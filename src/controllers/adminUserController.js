const mongoose = require('mongoose');
const User = require('../models/User');
const Plot = require('../models/Plot');
const Alert = require('../models/Alert');

function positiveInteger(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, maximum);
}

function sanitizeUser(user) {
  const data = user.toObject ? user.toObject() : user;
  const { password, googleId, facebookId, __v, ...safeUser } = data;
  return {
    ...safeUser,
    profilePicture: safeUser.avatar || null,
  };
}

function countMap(rows) {
  return new Map(rows.map((row) => [row._id.toString(), row.count]));
}

async function getUsers(req, res) {
  try {
    const page = positiveInteger(req.query.page, 1, 100000);
    const limit = positiveInteger(req.query.limit, 10, 100);
    const { search, status, dateFrom, dateTo } = req.query;
    const filter = {};

    if (status) {
      if (!['Pending', 'Verified', 'Rejected'].includes(status)) {
        return res.status(400).json({ message: 'Invalid account status' });
      }
      filter.accountStatus = status;
    }
    if (search?.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }];
    }
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setUTCHours(23, 59, 59, 999);
        filter.createdAt.$lte = endDate;
      }
      if (Object.values(filter.createdAt).some((date) => Number.isNaN(date.getTime()))) {
        return res.status(400).json({ message: 'Invalid date filter' });
      }
    }

    const sortField = req.query.sortBy === 'name' ? 'name' : 'createdAt';
    const sortDirection = req.query.sortOrder === 'asc' ? 1 : -1;
    const [users, total] = await Promise.all([
      User.find(filter)
        .select('name email phone avatar accountStatus createdAt')
        .sort({ [sortField]: sortDirection, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    const userIds = users.map((user) => user._id);
    const [plotCounts, alertCounts] = userIds.length ? await Promise.all([
      Plot.aggregate([{ $match: { createdBy: { $in: userIds } } }, { $group: { _id: '$createdBy', count: { $sum: 1 } } }]),
      Alert.aggregate([{ $match: { createdBy: { $in: userIds } } }, { $group: { _id: '$createdBy', count: { $sum: 1 } } }]),
    ]) : [[], []];
    const plotsByUser = countMap(plotCounts);
    const alertsByUser = countMap(alertCounts);

    const results = users.map((user) => ({
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      profilePicture: user.avatar || null,
      plots: plotsByUser.get(user._id.toString()) || 0,
      alerts: alertsByUser.get(user._id.toString()) || 0,
      status: user.accountStatus,
      dateJoined: user.createdAt,
    }));

    res.json({
      users: results,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch users', error: error.message });
  }
}

async function getUserById(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const userId = new mongoose.Types.ObjectId(req.params.id);
    const [user, plots, alerts] = await Promise.all([
      User.findById(userId).select('-password -googleId -facebookId -__v').lean(),
      Plot.find({ createdBy: userId }).sort({ createdAt: -1 }).lean(),
      Alert.find({ createdBy: userId }).sort({ createdAt: -1 }).lean(),
    ]);
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({
      user: sanitizeUser(user),
      summary: { plots: plots.length, alerts: alerts.length },
      plots,
      alerts,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch user details', error: error.message });
  }
}

async function reviewUser(req, res, accountStatus) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    if (req.params.id === req.user.id) {
      return res.status(400).json({ message: 'You cannot review your own account' });
    }

    const updates = {
      accountStatus,
      reviewedAt: new Date(),
      reviewedBy: req.user.id,
      rejectionReason: accountStatus === 'Rejected' ? String(req.body.reason || '').trim() : '',
    };
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
      .select('-password -googleId -facebookId -__v');
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({
      message: accountStatus === 'Verified' ? 'User approved successfully' : 'User rejected successfully',
      user: sanitizeUser(user),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update user status', error: error.message });
  }
}

function approveUser(req, res) {
  return reviewUser(req, res, 'Verified');
}

function rejectUser(req, res) {
  return reviewUser(req, res, 'Rejected');
}

module.exports = { getUsers, getUserById, approveUser, rejectUser };
