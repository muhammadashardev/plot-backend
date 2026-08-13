const mongoose = require('mongoose');
const Alert = require('../models/Alert');
const AlertReport = require('../models/AlertReport');

const ALERT_STATUSES = ['Active', 'Resolved', 'False', 'Closed', 'Expired'];
const PRIORITIES = ['Low', 'Medium', 'High'];
const CATEGORIES = ['Theft', 'Suspicious Activity', 'Fire', 'Medical Emergency', 'Natural Disaster', 'Vandalism', 'Animal Threat', 'Other'];

function positiveInteger(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, maximum);
}

function dateRange(filter, dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return null;
  const createdAt = {};
  if (dateFrom) createdAt.$gte = new Date(dateFrom);
  if (dateTo) {
    const endDate = new Date(dateTo);
    endDate.setUTCHours(23, 59, 59, 999);
    createdAt.$lte = endDate;
  }
  if (Object.values(createdAt).some((date) => Number.isNaN(date.getTime()))) return 'invalid';
  filter.createdAt = createdAt;
  return null;
}

function formatAlert(alert) {
  return {
    id: alert._id,
    title: alert.title,
    category: alert.category,
    priority: alert.priority,
    status: alert.status,
    description: alert.description,
    location: alert.location,
    plot: alert.plotId
      ? { id: alert.plotId._id || alert.plotId, title: alert.plotId.title || 'Unnamed plot' }
      : null,
    reportedBy: alert.createdBy
      ? { id: alert.createdBy._id || alert.createdBy, name: alert.createdBy.name || 'Unnamed user', email: alert.createdBy.email || '' }
      : null,
    evidence: alert.evidence || [],
    reviewedAt: alert.reviewedAt || null,
    reviewedBy: alert.reviewedBy || null,
    resolutionNote: alert.resolutionNote || '',
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
  };
}

async function getAlerts(req, res) {
  try {
    const page = positiveInteger(req.query.page, 1, 100000);
    const limit = positiveInteger(req.query.limit, 10, 100);
    const { status, priority, category, search, dateFrom, dateTo } = req.query;
    const filter = {};

    if (status) {
      if (!ALERT_STATUSES.includes(status)) return res.status(400).json({ message: 'Invalid alert status' });
      filter.status = status;
    }
    if (priority) {
      if (!PRIORITIES.includes(priority)) return res.status(400).json({ message: 'Invalid priority' });
      filter.priority = priority;
    }
    if (category) {
      if (!CATEGORIES.includes(category)) return res.status(400).json({ message: 'Invalid category' });
      filter.category = category;
    }
    if (search?.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [{ title: regex }, { description: regex }, { 'location.address': regex }];
    }
    if (dateRange(filter, dateFrom, dateTo) === 'invalid') {
      return res.status(400).json({ message: 'Invalid date filter' });
    }

    const sortBy = ['createdAt', 'priority', 'status'].includes(req.query.sortBy) ? req.query.sortBy : 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const [alerts, total] = await Promise.all([
      Alert.find(filter)
        .populate('createdBy', 'name email')
        .populate('plotId', 'title')
        .sort({ [sortBy]: sortOrder, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Alert.countDocuments(filter),
    ]);

    res.json({
      alerts: alerts.map(formatAlert),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch admin alerts', error: error.message });
  }
}

async function getAlertById(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid alert id' });
    const [alert, reports] = await Promise.all([
      Alert.findById(req.params.id)
        .populate('createdBy', 'name email')
        .populate('plotId', 'title')
        .populate('reviewedBy', 'name email')
        .lean(),
      AlertReport.find({ alert: req.params.id })
        .populate('reportedBy', 'name email')
        .sort({ createdAt: -1 })
        .lean(),
    ]);
    if (!alert) return res.status(404).json({ message: 'Alert not found' });

    res.json({
      alert: formatAlert(alert),
      reports: reports.map((report) => ({
        id: report._id,
        reason: report.reason,
        description: report.description,
        evidence: report.evidence || [],
        status: report.status,
        reportedBy: report.reportedBy
          ? { id: report.reportedBy._id, name: report.reportedBy.name || 'Unnamed user', email: report.reportedBy.email || '' }
          : null,
        createdAt: report.createdAt,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch alert details', error: error.message });
  }
}

async function reviewAlert(req, res, status) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid alert id' });
    const note = String(req.body.note || '').trim();
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      { status, reviewedAt: new Date(), reviewedBy: req.user.id, resolutionNote: note },
      { new: true, runValidators: true }
    )
      .populate('createdBy', 'name email')
      .populate('plotId', 'title');
    if (!alert) return res.status(404).json({ message: 'Alert not found' });

    // A false decision closes any pending user reports as actioned. The alert
    // itself remains in the user's history with status False.
    if (status === 'False') {
      await AlertReport.updateMany({ alert: alert._id, status: 'Pending' }, { status: 'Actioned' });
    }

    res.json({
      message: status === 'Resolved' ? 'Alert marked as resolved' : 'Alert marked as false',
      alert: formatAlert(alert),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to review alert', error: error.message });
  }
}

function markAlertResolved(req, res) {
  return reviewAlert(req, res, 'Resolved');
}

function markAlertFalse(req, res) {
  return reviewAlert(req, res, 'False');
}

module.exports = { getAlerts, getAlertById, markAlertResolved, markAlertFalse };
