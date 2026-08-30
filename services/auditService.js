const AuditLog = require('../models/AuditLog');

/**
 * Log an administrative, security, or workflow audit event
 * @param {object} params
 * @param {string|object} params.actor - User ID or User Document
 * @param {string} params.actorRole - 'admin', 'worker', 'customer', 'system'
 * @param {string} params.action - Event action string (e.g. WORKER_APPROVED, TICKET_ESCALATED)
 * @param {string} [params.target] - ID or description of target
 * @param {string} [params.targetType] - 'Ticket', 'User', 'Review', etc.
 * @param {object} [params.metadata] - Extra contextual information
 * @param {object} [params.req] - Express request object for IP extraction
 */
const logAuditEvent = async ({
  actor,
  actorRole,
  action,
  target = '',
  targetType = 'General',
  metadata = {},
  req = null,
}) => {
  try {
    const ipAddress =
      req?.headers['x-forwarded-for']?.split(',')[0] ||
      req?.socket?.remoteAddress ||
      '';

    const actorId = actor?._id || actor;
    const role = actorRole || actor?.role || 'system';

    await AuditLog.create({
      actor: actorId,
      actorRole: role,
      action,
      target: target ? target.toString() : '',
      targetType,
      metadata,
      ipAddress,
    });
  } catch (err) {
    console.error('[AuditService] Failed to record audit log:', err.message);
  }
};

module.exports = { logAuditEvent };
