const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middleware/auth');
const superAdminMiddleware = require('../middleware/superAdmin');
const controller = require('../controllers/superAdminSettingsController');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

router.use(authMiddleware, superAdminMiddleware);
router.get('/settings', controller.getGeneralSettings);
router.put('/settings/general', controller.updateGeneralSettings);
router.post('/settings/logo', upload.single('logo'), controller.uploadAppLogo);
router.put('/settings/security', controller.updateSecuritySettings);
router.put('/settings/localization', controller.updateLocalization);
router.get('/settings/activity-logs', controller.getActivityLogs);
router.get('/settings/activity-logs/export', controller.exportActivityLogs);
router.get('/settings/backups', controller.getBackups);
router.post('/settings/backups', controller.createBackup);
router.get('/settings/super-admins', controller.getSuperAdmins);
router.post('/settings/super-admins', controller.createSuperAdmin);

module.exports = router;
