const mongoose = require('mongoose');

let mongoServer;

const connectDB = async () => {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/supportflow';

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 2500,
    });
    console.log(`[MongoDB] Connected successfully: ${conn.connection.host}`);
  } catch (err) {
    console.warn(`[MongoDB] Local connection to ${uri} failed: ${err.message}`);
    console.log('[MongoDB] Initializing MongoDB in-memory server as fallback...');
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      mongoServer = await MongoMemoryServer.create();
      const memoryUri = mongoServer.getUri();
      const conn = await mongoose.connect(memoryUri);
      console.log(`[MongoDB] In-Memory server connected: ${memoryUri}`);
    } catch (memErr) {
      console.error('[MongoDB] Failed to start in-memory MongoDB server:', memErr.message);
      process.exit(1);
    }
  }
};

const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  } catch (err) {
    console.error('Error disconnecting DB:', err.message);
  }
};

module.exports = { connectDB, disconnectDB };
