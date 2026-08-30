const nodemailer = require('nodemailer');

const sendOTPEmail = async (email, otp, userName = 'User') => {
  const isProduction = process.env.NODE_ENV === 'production';

  // In development only, display console notice for ease of testing
  if (!isProduction) {
    console.log('\n======================================================');
    console.log(`[PASSWORD RESET OTP] For: ${email} (${userName})`);
    console.log(`[OTP CODE] ==> [ ${otp} ] (Valid for 10 minutes)`);
    console.log('======================================================\n');
  }

  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) {
    return { delivered: false, simulated: true };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT || 587,
      secure: process.env.EMAIL_PORT === '465',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_FROM || '"SupportFlow" <no-reply@supportflow.com>',
      to: email,
      subject: 'SupportFlow Password Reset Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #2563eb;">SupportFlow Security Verification</h2>
          <p>Hello <strong>${userName}</strong>,</p>
          <p>You requested a one-time verification code to reset your account password:</p>
          <div style="background-color: #f1f5f9; padding: 15px; text-align: center; border-radius: 6px; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #1e293b; margin: 20px 0;">
            ${otp}
          </div>
          <p style="color: #64748b; font-size: 13px;">This code will expire in 10 minutes. If you did not initiate this request, please change your password immediately.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    return { delivered: true, simulated: false };
  } catch (err) {
    console.warn(`[EmailService] SMTP delivery skipped/failed: ${err.message}`);
    return { delivered: false, error: err.message };
  }
};

module.exports = { sendOTPEmail };
