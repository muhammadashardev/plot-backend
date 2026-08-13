const mongoose = require('mongoose');

const appSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true, immutable: true },
    platformName: { type: String, trim: true, maxlength: 100, default: 'Community Connect' },
    supportEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
    contactNumber: { type: String, trim: true, maxlength: 40, default: '' },
    appLogo: { type: String, trim: true, default: '' },
    security: {
      dataRetentionDays: { type: Number, enum: [30, 60, 90, 180, 365], default: 30 },
      minPasswordLength: { type: Number, min: 6, max: 128, default: 8 },
      requireUppercase: { type: Boolean, default: true },
      requireNumbers: { type: Boolean, default: true },
      requireSpecialCharacters: { type: Boolean, default: true },
    },
    localization: {
      defaultLanguage: { type: String, trim: true, maxlength: 50, default: 'English' },
      multipleLanguagesEnabled: { type: Boolean, default: false },
    },
    backups: [{
      createdAt: { type: Date, default: Date.now },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      type: { type: String, default: 'Full System Backup' },
      status: { type: String, enum: ['completed', 'failed'], default: 'completed' },
    }],
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AppSettings', appSettingsSchema);
