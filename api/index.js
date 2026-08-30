const { connectDB } = require('../config/db');
const app = require('../server');

module.exports = async (req, res) => {
  try {
    await connectDB();
  } catch (err) {
    console.error('[Vercel Serverless DB Error]:', err.message);
  }
  return app(req, res);
};
