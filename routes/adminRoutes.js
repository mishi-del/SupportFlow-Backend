const express = require('express');
const router = express.Router();
const {
  getDashboardStats,
  getWorkerRequests,
  approveWorker,
  rejectWorker,
  getAllUsers,
  toggleUserActive,
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);
router.use(authorize('admin'));

router.get('/stats', getDashboardStats);
router.get('/worker-requests', getWorkerRequests);
router.post('/workers/:id/approve', approveWorker);
router.post('/workers/:id/reject', rejectWorker);
router.get('/users', getAllUsers);
router.put('/users/:id/toggle-active', toggleUserActive);

module.exports = router;
