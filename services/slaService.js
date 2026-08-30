/**
 * Service Level Agreement (SLA) Engine
 * Calculates SLA deadlines, response times, and compliance status.
 */

const SLA_CONFIG_MINUTES = {
  Critical: 15,
  Urgent: 30,
  High: 120, // 2 hours
  Medium: 480, // 8 hours
  Low: 1440, // 24 hours
};

/**
 * Calculate SLA deadline from ticket priority and start date
 * @param {string} priority
 * @param {Date} [startDate]
 * @returns {Date}
 */
const calculateSlaDeadline = (priority = 'Medium', startDate = new Date()) => {
  const minutes = SLA_CONFIG_MINUTES[priority] || SLA_CONFIG_MINUTES.Medium;
  return new Date(new Date(startDate).getTime() + minutes * 60 * 1000);
};

/**
 * Evaluate current SLA status of a ticket
 * @param {object} ticket
 * @returns {'Within SLA' | 'SLA Breached' | 'SLA Met'}
 */
const evaluateSlaStatus = (ticket) => {
  if (!ticket.slaDeadline) return 'Within SLA';

  const deadline = new Date(ticket.slaDeadline).getTime();
  const now = Date.now();

  if (ticket.status === 'Resolved' || ticket.status === 'Closed') {
    const resolvedTime = new Date(ticket.resolvedAt || ticket.updatedAt).getTime();
    return resolvedTime <= deadline ? 'SLA Met' : 'SLA Breached';
  }

  return now > deadline ? 'SLA Breached' : 'Within SLA';
};

/**
 * Calculate remaining SLA time in minutes (negative if breached)
 * @param {object} ticket
 * @returns {number}
 */
const getSlaRemainingMinutes = (ticket) => {
  if (!ticket.slaDeadline) return 0;
  const deadline = new Date(ticket.slaDeadline).getTime();
  const now = ticket.resolvedAt ? new Date(ticket.resolvedAt).getTime() : Date.now();
  return Math.round((deadline - now) / (60 * 1000));
};

module.exports = {
  SLA_CONFIG_MINUTES,
  calculateSlaDeadline,
  evaluateSlaStatus,
  getSlaRemainingMinutes,
};
