const mongoose = require('mongoose');

let isConnected = false;

const connectDB = async () => {
  // If already connected in this serverless execution context, reuse it
  if (mongoose.connection.readyState >= 1) {
    return mongoose.connection;
  }

  const isServerless = Boolean(process.env.VERCEL);
  const uri = process.env.MONGO_URI;

  if (!uri) {
    const errorMsg = 'MONGO_URI is missing in environment variables. Please add MONGO_URI in Vercel Project Settings > Environment Variables.';
    console.error(`[MongoDB Error] ${errorMsg}`);
    if (!isServerless && process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
    throw new Error(errorMsg);
  }

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 7000,
    });
    isConnected = true;
    console.log(`[MongoDB] Connected successfully: ${conn.connection.host}`);
    return conn;
  } catch (err) {
    console.error(`[MongoDB] Connection error: ${err.message}`);
    if (!isServerless && process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
    throw err;
  }
};

const disconnectDB = async () => {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  } catch (err) {
    console.error('[MongoDB] Error disconnecting DB:', err.message);
  }
};

module.exports = { connectDB, disconnectDB };
