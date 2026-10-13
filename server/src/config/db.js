const mongoose = require('mongoose');
const env = require('./env');

let isConnecting = false;

async function connectDB() {
  if (!env.MONGODB_URI) {
    console.warn('[db] MongoDB URI missing. Continuing without database persistence.');
    return false;
  }

  if (mongoose.connection.readyState === 1) {
    return true;
  }

  if (isConnecting) {
    return false;
  }

  isConnecting = true;
  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log('MongoDB connected');
    isConnecting = false;
    return true;
  } catch (err) {
    console.warn('MongoDB connection error:', err.message);
    console.warn('[db] Falling back to in-memory mode for local development.');
    isConnecting = false;

    // Retry connection in background so it recovers automatically if Atlas DNS/TLS was slow
    setTimeout(() => {
      if (mongoose.connection.readyState !== 1) {
        connectDB().catch(() => {});
      }
    }, 5000);

    return false;
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('[db] MongoDB disconnected. Attempting to reconnect...');
  setTimeout(() => {
    if (mongoose.connection.readyState !== 1) {
      connectDB().catch(() => {});
    }
  }, 3000);
});

module.exports = connectDB;

