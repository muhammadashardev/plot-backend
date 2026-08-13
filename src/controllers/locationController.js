const { NOMINATIM_USER_AGENT } = require('../config/env');
const { isValidCoordinate, positiveNumber } = require('../utils/geo');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const CACHE_TTL_MS = 60 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 1000;
const MAX_CACHE_ENTRIES = 500;
const cache = new Map();
let requestQueue = Promise.resolve();
let lastRequestAt = 0;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getCached(key) {
  const cached = cache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return cached.value;
}

function setCached(key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function requestNominatim(path) {
  if (!NOMINATIM_USER_AGENT) {
    const error = new Error('NOMINATIM_USER_AGENT is not configured');
    error.status = 503;
    throw error;
  }

  // Keep all requests from this process at or below Nominatim's 1 request/sec limit.
  const task = requestQueue.then(async () => {
    const waitFor = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (waitFor) await sleep(waitFor);
    lastRequestAt = Date.now();

    const response = await fetch(`${NOMINATIM_URL}${path}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': NOMINATIM_USER_AGENT,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const error = new Error(`OpenStreetMap lookup failed with status ${response.status}`);
      error.status = response.status === 429 ? 429 : 502;
      throw error;
    }

    return response.json();
  });

  // A failed lookup must not stop later requests in the queue.
  requestQueue = task.catch(() => undefined);
  return task;
}

function normalizePlace(place) {
  const address = place.address || {};
  return {
    id: `${place.osm_type || 'place'}:${place.osm_id || place.place_id}`,
    address: place.display_name,
    latitude: Number(place.lat),
    longitude: Number(place.lon),
    city: address.city || address.town || address.village || address.municipality || address.county || '',
    country: address.country || '',
    countryCode: address.country_code || '',
    bounds: Array.isArray(place.boundingbox)
      ? {
        south: Number(place.boundingbox[0]),
        north: Number(place.boundingbox[1]),
        west: Number(place.boundingbox[2]),
        east: Number(place.boundingbox[3]),
      }
      : null,
  };
}

async function searchLocations(req, res) {
  try {
    const query = String(req.query.q || '').trim();
    if (query.length < 3 || query.length > 200) {
      return res.status(400).json({ message: 'Search query must be between 3 and 200 characters' });
    }

    const limit = Math.min(Math.floor(positiveNumber(req.query.limit, 5, 10)), 10);
    const countryCodes = String(req.query.countryCodes || '').trim().toLowerCase();
    if (countryCodes && !/^[a-z]{2}(,[a-z]{2})*$/.test(countryCodes)) {
      return res.status(400).json({ message: 'countryCodes must be comma-separated ISO country codes' });
    }

    const params = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', limit: String(limit) });
    if (countryCodes) params.set('countrycodes', countryCodes);
    const cacheKey = `search:${params}`;
    let locations = getCached(cacheKey);

    if (!locations) {
      const places = await requestNominatim(`/search?${params}`);
      locations = places.map(normalizePlace);
      setCached(cacheKey, locations);
    }

    res.json({ locations, count: locations.length, attribution: 'OpenStreetMap contributors' });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || 'Failed to search locations' });
  }
}

async function reverseGeocode(req, res) {
  try {
    const { latitude, longitude } = req.query;
    if (!isValidCoordinate(latitude, longitude)) {
      return res.status(400).json({ message: 'Valid latitude and longitude are required' });
    }

    const params = new URLSearchParams({
      lat: String(Number(latitude)),
      lon: String(Number(longitude)),
      format: 'jsonv2',
      addressdetails: '1',
      zoom: '18',
    });
    const cacheKey = `reverse:${params}`;
    let location = getCached(cacheKey);

    if (!location) {
      const place = await requestNominatim(`/reverse?${params}`);
      location = normalizePlace(place);
      setCached(cacheKey, location);
    }

    res.json({ location, attribution: 'OpenStreetMap contributors' });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || 'Failed to reverse geocode location' });
  }
}

module.exports = { searchLocations, reverseGeocode };
