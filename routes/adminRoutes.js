const express = require('express');
const router = express.Router();
const {
  getAdminStats,
  getPendingWorkers,
  approveWorker,
  rejectWorker,
  getAllUsers,
  toggleUserStatus,
  reassignWorker,
  getAuditLogs,
} = require('../controllers/adminController');
const { protect, requireAdmin } = require('../middleware/auth');

router.use(protect);
router.use(requireAdmin);

router.get('/stats', getAdminStats);
router.get('/workers/pending', getPendingWorkers);
router.put('/workers/:id/approve', approveWorker);
router.put('/workers/:id/reject', rejectWorker);
router.get('/users', getAllUsers);
router.put('/users/:id/toggle-status', toggleUserStatus);
router.put('/tickets/:id/reassign', reassignWorker);
router.get('/audit-logs', getAuditLogs);

module.exports = router;
