const constants = require('../config/constants');
const positionService = require('./position.service');
const officeService = require('./office.service');
const { createSpatialIndex } = require('./spatial-index');

const previousProximitySets = new Map();
const previousAttenuations = new Map();
let isRecomputing = false;
const recomputeDurations = [];
let maxRecomputeDurationMs = 0;

// 2D line-segment intersection using the standard orientation test.
function orientation(ax, ay, bx, by, cx, cy) {
  return (by - ay) * (cx - ax) - (bx - ax) * (cy - ay);
}

function onSegment(px, py, qx, qy, rx, ry) {
  return (
    qx <= Math.max(px, rx) &&
    qx >= Math.min(px, rx) &&
    qy <= Math.max(py, ry) &&
    qy >= Math.min(py, ry)
  );
}

function lineSegmentsIntersect(p1x, p1y, p2x, p2y, q1x, q1y, q2x, q2y) {
  const o1 = orientation(p1x, p1y, p2x, p2y, q1x, q1y);
  const o2 = orientation(p1x, p1y, p2x, p2y, q2x, q2y);
  const o3 = orientation(q1x, q1y, q2x, q2y, p1x, p1y);
  const o4 = orientation(q1x, q1y, q2x, q2y, p2x, p2y);

  if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0) && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) {
    return true;
  }

  if (Math.abs(o1) < 1e-9 && onSegment(p1x, p1y, q1x, q1y, p2x, p2y)) return true;
  if (Math.abs(o2) < 1e-9 && onSegment(p1x, p1y, q2x, q2y, p2x, p2y)) return true;
  if (Math.abs(o3) < 1e-9 && onSegment(q1x, q1y, p1x, p1y, q2x, q2y)) return true;
  if (Math.abs(o4) < 1e-9 && onSegment(q1x, q1y, p2x, p2y, q2x, q2y)) return true;

  return false;
}

// Compute total attenuation factor from obstacles crossing line of sight
function computeObstacleAttenuation(p1, p2, obstacles = []) {
  if (!obstacles || obstacles.length === 0) return 1.0;
  let factor = 1.0;
  for (const obs of obstacles) {
    if (obs.x1 !== undefined && obs.y1 !== undefined && obs.x2 !== undefined && obs.y2 !== undefined) {
      if (lineSegmentsIntersect(p1[0], p1[1], p2[0], p2[1], obs.x1, obs.y1, obs.x2, obs.y2)) {
        const wallAtt = typeof obs.attenuation === 'number' ? obs.attenuation : 0.25;
        factor *= wallAtt;
      }
    }
  }
  return Math.max(0.05, Math.min(1.0, factor));
}

// Mesh Telemetry tracking
const meshTelemetry = {
  totalChecks: 0,
  maxConnectionsObserved: 0,
  lastWarningTime: {},
  getStats: () => {
    const userCounts = [...previousProximitySets.entries()].map(([uId, set]) => ({
      userId: uId,
      peerCount: set.size,
    }));
    const totalUsers = userCounts.length;
    const totalConnections = userCounts.reduce((acc, curr) => acc + curr.peerCount, 0);
    const avgConnections = totalUsers > 0 ? (totalConnections / totalUsers).toFixed(2) : 0;
    const maxConnections = userCounts.reduce((max, curr) => Math.max(max, curr.peerCount), 0);

    return {
      activeUsers: totalUsers,
      totalProximityPairs: totalConnections / 2, // bidirectional pairs
      avgConnectionsPerUser: parseFloat(avgConnections),
      maxConnectionsPerUser: maxConnections,
      fullMeshNaïvePairs: totalUsers > 1 ? (totalUsers * (totalUsers - 1)) / 2 : 0,
      reductionRatio: totalUsers > 1 ? `${Math.round((1 - (totalConnections / (totalUsers * (totalUsers - 1)))) * 100)}%` : '0%',
      meshCap: 10,
      sfuEscalationTriggered: maxConnections >= 10,
      proximityRecompute: {
        samples: recomputeDurations.length,
        averageMs: recomputeDurations.length
          ? Number((recomputeDurations.reduce((sum, duration) => sum + duration, 0) / recomputeDurations.length).toFixed(3))
          : 0,
        p95Ms: recomputeDurations.length
          ? Number([...recomputeDurations].sort((a, b) => a - b)[Math.ceil(recomputeDurations.length * 0.95) - 1].toFixed(3))
          : 0,
        maxMs: Number(maxRecomputeDurationMs.toFixed(3)),
        targetMs: 20,
      },
    };
  },
};

