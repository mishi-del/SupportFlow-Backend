const mongoose = require('mongoose');

let mongoServer;

const connectDB = async () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const uri = process.env.MONGO_URI;

  if (isProduction && !uri) {
    console.error(' [CRITICAL ERROR] MONGO_URI is missing in production environment variables.');
    process.exit(1);
  }

  const targetUri = uri || 'mongodb://localhost:27017/supportflow';

  try {
    const conn = await mongoose.connect(targetUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`[MongoDB] Connected successfully: ${conn.connection.host}`);
  } catch (err) {
    console.error(`[MongoDB] Connection error to ${targetUri}: ${err.message}`);

    if (isProduction) {
      console.error(' [FATAL] Production database connection failed. Refusing to start with in-memory database. Exiting process safely.');
      process.exit(1);
    }

    // In development or test environments only: fallback to in-memory server
    console.warn('[MongoDB] (Development Mode) Initializing in-memory MongoDB server as fallback...');
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      mongoServer = await MongoMemoryServer.create();
      const memoryUri = mongoServer.getUri();
      const conn = await mongoose.connect(memoryUri);
      console.log(`[MongoDB] In-Memory server running at: ${memoryUri}`);
    } catch (memErr) {
      console.error('[MongoDB] Failed to start in-memory server:', memErr.message);
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
    console.error('[MongoDB] Error disconnecting DB:', err.message);
  }
};

module.exports = { connectDB, disconnectDB };
