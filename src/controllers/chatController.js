const mongoose = require('mongoose');
const User = require('../models/User');
const Message = require('../models/Message');

// Keep the chat payload independent from the field names used by settings.
// `name` and `avatar` are retained for backward compatibility with existing
// clients, while the explicit fields make their UI purpose clear.
function formatChatUser(user) {
  const data = user.toObject ? user.toObject() : user;
  const fullName = data.name || data.email || 'Unnamed user';

  return {
    ...data,
    name: fullName,
    fullName,
    profilePicture: data.avatar || null,
  };
}

// Get all authenticated users available for chat (excluding the current user)
// Includes last message and unread count for each user
async function getChatUsers(req, res) {
  try {
    const currentUserId = req.user.id;

    // Validate and convert current user ID to ObjectId
    if (!mongoose.Types.ObjectId.isValid(currentUserId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);

    // Get all users except the current one
    const users = await User.find({ _id: { $ne: currentUserObjectId } })
      .select('name email avatar authProvider')
      .sort({ name: 1 })
      .lean();

    // Fetch last message and unread count for each user in one pass
    const userIds = users.map((u) => u._id);

    // Last message between current user and each other user
    const lastMessages = users.length > 0 ? await Message.aggregate([
      {
        $match: {
          $or: [
            { sender: currentUserObjectId, receiver: { $in: userIds } },
            { receiver: currentUserObjectId, sender: { $in: userIds } },
          ],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ['$sender', new mongoose.Types.ObjectId(currentUserId)] },
              '$receiver',
              '$sender',
            ],
          },
          lastMessage: { $first: '$text' },
          lastMessageAt: { $first: '$createdAt' },
          lastMessageSender: { $first: '$sender' },
        },
      },
    ]) : [];

    // Unread counts grouped by sender
    const unreadCounts = users.length > 0 ? await Message.aggregate([
      {
        $match: {
          receiver: currentUserObjectId,
          read: false,
        },
      },
      {
        $group: {
          _id: '$sender',
          count: { $sum: 1 },
        },
      },
    ]) : [];

    // Build lookup maps
    const lastMessageMap = new Map();
    lastMessages.forEach((lm) => {
      lastMessageMap.set(lm._id.toString(), lm);
    });

    const unreadMap = new Map();
    unreadCounts.forEach((uc) => {
      unreadMap.set(uc._id.toString(), uc.count);
    });

    // Merge data into user objects
    const chatUsers = users.map((user) => {
      const userIdStr = user._id.toString();
      const lastMsg = lastMessageMap.get(userIdStr);
      return {
        ...formatChatUser(user),
        // Older or OAuth-created accounts may not have a name. Always return
        // a usable label so sorting and the chat UI cannot crash.
        lastMessage: lastMsg ? lastMsg.lastMessage : null,
        lastMessageAt: lastMsg ? lastMsg.lastMessageAt : null,
        lastMessageSender: lastMsg ? lastMsg.lastMessageSender.toString() : null,
        unreadCount: unreadMap.get(userIdStr) || 0,
      };
    });

    // Sort: users with messages first (by last message time desc), then others by name
    chatUsers.sort((a, b) => {
      if (a.lastMessageAt && b.lastMessageAt) {
        return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
      }
      if (a.lastMessageAt) return -1;
      if (b.lastMessageAt) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ users: chatUsers, count: chatUsers.length });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch chat users', error: error.message });
  }
}

