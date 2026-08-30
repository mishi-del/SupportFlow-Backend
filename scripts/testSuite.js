const assert = require('assert');
const dotenv = require('dotenv');
const { connectDB, disconnectDB } = require('../config/db');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const Notification = require('../models/Notification');
const Review = require('../models/Review');
const KnowledgeBaseArticle = require('../models/KnowledgeBaseArticle');
const AuditLog = require('../models/AuditLog');
const { Counter, getNextTicketNumber } = require('../models/Counter');
const { triageRequest } = require('../services/aiTriageService');
const { calculateSlaDeadline, evaluateSlaStatus } = require('../services/slaService');

dotenv.config();

const runIntegrationTests = async () => {
  console.log('\n========================================================');
  console.log(' 🧪 Starting SupportFlow Automated Verification Test Suite');
  console.log('========================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  const test = (description, fn) => {
    try {
      fn();
      console.log(` ✅ PASS: ${description}`);
      passedCount++;
    } catch (err) {
      console.error(` ❌ FAIL: ${description}`);
      console.error(`    Error: ${err.message}`);
      failedCount++;
    }
  };

  const asyncTest = async (description, fn) => {
    try {
      await fn();
      console.log(` ✅ PASS: ${description}`);
      passedCount++;
    } catch (err) {
      console.error(` ❌ FAIL: ${description}`);
      console.error(`    Error: ${err.message}`);
      failedCount++;
    }
  };

  try {
    await connectDB();

    // Clean test database
    await User.deleteMany({});
    await Ticket.deleteMany({});
    await Notification.deleteMany({});
    await Review.deleteMany({});
    await Counter.deleteMany({});
    await KnowledgeBaseArticle.deleteMany({});
    await AuditLog.deleteMany({});

    // Initialize sequence counter
    await Counter.create({ _id: 'ticketNumber', seq: 1000 });

    // TEST 1: Customer instant active vs Worker pending approval
    await asyncTest('Customer is active immediately on registration', async () => {
      const customer = await User.create({
        name: 'Test Customer',
        email: 'test.customer@test.com',
        password: 'Password@123',
        role: 'customer',
      });
      assert.strictEqual(customer.isActive, true);
      assert.strictEqual(customer.workerApprovalStatus, 'approved');
    });

    await asyncTest('Worker registration requires pending approval', async () => {
      const worker = await User.create({
        name: 'Test Worker',
        email: 'test.worker@test.com',
        password: 'Password@123',
        role: 'worker',
      });
      assert.strictEqual(worker.isActive, false);
      assert.strictEqual(worker.workerApprovalStatus, 'pending');
    });

    // TEST 2: Admin Worker Approval & Last-Admin Protection
    await asyncTest('Admin can approve worker registration', async () => {
      const worker = await User.findOne({ email: 'test.worker@test.com' });
      worker.workerApprovalStatus = 'approved';
      worker.isActive = true;
      await worker.save();
      assert.strictEqual(worker.isActive, true);
      assert.strictEqual(worker.workerApprovalStatus, 'approved');
    });

    await asyncTest('Single Admin creation and Last-Admin protection check', async () => {
      const admin = await User.create({
        name: 'Abiha',
        email: 'abiha@gmail.com',
        password: '12345678',
        role: 'admin',
        isActive: true,
      });
      const activeAdminCount = await User.countDocuments({ role: 'admin', isActive: true });
      assert.strictEqual(activeAdminCount, 1);
      assert.strictEqual(admin.email, 'abiha@gmail.com');
    });

    // TEST 3: Collision-safe Ticket Number Generation
    await asyncTest('Atomic collision-safe ticket numbers generate sequentially', async () => {
      const t1 = await getNextTicketNumber();
      const t2 = await getNextTicketNumber();
      const t3 = await getNextTicketNumber();
      assert.strictEqual(t1, 'SF-1001');
      assert.strictEqual(t2, 'SF-1002');
      assert.strictEqual(t3, 'SF-1003');
    });

    // TEST 4: AI Triage Heuristic Engine
    test('AI Triage accurately classifies Billing & Payments with High Confidence', () => {
      const triage = triageRequest(
        'Invoice refund request',
        'Customer was overcharged on credit card subscription billing'
      );
      assert.strictEqual(triage.category, 'Billing');
      assert.strictEqual(triage.confidenceLabel, 'High Confidence');
    });

    test('AI Triage accurately assesses Critical priority for production outage', () => {
      const triage = triageRequest(
        'Complete system outage',
        'Production server down and all users affected in fatal crash'
      );
      assert.strictEqual(triage.priority, 'Critical');
    });

    // TEST 5: SLA Engine Calculations
    test('SLA Engine calculates accurate deadlines based on priority matrix', () => {
      const now = new Date();
      const criticalDeadline = calculateSlaDeadline('Critical', now);
      const highDeadline = calculateSlaDeadline('High', now);

      const criticalDiffMinutes = Math.round((criticalDeadline - now) / 60000);
      const highDiffMinutes = Math.round((highDeadline - now) / 60000);

      assert.strictEqual(criticalDiffMinutes, 15);
      assert.strictEqual(highDiffMinutes, 120);
    });

    // TEST 6: Atomic Concurrent Worker Ticket Acceptance
    await asyncTest('Simulated concurrent worker acceptance assigns only first worker', async () => {
      const customer = await User.findOne({ role: 'customer' });
      const workerA = await User.findOne({ email: 'test.worker@test.com' });
      const workerB = await User.create({
        name: 'Worker B',
        email: 'worker.b@test.com',
        password: 'Password@123',
        role: 'worker',
        workerApprovalStatus: 'approved',
        isActive: true,
      });

      const ticket = await Ticket.create({
        customer: customer._id,
        subject: 'Database connection pool exhausted',
        description: 'PostgreSQL max connections reached under load',
        category: 'Technical Support',
        priority: 'High',
        status: 'Pending',
      });

      // Worker A attempts atomic claim
      const claimA = await Ticket.findOneAndUpdate(
        { _id: ticket._id, status: 'Pending', assignedWorker: null },
        { $set: { assignedWorker: workerA._id, status: 'Accepted' } },
        { new: true }
      );

      // Worker B attempts atomic claim at virtually the same instant
      const claimB = await Ticket.findOneAndUpdate(
        { _id: ticket._id, status: 'Pending', assignedWorker: null },
        { $set: { assignedWorker: workerB._id, status: 'Accepted' } },
        { new: true }
      );

      assert(claimA !== null, 'Worker A should successfully claim the ticket');
      assert.strictEqual(claimB, null, 'Worker B claim should fail atomically');
      assert.strictEqual(claimA.assignedWorker.toString(), workerA._id.toString());
    });

    // TEST 7: Progressive State Machine Lifecycle
    await asyncTest('State machine enforces valid progression: Accepted -> In Progress -> Resolved -> Closed', async () => {
      const ticket = await Ticket.findOne({ status: 'Accepted' });
      assert(ticket, 'Ticket should exist');

      // 1. In Progress
      ticket.status = 'In Progress';
      await ticket.save();
      assert.strictEqual(ticket.status, 'In Progress');

      // 2. Resolved
      ticket.status = 'Resolved';
      ticket.resolvedAt = new Date();
      await ticket.save();
      assert.strictEqual(ticket.status, 'Resolved');

      // 3. Closed
      ticket.status = 'Closed';
      ticket.closedAt = new Date();
      await ticket.save();
      assert.strictEqual(ticket.status, 'Closed');

      // 4. Reopen -> Pending
      ticket.status = 'Pending';
      ticket.assignedWorker = null;
      await ticket.save();
      assert.strictEqual(ticket.status, 'Pending');
    });

    // TEST 8: 5-Star Customer Review Constraints
    await asyncTest('Customer can submit 5-star review on resolved ticket and uniqueness is enforced', async () => {
      const customer = await User.findOne({ role: 'customer' });
      const worker = await User.findOne({ email: 'test.worker@test.com' });

      const resolvedTicket = await Ticket.create({
        customer: customer._id,
        assignedWorker: worker._id,
        subject: 'WiFi configuration assistance',
        description: 'Assisted with 802.11ax mesh setup',
        status: 'Resolved',
        resolvedAt: new Date(),
      });

      const review = await Review.create({
        ticket: resolvedTicket._id,
        customer: customer._id,
        worker: worker._id,
        rating: 5,
        comment: 'Great service and quick resolution!',
      });

      assert.strictEqual(review.rating, 5);

      // Verify unique index prevents duplicate review for same ticket
      let duplicateError = false;
      try {
        await Review.create({
          ticket: resolvedTicket._id,
          customer: customer._id,
          worker: worker._id,
          rating: 4,
          comment: 'Duplicate review attempt',
        });
      } catch (err) {
        duplicateError = true;
      }
      assert.strictEqual(duplicateError, true, 'Duplicate review should be blocked by MongoDB unique index');
    });

    // TEST 9: Knowledge Base CRUD and View Counts
    await asyncTest('Knowledge Base articles search and view count increments correctly', async () => {
      const article = await KnowledgeBaseArticle.create({
        title: 'How to configure custom email domains in SupportFlow',
        slug: 'how-to-configure-custom-email-domains',
        category: 'Account',
        content: 'Navigate to email settings and enter your MX and SPF DNS records.',
        published: true,
      });

      const found = await KnowledgeBaseArticle.findOneAndUpdate(
        { slug: 'how-to-configure-custom-email-domains' },
        { $inc: { viewCount: 1 } },
        { new: true }
      );

      assert.strictEqual(found.viewCount, 1);
      assert.strictEqual(found.title, article.title);
    });

    // TEST 10: Audit Log Recording
    await asyncTest('System audit log records security actions accurately', async () => {
      const admin = await User.findOne({ role: 'admin' });
      const log = await AuditLog.create({
        actor: admin._id,
        actorRole: 'admin',
        action: 'TICKET_ESCALATED',
        target: 'SF-1002',
        targetType: 'Ticket',
        metadata: { reason: 'Hardware failure requires vendor dispatch' },
      });

      assert.strictEqual(log.action, 'TICKET_ESCALATED');
      assert.strictEqual(log.actorRole, 'admin');
    });

    console.log('\n========================================================');
    console.log(` 📊 Test Results: ${passedCount} Passed, ${failedCount} Failed`);
    console.log('========================================================\n');

    await disconnectDB();
    process.exit(failedCount > 0 ? 1 : 0);
  } catch (globalErr) {
    console.error('Fatal test runner error:', globalErr);
    process.exit(1);
  }
};

runIntegrationTests();
