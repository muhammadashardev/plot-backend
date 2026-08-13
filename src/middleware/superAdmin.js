const mongoose = require('mongoose');
const User = require('../models/User');

async function superAdminMiddleware(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user?.id)) {
      return res.status(401).json({ message: 'Invalid authenticated user' });
    }

    const user = await User.findById(req.user.id).select('role').lean();
    if (!user || user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Super admin access is required' });
    }

    next();
  } catch (error) {
    res.status(500).json({ message: 'Failed to verify super admin access', error: error.message });
  }
}

module.exports = superAdminMiddleware;
