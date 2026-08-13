const Alert = require('../models/Alert');
const Plot = require('../models/Plot');
const cloudinary = require('../config/cloudinary');
const { distanceInKilometers, isValidCoordinate, positiveNumber } = require('../utils/geo');

function buildUploadPayload(req) {
  if (!req.files || req.files.length === 0) {
    return [];
  }

  return req.files.map((file) => ({
    buffer: file.buffer,
    mimetype: file.mimetype,
  }));
}

async function uploadEvidenceFiles(files) {
  if (!files || files.length === 0) {
    return [];
  }

  const uploadedUrls = [];

  for (const file of files) {
    const base64Image = file.buffer.toString('base64');
    const dataUri = `data:${file.mimetype};base64,${base64Image}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder: 'plot-backend/alerts',
      resource_type: 'auto',
    });

    uploadedUrls.push(result.secure_url);
  }

  return uploadedUrls;
}

async function createAlert(req, res) {
  try {
    const { title, category, priority, description, location, plotId } = req.body;

    if (!title || !category || !priority || !description) {
      return res.status(400).json({ message: 'Title, category, priority and description are required' });
    }

    if (!location || !location.address || location.latitude === undefined || location.longitude === undefined) {
      return res.status(400).json({ message: 'Location with address, latitude and longitude is required' });
    }

    const evidenceUrls = await uploadEvidenceFiles(buildUploadPayload(req));

    const alert = await Alert.create({
      title,
      category,
      priority,
      description,
      location,
      plotId,
      evidence: evidenceUrls,
      createdBy: req.user.id,
    });

    res.status(201).json({ message: 'Alert created successfully', alert });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create alert', error: error.message });
  }
}

async function getMyAlerts(req, res) {
  try {
    const radiusKm = positiveNumber(req.query.radiusKm, 2, 50);
    const hasViewerLocation = isValidCoordinate(req.query.latitude, req.query.longitude);
    const viewerLocation = hasViewerLocation
      ? { latitude: Number(req.query.latitude), longitude: Number(req.query.longitude) }
      : null;

    const [alerts, plots] = await Promise.all([
      Alert.find({ createdBy: req.user.id }).sort({ createdAt: -1 }).lean(),
      Plot.find({
        createdBy: { $ne: req.user.id },
        'location.latitude': { $exists: true },
        'location.longitude': { $exists: true },
      }).select('createdBy location').lean(),
    ]);

    const alertsWithLocationStats = alerts.map((alert) => {
      const { latitude, longitude } = alert.location || {};
      const hasAlertLocation = isValidCoordinate(latitude, longitude);
      const notifiedOwnerIds = new Set();

      if (hasAlertLocation) {
        plots.forEach((plot) => {
          if (!isValidCoordinate(plot.location?.latitude, plot.location?.longitude)) return;
          const ownerDistanceKm = distanceInKilometers(
            latitude,
            longitude,
            plot.location.latitude,
            plot.location.longitude
          );
          if (ownerDistanceKm <= radiusKm) notifiedOwnerIds.add(plot.createdBy.toString());
        });
      }

      const distanceKm = hasAlertLocation && viewerLocation
        ? Number(distanceInKilometers(
          viewerLocation.latitude,
          viewerLocation.longitude,
          latitude,
          longitude
        ).toFixed(2))
        : null;

      return {
        ...alert,
        distanceKm,
        notifiedUsers: notifiedOwnerIds.size,
        notificationRadiusKm: radiusKm,
      };
    });

    res.json({
      alerts: alertsWithLocationStats,
      viewerLocation,
      notificationRadiusKm: radiusKm,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch alerts', error: error.message });
  }
}

async function getAlertById(req, res) {
  try {
    const alert = await Alert.findById(req.params.id).populate('createdBy', 'name email');

    if (!alert) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    res.json({ alert });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch alert', error: error.message });
  }
}

async function updateAlert(req, res) {
  try {
    const alert = await Alert.findById(req.params.id);

    if (!alert) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    if (alert.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You can only update your own alerts' });
    }

    const allowedFields = ['title', 'category', 'priority', 'description', 'location'];
    const updates = {};

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    if (req.files && req.files.length > 0) {
      const evidenceUrls = await uploadEvidenceFiles(buildUploadPayload(req));
      updates.evidence = evidenceUrls;
    } else if (req.body.evidence !== undefined) {
      updates.evidence = req.body.evidence;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update' });
    }

    const updatedAlert = await Alert.findByIdAndUpdate(req.params.id, updates, { new: true });
    res.json({ message: 'Alert updated successfully', alert: updatedAlert });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update alert', error: error.message });
  }
}

async function deleteAlert(req, res) {
  try {
    const alert = await Alert.findById(req.params.id);

    if (!alert) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    if (alert.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You can only delete your own alerts' });
    }

    await Alert.findByIdAndDelete(req.params.id);
    res.json({ message: 'Alert deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete alert', error: error.message });
  }
}

async function getNearbyAlerts(req, res) {
  try {
    const { latitude, longitude, radius = 5 } = req.query;

    if (!isValidCoordinate(latitude, longitude)) {
      return res.status(400).json({ message: 'Valid latitude and longitude are required' });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    const maxDistance = positiveNumber(radius, 5, 100);

    const alerts = await Alert.find({
      status: 'Active',
      'location.latitude': { $exists: true },
      'location.longitude': { $exists: true },
    }).sort({ createdAt: -1 }).limit(50);

    const nearbyAlerts = alerts.filter((alert) => {
      return distanceInKilometers(lat, lng, alert.location.latitude, alert.location.longitude) <= maxDistance;
    });

    res.json({ alerts: nearbyAlerts });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch nearby alerts', error: error.message });
  }
}

// Property owners with a plot within the alert radius. The returned user IDs
// can be passed directly to the existing chat message endpoints.
async function getNearbyUsers(req, res) {
  try {
    const alert = await Alert.findById(req.params.id).select('location createdBy status').lean();
    if (!alert) return res.status(404).json({ message: 'Alert not found' });

    const { latitude, longitude } = alert.location || {};
    if (!isValidCoordinate(latitude, longitude)) {
      return res.status(422).json({ message: 'This alert has no valid map location' });
    }

    const radiusKm = positiveNumber(req.query.radiusKm, 2, 50);
    const limit = Math.min(Math.floor(positiveNumber(req.query.limit, 20, 50)), 50);
    const plots = await Plot.find({
      createdBy: { $ne: req.user.id },
      'location.latitude': { $exists: true },
      'location.longitude': { $exists: true },
    })
      .select('title location createdBy')
      .populate('createdBy', 'name email avatar')
      .lean();

    const nearestOwnerPlot = new Map();
    plots.forEach((plot) => {
      if (!plot.createdBy || !isValidCoordinate(plot.location?.latitude, plot.location?.longitude)) return;
      const distanceKm = distanceInKilometers(latitude, longitude, plot.location.latitude, plot.location.longitude);
      if (distanceKm > radiusKm) return;

      const ownerId = plot.createdBy._id.toString();
      const previous = nearestOwnerPlot.get(ownerId);
      if (!previous || distanceKm < previous.distanceKm) {
        nearestOwnerPlot.set(ownerId, { plot, distanceKm });
      }
    });

    const users = [...nearestOwnerPlot.entries()]
      .map(([userId, { plot, distanceKm }]) => ({
        userId,
        name: plot.createdBy.name || plot.createdBy.email || 'Unnamed user',
        email: plot.createdBy.email,
        avatar: plot.createdBy.avatar || null,
        distanceKm: Number(distanceKm.toFixed(2)),
        nearestPlot: {
          id: plot._id,
          title: plot.title,
          address: plot.location.address,
        },
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);

    res.json({
      alertId: alert._id,
      location: alert.location,
      radiusKm,
      users,
      count: users.length,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch nearby users', error: error.message });
  }
}

module.exports = {
  createAlert,
  getMyAlerts,
  getAlertById,
  updateAlert,
  deleteAlert,
  getNearbyAlerts,
  getNearbyUsers,
};
