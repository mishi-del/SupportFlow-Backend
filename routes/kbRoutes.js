const express = require('express');
const router = express.Router();
const {
  getArticles,
  getArticleBySlug,
  createArticle,
  updateArticle,
  deleteArticle,
  rateHelpful,
} = require('../controllers/kbController');
const { protect, requireAdmin } = require('../middleware/auth');
const { apiWriteLimiter } = require('../middleware/rateLimiter');

// Public / Authenticated read routes
router.get('/', getArticles);
router.get('/:slug', getArticleBySlug);
router.post('/:slug/helpful', rateHelpful);

// Admin-only management routes
router.post('/', protect, requireAdmin, apiWriteLimiter, createArticle);
router.put('/:id', protect, requireAdmin, apiWriteLimiter, updateArticle);
router.delete('/:id', protect, requireAdmin, deleteArticle);

module.exports = router;
