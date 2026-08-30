const express = require('express');
const router = express.Router();
const {
  acceptTicket,
  rejectTicket,
  updateTicketStatus,
  updateTicketPriority,
} = require('../controllers/ticketController');
const { protect, authorize } = require('../middleware/auth');
const { apiWriteLimiter } = require('../middleware/rateLimiter');

router.use(protect);
router.use(authorize('worker', 'admin'));

router.post('/requests/:id/accept', apiWriteLimiter, acceptTicket);
router.post('/requests/:id/reject', apiWriteLimiter, rejectTicket);
router.put('/requests/:id/status', apiWriteLimiter, updateTicketStatus);
router.put('/requests/:id/priority', apiWriteLimiter, updateTicketPriority);

module.exports = router;
