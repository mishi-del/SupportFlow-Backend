const KnowledgeBaseArticle = require('../models/KnowledgeBaseArticle');
const { logAuditEvent } = require('../services/auditService');

// Helper to escape regex
const escapeRegex = (text) => text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

// Helper to generate slug
const slugify = (text) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * @desc    Get Knowledge Base articles with category filter, search & pagination
 * @route   GET /api/kb
 * @access  Public / Authenticated
 */
exports.getArticles = async (req, res, next) => {
  try {
    const { category, search, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const query = { published: true };

    if (category && category !== 'all') {
      query.category = category;
    }

    if (search && search.trim()) {
      const sanitized = escapeRegex(search.trim().slice(0, 100));
      const searchRegex = new RegExp(sanitized, 'i');
      query.$or = [
        { title: searchRegex },
        { content: searchRegex },
        { tags: searchRegex },
      ];
    }

    const [total, articles] = await Promise.all([
      KnowledgeBaseArticle.countDocuments(query),
      KnowledgeBaseArticle.find(query)
        .populate('author', 'name role')
        .sort('-createdAt')
        .skip(skip)
        .limit(limitNum)
        .lean(),
    ]);

    res.status(200).json({
      success: true,
      count: articles.length,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
      articles,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get single article by slug
 * @route   GET /api/kb/:slug
 * @access  Public / Authenticated
 */
exports.getArticleBySlug = async (req, res, next) => {
  try {
    const article = await KnowledgeBaseArticle.findOneAndUpdate(
      { slug: req.params.slug, published: true },
      { $inc: { viewCount: 1 } },
      { new: true }
    ).populate('author', 'name role');

    if (!article) {
      return res.status(404).json({
        success: false,
        message: 'Knowledge Base article not found',
        code: 'ARTICLE_NOT_FOUND',
      });
    }

    res.status(200).json({
      success: true,
      article,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Create new Knowledge Base article
 * @route   POST /api/kb
 * @access  Private (Admin)
 */
exports.createArticle = async (req, res, next) => {
  try {
    const { title, category, content, tags = [] } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        message: 'Title and content are required',
        code: 'MISSING_FIELDS',
      });
    }

    let slug = slugify(title);
    const existing = await KnowledgeBaseArticle.findOne({ slug });
    if (existing) {
      slug = `${slug}-${Date.now()}`;
    }

    const article = await KnowledgeBaseArticle.create({
      title: title.trim(),
      slug,
      category: category || 'General',
      content: content.trim(),
      tags: Array.isArray(tags) ? tags : tags.split(',').map((t) => t.trim()),
      author: req.user._id,
      published: true,
    });

    await logAuditEvent({
      actor: req.user._id,
      actorRole: 'admin',
      action: 'KB_ARTICLE_CREATED',
      target: article.slug,
      targetType: 'KnowledgeBaseArticle',
      req,
    });

    res.status(201).json({
      success: true,
      message: 'Article published to Knowledge Base',
      article,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Update Knowledge Base article
 * @route   PUT /api/kb/:id
 * @access  Private (Admin)
 */
exports.updateArticle = async (req, res, next) => {
  try {
    const { title, category, content, tags, published } = req.body;
    const article = await KnowledgeBaseArticle.findById(req.params.id);

    if (!article) {
      return res.status(404).json({
        success: false,
        message: 'Article not found',
        code: 'ARTICLE_NOT_FOUND',
      });
    }

    if (title) article.title = title.trim();
    if (category) article.category = category;
    if (content) article.content = content.trim();
    if (tags !== undefined) {
      article.tags = Array.isArray(tags) ? tags : tags.split(',').map((t) => t.trim());
    }
    if (published !== undefined) article.published = published;

    await article.save();

    await logAuditEvent({
      actor: req.user._id,
      actorRole: 'admin',
      action: 'KB_ARTICLE_UPDATED',
      target: article.slug,
      targetType: 'KnowledgeBaseArticle',
      req,
    });

    res.status(200).json({
      success: true,
      message: 'Article updated successfully',
      article,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Delete Knowledge Base article
 * @route   DELETE /api/kb/:id
 * @access  Private (Admin)
 */
exports.deleteArticle = async (req, res, next) => {
  try {
    const article = await KnowledgeBaseArticle.findById(req.params.id);

    if (!article) {
      return res.status(404).json({
        success: false,
        message: 'Article not found',
        code: 'ARTICLE_NOT_FOUND',
      });
    }

    await KnowledgeBaseArticle.findByIdAndDelete(req.params.id);

    await logAuditEvent({
      actor: req.user._id,
      actorRole: 'admin',
      action: 'KB_ARTICLE_DELETED',
      target: article.slug,
      targetType: 'KnowledgeBaseArticle',
      req,
    });

    res.status(200).json({
      success: true,
      message: 'Article removed from Knowledge Base',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Rate article as helpful
 * @route   POST /api/kb/:slug/helpful
 * @access  Public / Authenticated
 */
exports.rateHelpful = async (req, res, next) => {
  try {
    const article = await KnowledgeBaseArticle.findOneAndUpdate(
      { slug: req.params.slug, published: true },
      { $inc: { helpfulCount: 1 } },
      { new: true }
    );

    if (!article) {
      return res.status(404).json({
        success: false,
        message: 'Article not found',
        code: 'ARTICLE_NOT_FOUND',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Thank you for your feedback!',
      helpfulCount: article.helpfulCount,
    });
  } catch (err) {
    next(err);
  }
};
