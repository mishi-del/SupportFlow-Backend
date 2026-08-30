const User = require('../models/User');
const Ticket = require('../models/Ticket');
const Review = require('../models/Review');
const {
  createAndSendNotification,
  broadcastSocketEvent,
} = require('../services/notificationService');

/**
 * @desc    Get comprehensive Admin statistics and KPI metrics
 * @route   GET /api/admin/stats
 * @access  Private (Admin)
 */
exports.getDashboardStats = async (req, res, next) => {
  try {
    const [
      totalCustomers,
      totalWorkers,
      pendingWorkerApplications,
      approvedWorkers,
      rejectedWorkerApplications,
      totalRequests,
      pendingRequests,
      acceptedRequests,
      inProgressRequests,
      resolvedRequests,
      rejectedRequests,
      totalReviews,
    ] = await Promise.all([
      User.countDocuments({ role: 'customer' }),
      User.countDocuments({ role: 'worker' }),
      User.countDocuments({ role: 'worker', workerApprovalStatus: 'pending' }),
      User.countDocuments({ role: 'worker', workerApprovalStatus: 'approved' }),
      User.countDocuments({ role: 'worker', workerApprovalStatus: 'rejected' }),
      Ticket.countDocuments(),
      Ticket.countDocuments({ status: 'Pending' }),
      Ticket.countDocuments({ status: 'Accepted' }),
      Ticket.countDocuments({ status: 'In Progress' }),
      Ticket.countDocuments({ status: 'Resolved' }),
      Ticket.countDocuments({ status: 'Rejected' }),
      Review.countDocuments(),
    ]);

    // Calculate system-wide average rating
    const ratingAggregation = await Review.aggregate([
      { $group: { _id: null, avgRating: { $avg: '$rating' } } },
    ]);
    const systemAverageRating =
      ratingAggregation.length > 0
        ? Number(ratingAggregation[0].avgRating.toFixed(1))
        : 0;

    res.status(200).json({
      success: true,
      stats: {
        totalCustomers,
        totalWorkers,
        pendingWorkerApplications,
        approvedWorkers,
        rejectedWorkerApplications,
        totalRequests,
        pendingRequests,
        acceptedRequests,
        inProgressRequests,
        resolvedRequests,
        rejectedRequests,
        totalReviews,
        systemAverageRating,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get all worker registration applications
 * @route   GET /api/admin/worker-requests
 * @access  Private (Admin)
 */
exports.getWorkerRequests = async (req, res, next) => {
  try {
    const { status } = req.query;
    let query = { role: 'worker' };

    if (status && status !== 'all') {
      query.workerApprovalStatus = status;
    }

    const workers = await User.find(query)
      .select('-password -passwordResetOTPHash')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: workers.length,
      workers,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Approve a worker application
 * @route   POST /api/admin/workers/:id/approve
 * @access  Private (Admin)
 */
exports.approveWorker = async (req, res, next) => {
  try {
    const worker = await User.findById(req.params.id);

    if (!worker || worker.role !== 'worker') {
      return res.status(404).json({
        success: false,
        message: 'Worker application not found',
      });
    }

    worker.workerApprovalStatus = 'approved';
    worker.isActive = true;
    await worker.save();

    // Send notification to worker
    await createAndSendNotification({
      recipient: worker._id,
      type: 'worker_approved',
      title: 'Application Approved!',
      message:
        'Your Worker application has been approved. You can now login and start receiving Customer requests.',
      link: '/worker/dashboard',
    });

    broadcastSocketEvent('worker-application-approved', {
      workerId: worker._id,
      name: worker.name,
      email: worker.email,
    });

    res.status(200).json({
      success: true,
      message: `Worker ${worker.name} approved successfully`,
      worker,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Reject a worker application
 * @route   POST /api/admin/workers/:id/reject
 * @access  Private (Admin)
 */
exports.rejectWorker = async (req, res, next) => {
  try {
    const worker = await User.findById(req.params.id);

    if (!worker || worker.role !== 'worker') {
      return res.status(404).json({
        success: false,
        message: 'Worker application not found',
      });
    }

    worker.workerApprovalStatus = 'rejected';
    worker.isActive = false;
    await worker.save();

    // Send notification to worker applicant
    await createAndSendNotification({
      recipient: worker._id,
      type: 'worker_rejected',
      title: 'Application Update',
      message:
        'Your Worker application was not approved by the Administrator.',
    });

    broadcastSocketEvent('worker-application-rejected', {
      workerId: worker._id,
      name: worker.name,
      email: worker.email,
    });

    res.status(200).json({
      success: true,
      message: `Worker application for ${worker.name} has been rejected`,
      worker,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get all users in the system (Admin)
 * @route   GET /api/admin/users
 * @access  Private (Admin)
 */
exports.getAllUsers = async (req, res, next) => {
  try {
    const { role, search } = req.query;
    let query = {};

    if (role && role !== 'all') {
      query.role = role;
    }

    if (search) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [{ name: searchRegex }, { email: searchRegex }];
    }

    const users = await User.find(query)
      .select('-password -passwordResetOTPHash')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Toggle user active status
 * @route   PUT /api/admin/users/:id/toggle-active
 * @access  Private (Admin)
 */
exports.toggleUserActive = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Prevent deactivating oneself
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate your own administrator account',
      });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.status(200).json({
      success: true,
      message: `User account is now ${user.isActive ? 'Active' : 'Inactive'}`,
      user,
    });
  } catch (err) {
    next(err);
  }
};
