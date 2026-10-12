const mongoose = require('mongoose');
const Position = require('../models/Position');
const constants = require('../config/constants');

// High-speed in-memory active position cache
const activePositions = new Map();
const persistenceStates = new Map();

async function updatePosition(userId, officeId, x, y) {
  const nextPosition = {
    userId,
    officeId,
    location: [x, y],
    isOnline: true,
  };

  activePositions.set(userId, nextPosition);

  if (mongoose.connection.readyState !== 1) {
    return nextPosition;
  }

  let state = persistenceStates.get(userId);
  if (!state) {
    state = { pending: null, lastAttemptAt: 0, inFlight: false, timer: null };
    persistenceStates.set(userId, state);
  }
  state.pending = nextPosition;
  schedulePersistence(userId, state, 0);
  return nextPosition;
}

function schedulePersistence(userId, state, delay) {
  if (state.timer || state.inFlight) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    persistPendingPosition(userId, state);
  }, delay);
  state.timer.unref?.();
}

async function persistPendingPosition(userId, state) {
  if (state.inFlight || !state.pending || mongoose.connection.readyState !== 1) return;
  const waitMs = Math.max(
    0,
    constants.POSITION_PERSIST_INTERVAL_MS - (Date.now() - state.lastAttemptAt),
  );
  if (waitMs > 0) {
    schedulePersistence(userId, state, waitMs);
    return;
  }

  const position = state.pending;
  state.pending = null;
  state.inFlight = true;
  state.lastAttemptAt = Date.now();
  try {
    await Position.findOneAndUpdate(
      { userId, officeId: position.officeId },
      { location: position.location, isOnline: true },
      { upsert: true, returnDocument: 'after' },
    );
  } catch (err) {
    console.warn('Background position save warning:', err.message);
    if (!state.pending) state.pending = position;
  } finally {
    state.inFlight = false;
    if (state.pending && mongoose.connection.readyState === 1) {
      schedulePersistence(userId, state, constants.POSITION_PERSIST_INTERVAL_MS);
    }
  }
}

function getActivePositionsForOffice(officeId) {
  const results = [];
  for (const pos of activePositions.values()) {
    if (pos.officeId === officeId && pos.isOnline) {
      results.push(pos);
    }
  }
  return results;
}

function cachePositions(positions) {
  for (const position of positions) {
    const plain = position.toObject ? position.toObject() : position;
    activePositions.set(plain.userId, {
      userId: plain.userId,
      officeId: plain.officeId,
      location: plain.location,
      isOnline: plain.isOnline,
    });
  }
  return positions;
}

function getAllActivePositions() {
  return Array.from(activePositions.values()).filter((p) => p.isOnline);
}

async function markOffline(userId) {
  if (activePositions.has(userId)) {
    activePositions.get(userId).isOnline = false;
  }

  const persistenceState = persistenceStates.get(userId);
  if (persistenceState?.timer) {
    clearTimeout(persistenceState.timer);
    persistenceState.timer = null;
  }
  if (persistenceState?.inFlight) {
    await new Promise((resolve) => {
      const waitForSave = () => {
        if (persistenceState.inFlight) setTimeout(waitForSave, 10);
        else resolve();
      };
      waitForSave();
    });
  }
  if (persistenceState?.timer) {
    clearTimeout(persistenceState.timer);
    persistenceState.timer = null;
  }

  if (mongoose.connection.readyState !== 1) {
    persistenceStates.delete(userId);
    return true;
  }

  try {
    if (persistenceState?.pending) {
      const pending = persistenceState.pending;
      persistenceState.pending = null;
      await Position.findOneAndUpdate(
        { userId, officeId: pending.officeId },
        { location: pending.location, isOnline: true },
        { upsert: true },
      );
    }
    await Position.updateMany({ userId }, { isOnline: false });
    persistenceStates.delete(userId);
    return true;
  } catch (err) {
    console.warn('Could not persist offline status:', err.message);
    persistenceStates.delete(userId);
    return false;
  }
}

async function getOnlineUsers(officeId, { width = 1000, height = 700 } = {}) {
  const memoryUsers = getActivePositionsForOffice(officeId);
  if (mongoose.connection.readyState !== 1) {
    return memoryUsers;
  }

  try {
    const dbUsers = await Position.find({
      officeId,
      isOnline: true,
      location: { $geoWithin: { $box: [[0, 0], [width, height]] } },
    }).lean();
    cachePositions(dbUsers);
    const byUserId = new Map(memoryUsers.map((user) => [user.userId, user]));
    dbUsers.forEach((user) => byUserId.set(user.userId, user));
    return [...byUserId.values()];
  } catch (err) {
    console.warn('[positions] MongoDB office geospatial lookup failed:', err.message);
    return memoryUsers;
  }
}

async function getNearbyUsers(officeId, x, y, radius) {
  const memoryUsers = getActivePositionsForOffice(officeId)
    .filter((position) => Math.hypot(position.location[0] - x, position.location[1] - y) <= radius);
  if (mongoose.connection.readyState !== 1) {
    return memoryUsers;
  }

  try {
    const dbUsers = await Position.find({
      officeId,
      isOnline: true,
      location: { $near: [x, y], $maxDistance: radius },
    }).limit(100).lean();
    cachePositions(dbUsers);
    const byUserId = new Map(memoryUsers.map((user) => [user.userId, user]));
    dbUsers.forEach((user) => byUserId.set(user.userId, user));
    return [...byUserId.values()];
  } catch (err) {
    console.warn('[positions] MongoDB nearby geospatial lookup failed:', err.message);
    return memoryUsers;
  }
}

async function getPosition(userId, officeId) {
  if (activePositions.has(userId)) {
    return activePositions.get(userId);
  }

  if (mongoose.connection.readyState !== 1) {
    return null;
  }

  return Position.findOne({ userId, officeId }).catch(() => null);
}

module.exports = {
  updatePosition,
  markOffline,
  getOnlineUsers,
  getNearbyUsers,
  getPosition,
  getAllActivePositions,
  getActivePositionsForOffice,
};
