const express = require('express');
const authMiddleware = require('../middleware/auth');
const superAdminMiddleware = require('../middleware/superAdmin');
const { getUsers, getUserById, approveUser, rejectUser } = require('../controllers/adminUserController');
const { getPlots, getPlotById, approvePlot, suspendPlot } = require('../controllers/adminPlotController');
const { getAlerts, getAlertById, markAlertResolved, markAlertFalse } = require('../controllers/adminAlertController');
const { getSuperAdminDashboard } = require('../controllers/superAdminDashboardController');

const router = express.Router();

router.use(authMiddleware, superAdminMiddleware);
router.get('/dashboard', getSuperAdminDashboard);
router.get('/users', getUsers);
router.get('/users/:id', getUserById);
router.patch('/users/:id/approve', approveUser);
router.patch('/users/:id/reject', rejectUser);

// Plot management for the super-admin dashboard.
router.get('/plots', getPlots);
router.get('/plots/:id', getPlotById);
router.patch('/plots/:id/approve', approvePlot);
router.patch('/plots/:id/suspend', suspendPlot);

// Alert moderation for the super-admin dashboard.
router.get('/alerts', getAlerts);
router.get('/alerts/:id', getAlertById);
router.patch('/alerts/:id/resolve', markAlertResolved);
router.patch('/alerts/:id/false', markAlertFalse);

module.exports = router;
