const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendOTPEmail } = require('../services/emailService');
const { createAndSendNotification } = require('../services/notificationService');
const { logAuditEvent } = require('../services/auditService');

// Helper to generate JWT
const generateToken = (id) => {
  return jwt.sign(
    { id },
    process.env.JWT_SECRET || 'supportflow_jwt_super_secret_key_2026_secure',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

/**
 * @desc    Register a new user (Customer or Worker)
 * @route   POST /api/auth/signup
 * @access  Public
 */
exports.signup = async (req, res, next) => {
  try {
    const { name, email, password, confirmPassword, role = 'customer' } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required',
        code: 'MISSING_FIELDS',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
        code: 'PASSWORD_TOO_SHORT',
      });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
        code: 'PASSWORD_MISMATCH',
      });
    }

    // Role enforcement: Public signup can ONLY create 'customer' or 'worker'
    const validRoles = ['customer', 'worker'];
    const normalizedRole = role.toLowerCase().trim();
    const chosenRole = validRoles.includes(normalizedRole) ? normalizedRole : 'customer';

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email address already exists',
        code: 'EMAIL_ALREADY_REGISTERED',
      });
    }

    const isWorker = chosenRole === 'worker';

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: chosenRole,
      workerApprovalStatus: isWorker ? 'pending' : 'approved',
      isActive: !isWorker,
    });

    if (isWorker) {
      // Notify all Admins that a new worker application was submitted
      const admins = await User.find({ role: 'admin' });
      for (const admin of admins) {
        await createAndSendNotification({
          recipient: admin._id,
          type: 'worker_applied',
          title: 'New Worker Application',
          message: `${user.name} (${user.email}) submitted a Worker application awaiting review.`,
          link: '/admin/workers',
        });
      }

      await logAuditEvent({
        actor: user._id,
        actorRole: 'worker',
        action: 'WORKER_REGISTERED_PENDING_APPROVAL',
        target: user._id.toString(),
        targetType: 'User',
        req,
      });

      return res.status(201).json({
        success: true,
        message:
          'Worker registration successful! Your application is pending Administrator approval before you can log in.',
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          workerApprovalStatus: user.workerApprovalStatus,
          isActive: user.isActive,
        },
      });
    }

    // Customer registration - immediate login token
    const token = generateToken(user._id);

    await logAuditEvent({
      actor: user._id,
      actorRole: 'customer',
      action: 'CUSTOMER_REGISTERED',
      target: user._id.toString(),
      targetType: 'User',
      req,
    });

    res.status(201).json({
      success: true,
      message: 'Account registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        workerApprovalStatus: user.workerApprovalStatus,
        isActive: user.isActive,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Authenticate user & get token
 * @route   POST /api/auth/login
 * @access  Public
 */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and password',
        code: 'MISSING_CREDENTIALS',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS',
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Worker Approval Status Checks
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

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.',
        code: 'ACCOUNT_INACTIVE',
      });
    }

    const token = generateToken(user._id);

    await logAuditEvent({
      actor: user._id,
      actorRole: user.role,
      action: 'USER_LOGIN',
      target: user._id.toString(),
      targetType: 'User',
      req,
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        workerApprovalStatus: user.workerApprovalStatus,
        isActive: user.isActive,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get current authenticated user profile
 * @route   GET /api/auth/me
 * @access  Private
 */
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found',
        code: 'USER_NOT_FOUND',
      });
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        workerApprovalStatus: user.workerApprovalStatus,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Request Password Reset OTP (Cryptographically Secure)
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required',
        code: 'EMAIL_REQUIRED',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    // Always respond with a generic success message to prevent user enumeration
    if (!user) {
      return res.status(200).json({
        success: true,
        message:
          'If an account exists with this email, a 6-digit verification code has been dispatched.',
      });
    }

    // Generate cryptographically secure 6-digit OTP using crypto.randomInt
    const otpNumber = crypto.randomInt(100000, 1000000);
    const otp = otpNumber.toString();

    // Hash OTP with bcrypt before storing
    const salt = await bcrypt.genSalt(10);
    user.passwordResetOTPHash = await bcrypt.hash(otp, salt);
    user.passwordResetOTPExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
    user.passwordResetAttempts = 0; // Reset verification attempt counter
    user.passwordResetTokenHash = null;
    user.passwordResetTokenExpiresAt = null;
    await user.save({ validateBeforeSave: false });

    // Send email / log OTP in non-prod
    await sendOTPEmail(user.email, otp, user.name);

    await logAuditEvent({
      actor: user._id,
      actorRole: user.role,
      action: 'PASSWORD_RESET_OTP_REQUESTED',
      target: user._id.toString(),
      targetType: 'User',
      req,
    });

    res.status(200).json({
      success: true,
      message:
        'If an account exists with this email, a 6-digit verification code has been dispatched.',
      // In development/test mode only: provide preview for testing
      ...(process.env.NODE_ENV !== 'production' && { devOtpPreview: otp }),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Verify OTP code & issue one-time reset token
 * @route   POST /api/auth/verify-otp
 * @access  Public
 */
exports.verifyOTP = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and 6-digit OTP code are required',
        code: 'MISSING_CREDENTIALS',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail }).select(
      '+passwordResetOTPHash +passwordResetAttempts'
    );

    if (!user || !user.passwordResetOTPHash || !user.passwordResetOTPExpiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification request. Please request a new code.',
        code: 'INVALID_RESET_REQUEST',
      });
    }

    // Check expiration
    if (new Date() > user.passwordResetOTPExpiresAt) {
      user.passwordResetOTPHash = null;
      user.passwordResetOTPExpiresAt = null;
      await user.save({ validateBeforeSave: false });
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired. Please request a new code.',
        code: 'OTP_EXPIRED',
      });
    }

    // Check maximum attempts (max 5)
    if (user.passwordResetAttempts >= 5) {
      user.passwordResetOTPHash = null;
      user.passwordResetOTPExpiresAt = null;
      await user.save({ validateBeforeSave: false });
      return res.status(400).json({
        success: false,
        message: 'Too many failed verification attempts. Please request a new code.',
        code: 'MAX_ATTEMPTS_EXCEEDED',
      });
    }

    // Verify OTP hash
    const isMatch = await bcrypt.compare(otp.toString().trim(), user.passwordResetOTPHash);
    if (!isMatch) {
      user.passwordResetAttempts = (user.passwordResetAttempts || 0) + 1;
      await user.save({ validateBeforeSave: false });
      return res.status(400).json({
        success: false,
        message: `Incorrect verification code. (${5 - user.passwordResetAttempts} attempts remaining)`,
        code: 'INVALID_OTP',
      });
    }

    // Generate secure one-time reset token
    const rawResetToken = crypto.randomBytes(32).toString('hex');
    const salt = await bcrypt.genSalt(10);
    user.passwordResetTokenHash = await bcrypt.hash(rawResetToken, salt);
    user.passwordResetTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    // Invalidate OTP hash after successful verification
    user.passwordResetOTPHash = null;
    user.passwordResetOTPExpiresAt = null;
    user.passwordResetAttempts = 0;
    await user.save({ validateBeforeSave: false });

    await logAuditEvent({
      actor: user._id,
      actorRole: user.role,
      action: 'PASSWORD_RESET_OTP_VERIFIED',
      target: user._id.toString(),
      targetType: 'User',
      req,
    });

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully. You may now reset your password.',
      resetToken: rawResetToken,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Reset password using verified one-time reset token
 * @route   POST /api/auth/reset-password
 * @access  Public
 */
