const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middleware/auth');
const {
  createAlert,
  getMyAlerts,
  getAlertById,
  updateAlert,
  deleteAlert,
  getNearbyAlerts,
  getNearbyUsers,
} = require('../controllers/alertController');
const { createAlertReport } = require('../controllers/alertReportController');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/', authMiddleware, upload.array('evidence', 10), createAlert);
router.get('/my-alerts', authMiddleware, getMyAlerts);
router.get('/nearby', authMiddleware, getNearbyAlerts);
router.get('/:id', authMiddleware, getAlertById);
router.get('/:id/nearby-users', authMiddleware, getNearbyUsers);
router.post('/:id/reports', authMiddleware, upload.array('evidence', 5), createAlertReport);
router.put('/:id', authMiddleware, upload.array('evidence', 10), updateAlert);
router.delete('/:id', authMiddleware, deleteAlert);

module.exports = router;
