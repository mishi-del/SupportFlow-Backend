const { Server } = require('socket.io');

let io;

const initSocket = (server, clientUrl) => {
  io = new Server(server, {
    cors: {
      origin: clientUrl || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    // Join personal user room for direct notifications
    socket.on('join-user-room', (userId) => {
      if (userId) {
        const roomName = `user_${userId}`;
        socket.join(roomName);
        console.log(`[Socket.IO] User ${userId} joined room ${roomName}`);
      }
    });

    // Join ticket-specific room for real-time chat & status updates
    socket.on('join-ticket-room', (ticketId) => {
      if (ticketId) {
        const roomName = `ticket_${ticketId}`;
        socket.join(roomName);
        console.log(`[Socket.IO] Socket ${socket.id} joined ticket room ${roomName}`);
      }
    });

    socket.on('leave-ticket-room', (ticketId) => {
      if (ticketId) {
        const roomName = `ticket_${ticketId}`;
        socket.leave(roomName);
        console.log(`[Socket.IO] Socket ${socket.id} left ticket room ${roomName}`);
      }
    });

    // Handle real-time chat typing indicator
    socket.on('typing', ({ ticketId, userName }) => {
      if (ticketId) {
        socket.to(`ticket_${ticketId}`).emit('user-typing', { userName });
      }
    });

    socket.on('stop-typing', ({ ticketId }) => {
      if (ticketId) {
        socket.to(`ticket_${ticketId}`).emit('user-stop-typing');
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    console.warn('[Socket.IO] io has not been initialized yet');
  }
  return io;
};

module.exports = { initSocket, getIO };
