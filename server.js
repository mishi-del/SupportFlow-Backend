const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { connectDB } = require('./config/db');
const errorHandler = require('./middleware/errorHandler');

// Load environment variables
dotenv.config();

const app = express();

// Security Headers with Helmet
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Permissive CORS for Vercel, localhost, and custom domains
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests from all origins in cloud serverless deployment
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static uploaded files (Attachments)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Root info endpoint (Never crashes, immediate 200 JSON)
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'OK',
    service: 'SupportFlow v2.0 REST API',
    architecture: 'Pure REST (Socket-Free)',
    health: '/api/health',
    timestamp: new Date().toISOString(),
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    app: 'SupportFlow v2.0 REST API',
    architecture: 'Pure REST (Socket-Free)',
    timestamp: new Date().toISOString(),
  });
});

// DB Connection middleware: safely connect on-demand for serverless functions
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('[DB Middleware Error]:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Database connection failed. Please ensure MONGO_URI is configured in Vercel Environment Variables.',
      error: err.message,
    });
  }
});

// Mount REST API Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/tickets', require('./routes/ticketRoutes'));
app.use('/api/workers', require('./routes/workerRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/reviews', require('./routes/reviewRoutes'));
app.use('/api/kb', require('./routes/kbRoutes'));

// 404 Handler for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Endpoint ${req.originalUrl} not found on SupportFlow API`,
    code: 'ROUTE_NOT_FOUND',
  });
});

// Central Error Handler Middleware
app.use(errorHandler);

// Connect Database & Start Server for local non-serverless dev
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`\n======================================================`);
      console.log(` 🚀 SupportFlow Pure REST API running on port ${PORT}`);
      console.log(` 🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(` 🔒 Security: Helmet & Rate Limiting enabled`);
      console.log(` 📡 Health check: http://localhost:${PORT}/api/health`);
      console.log(`======================================================\n`);
    });
  } catch (err) {
    console.error('Server startup error:', err.message);
  }
};

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  startServer();
}

module.exports = app;
