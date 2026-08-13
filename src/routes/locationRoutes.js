const express = require('express');
const authMiddleware = require('../middleware/auth');
const { searchLocations, reverseGeocode } = require('../controllers/locationController');

const router = express.Router();

router.use(authMiddleware);
router.get('/search', searchLocations);
router.get('/reverse', reverseGeocode);

module.exports = router;
