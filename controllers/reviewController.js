const mongoose = require('mongoose');
const Review = require('../models/Review');
const Ticket = require('../models/Ticket');
const {
  createAndSendNotification,
  broadcastSocketEvent,
} = require('../services/notificationService');

/**
 * @desc    Submit a 5-star review for a completed/resolved ticket (Customer only)
 * @route   POST /api/tickets/:id/review
 * @access  Private (Customer)
 */
exports.submitReview = async (req, res, next) => {
  try {
    const { rating, comment = '' } = req.body;
    const ticketId = req.params.id;

    if (!rating || rating < 1 || rating > 5 || !Number.isInteger(Number(rating))) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be an integer between 1 and 5 stars',
        errors: ['Rating is required and must be between 1 and 5'],
      });
    }

    const ticket = await Ticket.findById(ticketId).populate('assignedWorker', 'name email');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    // Only the ticket owner can review
    if (ticket.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only review your own requests.',
      });
    }

    // Only resolved requests can be reviewed
    if (ticket.status !== 'Resolved') {
      return res.status(400).json({
        success: false,
        message: `Review not allowed before resolution. Current status is '${ticket.status}'.`,
        errors: ['Request must be in Resolved status to submit a review'],
      });
    }

    if (!ticket.assignedWorker) {
      return res.status(400).json({
        success: false,
        message: 'Cannot submit review for a request without an assigned worker.',
      });
    }

    // Check if review already exists
    const existingReview = await Review.findOne({ ticket: ticket._id });
    if (existingReview || ticket.hasReview) {
      return res.status(400).json({
        success: false,
        message: 'A review has already been submitted for this request.',
        errors: ['Duplicate review not allowed'],
      });
    }

    const review = await Review.create({
      ticket: ticket._id,
      customer: req.user._id,
      worker: ticket.assignedWorker._id,
      rating: Number(rating),
      comment: comment.trim(),
    });

    ticket.hasReview = true;
    await ticket.save();

    await review.populate('customer', 'name email');

    // Notify Worker
    await createAndSendNotification({
      recipient: ticket.assignedWorker._id,
      ticket: ticket._id,
      type: 'review_submitted',
      title: 'New Service Rating Received',
      message: `${req.user.name} rated your service ${rating}/5 stars on request "${ticket.subject}" (${ticket.ticketNumber}).`,
      link: `/worker/profile`,
    });

    broadcastSocketEvent(`ticket_${ticket._id}`, 'review-submitted', review);

    res.status(201).json({
      success: true,
      message: 'Thank you! Your review and rating have been submitted.',
      review,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get reviews and aggregate statistics for a worker
 * @route   GET /api/workers/:id/reviews
 * @access  Private
 */
exports.getWorkerReviews = async (req, res, next) => {
  try {
    const workerId = req.params.id === 'me' ? req.user._id : req.params.id;

    if (!mongoose.Types.ObjectId.isValid(workerId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid worker ID',
      });
    }

    const reviews = await Review.find({ worker: workerId })
      .populate('customer', 'name email')
      .populate('ticket', 'subject ticketNumber category')
      .sort({ createdAt: -1 });

    // Calculate dynamic rating aggregate directly from database
    const aggregateResult = await Review.aggregate([
      { $match: { worker: new mongoose.Types.ObjectId(workerId) } },
      {
        $group: {
          _id: '$worker',
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
          star5Count: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
          star4Count: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
          star3Count: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
          star2Count: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
          star1Count: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
        },
      },
    ]);

    const stats =
      aggregateResult.length > 0
        ? {
            averageRating: Number(aggregateResult[0].averageRating.toFixed(1)),
            totalReviews: aggregateResult[0].totalReviews,
            breakdown: {
              5: aggregateResult[0].star5Count,
              4: aggregateResult[0].star4Count,
              3: aggregateResult[0].star3Count,
              2: aggregateResult[0].star2Count,
              1: aggregateResult[0].star1Count,
            },
          }
        : {
            averageRating: 0,
            totalReviews: 0,
            breakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
          };

    res.status(200).json({
      success: true,
      stats,
      count: reviews.length,
      reviews,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get review for a specific ticket
 * @route   GET /api/tickets/:id/review
 * @access  Private
 */
exports.getTicketReview = async (req, res, next) => {
  try {
    const review = await Review.findOne({ ticket: req.params.id })
      .populate('customer', 'name email')
      .populate('worker', 'name email');

    if (!review) {
      return res.status(200).json({
        success: true,
        hasReview: false,
        review: null,
      });
    }

    res.status(200).json({
      success: true,
      hasReview: true,
      review,
    });
  } catch (err) {
    next(err);
  }
};
