const Position = require('../models/Position');

// High-speed in-memory active position cache
const activePositions = new Map();

async function updatePosition(userId, officeId, x, y) {
  // Instant in-memory update
  activePositions.set(userId, {
    userId,
    officeId,
    location: [x, y],
    isOnline: true,
  });

  // Asynchronous background persistence to Atlas without blocking real-time events
  return Position.findOneAndUpdate(
    { userId, officeId },
    { location: [x, y], isOnline: true },
    { upsert: true, returnDocument: 'after' }
  ).catch((err) => {
    console.warn('Background position save warning:', err.message);
  });
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

function getAllActivePositions() {
  return Array.from(activePositions.values()).filter((p) => p.isOnline);
}

async function markOffline(userId) {
  if (activePositions.has(userId)) {
    activePositions.get(userId).isOnline = false;
  }
  return Position.updateMany({ userId }, { isOnline: false }).catch(() => {});
}

async function getOnlineUsers(officeId) {
  const memoryUsers = getActivePositionsForOffice(officeId);
  if (memoryUsers.length > 0) {
    return memoryUsers;
  }
  // Fallback to database on cold start
  try {
    const dbUsers = await Position.find({ officeId, isOnline: true });
    dbUsers.forEach((u) => {
      activePositions.set(u.userId, {
        userId: u.userId,
        officeId: u.officeId,
        location: u.location,
        isOnline: u.isOnline,
      });
    });
    return dbUsers;
  } catch (err) {
    return [];
  }
}

async function getPosition(userId, officeId) {
  if (activePositions.has(userId)) {
    return activePositions.get(userId);
  }
  return Position.findOne({ userId, officeId }).catch(() => null);
}

module.exports = {
  updatePosition,
  markOffline,
  getOnlineUsers,
  getPosition,
  getAllActivePositions,
  getActivePositionsForOffice,
};
