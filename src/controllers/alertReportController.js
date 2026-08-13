const Alert = require('../models/Alert');
const AlertReport = require('../models/AlertReport');
const cloudinary = require('../config/cloudinary');

const REPORT_REASONS = ['Misleading Information', 'Abusive Content', 'Spam', 'False Alert', 'Other'];

async function uploadEvidence(files) {
  if (!files?.length) return [];

  const uploads = files.map(async (file) => {
    const dataUri = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: 'plot-backend/alert-reports',
      resource_type: 'auto',
    });
    return result.secure_url;
  });

  return Promise.all(uploads);
}

async function createAlertReport(req, res) {
  try {
    const { reason, description = '' } = req.body;
    if (!REPORT_REASONS.includes(reason)) {
      return res.status(400).json({ message: 'A valid report reason is required' });
    }

    const alert = await Alert.findById(req.params.id).select('createdBy');
    if (!alert) return res.status(404).json({ message: 'Alert not found' });

    if (alert.createdBy.toString() === req.user.id) {
      return res.status(400).json({ message: 'You cannot report your own alert' });
    }

    const evidence = await uploadEvidence(req.files);
    const report = await AlertReport.create({
      alert: alert._id,
      reportedBy: req.user.id,
      reason,
      description: String(description).trim(),
      evidence,
    });

    res.status(201).json({ message: 'Alert report submitted successfully', report });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'You have already reported this alert' });
    }
    res.status(500).json({ message: 'Failed to submit alert report', error: error.message });
  }
}

module.exports = { createAlertReport, REPORT_REASONS };
