const cloudinary = require('../config/cloudinary');
const AppSettings = require('../models/AppSettings');
const AdminActivity = require('../models/AdminActivity');
const User = require('../models/User');
const { hashPassword } = require('../utils/auth');
const { validatePasswordPolicy } = require('../utils/passwordPolicy');

const SETTINGS_KEY = 'global';

async function getSettings() {
  return AppSettings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $setOnInsert: { key: SETTINGS_KEY } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

function settingsPayload(settings) {
  return {
    platformName: settings.platformName,
    supportEmail: settings.supportEmail,
    contactNumber: settings.contactNumber,
    appLogo: settings.appLogo,
    security: settings.security,
    localization: settings.localization,
    updatedAt: settings.updatedAt,
  };
}

async function logActivity(req, action, module = 'Settings') {
  await AdminActivity.create({
    admin: req.user.id,
    action,
    module,
    ipAddress: req.ip || req.socket?.remoteAddress || '',
  });
}

async function getPublicSettings(req, res) {
  try {
    const settings = await getSettings();
    res.json({ settings: settingsPayload(settings) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch application settings', error: error.message });
  }
}

async function getGeneralSettings(req, res) {
  try {
    res.json({ settings: settingsPayload(await getSettings()) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch settings', error: error.message });
  }
}

async function updateGeneralSettings(req, res) {
  try {
    const { platformName, supportEmail, contactNumber } = req.body;
    if (platformName !== undefined && !String(platformName).trim()) {
      return res.status(400).json({ message: 'Platform name cannot be empty' });
    }
    if (supportEmail !== undefined && String(supportEmail).trim() && !/^\S+@\S+\.\S+$/.test(String(supportEmail).trim())) {
      return res.status(400).json({ message: 'Support email is invalid' });
    }
    const settings = await getSettings();
    if (platformName !== undefined) settings.platformName = String(platformName).trim();
    if (supportEmail !== undefined) settings.supportEmail = String(supportEmail).trim().toLowerCase();
    if (contactNumber !== undefined) settings.contactNumber = String(contactNumber).trim();
    settings.updatedBy = req.user.id;
    await settings.save();
    await logActivity(req, 'Updated general application settings');
    res.json({ message: 'General settings updated successfully', settings: settingsPayload(settings) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update general settings', error: error.message });
  }
}

async function uploadAppLogo(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: 'Provide an image in the logo field' });
    if (!req.file.mimetype.startsWith('image/')) return res.status(400).json({ message: 'Logo must be an image file' });
    if (req.file.size > 2 * 1024 * 1024) return res.status(400).json({ message: 'Logo must be 2MB or smaller' });
    const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const uploaded = await cloudinary.uploader.upload(dataUri, {
      folder: 'plot-backend/app-settings', public_id: 'app-logo', overwrite: true, resource_type: 'image',
    });
    const settings = await getSettings();
    settings.appLogo = uploaded.secure_url;
    settings.updatedBy = req.user.id;
    await settings.save();
    await logActivity(req, 'Updated application logo');
    res.json({ message: 'Application logo updated successfully', appLogo: settings.appLogo, settings: settingsPayload(settings) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to upload application logo', error: error.message });
  }
}

async function updateSecuritySettings(req, res) {
  try {
    const input = req.body;
    const settings = await getSettings();
    const allowed = ['dataRetentionDays', 'minPasswordLength', 'requireUppercase', 'requireNumbers', 'requireSpecialCharacters'];
    for (const key of allowed) if (input[key] !== undefined) settings.security[key] = input[key];
    settings.updatedBy = req.user.id;
    await settings.save();
    await logActivity(req, 'Updated privacy and security settings');
    res.json({ message: 'Security settings updated successfully', security: settings.security });
  } catch (error) {
    res.status(400).json({ message: 'Invalid security settings', error: error.message });
  }
}

async function updateLocalization(req, res) {
  try {
    const { defaultLanguage, multipleLanguagesEnabled } = req.body;
    const settings = await getSettings();
    if (defaultLanguage !== undefined) settings.localization.defaultLanguage = String(defaultLanguage).trim() || 'English';
    if (multipleLanguagesEnabled !== undefined) settings.localization.multipleLanguagesEnabled = Boolean(multipleLanguagesEnabled);
    settings.updatedBy = req.user.id;
    await settings.save();
    await logActivity(req, 'Updated language and localization settings');
    res.json({ message: 'Localization settings updated successfully', localization: settings.localization });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update localization settings', error: error.message });
  }
}

async function getActivityLogs(req, res) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const logs = await AdminActivity.find().populate('admin', 'name email').sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ logs: logs.map((log) => ({ id: log._id, adminName: log.admin?.name || 'Deleted admin', action: log.action, module: log.module, ipAddress: log.ipAddress, dateTime: log.createdAt })) });
  } catch (error) { res.status(500).json({ message: 'Failed to fetch activity logs', error: error.message }); }
}

async function exportActivityLogs(req, res) {
  try {
    const logs = await AdminActivity.find().populate('admin', 'name').sort({ createdAt: -1 }).limit(5000).lean();
    const escape = (value) => `"${String(value || '').replace(/"/g, '""')}"`;
    const csv = ['Activity ID,Admin Name,Action,Module,IP Address,Date & Time', ...logs.map((log) => [log._id, log.admin?.name || 'Deleted admin', log.action, log.module, log.ipAddress, log.createdAt.toISOString()].map(escape).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv'); res.attachment('admin-activity-logs.csv'); res.send(csv);
  } catch (error) { res.status(500).json({ message: 'Failed to export activity logs', error: error.message }); }
}

async function createBackup(req, res) {
  try {
    const settings = await getSettings();
    settings.backups.unshift({ createdBy: req.user.id, type: req.body.type || 'Full System Backup', status: 'completed' });
    settings.backups = settings.backups.slice(0, 20);
    await settings.save(); await logActivity(req, 'Created system backup', 'Backup & Restore');
    res.status(201).json({ message: 'Backup record created successfully', backup: settings.backups[0] });
  } catch (error) { res.status(500).json({ message: 'Failed to create backup', error: error.message }); }
}

async function getBackups(req, res) {
  try { const settings = await getSettings(); res.json({ backups: settings.backups }); }
  catch (error) { res.status(500).json({ message: 'Failed to fetch backups', error: error.message }); }
}

async function getSuperAdmins(req, res) {
  try {
    const admins = await User.find({ role: 'super_admin' }).select('name email avatar accountStatus createdAt').sort({ createdAt: -1 }).lean();
    res.json({ admins: admins.map((admin) => ({ id: admin._id, name: admin.name, email: admin.email, avatar: admin.avatar || null, role: 'Owner', status: admin.accountStatus, createdAt: admin.createdAt })) });
  } catch (error) { res.status(500).json({ message: 'Failed to fetch super admins', error: error.message }); }
}

async function createSuperAdmin(req, res) {
  try {
    const { name, email, password } = req.body;
    if (!String(name || '').trim() || !String(email || '').trim() || !password) return res.status(400).json({ message: 'Name, email and password are required' });
    const passwordError = await validatePasswordPolicy(password);
    if (passwordError) return res.status(400).json({ message: passwordError });
    const normalizedEmail = String(email).trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) return res.status(409).json({ message: 'Email is already in use' });
    const admin = await User.create({ name: String(name).trim(), email: normalizedEmail, password: await hashPassword(password), role: 'super_admin', accountStatus: 'Verified' });
    await logActivity(req, `Created super admin: ${admin.email}`, 'Super Admin Accounts');
    res.status(201).json({ message: 'Super admin created successfully', admin: { id: admin._id, name: admin.name, email: admin.email, role: admin.role } });
  } catch (error) { res.status(500).json({ message: 'Failed to create super admin', error: error.message }); }
}

module.exports = { getPublicSettings, getGeneralSettings, updateGeneralSettings, uploadAppLogo, updateSecuritySettings, updateLocalization, getActivityLogs, exportActivityLogs, createBackup, getBackups, getSuperAdmins, createSuperAdmin };
