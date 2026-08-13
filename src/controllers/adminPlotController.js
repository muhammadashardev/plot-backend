const mongoose = require('mongoose');
const Plot = require('../models/Plot');
const Alert = require('../models/Alert');

function positiveInteger(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, maximum);
}

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function serializePlotForList(plot) {
  return {
    id: plot._id,
    title: plot.title,
    owner: plot.createdBy
      ? { id: plot.createdBy._id, name: plot.createdBy.name, email: plot.createdBy.email, avatar: plot.createdBy.avatar || null }
      : null,
    location: plot.location,
    area: plot.area,
    areaUnit: plot.areaUnit,
    type: plot.type,
    sellingStatus: plot.status,
    moderationStatus: plot.moderationStatus || 'Pending',
    createdAt: plot.createdAt,
    updatedAt: plot.updatedAt,
  };
}

// GET /api/admin/plots
async function getPlots(req, res) {
  try {
    const page = positiveInteger(req.query.page, 1, 100000);
    const limit = positiveInteger(req.query.limit, 10, 100);
    const { search, moderationStatus, status, sellingStatus, type, dateFrom, dateTo } = req.query;
    const filter = {};
    const requestedModerationStatus = moderationStatus || status;

    if (requestedModerationStatus) {
      if (!['Pending', 'Protected', 'Suspended'].includes(requestedModerationStatus)) {
        return res.status(400).json({ message: 'Invalid moderation status' });
      }
      filter.moderationStatus = requestedModerationStatus;
    }
    if (sellingStatus) {
      if (!['Available', 'Sold', 'Reserved'].includes(sellingStatus)) {
        return res.status(400).json({ message: 'Invalid selling status' });
      }
      filter.status = sellingStatus;
    }
    if (type) filter.type = type;
    if (search?.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { title: regex },
        { description: regex },
        { 'location.address': regex },
        { 'location.city': regex },
      ];
    }
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setUTCHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
      if (Object.values(filter.createdAt).some((date) => Number.isNaN(date.getTime()))) {
        return res.status(400).json({ message: 'Invalid date filter' });
      }
    }

    const [plots, total] = await Promise.all([
      Plot.find(filter)
        .populate('createdBy', 'name email avatar')
        .sort({ createdAt: -1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Plot.countDocuments(filter),
    ]);

    res.json({
      plots: plots.map(serializePlotForList),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch plots', error: error.message });
  }
}

// GET /api/admin/plots/:id
async function getPlotById(req, res) {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid plot id' });

    const [plot, alerts, totalAlerts, activeAlerts] = await Promise.all([
      Plot.findById(req.params.id).populate('createdBy', 'name email phone avatar accountStatus').lean(),
      Alert.find({ plotId: req.params.id }).sort({ createdAt: -1 }).limit(20).lean(),
      Alert.countDocuments({ plotId: req.params.id }),
      Alert.countDocuments({ plotId: req.params.id, status: 'Active' }),
    ]);
    if (!plot) return res.status(404).json({ message: 'Plot not found' });

    res.json({
      plot: { ...plot, moderationStatus: plot.moderationStatus || 'Pending' },
      summary: {
        totalAlerts,
        activeAlerts,
      },
      recentAlerts: alerts,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch plot details', error: error.message });
  }
}

async function reviewPlot(req, res, moderationStatus) {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid plot id' });

    const updates = {
      moderationStatus,
      reviewedAt: new Date(),
      reviewedBy: req.user.id,
      suspensionReason: moderationStatus === 'Suspended' ? String(req.body.reason || '').trim() : '',
    };
    const plot = await Plot.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
      .populate('createdBy', 'name email avatar');
    if (!plot) return res.status(404).json({ message: 'Plot not found' });

    res.json({
      message: moderationStatus === 'Protected' ? 'Plot approved successfully' : 'Plot suspended successfully',
      plot,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update plot status', error: error.message });
  }
}

function approvePlot(req, res) {
  return reviewPlot(req, res, 'Protected');
}

function suspendPlot(req, res) {
  return reviewPlot(req, res, 'Suspended');
}

module.exports = { getPlots, getPlotById, approvePlot, suspendPlot };
