/**
 * Standardized Central Error Handling Middleware
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  const isProduction = process.env.NODE_ENV === 'production';

  // Log error for debugging in development/non-prod
  if (!isProduction) {
    console.error(`[Error] ${err.name || 'Server Error'}: ${err.message}`);
    if (err.stack) console.error(err.stack);
  }

  // Multer upload errors
  if (err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      message: `File upload error: ${err.message}`,
      code: 'FILE_UPLOAD_ERROR',
    });
  }

  // Mongoose bad ObjectId (CastError)
  if (err.name === 'CastError') {
    const message = `Resource not found with id: ${err.value}`;
    return res.status(404).json({
      success: false,
      message,
      code: 'RESOURCE_NOT_FOUND',
    });
  }

  // Mongoose duplicate key error (code 11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    const message = `Duplicate value entered for '${field}'. This value already exists.`;
    return res.status(400).json({
      success: false,
      message,
      code: 'DUPLICATE_ENTRY',
    });
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((val) => val.message);
    return res.status(400).json({
      success: false,
      message: messages[0] || 'Validation failed',
      errors: messages,
      code: 'VALIDATION_ERROR',
    });
  }

  // JSON Web Token errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid authorization token',
      code: 'TOKEN_INVALID',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Authorization token has expired. Please log in again.',
      code: 'TOKEN_EXPIRED',
    });
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Internal Server Error',
    code: error.code || 'SERVER_ERROR',
  });
};

module.exports = errorHandler;
