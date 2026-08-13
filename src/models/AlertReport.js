const mongoose = require('mongoose');

const alertReportSchema = new mongoose.Schema(
  {
    alert: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Alert',
      required: true,
      index: true,
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: {
      type: String,
      required: true,
      enum: ['Misleading Information', 'Abusive Content', 'Spam', 'False Alert', 'Other'],
    },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    evidence: [{ type: String }],
    status: {
      type: String,
      enum: ['Pending', 'Reviewed', 'Dismissed', 'Actioned'],
      default: 'Pending',
    },
  },
  { timestamps: true }
);

// A user can report a given alert only once.
alertReportSchema.index({ alert: 1, reportedBy: 1 }, { unique: true });

module.exports = mongoose.model('AlertReport', alertReportSchema);
