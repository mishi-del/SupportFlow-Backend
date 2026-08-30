const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Protect routes - Verify JWT token from Authorization header
 */
const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No authentication token provided.',
      code: 'UNAUTHORIZED',
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'supportflow_jwt_super_secret_key_2026_secure'
    );

    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'The account associated with this session no longer exists.',
        code: 'USER_NOT_FOUND',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact an administrator.',
        code: 'ACCOUNT_DEACTIVATED',
      });
    }

    // Worker Approval Status Verification
    if (user.role === 'worker') {
      if (user.workerApprovalStatus === 'pending') {
        return res.status(403).json({
          success: false,
          message:
            'Your Worker application is currently Pending Approval by an Administrator.',
          code: 'WORKER_PENDING_APPROVAL',
        });
      }
      if (user.workerApprovalStatus === 'rejected') {
        return res.status(403).json({
          success: false,
          message:
            'Your Worker application was rejected by the administrator. Access is disabled.',
          code: 'WORKER_APPLICATION_REJECTED',
        });
      }
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired authorization token. Please sign in again.',
      code: 'TOKEN_INVALID',
    });
  }
};

/**
 * Authorize specific user roles (RBAC)
 * @param  {...string} roles
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Role '${req.user ? req.user.role : 'unauthenticated'}' is not authorized to access this resource.`,
        code: 'FORBIDDEN',
      });
    }
    next();
  };
};

const requireWorker = (req, res, next) => {
  return authorize('worker', 'admin')(req, res, next);
};

const requireAdmin = (req, res, next) => {
  return authorize('admin')(req, res, next);
};

module.exports = { protect, authorize, requireWorker, requireAdmin };
