const cloudinary = require('../config/cloudinary');
const User = require('../models/User');
const Message = require('../models/Message');
const Plot = require('../models/Plot');
const Alert = require('../models/Alert');
const { generateToken, hashPassword, comparePassword } = require('../utils/auth');
const { validatePasswordPolicy } = require('../utils/passwordPolicy');

function publicUser(user) {
  const data = user.toObject ? user.toObject() : user;
  const { password, googleId, facebookId, __v, ...safeUser } = data;
  return safeUser;
}

async function getCurrentUser(req, res) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch profile', error: error.message });
  }
}

async function updateProfile(req, res) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const { name, email, phone, language, timezone } = req.body;
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ message: 'Full name cannot be empty' });
      user.name = String(name).trim();
    }
    if (email !== undefined) {
      const normalizedEmail = String(email).trim().toLowerCase();
      if (!normalizedEmail) return res.status(400).json({ message: 'Email cannot be empty' });
      const existingUser = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
      if (existingUser) return res.status(409).json({ message: 'This email is already in use' });
      user.email = normalizedEmail;
    }
    if (phone !== undefined) user.phone = String(phone).trim();
    if (language !== undefined) user.language = String(language).trim() || 'English';
    if (timezone !== undefined) user.timezone = String(timezone).trim() || 'Auto Detect';

    await user.save();
    res.json({
      message: 'Profile updated successfully',
      token: generateToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update profile', error: error.message });
  }
}

async function updateAvatar(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: 'Please provide an image file in the avatar field' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: 'plot-backend/avatars',
      public_id: `user-${user._id}`,
      overwrite: true,
      resource_type: 'image',
    });
    user.avatar = result.secure_url;
    await user.save();
    res.json({ message: 'Profile photo updated successfully', user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update profile photo', error: error.message });
  }
}

async function removeAvatar(req, res) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.avatar = undefined;
    await user.save();
    res.json({ message: 'Profile photo removed successfully', user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to remove profile photo', error: error.message });
  }
}

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: 'Current password, new password and confirmation are required' });
    }
    const passwordError = await validatePasswordPolicy(newPassword);
    if (passwordError) return res.status(400).json({ message: passwordError });
    if (newPassword !== confirmPassword) return res.status(400).json({ message: 'New password and confirmation do not match' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.password) return res.status(400).json({ message: 'Google-only accounts do not have a password to change' });
    if (!(await comparePassword(currentPassword, user.password))) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    user.password = await hashPassword(newPassword);
    await user.save();
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to change password', error: error.message });
  }
}

async function deleteAccount(req, res) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const { currentPassword, confirmEmail } = req.body;
    if (user.password) {
      if (!(await comparePassword(currentPassword || '', user.password))) {
        return res.status(401).json({ message: 'Current password is incorrect' });
      }
    } else if (String(confirmEmail || '').trim().toLowerCase() !== user.email.toLowerCase()) {
      return res.status(400).json({ message: 'Enter your email address to confirm account deletion' });
    }

    await Promise.all([
      Message.deleteMany({ $or: [{ sender: user._id }, { receiver: user._id }] }),
      Plot.deleteMany({ createdBy: user._id }),
      Alert.deleteMany({ createdBy: user._id }),
      User.findByIdAndDelete(user._id),
    ]);
    res.json({ message: 'Account and associated data deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete account', error: error.message });
  }
}

module.exports = { getCurrentUser, updateProfile, updateAvatar, removeAvatar, changePassword, deleteAccount };
