const mongoose = require('mongoose');
const env = require('./env');

async function connectDB() {
  if (!env.MONGODB_URI) {
    console.warn('[db] MongoDB URI missing. Continuing without database persistence.');
    return false;
  }

  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 3000,
    });
    console.log('MongoDB connected');
    return true;
  } catch (err) {
    console.warn('MongoDB connection error:', err.message);
    console.warn('[db] Falling back to in-memory mode for local development.');
    return false;
  }
}

module.exports = connectDB;

