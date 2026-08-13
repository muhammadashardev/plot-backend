const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  getChatUsers,
  getMessages,
  sendMessage,
  markAsRead,
  getUnreadCount,
  searchUsers,
} = require('../controllers/chatController');

const router = express.Router();

// All chat routes require authentication
router.use(authMiddleware);

// Get all authenticated users available for chat
router.get('/users', getChatUsers);

// Search users by email or name
router.get('/users/search', searchUsers);

// Get total unread message count for the current user
router.get('/unread/count', getUnreadCount);

// Get conversation messages between current user and another user
router.get('/messages/:userId', getMessages);

// Send a message to another user
router.post('/messages/:userId', sendMessage);

// Mark all messages from a specific user as read
router.patch('/messages/:userId/read', markAsRead);

module.exports = router;