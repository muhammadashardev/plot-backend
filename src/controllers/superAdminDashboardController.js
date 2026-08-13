const Alert = require('../models/Alert');
const AlertReport = require('../models/AlertReport');
const Plot = require('../models/Plot');
const User = require('../models/User');

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PRIORITIES = ['High', 'Medium', 'Low'];
const ALERT_STATUSES = ['Active', 'Resolved', 'False', 'Closed', 'Expired'];

function positiveInteger(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, maximum);
}

function startOfUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function previousUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
}

function trend(current, previous) {
  if (!previous) {
    return { percent: current ? 100 : 0, direction: current ? 'up' : 'flat' };
  }

  const percent = Number((((current - previous) / previous) * 100).toFixed(1));
  return {
    percent: Math.abs(percent),
    direction: percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat',
  };
}

function normalizeCountRows(rows) {
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

function serializeUser(user) {
  return {
    id: user._id,
    name: user.name || 'Unnamed user',
    email: user.email || '',
    avatar: user.avatar || null,
    accountStatus: user.accountStatus,
    createdAt: user.createdAt,
  };
}

function serializeAlert(alert) {
  return {
    id: alert._id,
    title: alert.title,
    category: alert.category,
    priority: alert.priority,
    status: alert.status,
    description: alert.description,
    location: alert.location,
    reportedBy: alert.createdBy
      ? { id: alert.createdBy._id || alert.createdBy, name: alert.createdBy.name || 'Unnamed user', email: alert.createdBy.email || '' }
      : null,
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
  };
}

function serializeReport(report) {
  return {
    id: report._id,
    reason: report.reason,
    description: report.description,
    status: report.status,
    alert: report.alert
      ? {
        id: report.alert._id || report.alert,
        title: report.alert.title || 'Deleted alert',
        category: report.alert.category || null,
        priority: report.alert.priority || null,
        status: report.alert.status || null,
      }
      : null,
    reportedBy: report.reportedBy
      ? { id: report.reportedBy._id || report.reportedBy, name: report.reportedBy.name || 'Unnamed user', email: report.reportedBy.email || '' }
      : null,
    createdAt: report.createdAt,
  };
}

function buildDateBuckets(range) {
  const now = new Date();

  if (range === 'weekly') {
    const buckets = [];
    for (let index = 6; index >= 0; index -= 1) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - index));
      buckets.push({
        key: date.toISOString().slice(0, 10),
        label: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
        start: date,
        end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)),
      });
    }
    return buckets;
  }

  if (range === 'monthly') {
    const buckets = [];
    for (let index = 29; index >= 0; index -= 1) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - index));
      buckets.push({
        key: date.toISOString().slice(0, 10),
        label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
        start: date,
        end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)),
      });
    }
    return buckets;
  }

  return MONTH_LABELS.map((label, month) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), month, 1));
    return {
      key: String(month + 1),
      label,
      start,
      end: new Date(Date.UTC(now.getUTCFullYear(), month + 1, 1)),
    };
  });
}

async function getPlotActivity(range) {
  const buckets = buildDateBuckets(range);
  const firstBucket = buckets[0];
  const lastBucket = buckets[buckets.length - 1];
  const groupExpression = range === 'yearly'
    ? { $month: '$createdAt' }
    : { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };

  const rows = await Plot.aggregate([
    { $match: { createdAt: { $gte: firstBucket.start, $lt: lastBucket.end } } },
    { $group: { _id: groupExpression, count: { $sum: 1 } } },
  ]);
  const counts = normalizeCountRows(rows);

  return {
    range,
    labels: buckets.map((bucket) => bucket.label),
    points: buckets.map((bucket) => ({
      label: bucket.label,
      count: counts.get(bucket.key) || 0,
    })),
  };
}

function countList(rows, keys) {
  const counts = normalizeCountRows(rows);
  return keys.map((key) => ({ label: key, count: counts.get(key) || 0 }));
}

