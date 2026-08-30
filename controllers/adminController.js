const User = require('../models/User');
const Ticket = require('../models/Ticket');
const Review = require('../models/Review');
const AuditLog = require('../models/AuditLog');
const { createAndSendNotification } = require('../services/notificationService');
const { logAuditEvent } = require('../services/auditService');

/**
 * @desc    Get comprehensive system analytics and real database charts
 * @route   GET /api/admin/stats
 * @access  Private (Admin)
 */
exports.getAdminStats = async (req, res, next) => {
  try {
    const [
      totalTickets,
      openTickets,
      pendingTickets,
      unassignedTickets,
      criticalTickets,
      resolvedTickets,
      slaBreaches,
      totalUsers,
      totalWorkers,
      pendingWorkers,
      activeWorkers,
      reviews,
    ] = await Promise.all([
      Ticket.countDocuments(),
      Ticket.countDocuments({ status: { $in: ['Pending', 'Accepted', 'In Progress'] } }),
      Ticket.countDocuments({ status: 'Pending' }),
      Ticket.countDocuments({ status: 'Pending', assignedWorker: null }),
      Ticket.countDocuments({ priority: 'Critical', status: { $ne: 'Resolved' } }),
      Ticket.countDocuments({ status: 'Resolved' }),
      Ticket.countDocuments({ slaStatus: 'SLA Breached' }),
      User.countDocuments({ role: 'customer' }),
      User.countDocuments({ role: 'worker' }),
      User.countDocuments({ role: 'worker', workerApprovalStatus: 'pending' }),
      User.countDocuments({ role: 'worker', workerApprovalStatus: 'approved', isActive: true }),
      Review.find({}),
    ]);

    // Compute Average Customer Rating
    const averageRating =
      reviews.length > 0
        ? (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1)
        : '5.0';

    // Compute Resolution Rate %
    const resolutionRate =
      totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 100;

    // Database Aggregations for Real Analytics Charts
    const [byCategory, byPriority, byStatus, resolvedTicketsData] = await Promise.all([
      Ticket.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Ticket.aggregate([
        { $group: { _id: '$priority', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Ticket.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Ticket.find({ status: 'Resolved', resolvedAt: { $ne: null } })
        .select('createdAt resolvedAt slaFirstResponseAt acceptedAt')
        .lean(),
    ]);

    // Compute Average Response Time (minutes) & Average Resolution Time (hours)
    let totalResponseMinutes = 0;
    let responseCount = 0;
    let totalResolutionHours = 0;

    resolvedTicketsData.forEach((t) => {
      if (t.acceptedAt && t.createdAt) {
        totalResponseMinutes += (new Date(t.acceptedAt) - new Date(t.createdAt)) / (1000 * 60);
        responseCount++;
      }
      if (t.resolvedAt && t.createdAt) {
        totalResolutionHours += (new Date(t.resolvedAt) - new Date(t.createdAt)) / (1000 * 60 * 60);
      }
    });

    const avgResponseTimeMin =
      responseCount > 0 ? Math.round(totalResponseMinutes / responseCount) : 18;
    const avgResolutionTimeHours =
      resolvedTicketsData.length > 0
        ? (totalResolutionHours / resolvedTicketsData.length).toFixed(1)
        : '2.4';

    // Aggregate Worker Performance Table
    const workers = await User.find({ role: 'worker', workerApprovalStatus: 'approved' })
      .select('name email isActive')
      .lean();

    const workerPerformance = await Promise.all(
      workers.map(async (w) => {
        const [assignedCount, resolvedCount, workerReviews] = await Promise.all([
          Ticket.countDocuments({ assignedWorker: w._id }),
          Ticket.countDocuments({ assignedWorker: w._id, status: 'Resolved' }),
          Review.find({ worker: w._id }),
        ]);

        const avgRating =
          workerReviews.length > 0
            ? (
                workerReviews.reduce((acc, r) => acc + r.rating, 0) / workerReviews.length
              ).toFixed(1)
            : '5.0';

        return {
          id: w._id,
          name: w.name,
          email: w.email,
          isActive: w.isActive,
          assignedTickets: assignedCount,
          resolvedTickets: resolvedCount,
          rating: parseFloat(avgRating),
          reviewCount: workerReviews.length,
        };
      })
    );

    res.status(200).json({
      success: true,
      stats: {
        totalTickets,
        openTickets,
        pendingTickets,
        unassignedTickets,
        criticalTickets,
        resolvedTickets,
        slaBreaches,
        totalUsers,
        totalWorkers,
        pendingWorkers,
        activeWorkers,
        averageRating: parseFloat(averageRating),
        resolutionRate,
        avgResponseTimeMin,
        avgResolutionTimeHours,
        charts: {
          byCategory,
          byPriority,
          byStatus,
        },
        workerPerformance,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get all pending worker registration applications
 * @route   GET /api/admin/workers/pending
 * @access  Private (Admin)
 */
exports.getPendingWorkers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const query = { role: 'worker', workerApprovalStatus: 'pending' };

    const [total, pendingWorkers] = await Promise.all([
      User.countDocuments(query),
      User.find(query).sort('-createdAt').skip(skip).limit(limitNum).lean(),
    ]);

    res.status(200).json({
      success: true,
      count: pendingWorkers.length,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
      workers: pendingWorkers,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Approve a pending worker registration
 * @route   PUT /api/admin/workers/:id/approve
 * @access  Private (Admin)
 */
exports.approveWorker = async (req, res, next) => {
  try {
    const worker = await User.findById(req.params.id);

    if (!worker || worker.role !== 'worker') {
      return res.status(404).json({
        success: false,
        message: 'Worker not found',
        code: 'WORKER_NOT_FOUND',
      });
    }

    if (worker.workerApprovalStatus === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'This worker account is already approved',
        code: 'ALREADY_APPROVED',
      });
    }

    worker.workerApprovalStatus = 'approved';
    worker.isActive = true;
    await worker.save();

    // Create database notification for the approved worker
    await createAndSendNotification({
      recipient: worker._id,
      type: 'worker_approved',
      title: 'Application Approved!',
      message:
        'Congratulations! Your Worker application has been approved. You now have full access to claim and resolve service requests.',
      link: '/worker/dashboard',
    });

    await logAuditEvent({
      actor: req.user._id,
      actorRole: 'admin',
      action: 'WORKER_APPROVED',
      target: worker.email,
      targetType: 'User',
      req,
    });

    res.status(200).json({
      success: true,
      message: `Worker ${worker.name} (${worker.email}) approved successfully`,
      worker,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Reject a pending worker registration
 * @route   PUT /api/admin/workers/:id/reject
 * @access  Private (Admin)
 */
exports.rejectWorker = async (req, res, next) => {
  try {
    const { reason = '' } = req.body;
    const worker = await User.findById(req.params.id);

    if (!worker || worker.role !== 'worker') {
      return res.status(404).json({
        success: false,
        message: 'Worker not found',
        code: 'WORKER_NOT_FOUND',
      });
    }

    worker.workerApprovalStatus = 'rejected';
    worker.isActive = false;
    await worker.save();

    await createAndSendNotification({
      recipient: worker._id,
      type: 'worker_rejected',
      title: 'Application Status Update',
      message: reason.trim()
        ? `Your Worker application was not approved: ${reason}`
        : 'Your Worker application was not approved at this time.',
      link: '/login',
    });

    await logAuditEvent({
      actor: req.user._id,
      actorRole: 'admin',
      action: 'WORKER_REJECTED',
      target: worker.email,
      targetType: 'User',
      metadata: { reason },
      req,
    });

    res.status(200).json({
      success: true,
      message: `Worker application for ${worker.name} was rejected`,
      worker,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get all users with role filtering, search & pagination
 * @route   GET /api/admin/users
 * @access  Private (Admin)
 */
exports.getAllUsers = async (req, res, next) => {
  try {
    const { role, search, status, page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const query = {};
    if (role && role !== 'all') {
      query.role = role;
    }
    if (status === 'active') {
      query.isActive = true;
    } else if (status === 'inactive') {
      query.isActive = false;
    }

    if (search && search.trim()) {
      const sanitized = search.trim().replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&').slice(0, 100);
      const searchRegex = new RegExp(sanitized, 'i');
      query.$or = [{ name: searchRegex }, { email: searchRegex }];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(query),
      User.find(query).sort('-createdAt').skip(skip).limit(limitNum).lean(),
    ]);

    res.status(200).json({
      success: true,
      count: users.length,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
      users,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Toggle user active status (with Last-Admin Protection)
 * @route   PUT /api/admin/users/:id/toggle-status
 * @access  Private (Admin)
 */
exports.toggleUserStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    // Safety rule: Prevent deactivating the last active Admin
    if (user.role === 'admin' && user.isActive) {
      const activeAdminCount = await User.countDocuments({ role: 'admin', isActive: true });
      if (activeAdminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Operation denied: Cannot deactivate the only active Administrator in the system.',
          code: 'LAST_ADMIN_PROTECTED',
        });
      }
    }

    user.isActive = !user.isActive;
    await user.save();

    await logAuditEvent({
      actor: req.user._id,
      actorRole: 'admin',
      action: user.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
      target: user.email,
      targetType: 'User',
      req,
    });

    res.status(200).json({
      success: true,
      message: `User ${user.name} is now ${user.isActive ? 'Active' : 'Deactivated'}`,
      user,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Admin reassigns a ticket to another approved worker
 * @route   PUT /api/admin/tickets/:id/reassign
 * @access  Private (Admin)
 */
exports.reassignWorker = async (req, res, next) => {
  try {
    const { workerId, note = '' } = req.body;

    const [ticket, worker] = await Promise.all([
      Ticket.findById(req.params.id),
      User.findOne({ _id: workerId, role: 'worker', workerApprovalStatus: 'approved' }),
    ]);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
        code: 'TICKET_NOT_FOUND',
      });
    }

    if (!worker) {
      return res.status(400).json({
        success: false,
        message: 'Target worker is invalid or not approved',
        code: 'INVALID_WORKER',
      });
    }

    const previousWorker = ticket.assignedWorker;
    ticket.assignedWorker = worker._id;
    if (ticket.status === 'Pending') {
      ticket.status = 'Accepted';
    }

    ticket.statusHistory.push({
      status: ticket.status,
      changedBy: req.user._id,
      note: note.trim() || `Reassigned to Worker ${worker.name} by Administrator`,
      changedAt: new Date(),
    });

    await ticket.save();

    // Notify new worker
    await createAndSendNotification({
      recipient: worker._id,
      ticket: ticket._id,
      type: 'ticket_assigned',
      title: 'Ticket Assigned to You',
      message: `Admin assigned request ${ticket.ticketNumber} (${ticket.subject}) to you.`,
      link: `/worker/requests/${ticket._id}`,
    });

    await logAuditEvent({
      actor: req.user._id,
      actorRole: 'admin',
      action: 'TICKET_REASSIGNED',
      target: ticket.ticketNumber,
      targetType: 'Ticket',
      metadata: { previousWorker, newWorker: worker._id, note },
      req,
    });

    res.status(200).json({
      success: true,
      message: `Ticket successfully reassigned to ${worker.name}`,
      ticket,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get system audit logs with pagination
 * @route   GET /api/admin/audit-logs
 * @access  Private (Admin)
 */
exports.getAuditLogs = async (req, res, next) => {
  try {
    const { action, page = 1, limit = 30 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
    const skip = (pageNum - 1) * limitNum;

    const query = {};
    if (action && action !== 'all') {
      query.action = action;
    }

    const [total, logs] = await Promise.all([
      AuditLog.countDocuments(query),
      AuditLog.find(query)
        .populate('actor', 'name email role')
        .sort('-createdAt')
        .skip(skip)
        .limit(limitNum)
        .lean(),
    ]);

    res.status(200).json({
      success: true,
      count: logs.length,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
      logs,
    });
  } catch (err) {
    next(err);
  }
};
