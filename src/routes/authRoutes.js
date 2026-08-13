const express = require('express');
const { register, login, googleLogin, googleCallback, facebookLogin, facebookCallback } = require('../controllers/authController');
const multer = require('multer');
const authMiddleware = require('../middleware/auth');
const {
  getCurrentUser, updateProfile, updateAvatar, removeAvatar, changePassword, deleteAccount,
} = require('../controllers/settingsController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

router.post('/register', register);
router.post('/login', login);
router.post('/google-login', googleLogin);
router.get('/google/callback', googleCallback);
router.post('/google/callback', googleCallback);
router.get('/facebook', facebookLogin);
router.get('/facebook/callback', facebookCallback);

// Settings / profile routes
router.get('/me', authMiddleware, getCurrentUser);
router.patch('/me', authMiddleware, updateProfile);
router.patch('/me/avatar', authMiddleware, upload.single('avatar'), updateAvatar);
router.delete('/me/avatar', authMiddleware, removeAvatar);
router.patch('/me/password', authMiddleware, changePassword);
router.delete('/me', authMiddleware, deleteAccount);

module.exports = router;
