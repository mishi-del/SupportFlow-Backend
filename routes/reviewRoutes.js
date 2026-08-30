const express = require('express');
const router = express.Router();
const {
  createReview,
  getWorkerReviews,
} = require('../controllers/reviewController');
const { protect, authorize } = require('../middleware/auth');
const { apiWriteLimiter } = require('../middleware/rateLimiter');

router.use(protect);

router.post('/', authorize('customer'), apiWriteLimiter, createReview);
router.get('/worker/:workerId', getWorkerReviews);

module.exports = router;
