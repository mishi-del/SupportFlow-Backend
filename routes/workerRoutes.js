const express = require('express');
const router = express.Router();
const {
  getTickets,
  acceptTicket,
  rejectTicket,
  updateTicketStatus,
  updateTicketPriority,
} = require('../controllers/ticketController');
const { getWorkerReviews } = require('../controllers/reviewController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

// Worker requests pool & workflows
router.get('/requests', authorize('worker', 'admin'), getTickets);
router.post('/requests/:id/accept', authorize('worker'), acceptTicket);
router.post('/requests/:id/reject', authorize('worker'), rejectTicket);
router.put('/requests/:id/status', authorize('worker'), updateTicketStatus);
router.put('/requests/:id/priority', authorize('worker'), updateTicketPriority);

// Worker ratings & reviews
router.get('/:id/reviews', getWorkerReviews);

module.exports = router;
