const AppSettings = require('../models/AppSettings');

const defaults = {
  minPasswordLength: 8,
  requireUppercase: true,
  requireNumbers: true,
  requireSpecialCharacters: true,
};

async function validatePasswordPolicy(password) {
  const settings = await AppSettings.findOne({ key: 'global' }).select('security').lean();
  const policy = { ...defaults, ...(settings?.security || {}) };
  const value = String(password || '');
  if (value.length < policy.minPasswordLength) return `Password must be at least ${policy.minPasswordLength} characters`;
  if (policy.requireUppercase && !/[A-Z]/.test(value)) return 'Password must include an uppercase letter';
  if (policy.requireNumbers && !/\d/.test(value)) return 'Password must include a number';
  if (policy.requireSpecialCharacters && !/[^A-Za-z0-9]/.test(value)) return 'Password must include a special character';
  return null;
}

module.exports = { validatePasswordPolicy };
