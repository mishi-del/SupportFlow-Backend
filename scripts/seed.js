const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { connectDB } = require('../config/db');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const Notification = require('../models/Notification');
const Review = require('../models/Review');
const { triageRequest } = require('../services/aiTriageService');

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

    console.log('[Seeder] Creating users...');

    // 1. Single System Admin
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

    console.log('[Seeder] Creating sample tickets and conversations...');

    // Ticket 1: Resolved with review
    const t1Subject = 'Cannot process enterprise invoice payments with Stripe gateway';
    const t1Desc =
      'Our monthly billing renewal failed this morning. Customers are seeing a payment gateway error 500 when attempting to update credit card details.';
    const t1Ai = triageRequest(t1Subject, t1Desc);

    const ticket1 = await Ticket.create({
      ticketNumber: 'SF-1001',
      customer: customer1._id,
      assignedWorker: worker1._id,
      subject: t1Subject,
      description: t1Desc,
      category: t1Ai.category,
      priority: 'High',
      status: 'Resolved',
      aiTriage: t1Ai,
      acceptedAt: new Date(Date.now() - 3600000 * 24),
      resolvedAt: new Date(Date.now() - 3600000 * 4),
      hasReview: true,
      statusHistory: [
        {
          status: 'Pending',
          changedBy: customer1._id,
          note: 'Request created by customer.',
          changedAt: new Date(Date.now() - 3600000 * 25),
        },
        {
          status: 'Accepted',
          changedBy: worker1._id,
          note: 'Accepted by Alex Taylor',
          changedAt: new Date(Date.now() - 3600000 * 24),
        },
        {
          status: 'In Progress',
          changedBy: worker1._id,
          note: 'Investigating Stripe API webhook logs',
          changedAt: new Date(Date.now() - 3600000 * 12),
        },
        {
          status: 'Resolved',
          changedBy: worker1._id,
          note: 'Webhook TLS certificate updated and failing payment retry queue cleared.',
          changedAt: new Date(Date.now() - 3600000 * 4),
        },
      ],
      messages: [
        {
          sender: customer1._id,
          senderRole: 'customer',
          senderName: 'Emily Watson',
          text: 'Hi Alex, any update on the Stripe gateway issues? We have pending transactions.',
          createdAt: new Date(Date.now() - 3600000 * 10),
        },
        {
          sender: worker1._id,
          senderRole: 'worker',
          senderName: 'Alex Taylor',
          text: 'Hello Emily! I found the expired webhook certificate and rotated it. The retry queue is now executing cleanly.',
          createdAt: new Date(Date.now() - 3600000 * 5),
        },
        {
          sender: customer1._id,
          senderRole: 'customer',
          senderName: 'Emily Watson',
          text: 'All transactions went through! Thank you so much for the swift resolution.',
          createdAt: new Date(Date.now() - 3600000 * 4),
        },
      ],
    });

    // Review for Ticket 1
    await Review.create({
      ticket: ticket1._id,
      customer: customer1._id,
      worker: worker1._id,
      rating: 5,
      comment:
        'Alex was extremely fast and resolved our payment gateway issue in no time. Top tier support!',
    });

    // Ticket 2: In Progress
    const t2Subject = 'Database connection timeout in production cluster';
    const t2Desc =
      'Our primary MongoDB replica set is rejecting incoming connections during peak traffic spikes. We are experiencing production downtime.';
    const t2Ai = triageRequest(t2Subject, t2Desc);

    await Ticket.create({
      ticketNumber: 'SF-1002',
      customer: customer2._id,
      assignedWorker: worker1._id,
      subject: t2Subject,
      description: t2Desc,
      category: t2Ai.category,
      priority: 'Critical',
      status: 'In Progress',
      aiTriage: t2Ai,
      acceptedAt: new Date(Date.now() - 3600000 * 2),
      statusHistory: [
        {
          status: 'Pending',
          changedBy: customer2._id,
          note: 'Request created',
          changedAt: new Date(Date.now() - 3600000 * 3),
        },
        {
          status: 'Accepted',
          changedBy: worker1._id,
          note: 'Accepted by Alex Taylor',
          changedAt: new Date(Date.now() - 3600000 * 2),
        },
        {
          status: 'In Progress',
          changedBy: worker1._id,
          note: 'Analyzing pool connection metrics and indexing bottlenecks.',
          changedAt: new Date(Date.now() - 3600000 * 1),
        },
      ],
      messages: [
        {
          sender: worker1._id,
          senderRole: 'worker',
          senderName: 'Alex Taylor',
          text: 'I am reviewing the active query telemetry. Increasing connection pool limit temporarily.',
          createdAt: new Date(Date.now() - 3600000 * 1),
        },
      ],
    });

    // Ticket 3: Accepted
    const t3Subject = 'VPN gateway unreachable after router firmware update';
    const t3Desc =
      'Remote employees in Europe are unable to connect to the internal VPN gateway since 08:00 AM.';
    const t3Ai = triageRequest(t3Subject, t3Desc);

    await Ticket.create({
      ticketNumber: 'SF-1003',
      customer: customer1._id,
      assignedWorker: worker2._id,
      subject: t3Subject,
      description: t3Desc,
      category: t3Ai.category,
      priority: 'Urgent',
      status: 'Accepted',
      aiTriage: t3Ai,
      acceptedAt: new Date(Date.now() - 3600000 * 1),
      statusHistory: [
        {
          status: 'Pending',
          changedBy: customer1._id,
          note: 'Created',
          changedAt: new Date(Date.now() - 3600000 * 2),
        },
        {
          status: 'Accepted',
          changedBy: worker2._id,
          note: 'Accepted by Sarah Jenkins',
          changedAt: new Date(Date.now() - 3600000 * 1),
        },
      ],
    });

    // Ticket 4: Pending in available pool
    const t4Subject = 'Dual monitor flicker on USB-C docking station';
    const t4Desc =
      'Whenever connecting 4K secondary displays via DisplayPort on the new Dell dock, the left screen periodically turns black.';
    const t4Ai = triageRequest(t4Subject, t4Desc);

    await Ticket.create({
      ticketNumber: 'SF-1004',
      customer: customer2._id,
      assignedWorker: null,
      subject: t4Subject,
      description: t4Desc,
      category: t4Ai.category,
      priority: 'Medium',
      status: 'Pending',
      aiTriage: t4Ai,
      statusHistory: [
        {
          status: 'Pending',
          changedBy: customer2._id,
          note: 'Awaiting worker review',
          changedAt: new Date(Date.now() - 3600000 * 4),
        },
      ],
    });

    // Ticket 5: Pending in available pool
    const t5Subject = 'Request 2FA authenticator reset for locked account';
    const t5Desc =
      'I lost my phone over the weekend and cannot receive authentication codes to access my account dashboard.';
    const t5Ai = triageRequest(t5Subject, t5Desc);

    await Ticket.create({
      ticketNumber: 'SF-1005',
      customer: customer1._id,
      assignedWorker: null,
      subject: t5Subject,
      description: t5Desc,
      category: t5Ai.category,
      priority: 'High',
      status: 'Pending',
      aiTriage: t5Ai,
      statusHistory: [
        {
          status: 'Pending',
          changedBy: customer1._id,
          note: 'Awaiting worker review',
          changedAt: new Date(Date.now() - 3600000 * 5),
        },
      ],
    });

    // Sample Notifications
    await Notification.create([
      {
        recipient: admin._id,
        type: 'worker_applied',
        title: 'New Worker Application',
        message: 'David Vance (worker.pending@supportflow.com) registered as a Worker and is pending approval.',
        link: '/admin/workers',
        isRead: false,
      },
      {
        recipient: customer1._id,
        ticket: ticket1._id,
        type: 'ticket_resolved',
        title: 'Request Resolved',
        message: 'Your request "Cannot process enterprise invoice payments" was resolved. Thank you for your review!',
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
    console.log(' Demo Accounts Created:');
    console.log('   👤 Admin (Single):   abiha@gmail.com (Password: 12345678)');
    console.log('   🛠️  Worker (Approved): worker1@supportflow.com (Password: Password@123)');
    console.log('   🛠️  Worker (Approved): worker2@supportflow.com (Password: Password@123)');
    console.log('   ⏳ Worker (Pending):  worker.pending@supportflow.com (Password: Password@123)');
    console.log('   🚫 Worker (Rejected): worker.rejected@supportflow.com (Password: Password@123)');
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
