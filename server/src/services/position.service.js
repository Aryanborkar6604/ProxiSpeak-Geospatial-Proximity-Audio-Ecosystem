const Position = require('../models/Position');

async function updatePosition(userId, officeId, x, y) {
  return Position.findOneAndUpdate(
    { userId, officeId },
    { location: [x, y], isOnline: true },
    { upsert: true, new: true }
  );
}

async function markOffline(userId) {
  return Position.updateMany(
    { userId },
    { isOnline: false }
  );
}

async function getOnlineUsers(officeId) {
  return Position.find({ officeId, isOnline: true });
}

module.exports = { updatePosition, markOffline, getOnlineUsers };

