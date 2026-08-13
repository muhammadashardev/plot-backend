const express = require('express');
const authMiddleware = require('../middleware/auth');
const { getDashboard } = require('../controllers/dashboardController');

const router = express.Router();

// latitude/longitude are optional. Provide them to populate nearby alert counts and map markers.
router.get('/', authMiddleware, getDashboard);

module.exports = router;
