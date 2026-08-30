const express = require('express');
const router = express.Router();
const {
  createTicket,
  getTickets,
  getTicketById,
  closeTicket,
  reopenTicket,
  escalateTicket,
  getTicketMessages,
  addMessage,
} = require('../controllers/ticketController');
const { protect, authorize } = require('../middleware/auth');
const { apiWriteLimiter } = require('../middleware/rateLimiter');
const upload = require('../middleware/upload');

// Base tickets router
router.use(protect);

router
  .route('/')
  .get(getTickets)
  .post(authorize('customer', 'admin'), apiWriteLimiter, upload.array('attachments', 3), createTicket);

router.route('/:id').get(getTicketById);

router.put('/:id/close', closeTicket);
router.put('/:id/reopen', authorize('customer', 'admin'), reopenTicket);
router.post('/:id/escalate', authorize('worker', 'admin'), escalateTicket);

// Ticket Messages
router
  .route('/:id/messages')
  .get(getTicketMessages)
  .post(apiWriteLimiter, upload.array('attachments', 3), addMessage);

module.exports = router;
