const mongoose = require('mongoose');
const env = require('./env');

// Disable query buffering so Mongoose fails fast to in-memory mode instead of stalling requests for 10s
mongoose.set('bufferCommands', false);

let hasConnected = false;
let isConnecting = false;
let reconnectTimer = null;

async function connectDB() {
  if (!env.MONGODB_URI) {
    console.warn('[db] MongoDB URI missing. Continuing without database persistence.');
    return false;
  }

  if (mongoose.connection.readyState === 1) {
    hasConnected = true;
    return true;
  }

  if (isConnecting) {
    return false;
  }

  isConnecting = true;
  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 2500, // Fast failover (2.5s) instead of freezing requests for 10s
      connectTimeoutMS: 2500,
      socketTimeoutMS: 5000,
    });
    console.log('MongoDB connected');
    hasConnected = true;
    isConnecting = false;
    return true;
  } catch (err) {
    console.warn('MongoDB connection error:', err.message);
    console.warn('[db] Running in in-memory mode for local development.');
    isConnecting = false;

    // Retry quietly in the background after 30 seconds without spamming the event loop
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (mongoose.connection.readyState !== 1) {
          connectDB().catch(() => {});
        }
      }, 30000);
      reconnectTimer.unref?.();
    }

    return false;
  }
}

mongoose.connection.on('disconnected', () => {
  if (!hasConnected) return; // Only trigger if a previously active connection was dropped
  hasConnected = false;
  console.warn('[db] MongoDB disconnected. Attempting to reconnect in 10s...');
  if (!reconnectTimer) {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (mongoose.connection.readyState !== 1) {
        connectDB().catch(() => {});
      }
    }, 10000);
    reconnectTimer.unref?.();
  }
});

module.exports = connectDB;