async function getSuperAdminDashboard(req, res) {
  try {
    const limit = positiveInteger(req.query.limit, 5, 20);
    const mapLimit = positiveInteger(req.query.mapLimit, 50, 200);
    const requestedRange = ['weekly', 'monthly', 'yearly'].includes(req.query.range) ? req.query.range : 'yearly';
    const now = new Date();
    const currentMonthStart = startOfUtcMonth(now);
    const previousMonthStart = previousUtcMonth(now);

    const currentMonthFilter = { createdAt: { $gte: currentMonthStart } };
    const previousMonthFilter = { createdAt: { $gte: previousMonthStart, $lt: currentMonthStart } };

    const [
      totalPlots,
      totalUsers,
      activeAlerts,
      pendingReports,
      currentMonthPlots,
      previousMonthPlots,
      currentMonthUsers,
      previousMonthUsers,
      currentMonthActiveAlerts,
      previousMonthActiveAlerts,
      currentMonthPendingReports,
      previousMonthPendingReports,
      recentAlerts,
      recentReports,
      recentUsers,
      activeMapAlerts,
      alertPriorityRows,
      alertStatusRows,
      plotActivity,
    ] = await Promise.all([
      Plot.countDocuments({}),
      User.countDocuments({}),
      Alert.countDocuments({ status: 'Active' }),
      AlertReport.countDocuments({ status: 'Pending' }),
      Plot.countDocuments(currentMonthFilter),
      Plot.countDocuments(previousMonthFilter),
      User.countDocuments(currentMonthFilter),
      User.countDocuments(previousMonthFilter),
      Alert.countDocuments({ status: 'Active', ...currentMonthFilter }),
      Alert.countDocuments({ status: 'Active', ...previousMonthFilter }),
      AlertReport.countDocuments({ status: 'Pending', ...currentMonthFilter }),
      AlertReport.countDocuments({ status: 'Pending', ...previousMonthFilter }),
      Alert.find({})
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1, _id: 1 })
        .limit(limit)
        .lean(),
      AlertReport.find({})
        .populate('reportedBy', 'name email')
        .populate('alert', 'title category priority status')
        .sort({ createdAt: -1, _id: 1 })
        .limit(limit)
        .lean(),
      User.find({})
        .select('name email avatar accountStatus createdAt')
        .sort({ createdAt: -1, _id: 1 })
        .limit(limit)
        .lean(),
      Alert.find({ status: 'Active', 'location.latitude': { $exists: true }, 'location.longitude': { $exists: true } })
        .select('title category priority status location createdAt')
        .sort({ createdAt: -1, _id: 1 })
        .limit(mapLimit)
        .lean(),
      Alert.aggregate([{ $group: { _id: '$priority', count: { $sum: 1 } } }]),
      Alert.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      getPlotActivity(requestedRange),
    ]);

    res.json({
      summary: {
        totalPlots: { value: totalPlots, change: trend(currentMonthPlots, previousMonthPlots), label: 'from last month' },
        totalUsers: { value: totalUsers, change: trend(currentMonthUsers, previousMonthUsers), label: 'from last month' },
        activeAlerts: { value: activeAlerts, change: trend(currentMonthActiveAlerts, previousMonthActiveAlerts), label: 'from last month' },
        pendingReports: { value: pendingReports, change: trend(currentMonthPendingReports, previousMonthPendingReports), label: 'from last month' },
      },
      map: {
        markers: activeMapAlerts.map(serializeAlert),
      },
      alertOverview: {
        total: alertPriorityRows.reduce((sum, row) => sum + row.count, 0),
        byPriority: countList(alertPriorityRows, PRIORITIES),
        byStatus: countList(alertStatusRows, ALERT_STATUSES),
      },
      plotActivity,
      recentAlerts: recentAlerts.map(serializeAlert),
      recentReports: recentReports.map(serializeReport),
      recentUsers: recentUsers.map(serializeUser),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch super admin dashboard', error: error.message });
  }
}

module.exports = { getSuperAdminDashboard };
