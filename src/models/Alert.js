const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    category: {
      type: String,
      required: true,
      enum: ['Theft', 'Suspicious Activity', 'Fire', 'Medical Emergency', 'Natural Disaster', 'Vandalism', 'Animal Threat', 'Other'],
    },
    priority: {
      type: String,
      required: true,
      enum: ['Low', 'Medium', 'High'],
    },
    description: { type: String, required: true, trim: true },
    location: {
      address: { type: String, required: true, trim: true },
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
    },
    plotId: { type: mongoose.Schema.Types.ObjectId },
    evidence: [{ type: String }],
    status: {
      type: String,
      enum: ['Active', 'Resolved', 'False', 'Closed', 'Expired'],
      default: 'Active',
      index: true,
    },
    // Super-admin review metadata. Keeping it on the alert means every
    // dashboard reads the same final decision from one source of truth.
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolutionNote: { type: String, trim: true, maxlength: 2000, default: '' },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Alert', alertSchema);