// Get conversation messages between current user and another user
async function getMessages(req, res) {
  try {
    const currentUserId = req.user.id;
    const { userId } = req.params;
    const { before, limit } = req.query;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    // Validate and convert current user ID to ObjectId
    if (!mongoose.Types.ObjectId.isValid(currentUserId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);

    // Verify the other user exists
    const otherUser = await User.findById(userId).select('name email avatar');
    if (!otherUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const filter = {
      $or: [
        { sender: currentUserObjectId, receiver: userId },
        { sender: userId, receiver: currentUserObjectId },
      ],
    };

    // Support pagination by loading messages before a given date
    if (before) {
      filter.createdAt = { $lt: new Date(before) };
    }

    const maxLimit = Math.min(Number(limit) || 50, 100);

    const messages = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(maxLimit)
      .lean();

    // Keep sender/receiver IDs unchanged for existing clients, and include a
    // ready-to-use profile for the avatar beside every message.
    const participants = await User.find({
      _id: { $in: [currentUserObjectId, new mongoose.Types.ObjectId(userId)] },
    })
      .select('name email avatar')
      .lean();
    const participantMap = new Map(
      participants.map((participant) => [
        participant._id.toString(),
        formatChatUser(participant),
      ])
    );
    const messagesWithProfiles = messages.map((message) => ({
      ...message,
      senderProfile: participantMap.get(message.sender.toString()) || null,
      receiverProfile: participantMap.get(message.receiver.toString()) || null,
      senderProfilePicture:
        participantMap.get(message.sender.toString())?.profilePicture || null,
    }));

    // Mark messages received from the other user as read
    await Message.updateMany(
      { sender: userId, receiver: currentUserObjectId, read: false },
      { $set: { read: true } }
    );

    // Return oldest-first for display
    messagesWithProfiles.reverse();

    res.json({
      messages: messagesWithProfiles,
      user: formatChatUser(otherUser),
      hasMore: messagesWithProfiles.length === maxLimit,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch messages', error: error.message });
  }
}

// Send a message to another user
async function sendMessage(req, res) {
  try {
    const currentUserId = req.user.id;
    const { userId } = req.params;
    const { text } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Message text is required' });
    }

    // Prevent sending message to self
    if (userId === currentUserId) {
      return res.status(400).json({ message: 'Cannot send message to yourself' });
    }

    // Verify receiver exists
    const receiver = await User.findById(userId).select('name email avatar');
    if (!receiver) {
      return res.status(404).json({ message: 'Receiver not found' });
    }

    const message = await Message.create({
      sender: currentUserId,
      receiver: userId,
      text: text.trim(),
    });

    await message.populate('sender', 'name email avatar');
    await message.populate('receiver', 'name email avatar');

    const messageData = message.toObject();
    res.status(201).json({
      message: 'Message sent successfully',
      data: {
        ...messageData,
        sender: formatChatUser(messageData.sender),
        receiver: formatChatUser(messageData.receiver),
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to send message', error: error.message });
  }
}

// Mark all messages from a specific user as read
async function markAsRead(req, res) {
  try {
    const currentUserId = req.user.id;
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const result = await Message.updateMany(
      { sender: userId, receiver: currentUserId, read: false },
      { $set: { read: true } }
    );

    res.json({
      message: 'Messages marked as read',
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to mark messages as read', error: error.message });
  }
}

// Search users by email or name for starting new conversations
async function searchUsers(req, res) {
  try {
    const currentUserId = req.user.id;
    const { query } = req.query;

    if (!query || !query.trim()) {
      return res.json({ users: [], count: 0 });
    }

    // Validate and convert current user ID to ObjectId
    if (!mongoose.Types.ObjectId.isValid(currentUserId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);

    // Search for users by name or email, excluding current user
    const searchRegex = new RegExp(query.trim(), 'i');
    const users = await User.find({
      _id: { $ne: currentUserObjectId },
      $or: [
        { name: searchRegex },
        { email: searchRegex },
      ],
    })
      .select('name email avatar authProvider')
      .sort({ name: 1 })
      .limit(20)
      .lean();

    res.json({ users: users.map(formatChatUser), count: users.length });
  } catch (error) {
    res.status(500).json({ message: 'Failed to search users', error: error.message });
  }
}

// Get total unread message count for the current user
async function getUnreadCount(req, res) {
  try {
    const currentUserId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(currentUserId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);

    const count = await Message.countDocuments({
      receiver: currentUserObjectId,
      read: false,
    });

    res.json({ unreadCount: count });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch unread count', error: error.message });
  }
}

module.exports = {
  getChatUsers,
  getMessages,
  sendMessage,
  markAsRead,
  getUnreadCount,
  searchUsers,
};
