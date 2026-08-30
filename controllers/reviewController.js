const Review = require('../models/Review');
const Ticket = require('../models/Ticket');
const { createAndSendNotification } = require('../services/notificationService');
const { logAuditEvent } = require('../services/auditService');

/**
 * @desc    Submit a 5-star review on a resolved request (Customer only)
 * @route   POST /api/reviews
 * @access  Private (Customer)
 */
exports.createReview = async (req, res, next) => {
  try {
    const { ticketId, rating, comment = '' } = req.body;

    if (!ticketId || rating === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Ticket ID and star rating (1-5) are required',
        code: 'MISSING_FIELDS',
      });
    }

    const ratingNum = parseInt(rating, 10);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({
        success: false,
        message: 'Star rating must be an integer between 1 and 5',
        code: 'INVALID_RATING',
      });
    }

    if (comment && comment.trim().length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Comment cannot exceed 1000 characters',
        code: 'COMMENT_TOO_LONG',
      });
    }

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
        code: 'TICKET_NOT_FOUND',
      });
    }

    // Customer ownership validation
    if (ticket.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only review requests submitted by your account.',
        code: 'FORBIDDEN',
      });
    }

    // Must be in Resolved or Closed status
    if (ticket.status !== 'Resolved' && ticket.status !== 'Closed') {
      return res.status(400).json({
        success: false,
        message: `Reviews can only be submitted for Resolved or Closed requests. Current status: '${ticket.status}'.`,
        code: 'TICKET_NOT_RESOLVED',
      });
    }

    if (!ticket.assignedWorker) {
      return res.status(400).json({
        success: false,
        message: 'Cannot review a request with no assigned worker.',
        code: 'NO_ASSIGNED_WORKER',
      });
    }

    // Check for existing review (enforced by DB unique index as well)
    const existingReview = await Review.findOne({ ticket: ticketId });
    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'A review has already been submitted for this request. Reviews cannot be submitted twice.',
        code: 'DUPLICATE_REVIEW',
      });
    }

    const review = await Review.create({
      ticket: ticket._id,
      customer: req.user._id,
      worker: ticket.assignedWorker,
      rating: ratingNum,
      comment: comment.trim(),
    });

    ticket.hasReview = true;
    await ticket.save();

    // Create database notification for Worker
    await createAndSendNotification({
      recipient: ticket.assignedWorker,
      ticket: ticket._id,
      type: 'review_submitted',
      title: 'New Customer Review Received',
      message: `${req.user.name} rated your service ${ratingNum}/5 stars on request ${ticket.ticketNumber}.`,
      link: '/worker/profile',
    });

    await logAuditEvent({
      actor: req.user._id,
      actorRole: 'customer',
      action: 'REVIEW_SUBMITTED',
      target: ticket.ticketNumber,
      targetType: 'Review',
      metadata: { rating: ratingNum },
      req,
    });

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully! Thank you for your feedback.',
      review,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get reviews and aggregate rating metrics for a worker
 * @route   GET /api/reviews/worker/:workerId
 * @access  Private
 */
exports.getWorkerReviews = async (req, res, next) => {
  try {
    const workerId = req.params.workerId;
    const { page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [total, reviews] = await Promise.all([
      Review.countDocuments({ worker: workerId }),
      Review.find({ worker: workerId })
        .populate('customer', 'name')
        .populate('ticket', 'ticketNumber subject')
        .sort('-createdAt')
        .skip(skip)
        .limit(limitNum)
        .lean(),
    ]);

    // Aggregate statistics
    const allWorkerReviews = await Review.find({ worker: workerId });
    const count = allWorkerReviews.length;
    const average =
      count > 0
        ? (allWorkerReviews.reduce((sum, r) => sum + r.rating, 0) / count).toFixed(1)
        : '5.0';

    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    allWorkerReviews.forEach((r) => {
      if (distribution[r.rating] !== undefined) {
        distribution[r.rating]++;
      }
    });

    res.status(200).json({
      success: true,
      stats: {
        averageRating: parseFloat(average),
        totalReviews: count,
        distribution,
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
      reviews,
    });
  } catch (err) {
    next(err);
  }
};
