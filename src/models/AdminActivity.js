const mongoose = require('mongoose');

const adminActivitySchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true, trim: true, maxlength: 150 },
    module: { type: String, default: 'System Module', trim: true, maxlength: 100 },
    ipAddress: { type: String, trim: true, maxlength: 100, default: '' },
  },
  { timestamps: true }
);

adminActivitySchema.index({ createdAt: -1 });

module.exports = mongoose.model('AdminActivity', adminActivitySchema);
