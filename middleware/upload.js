const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    cb(null, `${Date.now()}-${uniqueSuffix}${ext}`);
  },
});

// File filter for safe extensions only
const fileFilter = (req, file, cb) => {
  const allowedExtensions = /^\.(png|jpe?g|pdf|txt)$/i;
  const allowedMimeTypes = /^(image\/(png|jpe?g)|application\/pdf|text\/plain)$/i;

  const ext = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype;

  if (allowedExtensions.test(ext) && allowedMimeTypes.test(mime)) {
    cb(null, true);
  } else {
    cb(
      new Error('Invalid file format. Allowed file types: PNG, JPG, JPEG, PDF, TXT.'),
      false
    );
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: fileFilter,
});

module.exports = upload;
