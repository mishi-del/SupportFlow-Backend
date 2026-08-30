const { connectDB } = require('../config/db');
const app = require('../server');

let isConnected = false;

module.exports = async (req, res) => {
  if (!isConnected) {
    try {
      await connectDB();
      isConnected = true;
    } catch (err) {
      console.error('[Vercel Serverless] DB connection error:', err);
    }
  }
  return app(req, res);
};
