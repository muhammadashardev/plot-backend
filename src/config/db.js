const mongoose = require('mongoose');
const { MONGODB_URL } = require('./env');

async function connectDB() {
  if (!MONGODB_URL) {
    console.warn('MONGODB_URL is not set. Skipping database connection.');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URL);
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
  }
}

module.exports = connectDB;
