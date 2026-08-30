const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendOTPEmail } = require('../services/emailService');
const { createAndSendNotification, broadcastSocketEvent } = require('../services/notificationService');

// Helper to generate JWT
const generateToken = (id) => {
  return jwt.sign(
    { id },
    process.env.JWT_SECRET || 'supportflow_jwt_super_secret_key_2026_secure',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Helper to generate temporary reset token
const generateResetToken = (id) => {
  return jwt.sign(
    { id, purpose: 'password_reset' },
    process.env.JWT_SECRET || 'supportflow_jwt_super_secret_key_2026_secure',
    { expiresIn: '15m' }
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
        errors: ['Please provide all required fields'],
      });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
        errors: ['Passwords do not match'],
      });
    }

    const validRoles = ['customer', 'worker'];
    const chosenRole = validRoles.includes(role.toLowerCase())
      ? role.toLowerCase()
      : 'customer';

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists',
        errors: ['Email is already registered'],
      });
    }

    const isWorker = chosenRole === 'worker';

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
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
          message: `${user.name} (${user.email}) registered as a Worker and is pending approval.`,
          link: '/admin/workers',
        });
      }
      broadcastSocketEvent('worker-application-created', {
        workerId: user._id,
        name: user.name,
        email: user.email,
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
        errors: ['Email and password are required'],
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
    }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. Check email and password.',
        errors: ['Invalid email or password'],
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. Check email and password.',
        errors: ['Invalid email or password'],
      });
    }

    // Worker Approval Status Checks
    if (user.role === 'worker') {
      if (user.workerApprovalStatus === 'pending') {
        return res.status(403).json({
          success: false,
          message:
            'Your Worker application is currently Pending Approval by an Administrator.',
          errors: ['Worker account pending administrator approval'],
        });
      }

      if (user.workerApprovalStatus === 'rejected') {
        return res.status(403).json({
          success: false,
          message:
            'Your Worker application was rejected by the administrator. Access is disabled.',
          errors: ['Worker application was rejected'],
        });
      }
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.',
        errors: ['Account is inactive'],
      });
    }

    const token = generateToken(user._id);

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
 * @desc    Request Password Reset OTP
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
        errors: ['Email is required'],
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Always respond with success to avoid account enumeration
    if (!user) {
      return res.status(200).json({
        success: true,
        message:
          'If an account exists with this email, a 6-digit verification code has been dispatched.',
      });
    }

    // Generate secure 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Hash OTP with bcrypt
    const salt = await bcrypt.genSalt(10);
    user.passwordResetOTPHash = await bcrypt.hash(otp, salt);
    user.passwordResetOTPExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
    await user.save({ validateBeforeSave: false });

    // Send email / log OTP
    await sendOTPEmail(user.email, otp, user.name);

    res.status(200).json({
      success: true,
      message:
        'If an account exists with this email, a 6-digit verification code has been dispatched.',
      // In development/test mode, provide preview for easy testing
      ...(process.env.NODE_ENV !== 'production' && { devOtpPreview: otp }),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Verify OTP code
 * @route   POST /api/auth/verify-otp
 * @access  Public
 */
exports.verifyOTP = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP verification code are required',
        errors: ['Please provide email and 6-digit OTP code'],
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
    }).select('+passwordResetOTPHash');

    if (!user || !user.passwordResetOTPHash || !user.passwordResetOTPExpiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP code. Please request a new code.',
        errors: ['Invalid or expired verification request'],
      });
    }

    // Check expiration
    if (new Date() > user.passwordResetOTPExpiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired. Please request a new code.',
        errors: ['OTP expired'],
      });
    }

    // Verify OTP hash
    const isMatch = await bcrypt.compare(otp.toString().trim(), user.passwordResetOTPHash);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Incorrect verification code. Please try again.',
        errors: ['Invalid OTP code'],
      });
    }

    // Generate reset token valid for 15 mins
    const resetToken = generateResetToken(user._id);

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully. You may now reset your password.',
      resetToken,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Reset password using resetToken or verified OTP
 * @route   POST /api/auth/reset-password
 * @access  Public
 */
exports.resetPassword = async (req, res, next) => {
  try {
    const { resetToken, email, otp, newPassword, confirmPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
        errors: ['Password must be at least 6 characters'],
      });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
        errors: ['Passwords do not match'],
      });
    }

    let user;

    if (resetToken) {
      try {
        const decoded = jwt.verify(
          resetToken,
          process.env.JWT_SECRET || 'supportflow_jwt_super_secret_key_2026_secure'
        );
        if (decoded.purpose !== 'password_reset') {
          return res.status(400).json({
            success: false,
            message: 'Invalid reset token',
          });
        }
        user = await User.findById(decoded.id);
      } catch (err) {
        return res.status(400).json({
          success: false,
          message: 'Reset token has expired or is invalid. Please request a new OTP.',
          errors: ['Invalid or expired reset token'],
        });
      }
    } else if (email && otp) {
      user = await User.findOne({
        email: email.toLowerCase().trim(),
      }).select('+passwordResetOTPHash');

      if (!user || !user.passwordResetOTPHash || !user.passwordResetOTPExpiresAt) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired OTP',
        });
      }

      if (new Date() > user.passwordResetOTPExpiresAt) {
        return res.status(400).json({
          success: false,
          message: 'OTP has expired',
        });
      }

      const isMatch = await bcrypt.compare(otp.toString().trim(), user.passwordResetOTPHash);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: 'Invalid OTP code',
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Please provide either a valid resetToken or email & OTP',
        errors: ['Missing verification credentials'],
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User account not found',
      });
    }

    // Set new password
    user.password = newPassword;
    user.passwordResetOTPHash = null;
    user.passwordResetOTPExpiresAt = null;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password reset successfully! You can now log in with your new password.',
    });
  } catch (err) {
    next(err);
  }
};
