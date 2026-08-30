const Notification = require('../models/Notification');

/**
 * Create a persistent database notification
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
    return notification;
  } catch (err) {
    console.error('[NotificationService] Error creating database notification:', err.message);
  }
};

module.exports = {
  createAndSendNotification,
};
