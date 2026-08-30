const express = require('express');
const router = express.Router();
const {
  createTicket,
  getTickets,
  getTicketById,
  addMessage,
} = require('../controllers/ticketController');
const {
  submitReview,
  getTicketReview,
} = require('../controllers/reviewController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router
  .route('/')
  .post(authorize('customer'), createTicket)
  .get(getTickets);

router.route('/:id').get(getTicketById);
router.route('/:id/messages').post(addMessage);
router.route('/:id/review').post(authorize('customer'), submitReview).get(getTicketReview);

module.exports = router;
