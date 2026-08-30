const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { connectDB } = require('../config/db');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const Notification = require('../models/Notification');
const Review = require('../models/Review');
const { Counter } = require('../models/Counter');
const KnowledgeBaseArticle = require('../models/KnowledgeBaseArticle');
const AuditLog = require('../models/AuditLog');

dotenv.config();

const seedData = async () => {
  try {
    console.log('[Seeder] Connecting to database...');
    await connectDB();

    console.log('[Seeder] Clearing existing data...');
    await User.deleteMany({});
    await Ticket.deleteMany({});
    await Notification.deleteMany({});
    await Review.deleteMany({});
    await Counter.deleteMany({});
    await KnowledgeBaseArticle.deleteMany({});
    await AuditLog.deleteMany({});

    console.log('[Seeder] Initializing ticket sequence counter...');
    await Counter.create({ _id: 'ticketNumber', seq: 1000 });

    console.log('[Seeder] Creating users...');

    // 1. Single System Admin (Explicitly Requested: abiha@gmail.com / 12345678)
    const admin = await User.create({
      name: 'Abiha',
      email: 'abiha@gmail.com',
      password: '12345678',
      role: 'admin',
      workerApprovalStatus: 'approved',
      isActive: true,
    });

    // 2. Approved Worker 1
    const worker1 = await User.create({
      name: 'Alex Taylor',
      email: 'worker1@supportflow.com',
      password: 'Password@123',
      role: 'worker',
      workerApprovalStatus: 'approved',
      isActive: true,
    });

    // 3. Approved Worker 2
    const worker2 = await User.create({
      name: 'Sarah Jenkins',
      email: 'worker2@supportflow.com',
      password: 'Password@123',
      role: 'worker',
      workerApprovalStatus: 'approved',
      isActive: true,
    });

    // 4. Pending Worker
    const pendingWorker = await User.create({
      name: 'David Vance',
      email: 'worker.pending@supportflow.com',
      password: 'Password@123',
      role: 'worker',
      workerApprovalStatus: 'pending',
      isActive: false,
    });

    // 5. Rejected Worker
    const rejectedWorker = await User.create({
      name: 'Tom Brown',
      email: 'worker.rejected@supportflow.com',
      password: 'Password@123',
      role: 'worker',
      workerApprovalStatus: 'rejected',
      isActive: false,
    });

    // 6. Customers
    const customer1 = await User.create({
      name: 'Emily Watson',
      email: 'customer1@supportflow.com',
      password: 'Password@123',
      role: 'customer',
      workerApprovalStatus: 'approved',
      isActive: true,
    });

    const customer2 = await User.create({
      name: 'Michael Chang',
      email: 'customer2@supportflow.com',
      password: 'Password@123',
      role: 'customer',
      workerApprovalStatus: 'approved',
      isActive: true,
    });

    console.log('[Seeder] Creating Knowledge Base articles...');
    await KnowledgeBaseArticle.insertMany([
      {
        title: 'How to Reset Your Account Password and Enable 2FA',
        slug: 'how-to-reset-password-and-enable-2fa',
        category: 'Account',
        content: `If you forget your password, click the "Forgot Password?" link on the Sign In page. A cryptographically secure 6-digit verification code will be dispatched to your registered email address.\n\nEnter the 6-digit code within 10 minutes to verify your identity, then define a new strong password (minimum 6 characters).\n\nFor enhanced account protection, keep your credentials confidential and change your password periodically.`,
        tags: ['password', 'account', 'security', 'otp', 'reset'],
        published: true,
        viewCount: 142,
        helpfulCount: 38,
        author: admin._id,
      },
      {
        title: 'Understanding Billing Cycles, Invoices, and Payment Methods',
        slug: 'understanding-billing-cycles-and-invoices',
        category: 'Billing',
        content: `SupportFlow invoices are generated automatically at the beginning of each billing cycle.\n\nAccepted payment methods include major credit cards (Visa, MasterCard, American Express) and corporate bank transfers. If your transaction fails, verify that your card has international transactions enabled and retry. Invoices can be downloaded as PDF receipts at any time.`,
        tags: ['billing', 'invoice', 'payment', 'credit card'],
        published: true,
        viewCount: 89,
        helpfulCount: 24,
        author: admin._id,
      },
      {
        title: 'Troubleshooting High Latency, VPN Disconnections, and Network Timeouts',
        slug: 'troubleshooting-high-latency-and-vpn',
        category: 'Network',
        content: `If you experience network drops or slow response times:\n1. Run a traceroute test to verify where packet loss occurs.\n2. Ensure your local firewall allows UDP traffic on standard VPN gateway ports.\n3. Flush your DNS cache by running 'ipconfig /flushdns' in Command Prompt or Terminal.\n4. If connectivity issues persist, submit a Critical priority support request for immediate SLA routing.`,
        tags: ['network', 'vpn', 'latency', 'ping', 'dns'],
        published: true,
        viewCount: 215,
        helpfulCount: 76,
        author: worker2._id,
      },
      {
        title: 'Diagnosing Hardware & Peripheral Connection Errors',
        slug: 'diagnosing-hardware-and-peripheral-errors',
        category: 'Hardware',
        content: `When external monitors, audio devices, or docking stations fail to register:\n1. Check physical cable connections and power adapters.\n2. Verify device manager drivers for yellow warning exclamation marks.\n3. Disconnect other USB peripherals to test power load balance.\n4. Contact on-site engineering with device serial numbers for replacement.`,
        tags: ['hardware', 'monitor', 'docking', 'cables', 'device'],
        published: true,
        viewCount: 65,
        helpfulCount: 19,
        author: worker1._id,
      },
      {
        title: 'Resolving Application Crashes and 500 Server Errors',
        slug: 'resolving-application-crashes-and-500-errors',
        category: 'Technical Support',
        content: `Encountering an unexpected error code or blank screen?\n1. Clear your browser cache and cookies.\n2. Verify that you are running the latest version of Chrome, Firefox, or Safari.\n3. Check system status notifications for scheduled maintenance.\n4. Attach screenshots or error codes when submitting a support ticket to expedite resolution.`,
        tags: ['bug', 'crash', '500', 'error', 'browser'],
        published: true,
        viewCount: 178,
        helpfulCount: 52,
        author: admin._id,
      },
    ]);

    console.log('[Seeder] Creating sample tickets and conversations...');

    // Ticket 1: Resolved with 5-Star Review
    const ticket1 = await Ticket.create({
      ticketNumber: 'SF-1001',
      customer: customer1._id,
      assignedWorker: worker1._id,
      subject: 'Critical: Payment gateway timeout during client checkout',
      description:
        'When clients attempt to check out with Stripe, the payment modal spins indefinitely and times out after 45 seconds.',
      category: 'Billing',
      priority: 'Critical',
      status: 'Resolved',
      aiTriage: {
        category: 'Billing',
        priority: 'Critical',
        summary: 'Critical payment gateway checkout timeout triaged with Critical priority.',
        confidence: 0.95,
        confidenceLabel: 'High Confidence',
        suggestedActions: [
          'Immediate 15-minute SLA escalation triggered.',
          'Verify webhook delivery status and Stripe API logs.',
          'Restart payment microservice gateway.',
        ],
      },
      slaDeadline: new Date(Date.now() - 2 * 60 * 60 * 1000),
      slaFirstResponseAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      slaStatus: 'SLA Met',
      acceptedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
      resolvedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
      hasReview: true,
      statusHistory: [
        {
          status: 'Pending',
          changedBy: customer1._id,
          note: 'Request created by customer.',
          changedAt: new Date(Date.now() - 4.5 * 60 * 60 * 1000),
        },
        {
          status: 'Accepted',
          changedBy: worker1._id,
          note: 'Accepted by Worker Alex Taylor',
          changedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
        },
        {
          status: 'In Progress',
          changedBy: worker1._id,
          note: 'Investigating webhook certificates and timeout settings.',
          changedAt: new Date(Date.now() - 3.5 * 60 * 60 * 1000),
        },
        {
          status: 'Resolved',
          changedBy: worker1._id,
          note: 'Updated webhook TLS cipher configuration. Verified 5 successful checkout test runs.',
          changedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        },
      ],
      messages: [
        {
          sender: customer1._id,
          senderRole: 'customer',
          senderName: 'Emily Watson',
          text: 'Hi Alex, checkout is completely blocked for our European customers. Any updates?',
          createdAt: new Date(Date.now() - 3.8 * 60 * 60 * 1000),
        },
        {
          sender: worker1._id,
          senderRole: 'worker',
          senderName: 'Alex Taylor',
          text: 'Hello Emily! I am reviewing the webhook gateway logs right now. Found a TLS negotiation timeout. Deploying fix now.',
          createdAt: new Date(Date.now() - 3.5 * 60 * 60 * 1000),
        },
        {
          sender: worker1._id,
          senderRole: 'worker',
          senderName: 'Alex Taylor',
          text: 'Fix is deployed! Transactions are passing cleanly with <200ms latency. Marking this resolved.',
          createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        },
      ],
    });

    // Review on Ticket 1
    await Review.create({
      ticket: ticket1._id,
      customer: customer1._id,
      worker: worker1._id,
      rating: 5,
      comment: 'Incredible response time! Alex diagnosed the TLS handshake issue within minutes and saved our weekend launch.',
    });

    // Ticket 2: In Progress
    const ticket2 = await Ticket.create({
      ticketNumber: 'SF-1002',
      customer: customer2._id,
      assignedWorker: worker2._id,
      subject: 'Office VPN disconnecting every 10 minutes on macOS Sequoia',
      description:
        'All team members on macOS Sequoia experience abrupt VPN disconnects every 10-15 minutes.',
      category: 'Network',
      priority: 'High',
      status: 'In Progress',
      aiTriage: {
        category: 'Network',
        priority: 'High',
        summary: 'VPN stability and disconnect issue triaged with High priority.',
        confidence: 0.92,
        confidenceLabel: 'High Confidence',
        suggestedActions: [
          'Verify IKEv2 keep-alive handshake timers.',
          'Issue updated WireGuard configuration profile.',
        ],
      },
      slaDeadline: new Date(Date.now() + 90 * 60 * 1000),
      slaFirstResponseAt: new Date(Date.now() - 30 * 60 * 1000),
      slaStatus: 'Within SLA',
      acceptedAt: new Date(Date.now() - 45 * 60 * 1000),
      statusHistory: [
        {
          status: 'Pending',
          changedBy: customer2._id,
          note: 'Request created.',
          changedAt: new Date(Date.now() - 60 * 60 * 1000),
        },
        {
          status: 'Accepted',
          changedBy: worker2._id,
          note: 'Accepted by Worker Sarah Jenkins',
          changedAt: new Date(Date.now() - 45 * 60 * 1000),
        },
        {
          status: 'In Progress',
          changedBy: worker2._id,
          note: 'Diagnosing WireGuard handshake packet renegotiation parameters.',
          changedAt: new Date(Date.now() - 35 * 60 * 1000),
        },
      ],
      messages: [
        {
          sender: customer2._id,
          senderRole: 'customer',
          senderName: 'Michael Chang',
          text: 'Hi Sarah, it happens on both Wi-Fi and Ethernet connections.',
          createdAt: new Date(Date.now() - 35 * 60 * 1000),
        },
        {
          sender: worker2._id,
          senderRole: 'worker',
          senderName: 'Sarah Jenkins',
          text: 'Thanks Michael! Apple updated MTU handling in 15.1. I am preparing a revised profile with MTU 1380.',
          createdAt: new Date(Date.now() - 30 * 60 * 1000),
        },
      ],
    });

    // Ticket 3: Pending in Available Pool
    const ticket3 = await Ticket.create({
      ticketNumber: 'SF-1003',
      customer: customer1._id,
      assignedWorker: null,
      subject: 'Request for secondary monitor and 4K docking hub setup',
      description:
        'Need assistance configuring dual 4K external displays via Thunderbolt dock with display calibration.',
      category: 'Hardware',
      priority: 'Medium',
      status: 'Pending',
      aiTriage: {
        category: 'Hardware',
        priority: 'Medium',
        summary: 'Dual display hardware setup triaged with Medium priority.',
        confidence: 0.88,
        confidenceLabel: 'Medium Confidence',
        suggestedActions: [
          'Verify DisplayPort 1.4 MST support on target graphics card.',
          'Provide standardized docking station setup guide.',
        ],
      },
      slaDeadline: new Date(Date.now() + 6 * 60 * 60 * 1000),
      slaStatus: 'Within SLA',
      statusHistory: [
        {
          status: 'Pending',
          changedBy: customer1._id,
          note: 'Request placed in Available pool.',
          changedAt: new Date(Date.now() - 20 * 60 * 1000),
        },
      ],
      messages: [],
    });

    // Audit Logs
    await AuditLog.insertMany([
      {
        actor: admin._id,
        actorRole: 'admin',
        action: 'SYSTEM_INITIALIZED',
        target: 'SupportFlow v2.0',
        targetType: 'System',
        metadata: { version: '2.0.0', architecture: 'Pure REST' },
      },
      {
        actor: admin._id,
        actorRole: 'admin',
        action: 'WORKER_APPROVED',
        target: worker1.email,
        targetType: 'User',
      },
      {
        actor: admin._id,
        actorRole: 'admin',
        action: 'WORKER_APPROVED',
        target: worker2.email,
        targetType: 'User',
      },
      {
        actor: customer1._id,
        actorRole: 'customer',
        action: 'TICKET_CREATED',
        target: 'SF-1001',
        targetType: 'Ticket',
      },
    ]);

    // Initial Notifications
    await Notification.insertMany([
      {
        recipient: admin._id,
        type: 'worker_applied',
        title: 'New Worker Application',
        message: 'David Vance (worker.pending@supportflow.com) submitted a Worker application awaiting review.',
        link: '/admin/workers',
        isRead: false,
      },
      {
        recipient: customer1._id,
        ticket: ticket1._id,
        type: 'ticket_resolved',
        title: 'Request Completed & Resolved',
        message: 'Your request SF-1001 has been resolved by Alex Taylor. Please rate your service experience!',
        link: `/customer/requests/${ticket1._id}`,
        isRead: true,
      },
      {
        recipient: worker1._id,
        ticket: ticket1._id,
        type: 'review_submitted',
        title: 'New 5-Star Review',
        message: 'Emily Watson rated your service 5/5 stars on SF-1001.',
        link: '/worker/profile',
        isRead: false,
      },
    ]);

    console.log('\n======================================================');
    console.log(' ✨ SupportFlow Database Seed Completed Successfully!');
    console.log('======================================================');
    console.log(' Demo Accounts:');
    console.log('   👤 Single Admin:      abiha@gmail.com (Password: 12345678)');
    console.log('   🛠️  Approved Worker 1: worker1@supportflow.com (Password: Password@123)');
    console.log('   🛠️  Approved Worker 2: worker2@supportflow.com (Password: Password@123)');
    console.log('   ⏳ Pending Worker:    worker.pending@supportflow.com (Password: Password@123)');
    console.log('   🚫 Rejected Worker:   worker.rejected@supportflow.com (Password: Password@123)');
    console.log('   🙋 Customer 1:        customer1@supportflow.com (Password: Password@123)');
    console.log('   🙋 Customer 2:        customer2@supportflow.com (Password: Password@123)');
    console.log('======================================================\n');

    process.exit(0);
  } catch (err) {
    console.error('[Seeder] Error seeding database:', err);
    process.exit(1);
  }
};

seedData();
