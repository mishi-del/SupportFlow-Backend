const mongoose = require('mongoose');
const { getNextTicketNumber } = require('./Counter');
const { calculateSlaDeadline } = require('../services/slaService');

const attachmentSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    url: { type: String, required: true },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    senderRole: {
      type: String,
      enum: ['customer', 'worker', 'admin'],
      required: true,
    },
    senderName: {
      type: String,
      required: true,
    },
    text: {
      type: String,
      required: [true, 'Message text is required'],
      trim: true,
      maxlength: [2000, 'Message cannot exceed 2000 characters'],
    },
    attachments: [attachmentSchema],
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    note: {
      type: String,
      default: '',
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const ticketSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      unique: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Customer is required'],
      index: true,
    },
    assignedWorker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    subject: {
      type: String,
      required: [true, 'Subject is required'],
      trim: true,
      maxlength: [200, 'Subject cannot exceed 200 characters'],
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: [5000, 'Description cannot exceed 5000 characters'],
    },
    category: {
      type: String,
      default: 'General Inquiry',
      index: true,
    },
    priority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Critical', 'Urgent'],
      default: 'Medium',
      index: true,
    },
    status: {
      type: String,
      enum: ['Pending', 'Accepted', 'In Progress', 'Resolved', 'Rejected', 'Closed'],
      default: 'Pending',
      index: true,
    },
    aiTriage: {
      category: { type: String, default: 'General Inquiry' },
      priority: { type: String, default: 'Medium' },
      summary: { type: String, default: '' },
      confidence: { type: Number, default: 0.85 },
      confidenceLabel: { type: String, default: 'High Confidence' },
      suggestedActions: [{ type: String }],
    },
    // SLA Management
    slaDeadline: {
      type: Date,
      index: true,
    },
    slaFirstResponseAt: {
      type: Date,
      default: null,
    },
    slaStatus: {
      type: String,
      enum: ['Within SLA', 'SLA Breached', 'SLA Met'],
      default: 'Within SLA',
      index: true,
    },
    // Escalation Management
    isEscalated: {
      type: Boolean,
      default: false,
      index: true,
    },
    escalationReason: {
      type: String,
      default: '',
    },
    escalatedAt: {
      type: Date,
      default: null,
    },
    escalatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Lifecycle Timestamps
    acceptedAt: {
      type: Date,
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    hasReview: {
      type: Boolean,
      default: false,
    },
    attachments: [attachmentSchema],
    statusHistory: [statusHistorySchema],
    messages: [messageSchema],
  },
  {
    timestamps: true,
  }
);

// Indexes
ticketSchema.index({ customer: 1, createdAt: -1 });
ticketSchema.index({ assignedWorker: 1, status: 1 });
ticketSchema.index({ status: 1, priority: 1, createdAt: -1 });

// Atomic sequential ticket number & SLA initialization
ticketSchema.pre('save', async function (next) {
  if (this.isNew && !this.ticketNumber) {
    this.ticketNumber = await getNextTicketNumber();
  }
  if (this.isNew && !this.slaDeadline) {
    this.slaDeadline = calculateSlaDeadline(this.priority, this.createdAt || new Date());
  }
  next();
});

module.exports = mongoose.model('Ticket', ticketSchema);
