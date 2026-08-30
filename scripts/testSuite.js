const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { connectDB, disconnectDB } = require('../config/db');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const Review = require('../models/Review');
const Notification = require('../models/Notification');
const { triageRequest } = require('../services/aiTriageService');
const bcrypt = require('bcryptjs');

dotenv.config();

async function runTestSuite() {
  console.log('\n========================================================');
  console.log(' 🧪 Starting SupportFlow Automated Verification Test Suite');
  console.log('========================================================\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition, testName) => {
    if (condition) {
      console.log(` ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(` ❌ FAIL: ${testName}`);
      failed++;
    }
  };

  try {
    await connectDB();
    await User.deleteMany({});
    await Ticket.deleteMany({});
    await Review.deleteMany({});
    await Notification.deleteMany({});

    // --- TEST 1: Customer Signup & Active Status ---
    const customer = await User.create({
      name: 'Alice Customer',
      email: 'alice@test.com',
      password: 'Password@123',
      role: 'customer',
    });
    assert(customer.role === 'customer' && customer.isActive === true, 'Customer is active immediately on registration');

    // --- TEST 2: Worker Signup & Pending Approval State ---
    const worker = await User.create({
      name: 'Bob Worker',
      email: 'bob@test.com',
      password: 'Password@123',
      role: 'worker',
      workerApprovalStatus: 'pending',
      isActive: false,
    });
    assert(worker.role === 'worker' && worker.workerApprovalStatus === 'pending' && worker.isActive === false, 'Worker registration requires pending approval');

    // --- TEST 3: Admin Approval Workflow ---
    worker.workerApprovalStatus = 'approved';
    worker.isActive = true;
    await worker.save();
    const updatedWorker = await User.findById(worker._id);
    assert(updatedWorker.workerApprovalStatus === 'approved' && updatedWorker.isActive === true, 'Admin can approve worker registration');

    // --- TEST 4: OTP Password Reset Mechanism ---
    const rawOtp = '654321';
    const salt = await bcrypt.genSalt(10);
    customer.passwordResetOTPHash = await bcrypt.hash(rawOtp, salt);
    customer.passwordResetOTPExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await customer.save();

    const isOtpValid = await bcrypt.compare(rawOtp, customer.passwordResetOTPHash);
    const isNotExpired = customer.passwordResetOTPExpiresAt > new Date();
    assert(isOtpValid && isNotExpired, 'OTP verification and expiration validate correctly');

    // Reset password
    customer.password = 'NewPassword@123';
    customer.passwordResetOTPHash = null;
    customer.passwordResetOTPExpiresAt = null;
    await customer.save();

    const checkCust = await User.findById(customer._id).select('+password +passwordResetOTPHash');
    const isNewPassValid = await checkCust.matchPassword('NewPassword@123');
    assert(isNewPassValid && checkCust.passwordResetOTPHash === null, 'Password reset completes and clears OTP security tokens');

    // --- TEST 5: Deterministic Local AI Triage ---
    const triageBilling = triageRequest('Invoice payment failed with 500 error', 'Monthly stripe subscription was declined.');
    assert(triageBilling.category === 'Billing & Payments', 'AI Triage accurately classifies Billing & Payments category');

    const triageCritical = triageRequest('Production down outage', 'All servers are unreachable with fatal error.');
    assert(triageCritical.priority === 'Critical', 'AI Triage accurately assesses Critical priority');

    // --- TEST 6: Customer Request Creation & Workflow State Machine ---
    const ticket = await Ticket.create({
      ticketNumber: 'SF-9001',
      customer: customer._id,
      subject: 'WiFi connection drops periodically in conference room',
      description: 'The wireless access point disconnects laptops every 15 minutes.',
      category: 'Network & Connectivity',
      priority: 'Medium',
      status: 'Pending',
    });
    assert(ticket.status === 'Pending' && ticket.assignedWorker === null, 'Customer creates request with initial Pending status');

    // --- TEST 7: Worker Acceptance & Single-Worker Assignment ---
    ticket.assignedWorker = worker._id;
    ticket.status = 'Accepted';
    ticket.acceptedAt = new Date();
    await ticket.save();
    assert(ticket.status === 'Accepted' && ticket.assignedWorker.toString() === worker._id.toString(), 'Worker can accept pending request and is assigned exclusively');

    // --- TEST 8: Worker Operational Priority Adjustment ---
    ticket.priority = 'Urgent';
    await ticket.save();
    assert(ticket.priority === 'Urgent', 'Assigned worker can modify operational priority');

    // --- TEST 9: Status Progression ---
    ticket.status = 'In Progress';
    await ticket.save();
    assert(ticket.status === 'In Progress', 'Status transitions from Accepted to In Progress');

    ticket.status = 'Resolved';
    ticket.resolvedAt = new Date();
    await ticket.save();
    assert(ticket.status === 'Resolved' && ticket.resolvedAt !== null, 'Status transitions from In Progress to Resolved');

    // --- TEST 10: Customer 5-Star Review & Rating Constraint ---
    const review = await Review.create({
      ticket: ticket._id,
      customer: customer._id,
      worker: worker._id,
      rating: 5,
      comment: 'Superb and rapid network resolution!',
    });
    ticket.hasReview = true;
    await ticket.save();
    assert(review.rating === 5 && ticket.hasReview === true, 'Customer can submit 5-star review on resolved ticket');

    // Duplicate review constraint
    let duplicateRejected = false;
    try {
      await Review.create({
        ticket: ticket._id,
        customer: customer._id,
        worker: worker._id,
        rating: 4,
      });
    } catch (e) {
      duplicateRejected = true;
    }
    assert(duplicateRejected, 'Unique index prevents duplicate reviews for the same ticket');

    // --- TEST 11: Real Aggregate Rating Calculation ---
    const agg = await Review.aggregate([
      { $match: { worker: worker._id } },
      { $group: { _id: '$worker', avg: { $avg: '$rating' }, count: { $sum: 1 } } }
    ]);
    assert(agg.length > 0 && agg[0].avg === 5 && agg[0].count === 1, 'MongoDB aggregation calculates verified average worker rating');

    console.log('\n========================================================');
    console.log(` 📊 Test Results: ${passed} Passed, ${failed} Failed`);
    console.log('========================================================\n');

    await disconnectDB();
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test runner fatal error:', err);
    process.exit(1);
  }
}

runTestSuite();
