const Ticket = require('../models/Ticket');
const User = require('../models/User');
const { triageRequest } = require('../services/aiTriageService');
const {
  createAndSendNotification,
  broadcastSocketEvent,
} = require('../services/notificationService');

/**
 * Valid Status Transitions Matrix
 */
const VALID_TRANSITIONS = {
  New: ['Pending'],
  Pending: ['Accepted', 'Rejected'],
  Accepted: ['In Progress'],
  'In Progress': ['Resolved'],
  Resolved: [], // Finalized
  Rejected: [], // Finalized
};

/**
 * @desc    Create a new support request (Customer)
 * @route   POST /api/tickets
 * @access  Private (Customer)
 */
exports.createTicket = async (req, res, next) => {
  try {
    const { subject, description, category, priority } = req.body;

    if (!subject || !description) {
      return res.status(400).json({
        success: false,
        message: 'Subject and description are required',
        errors: ['Please provide both subject and description'],
      });
    }

    // Run deterministic local AI triage
    const aiResult = triageRequest(subject, description);

    const ticket = await Ticket.create({
      customer: req.user._id,
      subject: subject.trim(),
      description: description.trim(),
      category: category || aiResult.category,
      priority: priority || aiResult.priority,
      status: 'Pending',
      aiTriage: aiResult,
      statusHistory: [
        {
          status: 'Pending',
          changedBy: req.user._id,
          note: 'Request created by customer and queued for worker review.',
          changedAt: new Date(),
        },
      ],
    });

    // Populate customer info for return
    await ticket.populate('customer', 'name email');

    // Notify available workers and admins
    broadcastSocketEvent('ticket-created', ticket);

    // Create notification for Customer confirming receipt
    await createAndSendNotification({
      recipient: req.user._id,
      ticket: ticket._id,
      type: 'ticket_created',
      title: 'Request Submitted',
      message: `Your request "${ticket.subject}" (${ticket.ticketNumber}) has been submitted and is pending worker review.`,
      link: `/customer/requests/${ticket._id}`,
    });

    res.status(201).json({
      success: true,
      message: 'Support request created successfully',
      ticket,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get all tickets with role-based filtering
 * @route   GET /api/tickets
 * @access  Private
 */
exports.getTickets = async (req, res, next) => {
  try {
    const { status, priority, category, search, view } = req.query;
    let query = {};

    // Role-based visibility isolation
    if (req.user.role === 'customer') {
      query.customer = req.user._id;
    } else if (req.user.role === 'worker') {
      if (view === 'available') {
        // Available queue: Pending and unassigned
        query.status = 'Pending';
        query.assignedWorker = null;
      } else if (view === 'all') {
        // Worker viewing all assigned or available
        query.$or = [{ assignedWorker: req.user._id }, { status: 'Pending' }];
      } else {
        // Default worker view: assigned to this worker
        query.assignedWorker = req.user._id;
      }
    }
    // Admin sees all by default

    // Additional query filters
    if (status && status !== 'all') {
      query.status = status;
    }
    if (priority && priority !== 'all') {
      query.priority = priority;
    }
    if (category && category !== 'all') {
      query.category = category;
    }
    if (search) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { subject: searchRegex },
        { description: searchRegex },
        { ticketNumber: searchRegex },
      ];
    }

    const tickets = await Ticket.find(query)
      .populate('customer', 'name email')
      .populate('assignedWorker', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: tickets.length,
      tickets,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get single ticket details
 * @route   GET /api/tickets/:id
 * @access  Private
 */
exports.getTicketById = async (req, res, next) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate('customer', 'name email createdAt')
      .populate('assignedWorker', 'name email')
      .populate('statusHistory.changedBy', 'name role')
      .populate('messages.sender', 'name role');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
        errors: ['No ticket matching the requested ID'],
      });
    }

    // Authorization check
    if (req.user.role === 'customer') {
      if (ticket.customer._id.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You are not authorized to view this request.',
        });
      }
    } else if (req.user.role === 'worker') {
      // Worker can view if assigned OR if ticket is pending (available pool)
      const isAssigned =
        ticket.assignedWorker &&
        ticket.assignedWorker._id.toString() === req.user._id.toString();
      const isPending = ticket.status === 'Pending';
      if (!isAssigned && !isPending) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You are not assigned to this request.',
        });
      }
    }

    res.status(200).json({
      success: true,
      ticket,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Worker accepts a pending request
 * @route   POST /api/workers/requests/:id/accept
 * @access  Private (Worker)
 */
exports.acceptTicket = async (req, res, next) => {
  try {
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    if (ticket.status !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot accept request. Current status is already '${ticket.status}'.`,
        errors: ['Request is no longer pending'],
      });
    }

    if (ticket.assignedWorker) {
      return res.status(400).json({
        success: false,
        message: 'This request has already been accepted by another worker.',
        errors: ['Request already assigned'],
      });
    }

    ticket.assignedWorker = req.user._id;
    ticket.status = 'Accepted';
    ticket.acceptedAt = new Date();
    ticket.statusHistory.push({
      status: 'Accepted',
      changedBy: req.user._id,
      note: `Accepted by Worker ${req.user.name}`,
      changedAt: new Date(),
    });

    await ticket.save();
    await ticket.populate('customer', 'name email');
    await ticket.populate('assignedWorker', 'name email');

    // Notify Customer
    await createAndSendNotification({
      recipient: ticket.customer._id,
      ticket: ticket._id,
      type: 'ticket_accepted',
      title: 'Request Accepted',
      message: `Worker ${req.user.name} has accepted your request "${ticket.subject}" (${ticket.ticketNumber}).`,
      link: `/customer/requests/${ticket._id}`,
    });

    // Broadcast real-time event
    broadcastSocketEvent(`ticket_${ticket._id}`, 'ticket-accepted', ticket);
    broadcastSocketEvent('ticket-status-updated', {
      ticketId: ticket._id,
      status: 'Accepted',
      assignedWorker: ticket.assignedWorker,
    });

    res.status(200).json({
      success: true,
      message: 'Request accepted successfully',
      ticket,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Worker rejects a pending request
 * @route   POST /api/workers/requests/:id/reject
 * @access  Private (Worker)
 */
exports.rejectTicket = async (req, res, next) => {
  try {
    const { note = '' } = req.body;
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    if (ticket.status !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot reject request. Current status is '${ticket.status}'. Only Pending requests can be rejected.`,
        errors: ['Request is no longer pending'],
      });
    }

    ticket.status = 'Rejected';
    ticket.rejectedAt = new Date();
    ticket.statusHistory.push({
      status: 'Rejected',
      changedBy: req.user._id,
      note: note.trim() || `Rejected by Worker ${req.user.name}`,
      changedAt: new Date(),
    });

    await ticket.save();
    await ticket.populate('customer', 'name email');

    // Notify Customer
    await createAndSendNotification({
      recipient: ticket.customer._id,
      ticket: ticket._id,
      type: 'ticket_rejected',
      title: 'Request Rejected',
      message: `Your request "${ticket.subject}" (${ticket.ticketNumber}) was rejected by the service team.`,
      link: `/customer/requests/${ticket._id}`,
    });

    broadcastSocketEvent(`ticket_${ticket._id}`, 'ticket-rejected', ticket);
    broadcastSocketEvent('ticket-status-updated', {
      ticketId: ticket._id,
      status: 'Rejected',
    });

    res.status(200).json({
      success: true,
      message: 'Request rejected',
      ticket,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Update ticket status strictly enforcing one-way transitions
 * @route   PUT /api/workers/requests/:id/status
 * @access  Private (Worker)
 */
exports.updateTicketStatus = async (req, res, next) => {
  try {
    const { nextStatus, note = '' } = req.body;
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    // Verify Worker assignment
    if (
      !ticket.assignedWorker ||
      ticket.assignedWorker.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only update requests assigned to you.',
      });
    }

    const currentStatus = ticket.status;
    const allowedNext = VALID_TRANSITIONS[currentStatus] || [];

    if (!allowedNext.includes(nextStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from '${currentStatus}' to '${nextStatus}'. Allowed transitions from '${currentStatus}' are: [${allowedNext.join(
          ', '
        )}]`,
        errors: [`Cannot transition from ${currentStatus} to ${nextStatus}`],
      });
    }

    ticket.status = nextStatus;
    if (nextStatus === 'Resolved') {
      ticket.resolvedAt = new Date();
    }

    ticket.statusHistory.push({
      status: nextStatus,
      changedBy: req.user._id,
      note: note.trim() || `Status updated to ${nextStatus} by ${req.user.name}`,
      changedAt: new Date(),
    });

    await ticket.save();
    await ticket.populate('customer', 'name email');
    await ticket.populate('assignedWorker', 'name email');

    // Notify Customer of status change
    const isResolved = nextStatus === 'Resolved';
    await createAndSendNotification({
      recipient: ticket.customer._id,
      ticket: ticket._id,
      type: isResolved ? 'ticket_resolved' : 'ticket_status_updated',
      title: isResolved ? 'Request Completed & Resolved' : 'Request Status Updated',
      message: isResolved
        ? `Your request "${ticket.subject}" (${ticket.ticketNumber}) has been completed. Please rate your service experience!`
        : `Your request "${ticket.subject}" (${ticket.ticketNumber}) is now "${nextStatus}".`,
      link: `/customer/requests/${ticket._id}`,
    });

    // Real-time socket dispatch
    broadcastSocketEvent(`ticket_${ticket._id}`, 'ticket-status-updated', ticket);
    if (isResolved) {
      broadcastSocketEvent(`ticket_${ticket._id}`, 'ticket-resolved', ticket);
    }

    res.status(200).json({
      success: true,
      message: `Status transitioned successfully to '${nextStatus}'`,
      ticket,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Update ticket operational priority (Worker only)
 * @route   PUT /api/workers/requests/:id/priority
 * @access  Private (Worker)
 */
exports.updateTicketPriority = async (req, res, next) => {
  try {
    const { priority } = req.body;
    const validPriorities = ['Low', 'Medium', 'High', 'Critical', 'Urgent'];

    if (!validPriorities.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: `Invalid priority '${priority}'. Allowed priorities are: ${validPriorities.join(
          ', '
        )}`,
      });
    }

    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    // Only assigned worker can change priority
    if (
      !ticket.assignedWorker ||
      ticket.assignedWorker.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only the assigned worker can change request priority.',
      });
    }

    const oldPriority = ticket.priority;
    ticket.priority = priority;
    await ticket.save();

    await ticket.populate('customer', 'name email');
    await ticket.populate('assignedWorker', 'name email');

    // Notify Customer of priority change
    await createAndSendNotification({
      recipient: ticket.customer._id,
      ticket: ticket._id,
      type: 'ticket_priority_updated',
      title: 'Priority Updated',
      message: `Worker ${req.user.name} changed your request priority from ${oldPriority} to ${priority}.`,
      link: `/customer/requests/${ticket._id}`,
    });

    broadcastSocketEvent(`ticket_${ticket._id}`, 'ticket-priority-updated', {
      ticketId: ticket._id,
      priority,
    });

    res.status(200).json({
      success: true,
      message: `Priority updated to '${priority}'`,
      ticket,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Send a message in the ticket conversation
 * @route   POST /api/tickets/:id/messages
 * @access  Private (Customer, Assigned Worker, Admin)
 */
exports.addMessage = async (req, res, next) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message text cannot be empty',
      });
    }

    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    const isCustomerOwner =
      ticket.customer.toString() === req.user._id.toString();
    const isAssignedWorker =
      ticket.assignedWorker &&
      ticket.assignedWorker.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isCustomerOwner && !isAssignedWorker && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You are not authorized to participate in this conversation.',
      });
    }

    const newMessage = {
      sender: req.user._id,
      senderRole: req.user.role,
      senderName: req.user.name,
      text: text.trim(),
      createdAt: new Date(),
    };

    ticket.messages.push(newMessage);
    await ticket.save();

    // Determine notification recipient (the other participant)
    let recipientId = null;
    if (isCustomerOwner && ticket.assignedWorker) {
      recipientId = ticket.assignedWorker;
    } else if (isAssignedWorker) {
      recipientId = ticket.customer;
    }

    if (recipientId) {
      await createAndSendNotification({
        recipient: recipientId,
        ticket: ticket._id,
        type: 'new_message',
        title: `New Message from ${req.user.name}`,
        message: text.length > 80 ? `${text.substring(0, 80)}...` : text,
        link:
          req.user.role === 'customer'
            ? `/worker/requests/${ticket._id}`
            : `/customer/requests/${ticket._id}`,
      });
    }

    // Broadcast message to ticket room
    broadcastSocketEvent(`ticket_${ticket._id}`, 'new-message', {
      ticketId: ticket._id,
      message: newMessage,
    });

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      newMessage,
      ticket,
    });
  } catch (err) {
    next(err);
  }
};
