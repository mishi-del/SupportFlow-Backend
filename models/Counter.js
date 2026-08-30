const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  seq: {
    type: Number,
    default: 1000,
  },
});

const Counter = mongoose.model('Counter', counterSchema);

/**
 * Atomically generate the next sequential ticket number (SF-1001, SF-1002, ...)
 * Safe under high concurrency.
 */
const getNextTicketNumber = async () => {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'ticketNumber' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return `SF-${counter.seq}`;
};

module.exports = { Counter, getNextTicketNumber };
