const mongoose = require('mongoose');
const Position = require('../models/Position');
const constants = require('../config/constants');

// High-speed dual in-memory active position cache (O(1) user and office lookup)
const activePositions = new Map();
const activePositionsByOffice = new Map(); // officeId -> Map<userId, position>
const persistenceStates = new Map();

async function updatePosition(userId, officeId, x, y) {
  const prev = activePositions.get(userId);
  // Micro-jitter deduplication: skip redundant persistence scheduling if change < 0.25px
  if (
    prev &&
    prev.officeId === officeId &&
    prev.isOnline &&
    Math.abs(prev.location[0] - x) < 0.25 &&
    Math.abs(prev.location[1] - y) < 0.25
  ) {
    return prev;
  }

  const nextPosition = {
    userId,
    officeId,
    location: [x, y],
    isOnline: true,
  };

  activePositions.set(userId, nextPosition);

  // Maintain per-office index for zero-cost room filtering
  if (prev && prev.officeId !== officeId) {
    activePositionsByOffice.get(prev.officeId)?.delete(userId);
  }
  let officeMap = activePositionsByOffice.get(officeId);
  if (!officeMap) {
    officeMap = new Map();
    activePositionsByOffice.set(officeId, officeMap);
  }
  officeMap.set(userId, nextPosition);

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
  const officeMap = activePositionsByOffice.get(officeId);
  if (!officeMap) return [];
  const results = [];
  for (const pos of officeMap.values()) {
    if (pos.isOnline) {
      results.push(pos);
    }
  }
  return results;
}

function cachePositions(positions) {
  for (let i = 0; i < positions.length; i += 1) {
    const position = positions[i];
    const plain = position.toObject ? position.toObject() : position;
    const item = {
      userId: plain.userId,
      officeId: plain.officeId,
      location: plain.location,
      isOnline: plain.isOnline,
    };
    activePositions.set(plain.userId, item);
    let officeMap = activePositionsByOffice.get(plain.officeId);
    if (!officeMap) {
      officeMap = new Map();
      activePositionsByOffice.set(plain.officeId, officeMap);
    }
    officeMap.set(plain.userId, item);
  }
  return positions;
}

function getAllActivePositions() {
  const results = [];
  for (const p of activePositions.values()) {
    if (p.isOnline) results.push(p);
  }
  return results;
}

async function markOffline(userId) {
  const existing = activePositions.get(userId);
  if (existing) {
    existing.isOnline = false;
    activePositionsByOffice.get(existing.officeId)?.delete(userId);
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
