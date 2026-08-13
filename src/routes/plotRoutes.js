const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middleware/auth');
const {
  createPlot,
  getAllPlots,
  getPlotById,
  updatePlot,
  deletePlot,
} = require('../controllers/plotController');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// CRUD routes for user dashboard
router.post('/', authMiddleware, upload.array('images', 10), createPlot);
router.get('/', authMiddleware, getAllPlots);
router.get('/:id', authMiddleware, getPlotById);
router.put('/:id', authMiddleware, upload.array('images', 10), updatePlot);
router.delete('/:id', authMiddleware, deletePlot);

module.exports = router;