exports.resetPassword = async (req, res, next) => {
  try {
    const { resetToken, email, newPassword, confirmPassword } = req.body;

    if (!resetToken || !email || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Reset token, email, and new password are required',
        code: 'MISSING_FIELDS',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
        code: 'PASSWORD_TOO_SHORT',
      });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
        code: 'PASSWORD_MISMATCH',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail }).select(
      '+passwordResetTokenHash'
    );

    if (
      !user ||
      !user.passwordResetTokenHash ||
      !user.passwordResetTokenExpiresAt
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset session. Please request a new OTP.',
        code: 'INVALID_RESET_SESSION',
      });
    }

    if (new Date() > user.passwordResetTokenExpiresAt) {
      user.passwordResetTokenHash = null;
      user.passwordResetTokenExpiresAt = null;
      await user.save({ validateBeforeSave: false });
      return res.status(400).json({
        success: false,
        message: 'Reset token has expired. Please request a new OTP.',
        code: 'RESET_TOKEN_EXPIRED',
      });
    }

    // Verify resetToken hash
    const isTokenValid = await bcrypt.compare(resetToken, user.passwordResetTokenHash);
    if (!isTokenValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid reset token',
        code: 'INVALID_RESET_TOKEN',
      });
    }

    // Set new password
    user.password = newPassword;
    user.passwordResetTokenHash = null;
    user.passwordResetTokenExpiresAt = null;
    user.passwordResetOTPHash = null;
    user.passwordResetOTPExpiresAt = null;
    user.lastPasswordResetAt = new Date();
    await user.save();

    await logAuditEvent({
      actor: user._id,
      actorRole: user.role,
      action: 'PASSWORD_RESET_COMPLETED',
      target: user._id.toString(),
      targetType: 'User',
      req,
    });

    res.status(200).json({
      success: true,
      message: 'Password reset successfully! You can now log in with your new password.',
    });
  } catch (err) {
    next(err);
  }
};
