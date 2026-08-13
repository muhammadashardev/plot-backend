const Alert = require('../models/Alert');
const Plot = require('../models/Plot');
const Message = require('../models/Message');

function asPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function distanceInKilometers(lat1, lng1, lat2, lng2) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDifference = toRadians(lat2 - lat1);
  const longitudeDifference = toRadians(lng2 - lng1);
  const a = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2))
    * Math.sin(longitudeDifference / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function serializeAlert(alert, origin) {
  const data = alert.toObject ? alert.toObject() : alert;
  const latitude = data.location?.latitude;
  const longitude = data.location?.longitude;

  return {
    id: data._id,
    title: data.title,
    category: data.category,
    priority: data.priority,
    status: data.status,
    description: data.description,
    location: data.location,
    createdAt: data.createdAt,
    distanceKm: origin && Number.isFinite(latitude) && Number.isFinite(longitude)
      ? Number(distanceInKilometers(origin.latitude, origin.longitude, latitude, longitude).toFixed(2))
      : null,
  };
}

async function getDashboard(req, res) {
  try {
    const userId = req.user.id;
    const latitude = Number(req.query.latitude);
    const longitude = Number(req.query.longitude);
    const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
    const radiusKm = asPositiveNumber(req.query.radiusKm, 5);
    const limit = Math.min(asPositiveNumber(req.query.limit, 5), 20);
    const origin = hasLocation ? { latitude, longitude } : null;

    const [savedPlots, activeAlerts, unreadMessages, recentAlerts, recentPlots, recentMessages] = await Promise.all([
      Plot.countDocuments({ createdBy: userId }),
      Alert.countDocuments({ status: 'Active' }),
      Message.countDocuments({ receiver: userId, read: false }),
      Alert.find({ status: 'Active' }).sort({ createdAt: -1 }).limit(100).lean(),
      Plot.find({ createdBy: userId })
        .select('title location createdAt')
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Message.find({ $or: [{ sender: userId }, { receiver: userId }] })
        .select('text sender receiver createdAt read')
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
    ]);

    const formattedActiveAlerts = recentAlerts.map((alert) => serializeAlert(alert, origin));
    const nearbyAlerts = origin
      ? formattedActiveAlerts.filter((alert) => alert.distanceKm !== null && alert.distanceKm <= radiusKm)
      : [];
    const highPriorityAlerts = formattedActiveAlerts.filter((alert) => alert.priority === 'High');

    const activity = [
      ...recentPlots.map((plot) => ({
        type: 'plot_added',
        id: plot._id,
        title: `Plot ${plot.title} added`,
        location: plot.location?.address || null,
        createdAt: plot.createdAt,
      })),
      ...recentMessages.map((message) => ({
        type: message.receiver.toString() === userId ? 'message_received' : 'message_sent',
        id: message._id,
        title: message.receiver.toString() === userId ? 'New message received' : 'Message sent',
        preview: message.text,
        read: message.read,
        createdAt: message.createdAt,
      })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);

    res.json({
      summary: {
        savedPlots,
        nearbyAlerts: nearbyAlerts.length,
        activeAlerts,
        unreadMessages,
        highPriorityAlerts: highPriorityAlerts.length,
      },
      map: {
        center: origin,
        radiusKm,
        markers: nearbyAlerts,
      },
      recentAlerts: formattedActiveAlerts.slice(0, limit),
      recentActivity: activity,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch dashboard data', error: error.message });
  }
}

module.exports = { getDashboard };
