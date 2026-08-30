const express = require('express');
const router = express.Router();
const {
  submitReview,
  getWorkerReviews,
  getTicketReview,
} = require('../controllers/reviewController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.post('/tickets/:id', authorize('customer'), submitReview);
router.get('/tickets/:id', getTicketReview);
router.get('/workers/:id', getWorkerReviews);

module.exports = router;
