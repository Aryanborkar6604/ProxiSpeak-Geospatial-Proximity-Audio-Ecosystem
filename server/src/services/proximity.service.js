const Position = require('../models/Position');
const constants = require('../config/constants');

let previousProximitySets = {};

async function recomputeProximity(io) {
  try {
    const offices = await Position.distinct('officeId');
    
    for (const officeId of offices) {
      const onlineUsers = await Position.find({ officeId, isOnline: true });
      
      for (const user of onlineUsers) {
        const { userId, location } = user;
        
        const inRangeUsers = await Position.find({
          officeId,
          isOnline: true,
          userId: { $ne: userId },
          location: {
            $near: location,
            $maxDistance: constants.HEARING_RADIUS_PX
          }
        });
        
        const currentSet = new Set(inRangeUsers.map(u => u.userId));
        const prevSet = previousProximitySets[userId] || new Set();
        
        const entered = [...currentSet].filter(x => !prevSet.has(x));
        const exited = [...prevSet].filter(x => !currentSet.has(x));
        
        entered.forEach(peerId => {
          io.to(`user_${userId}`).emit('peer:enter-range', { userId: peerId });
        });
        
        exited.forEach(peerId => {
          io.to(`user_${userId}`).emit('peer:exit-range', { userId: peerId });
        });
        
        previousProximitySets[userId] = currentSet;
      }
    }
  } catch (error) {
    console.error("Proximity recompute error:", error);
  }
}

function startProximityService(io) {
  setInterval(() => {
    recomputeProximity(io);
  }, constants.PROXIMITY_RECOMPUTE_INTERVAL_MS);
}

module.exports = { startProximityService };

