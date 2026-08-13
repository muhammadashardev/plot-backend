const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    googleId: { type: String },
    facebookId: { type: String },
    avatar: { type: String },
    authProvider: { type: String, default: 'local' },
    role: {
      type: String,
      enum: ['user', 'super_admin'],
      default: 'user',
      index: true,
    },
    accountStatus: {
      type: String,
      enum: ['Pending', 'Verified', 'Rejected'],
      default: 'Pending',
      index: true,
    },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: { type: String, trim: true, maxlength: 500, default: '' },
    phone: { type: String, trim: true, default: '' },
    language: { type: String, default: 'English' },
    timezone: { type: String, default: 'Auto Detect' },
  },
  { timestamps: true }
);

// Some older records were created without a name. Give them a safe label
// before any save so unrelated updates (avatar, password, preferences) do
// not fail the required-name validation.
userSchema.pre('validate', function setFallbackName() {
  if (!this.name || !String(this.name).trim()) {
    this.name = this.email ? String(this.email).trim() : 'Unnamed user';
  }
});

module.exports = mongoose.model('User', userSchema);