function recomputeProximity(io) {
  if (isRecomputing) return;
  isRecomputing = true;
  const startedAt = performance.now();

  try {
    meshTelemetry.totalChecks += 1;
    const onlineUsers = positionService.getAllActivePositions();
    if (!onlineUsers || onlineUsers.length === 0) {
      previousProximitySets.clear();
      previousAttenuations.clear();
      return;
    }

    // Group active users by officeId
    const officeGroups = {};
    for (const u of onlineUsers) {
      if (!officeGroups[u.officeId]) {
        officeGroups[u.officeId] = [];
      }
      officeGroups[u.officeId].push(u);
    }

    for (const [officeId, users] of Object.entries(officeGroups)) {
      const office = officeService.getCachedOffice(officeId);
      const obstacles = office?.obstacles || officeService.DEFAULT_OBSTACLES;
      const hearingRadius = office?.hearingRadiusPx || constants.HEARING_RADIUS_PX;
      const spatialIndex = createSpatialIndex(users, hearingRadius);

      for (const user of users) {
        const { userId, location } = user;
        if (!location || location.length < 2) continue;
        const [x1, y1] = location;

        const inRangeUsers = spatialIndex.nearby(x1, y1, hearingRadius)
          .filter((other) => other.userId !== userId);

        const currentSet = new Set(inRangeUsers.map((u) => u.userId));
        const prevSet = previousProximitySets.get(userId) || new Set();

        if (!previousAttenuations.has(userId)) {
          previousAttenuations.set(userId, {});
        }
        const userAttenuations = previousAttenuations.get(userId);

        // Calculate obstacle attenuation for all in-range peers
        const currentAttenuations = {};
        for (const peer of inRangeUsers) {
          const att = computeObstacleAttenuation(location, peer.location, obstacles);
          currentAttenuations[peer.userId] = att;
        }

        // Mesh Scaling Telemetry: Check if approaching or exceeding mesh cap (10-12 peers)
        if (currentSet.size >= 10) {
          const now = Date.now();
          const lastWarn = meshTelemetry.lastWarningTime[userId] || 0;
          if (now - lastWarn > 10000) { // Log alert once every 10 seconds per user
            console.warn(
              `[Mesh Telemetry ALERT] User ${userId} has ${currentSet.size} active peer connections (approaching mesh limit of 10-12). Zone density is high - SFU evaluation trigger reached.`
            );
            meshTelemetry.lastWarningTime[userId] = now;
          }
        }

        if (currentSet.size > meshTelemetry.maxConnectionsObserved) {
          meshTelemetry.maxConnectionsObserved = currentSet.size;
        }

        const entered = [...currentSet].filter((x) => !prevSet.has(x));
        const exited = [...prevSet].filter((x) => !currentSet.has(x));

        entered.forEach((peerId) => {
          const att = currentAttenuations[peerId] ?? 1.0;
          io.to(`user_${userId}`).emit('peer:enter-range', { userId: peerId, attenuation: att });
          userAttenuations[peerId] = att;
        });

        // Check if attenuation changed for peers that remained in range (e.g. walked behind a wall)
        [...currentSet].forEach((peerId) => {
          if (!entered.includes(peerId)) {
            const currentAtt = currentAttenuations[peerId] ?? 1.0;
            const prevAtt = userAttenuations[peerId] ?? 1.0;
            if (Math.abs(currentAtt - prevAtt) > 0.05) {
              io.to(`user_${userId}`).emit('peer:attenuation-changed', {
                userId: peerId,
                attenuation: currentAtt,
              });
              userAttenuations[peerId] = currentAtt;
            }
          }
        });

        exited.forEach((peerId) => {
          io.to(`user_${userId}`).emit('peer:exit-range', { userId: peerId });
          delete userAttenuations[peerId];
        });

        previousProximitySets.set(userId, currentSet);
      }
    }
  } catch (error) {
    console.error('Proximity recompute error:', error);
  } finally {
    const duration = performance.now() - startedAt;
    recomputeDurations.push(duration);
    if (recomputeDurations.length > 1000) recomputeDurations.shift();
    maxRecomputeDurationMs = Math.max(maxRecomputeDurationMs, duration);
    isRecomputing = false;
  }
}

function cleanupUser(userId) {
  previousProximitySets.delete(userId);
  previousAttenuations.delete(userId);
  delete meshTelemetry.lastWarningTime[userId];
}

function arePeersInRange(userId, peerId) {
  if (!userId || !peerId || userId === peerId) return false;
  return Boolean(
    previousProximitySets.get(userId)?.has(peerId) &&
    previousProximitySets.get(peerId)?.has(userId)
  );
}

function startProximityService(io) {
  // Runs high-frequency in-memory checks every 100ms with zero DB overhead
  setInterval(() => {
    recomputeProximity(io);
  }, constants.PROXIMITY_RECOMPUTE_INTERVAL_MS);
}

module.exports = {
  startProximityService,
  cleanupUser,
  meshTelemetry,
  recomputeProximity,
  arePeersInRange,
  lineSegmentsIntersect,
  computeObstacleAttenuation,
};
