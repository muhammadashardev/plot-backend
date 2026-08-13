const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const User = require('../models/User');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token missing' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select('role accountStatus rejectionReason').lean();
    if (!user) {
      return res.status(401).json({ message: 'User account no longer exists' });
    }
    if (user.accountStatus === 'Rejected') {
      return res.status(403).json({
        code: 'ACCOUNT_REJECTED',
        message: 'Your account has been rejected by the super admin. You cannot access the dashboard or create alerts or plots.',
        accountStatus: user.accountStatus,
        rejectionReason: user.rejectionReason || '',
      });
    }

    req.user = { ...decoded, role: user.role, accountStatus: user.accountStatus };
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

module.exports = authMiddleware;
