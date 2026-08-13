const Plot = require('../models/Plot');
const cloudinary = require('../config/cloudinary');

function buildUploadPayload(req) {
  if (!req.files || req.files.length === 0) {
    return [];
  }

  return req.files.map((file) => ({
    buffer: file.buffer,
    mimetype: file.mimetype,
  }));
}

async function uploadPlotImages(files) {
  if (!files || files.length === 0) {
    return [];
  }

  const uploadedUrls = [];

  for (const file of files) {
    const base64Image = file.buffer.toString('base64');
    const dataUri = `data:${file.mimetype};base64,${base64Image}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder: 'plot-backend/plots',
      resource_type: 'auto',
    });

    uploadedUrls.push(result.secure_url);
  }

  return uploadedUrls;
}

// Create a new plot
async function createPlot(req, res) {
  try {
    const { title, description, price, area, areaUnit, type, category, location, amenities, contact, status } = req.body;

    if (!title || !description || !price || !area || !type || !category) {
      return res.status(400).json({ message: 'Title, description, price, area, type and category are required' });
    }

    if (!location || !location.address) {
      return res.status(400).json({ message: 'Location with address is required' });
    }

    const imageUrls = await uploadPlotImages(buildUploadPayload(req));

    const plot = await Plot.create({
      title,
      description,
      price,
      area,
      areaUnit,
      type,
      category,
      status,
      location,
      amenities,
      contact,
      images: imageUrls,
      createdBy: req.user.id,
    });

    res.status(201).json({ message: 'Plot created successfully', plot });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create plot', error: error.message });
  }
}

// Get all plots (for user dashboard - returns current user's plots)
async function getAllPlots(req, res) {
  try {
    const { status, type, category, search } = req.query;

    const filter = { createdBy: req.user.id };

    if (status) {
      filter.status = status;
    }

    if (type) {
      filter.type = type;
    }

    if (category) {
      filter.category = category;
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'location.address': { $regex: search, $options: 'i' } },
        { 'location.city': { $regex: search, $options: 'i' } },
      ];
    }

    const plots = await Plot.find(filter).sort({ createdAt: -1 });

    res.json({ plots, count: plots.length });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch plots', error: error.message });
  }
}

// Get a single plot by ID
async function getPlotById(req, res) {
  try {
    const plot = await Plot.findById(req.params.id).populate('createdBy', 'name email avatar');

    if (!plot) {
      return res.status(404).json({ message: 'Plot not found' });
    }

    res.json({ plot });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch plot', error: error.message });
  }
}

// Edit (update) a plot
async function updatePlot(req, res) {
  try {
    const plot = await Plot.findById(req.params.id);

    if (!plot) {
      return res.status(404).json({ message: 'Plot not found' });
    }

    if (plot.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You can only update your own plots' });
    }

    const allowedFields = [
      'title',
      'description',
      'price',
      'area',
      'areaUnit',
      'type',
      'category',
      'status',
      'location',
      'amenities',
      'contact',
    ];
    const updates = {};

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    if (req.files && req.files.length > 0) {
      const imageUrls = await uploadPlotImages(buildUploadPayload(req));
      updates.images = imageUrls;
    } else if (req.body.images !== undefined) {
      updates.images = req.body.images;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update' });
    }

    const updatedPlot = await Plot.findByIdAndUpdate(req.params.id, updates, { new: true });
    res.json({ message: 'Plot updated successfully', plot: updatedPlot });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update plot', error: error.message });
  }
}

// Delete a plot
async function deletePlot(req, res) {
  try {
    const plot = await Plot.findById(req.params.id);

    if (!plot) {
      return res.status(404).json({ message: 'Plot not found' });
    }

    if (plot.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You can only delete your own plots' });
    }

    await Plot.findByIdAndDelete(req.params.id);
    res.json({ message: 'Plot deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete plot', error: error.message });
  }
}

module.exports = {
  createPlot,
  getAllPlots,
  getPlotById,
  updatePlot,
  deletePlot,
};