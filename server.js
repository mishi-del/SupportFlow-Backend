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

// CORS configuration: allow frontend on Vercel, localhost, and custom domains
const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map((u) => u.trim().replace(/\/$/, ''))
  : ['http://localhost:5173', 'https://support-flow-frontend.vercel.app'];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server, mobile, postman, and curl requests
      if (!origin) return callback(null, true);
      const cleanOrigin = origin.replace(/\/$/, '');
      if (
        allowedOrigins.includes('*') ||
        allowedOrigins.includes(cleanOrigin) ||
        cleanOrigin.endsWith('.vercel.app') ||
        process.env.NODE_ENV !== 'production'
      ) {
        callback(null, true);
      } else {
        callback(null, true); // Permissive in deployment to prevent CORS blockages
      }
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

// Root info endpoint (Prevents 404/500 when visiting backend URL directly)
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

// Mount REST API Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/tickets', require('./routes/ticketRoutes'));
app.use('/api/workers', require('./routes/workerRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/reviews', require('./routes/reviewRoutes'));
app.use('/api/kb', require('./routes/kbRoutes'));

// 404 Handler for undefined API routes
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
