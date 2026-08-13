const User = require('../models/User');
const { SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD } = require('../config/env');
const { hashPassword } = require('./auth');

async function ensureSuperAdmin() {
  if (!SUPER_ADMIN_EMAIL && !SUPER_ADMIN_PASSWORD) return;
  if (!SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must both be configured');
  }
  if (SUPER_ADMIN_PASSWORD.length < 8) {
    throw new Error('SUPER_ADMIN_PASSWORD must be at least 8 characters');
  }

  const email = SUPER_ADMIN_EMAIL.trim().toLowerCase();
  const password = await hashPassword(SUPER_ADMIN_PASSWORD);
  const user = await User.findOneAndUpdate(
    { email },
    {
      $set: {
        password,
        role: 'super_admin',
        accountStatus: 'Verified',
        authProvider: 'local',
        rejectionReason: '',
      },
      $setOnInsert: { name: 'Super Admin' },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return user;
}

module.exports = { ensureSuperAdmin };
