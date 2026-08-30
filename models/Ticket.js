const mongoose = require('mongoose');

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
    },
    category: {
      type: String,
      default: 'General Inquiry',
    },
    priority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Critical', 'Urgent'],
      default: 'Medium',
    },
    status: {
      type: String,
      enum: ['New', 'Pending', 'Accepted', 'In Progress', 'Resolved', 'Rejected'],
      default: 'Pending',
      index: true,
    },
    aiTriage: {
      category: { type: String, default: 'General Inquiry' },
      priority: { type: String, default: 'Medium' },
      summary: { type: String, default: '' },
      confidence: { type: Number, default: 0.85 },
      suggestedActions: [{ type: String }],
    },
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
    hasReview: {
      type: Boolean,
      default: false,
    },
    statusHistory: [statusHistorySchema],
    messages: [messageSchema],
  },
  {
    timestamps: true,
  }
);

// Auto-generate ticketNumber (e.g. SF-1001, SF-1002...)
ticketSchema.pre('save', async function (next) {
  if (!this.ticketNumber) {
    const count = await mongoose.model('Ticket').countDocuments();
    const nextNum = 1000 + count + 1;
    this.ticketNumber = `SF-${nextNum}`;
  }
  next();
});

module.exports = mongoose.model('Ticket', ticketSchema);
