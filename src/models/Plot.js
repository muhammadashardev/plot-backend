const mongoose = require('mongoose');

const plotSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    area: { type: Number, required: true, min: 0 },
    areaUnit: {
      type: String,
      enum: ['Marla', 'Kanal', 'Square Feet', 'Square Meter', 'Acre'],
      default: 'Marla',
    },
    type: {
      type: String,
      required: true,
      enum: ['Residential', 'Commercial', 'Agricultural', 'Industrial'],
    },
    category: {
      type: String,
      required: true,
      enum: ['Theft', 'Suspicious Activity', 'Fire', 'Medical Emergency', 'Natural Disaster', 'Vandalism', 'Animal Threat', 'Other'],
    },
    status: {
      type: String,
      enum: ['Available', 'Sold', 'Reserved'],
      default: 'Available',
    },
    // This is separate from the selling status above. It controls whether a
    // plot is visible/allowed by the super-admin review process.
    moderationStatus: {
      type: String,
      enum: ['Pending', 'Protected', 'Suspended'],
      default: 'Pending',
      index: true,
    },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    suspensionReason: { type: String, trim: true, maxlength: 500, default: '' },
    location: {
      address: { type: String, required: true, trim: true },
      city: { type: String, trim: true },
      latitude: { type: Number },
      longitude: { type: Number },
    },
    images: [{ type: String }],
    amenities: [{ type: String }],
    contact: {
      phone: { type: String, trim: true },
      email: { type: String, trim: true },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Plot', plotSchema);
