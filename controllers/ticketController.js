const Ticket = require('../models/Ticket');
const User = require('../models/User');
const { triageRequest } = require('../services/aiTriageService');
const { createAndSendNotification } = require('../services/notificationService');
const { calculateSlaDeadline, evaluateSlaStatus } = require('../services/slaService');
const { logAuditEvent } = require('../services/auditService');

/**
 * Valid Status Transitions Matrix
 */
const VALID_TRANSITIONS = {
  Pending: ['Accepted', 'Rejected'],
  Accepted: ['In Progress'],
  'In Progress': ['Resolved'],
  Resolved: ['Closed'],
  Closed: ['Pending'], // Customer can reopen closed ticket
  Rejected: [], // Finalized
};

// Helper to escape regex metacharacters
const escapeRegex = (text) => {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
};

/**
 * @desc    Create a new support request (Customer)
 * @route   POST /api/tickets
 * @access  Private (Customer)
 */
exports.createTicket = async (req, res, next) => {
  try {
    const { subject, description, category, priority } = req.body;

    if (!subject || !subject.trim() || !description || !description.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Subject and description are required',
        code: 'MISSING_FIELDS',
      });
    }

    if (subject.trim().length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Subject cannot exceed 200 characters',
        code: 'SUBJECT_TOO_LONG',
      });
    }

    if (description.trim().length > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Description cannot exceed 5000 characters',
        code: 'DESCRIPTION_TOO_LONG',
      });
    }

    // Run deterministic local AI triage
    const aiResult = triageRequest(subject, description);
    const chosenPriority = priority || aiResult.priority;
    const slaDeadline = calculateSlaDeadline(chosenPriority, new Date());

    // Process file attachments if uploaded
    const attachments = [];
    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => {
        attachments.push({
          filename: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          url: `/uploads/${file.filename}`,
        });
      });
    }

    const ticket = await Ticket.create({
      customer: req.user._id,
      subject: subject.trim(),
      description: description.trim(),
      category: category || aiResult.category,
      priority: chosenPriority,
      status: 'Pending',
      aiTriage: aiResult,
      slaDeadline,
      slaStatus: 'Within SLA',
      attachments,
      statusHistory: [
        {
          status: 'Pending',
          changedBy: req.user._id,
          note: 'Request created by customer and placed in Available pool.',
          changedAt: new Date(),
        },
      ],
    });

    await ticket.populate('customer', 'name email');

    // Create database notification for customer
    await createAndSendNotification({
      recipient: req.user._id,
      ticket: ticket._id,
      type: 'ticket_created',
      title: 'Request Submitted',
      message: `Your request "${ticket.subject}" (${ticket.ticketNumber}) has been submitted.`,
      link: `/customer/requests/${ticket._id}`,
    });

    await logAuditEvent({
      actor: req.user._id,
      actorRole: 'customer',
      action: 'TICKET_CREATED',
      target: ticket.ticketNumber,
      targetType: 'Ticket',
      metadata: { category: ticket.category, priority: ticket.priority },
      req,
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
 * @desc    Get all tickets with secure visibility isolation, search & pagination
 * @route   GET /api/tickets
 * @access  Private
 */
exports.getTickets = async (req, res, next) => {
  try {
    const { status, priority, category, search, view, page = 1, limit = 20, sort = '-createdAt' } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    // 1. Mandatory Role-Based Visibility Query (Source of Truth)
    let visibilityQuery = {};
    if (req.user.role === 'customer') {
      visibilityQuery = { customer: req.user._id };
    } else if (req.user.role === 'worker') {
      if (view === 'available') {
        visibilityQuery = { status: 'Pending', assignedWorker: null };
      } else if (view === 'all') {
        visibilityQuery = {
          $or: [{ assignedWorker: req.user._id }, { status: 'Pending', assignedWorker: null }],
        };
      } else {
        // Default worker view: only assigned tickets
        visibilityQuery = { assignedWorker: req.user._id };
      }
    }
    // Admin sees all by default

    // 2. Build AND-query clauses so search NEVER bypasses visibility
    const andClauses = [visibilityQuery];

    // Filter by status
    if (status && status !== 'all') {
      andClauses.push({ status });
    }

    // Filter by priority
    if (priority && priority !== 'all') {
      andClauses.push({ priority });
    }

    // Filter by category
    if (category && category !== 'all') {
      andClauses.push({ category });
    }

    // Filter by escalated
    if (req.query.escalated === 'true') {
      andClauses.push({ isEscalated: true });
    }

    // Search query with regex escaping (Max 100 chars)
    if (search && search.trim()) {
      const sanitized = escapeRegex(search.trim().slice(0, 100));
      const searchRegex = new RegExp(sanitized, 'i');
      andClauses.push({
        $or: [
          { subject: searchRegex },
          { description: searchRegex },
          { ticketNumber: searchRegex },
        ],
      });
    }

    const finalQuery = andClauses.length === 1 ? andClauses[0] : { $and: andClauses };

    const [total, tickets] = await Promise.all([
      Ticket.countDocuments(finalQuery),
      Ticket.find(finalQuery)
        .populate('customer', 'name email')
        .populate('assignedWorker', 'name email')
        .populate('escalatedBy', 'name role')
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
    ]);

    // Compute live SLA status for each ticket
    const formattedTickets = tickets.map((t) => ({
      ...t,
      slaStatus: evaluateSlaStatus(t),
    }));

    res.status(200).json({
      success: true,
      count: formattedTickets.length,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
      tickets: formattedTickets,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get single ticket details with authorization check
 * @route   GET /api/tickets/:id
 * @access  Private
 */
exports.getTicketById = async (req, res, next) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate('customer', 'name email createdAt')
      .populate('assignedWorker', 'name email')
      .populate('statusHistory.changedBy', 'name role')
      .populate('messages.sender', 'name role')
      .populate('escalatedBy', 'name role');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
        code: 'TICKET_NOT_FOUND',
      });
    }

    // Authorization verification
    if (req.user.role === 'customer') {
      if (ticket.customer._id.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You are not authorized to view this request.',
          code: 'FORBIDDEN',
        });
      }
    } else if (req.user.role === 'worker') {
      const isAssigned =
        ticket.assignedWorker &&
        ticket.assignedWorker._id.toString() === req.user._id.toString();
      const isPendingUnassigned = ticket.status === 'Pending' && !ticket.assignedWorker;

      if (!isAssigned && !isPendingUnassigned) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You are not assigned to this request.',
          code: 'FORBIDDEN',
        });
      }
    }

    const ticketObj = ticket.toObject();
    ticketObj.slaStatus = evaluateSlaStatus(ticket);

    res.status(200).json({
      success: true,
      ticket: ticketObj,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Worker claims/accepts pending request atomically
 * @route   POST /api/workers/requests/:id/accept
 * @access  Private (Worker)
 */
exports.acceptTicket = async (req, res, next) => {
  try {
    const ticketId = req.params.id;

    // Atomic findOneAndUpdate eliminates acceptance race condition
    const ticket = await Ticket.findOneAndUpdate(
      {
        _id: ticketId,
        status: 'Pending',
        assignedWorker: null,
      },
      {
        $set: {
          assignedWorker: req.user._id,
          status: 'Accepted',
          acceptedAt: new Date(),
        },
        $push: {
          statusHistory: {
            status: 'Accepted',
            changedBy: req.user._id,
            note: `Accepted by Worker ${req.user.name}`,
            changedAt: new Date(),
          },
        },
      },
      { new: true }
    )
      .populate('customer', 'name email')
      .populate('assignedWorker', 'name email');

    if (!ticket) {
      return res.status(400).json({
        success: false,
        message: 'This request has already been claimed by another worker or is no longer pending.',
        code: 'TICKET_ALREADY_CLAIMED',
      });
    }

    // Notify Customer
    await createAndSendNotification({
      recipient: ticket.customer._id,
      ticket: ticket._id,
      type: 'ticket_accepted',
      title: 'Request Accepted',
      message: `Worker ${req.user.name} has accepted your request "${ticket.subject}" (${ticket.ticketNumber}).`,
      link: `/customer/requests/${ticket._id}`,
    });

    await logAuditEvent({
      actor: req.user._id,
      actorRole: 'worker',
      action: 'TICKET_ACCEPTED',
      target: ticket.ticketNumber,
      targetType: 'Ticket',
      req,
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
    const ticketId = req.params.id;

    const ticket = await Ticket.findOneAndUpdate(
      {
        _id: ticketId,
        status: 'Pending',
      },
      {
        $set: {
          status: 'Rejected',
          rejectedAt: new Date(),
        },
        $push: {
          statusHistory: {
            status: 'Rejected',
            changedBy: req.user._id,
            note: note.trim() || `Rejected by Worker ${req.user.name}`,
            changedAt: new Date(),
          },
        },
      },
      { new: true }
    ).populate('customer', 'name email');

    if (!ticket) {
      return res.status(400).json({
        success: false,
        message: 'Cannot reject request. Only Pending requests can be rejected.',
        code: 'INVALID_STATUS_TRANSITION',
      });
    }

    // Notify Customer
    await createAndSendNotification({
      recipient: ticket.customer._id,
      ticket: ticket._id,
      type: 'ticket_rejected',
      title: 'Request Declined',
      message: `Your request "${ticket.subject}" (${ticket.ticketNumber}) was declined by the service team.`,
      link: `/customer/requests/${ticket._id}`,
    });

    await logAuditEvent({
      actor: req.user._id,
      actorRole: 'worker',
      action: 'TICKET_REJECTED',
      target: ticket.ticketNumber,
      targetType: 'Ticket',
      metadata: { note },
      req,
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
 * @desc    Update ticket status with strict state machine validation
 * @route   PUT /api/workers/requests/:id/status
 * @access  Private (Worker, Admin)
 */
exports.updateTicketStatus = async (req, res, next) => {
  try {
    const { nextStatus, note = '' } = req.body;
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
        code: 'TICKET_NOT_FOUND',
      });
    }

    // Role check: Worker must be assigned; Admin has oversight
    const isAssignedWorker =
      ticket.assignedWorker &&
      ticket.assignedWorker.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isAssignedWorker && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only update requests assigned to you.',
        code: 'FORBIDDEN',
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
        code: 'INVALID_STATUS_TRANSITION',
      });
    }

    ticket.status = nextStatus;
    if (nextStatus === 'Resolved') {
      ticket.resolvedAt = new Date();
      ticket.slaStatus = evaluateSlaStatus(ticket);
    } else if (nextStatus === 'Closed') {
      ticket.closedAt = new Date();
      ticket.closedBy = req.user._id;
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

    // Notify Customer
    const isResolved = nextStatus === 'Resolved';
    const isClosed = nextStatus === 'Closed';

    await createAndSendNotification({
      recipient: ticket.customer._id,
      ticket: ticket._id,
      type: isResolved
        ? 'ticket_resolved'
        : isClosed
        ? 'ticket_closed'
        : 'ticket_status_updated',
      title: isResolved
        ? 'Request Completed & Resolved'
        : isClosed
        ? 'Request Closed'
        : 'Request Status Updated',
      message: isResolved
        ? `Your request "${ticket.subject}" (${ticket.ticketNumber}) has been resolved. Please rate your service experience!`
        : `Your request "${ticket.subject}" (${ticket.ticketNumber}) is now "${nextStatus}".`,
      link: `/customer/requests/${ticket._id}`,
    });

    await logAuditEvent({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'TICKET_STATUS_CHANGED',
      target: ticket.ticketNumber,
      targetType: 'Ticket',
      metadata: { from: currentStatus, to: nextStatus, note },
      req,
    });

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
 * @desc    Customer closes a resolved request
 * @route   PUT /api/tickets/:id/close
 * @access  Private (Customer, Admin)
 */
exports.closeTicket = async (req, res, next) => {
  try {
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
        code: 'TICKET_NOT_FOUND',
      });
    }

    if (
      req.user.role === 'customer' &&
      ticket.customer.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only close your own requests.',
        code: 'FORBIDDEN',
      });
    }

    if (ticket.status !== 'Resolved') {
      return res.status(400).json({
        success: false,
        message: `Only Resolved requests can be closed. Current status is '${ticket.status}'.`,
        code: 'INVALID_STATUS_TRANSITION',
      });
    }

    ticket.status = 'Closed';
    ticket.closedAt = new Date();
    ticket.closedBy = req.user._id;
    ticket.statusHistory.push({
      status: 'Closed',
      changedBy: req.user._id,
      note: `Closed by ${req.user.name}`,
      changedAt: new Date(),
    });

    await ticket.save();

    await logAuditEvent({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'TICKET_CLOSED',
      target: ticket.ticketNumber,
      targetType: 'Ticket',
      req,
    });

    res.status(200).json({
      success: true,
      message: 'Request closed successfully',
      ticket,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Customer reopens a closed request
 * @route   PUT /api/tickets/:id/reopen
 * @access  Private (Customer)
 */
exports.reopenTicket = async (req, res, next) => {
  try {
    const { reason = '' } = req.body;
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
        code: 'TICKET_NOT_FOUND',
      });
    }

    if (ticket.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only reopen your own requests.',
        code: 'FORBIDDEN',
      });
    }

    if (ticket.status !== 'Closed') {
      return res.status(400).json({
        success: false,
        message: `Only Closed requests can be reopened. Current status is '${ticket.status}'.`,
        code: 'INVALID_STATUS_TRANSITION',
      });
    }

    ticket.status = 'Pending';
    ticket.assignedWorker = null; // Re-enters available pool
    ticket.resolvedAt = null;
    ticket.closedAt = null;
    ticket.statusHistory.push({
      status: 'Pending',
      changedBy: req.user._id,
      note: reason.trim() ? `Reopened by customer: ${reason}` : 'Reopened by customer',
      changedAt: new Date(),
    });

    await ticket.save();

    await logAuditEvent({
      actor: req.user._id,
      actorRole: 'customer',
      action: 'TICKET_REOPENED',
      target: ticket.ticketNumber,
      targetType: 'Ticket',
      metadata: { reason },
      req,
    });

    res.status(200).json({
      success: true,
      message: 'Request reopened and placed in Available pool',
      ticket,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Escalate ticket to Senior Worker / Admin
 * @route   POST /api/tickets/:id/escalate
 * @access  Private (Worker, Admin)
 */
exports.escalateTicket = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
        code: 'TICKET_NOT_FOUND',
      });
    }

    ticket.isEscalated = true;
    ticket.escalationReason = (reason || 'Escalated by service team for specialized attention').trim();
    ticket.escalatedAt = new Date();
    ticket.escalatedBy = req.user._id;

    // Bump priority to Critical if not already
    if (ticket.priority !== 'Critical') {
      ticket.priority = 'Critical';
      ticket.slaDeadline = calculateSlaDeadline('Critical', new Date());
    }

    ticket.statusHistory.push({
      status: ticket.status,
      changedBy: req.user._id,
      note: `Escalated by ${req.user.name}: ${ticket.escalationReason}`,
      changedAt: new Date(),
    });

    await ticket.save();
    await ticket.populate('customer', 'name email');

    // Notify all Admins
    const admins = await User.find({ role: 'admin' });
    for (const admin of admins) {
      await createAndSendNotification({
        recipient: admin._id,
        ticket: ticket._id,
        type: 'ticket_escalated',
        title: 'Critical Ticket Escalated',
        message: `Request ${ticket.ticketNumber} (${ticket.subject}) was escalated by ${req.user.name}. Reason: ${ticket.escalationReason}`,
        link: `/customer/requests/${ticket._id}`,
      });
    }

    await logAuditEvent({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'TICKET_ESCALATED',
      target: ticket.ticketNumber,
      targetType: 'Ticket',
      metadata: { reason: ticket.escalationReason },
      req,
    });

    res.status(200).json({
      success: true,
      message: 'Ticket successfully escalated',
      ticket,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Update ticket operational priority (Worker, Admin)
 * @route   PUT /api/workers/requests/:id/priority
 * @access  Private (Worker, Admin)
 */
exports.updateTicketPriority = async (req, res, next) => {
  try {
    const { priority } = req.body;
    const validPriorities = ['Low', 'Medium', 'High', 'Critical', 'Urgent'];

    if (!validPriorities.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: `Invalid priority '${priority}'. Allowed values: ${validPriorities.join(', ')}`,
        code: 'INVALID_PRIORITY',
      });
    }

    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
        code: 'TICKET_NOT_FOUND',
      });
    }

    const isAssignedWorker =
      ticket.assignedWorker &&
      ticket.assignedWorker.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isAssignedWorker && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only the assigned worker or administrator can change priority.',
        code: 'FORBIDDEN',
      });
    }

    const oldPriority = ticket.priority;
    ticket.priority = priority;
    ticket.slaDeadline = calculateSlaDeadline(priority, ticket.createdAt || new Date());
    await ticket.save();

    await ticket.populate('customer', 'name email');
    await ticket.populate('assignedWorker', 'name email');

    // Notify Customer
    await createAndSendNotification({
      recipient: ticket.customer._id,
      ticket: ticket._id,
      type: 'ticket_priority_updated',
      title: 'Priority Updated',
      message: `Worker ${req.user.name} updated your request priority from ${oldPriority} to ${priority}.`,
      link: `/customer/requests/${ticket._id}`,
    });

    await logAuditEvent({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'TICKET_PRIORITY_CHANGED',
      target: ticket.ticketNumber,
      targetType: 'Ticket',
      metadata: { from: oldPriority, to: priority },
      req,
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
 * @desc    Get messages of a ticket (polling supported with 'after' timestamp query)
 * @route   GET /api/tickets/:id/messages
 * @access  Private (Customer owner, Assigned Worker, Admin)
 */
exports.getTicketMessages = async (req, res, next) => {
  try {
    const { after } = req.query;
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
        code: 'TICKET_NOT_FOUND',
      });
    }

    const isCustomerOwner = ticket.customer.toString() === req.user._id.toString();
    const isAssignedWorker =
      ticket.assignedWorker && ticket.assignedWorker.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isCustomerOwner && !isAssignedWorker && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You are not authorized to view this conversation.',
        code: 'FORBIDDEN',
      });
    }

    let messages = ticket.messages || [];

    if (after) {
      const afterDate = new Date(after);
      messages = messages.filter((m) => new Date(m.createdAt) > afterDate);
    }

    res.status(200).json({
      success: true,
      count: messages.length,
      messages,
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
        code: 'EMPTY_MESSAGE',
      });
    }

    if (text.trim().length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'Message cannot exceed 2000 characters',
        code: 'MESSAGE_TOO_LONG',
      });
    }

    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
        code: 'TICKET_NOT_FOUND',
      });
    }

    const isCustomerOwner = ticket.customer.toString() === req.user._id.toString();
    const isAssignedWorker =
      ticket.assignedWorker && ticket.assignedWorker.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isCustomerOwner && !isAssignedWorker && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You are not authorized to participate in this conversation.',
        code: 'FORBIDDEN',
      });
    }

    // Attachments if uploaded
    const attachments = [];
    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => {
        attachments.push({
          filename: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          url: `/uploads/${file.filename}`,
        });
      });
    }

    const newMessage = {
      sender: req.user._id,
      senderRole: req.user.role,
      senderName: req.user.name,
      text: text.trim(),
      attachments,
      createdAt: new Date(),
    };

    // Track first worker response timestamp for SLA analytics
    if (isAssignedWorker && !ticket.slaFirstResponseAt) {
      ticket.slaFirstResponseAt = new Date();
    }

    ticket.messages.push(newMessage);
    await ticket.save();

    // Determine recipient for notification
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
