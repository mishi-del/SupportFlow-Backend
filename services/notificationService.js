const Notification = require('../models/Notification');
const { getIO } = require('../config/socket');

/**
 * Create a persistent notification and deliver it in real time via Socket.IO
 * @param {object} params
 * @param {string} params.recipient - User ID of recipient
 * @param {string} [params.ticket] - Optional Ticket ID
 * @param {string} params.type - Event notification type
 * @param {string} params.title - Notification title
 * @param {string} params.message - Notification message body
 * @param {string} [params.link] - Optional frontend routing link
 * @returns {Promise<Notification>}
 */
const createAndSendNotification = async ({
  recipient,
  ticket = null,
  type,
  title,
  message,
  link = '',
}) => {
  try {
    const notification = await Notification.create({
      recipient,
      ticket,
      type,
      title,
      message,
      link,
    });

    const io = getIO();
    if (io) {
      // Deliver to specific recipient room
      io.to(`user_${recipient.toString()}`).emit('notification-created', notification);
    }

    return notification;
  } catch (err) {
    console.error('[NotificationService] Error creating notification:', err.message);
  }
};

/**
 * Broadcast event to all Admin users or a ticket room
 */
const broadcastSocketEvent = (roomOrEvent, eventName, payload) => {
  try {
    const io = getIO();
    if (!io) return;

    if (payload !== undefined) {
      io.to(roomOrEvent).emit(eventName, payload);
    } else {
      io.emit(roomOrEvent, eventName);
    }
  } catch (err) {
    console.error('[NotificationService] Error broadcasting socket event:', err.message);
  }
};

module.exports = {
  createAndSendNotification,
  broadcastSocketEvent,
};
