const assert = require('assert');
const { createSpatialIndex } = require('../src/services/spatial-index');
const positionService = require('../src/services/position.service');
const { meshTelemetry, recomputeProximity, cleanupUser } = require('../src/services/proximity.service');
const Position = require('../src/models/Position');

const geoIndex = Position.schema.indexes().find(([, options]) => options.name === 'office_online_location_2d');
assert.ok(geoIndex, 'Position model must declare the office-scoped 2d index');
assert.deepStrictEqual(geoIndex[0], { officeId: 1, isOnline: 1, location: '2d' });

const users = Array.from({ length: 50 }, (_, index) => ({
  userId: `user-${index}`,
  location: [((index * 137) % 950) + 20, ((index * 251) % 650) + 20],
}));
users.push({ userId: 'invalid', location: [NaN, 20] });
const index = createSpatialIndex(users, 100);

for (const user of users.slice(0, 50)) {
  const expected = users.slice(0, 50)
    .filter((candidate) => candidate.userId !== user.userId)
    .filter((candidate) => Math.hypot(candidate.location[0] - user.location[0], candidate.location[1] - user.location[1]) <= 100)
    .map((candidate) => candidate.userId)
    .sort();
  const actual = index.nearby(user.location[0], user.location[1], 100)
    .filter((candidate) => candidate.userId !== user.userId)
    .map((candidate) => candidate.userId)
    .sort();
  assert.deepStrictEqual(actual, expected, `Spatial index must match exact radius results for ${user.userId}`);
}

const denseUsers = Array.from({ length: 50 }, (_, index) => ({
  userId: `dense-${index}`,
  location: [500 + (index % 10) * 4, 350 + Math.floor(index / 10) * 4],
}));
const denseIndex = createSpatialIndex(denseUsers, 100);
const startedAt = performance.now();
for (let sample = 0; sample < 100; sample += 1) {
  for (const user of denseUsers) denseIndex.nearby(user.location[0], user.location[1], 100);
}
console.log(`Spatial index correctness passed for 50 users; 100 x 50-user dense passes: ${(performance.now() - startedAt).toFixed(2)}ms.`);

const originalGetAllActivePositions = positionService.getAllActivePositions;
const activeUsers = Array.from({ length: 50 }, (_, index) => ({
  userId: `runtime-${index}`,
  officeId: 'benchmark-office',
  location: [(index % 10) * 150 + 40, Math.floor(index / 10) * 150 + 40],
  isOnline: true,
}));
positionService.getAllActivePositions = () => activeUsers;
const startedRuntimeTick = performance.now();
recomputeProximity({ to: () => ({ emit: () => {} }) });
const runtimeTickMs = performance.now() - startedRuntimeTick;
const runtimeStats = meshTelemetry.getStats();
assert.strictEqual(runtimeStats.activeUsers, 50);
assert.ok(Number.isFinite(runtimeStats.proximityRecompute.maxMs));
console.log(`Full 50-user proximity tick: ${runtimeTickMs.toFixed(3)}ms (20ms goal ${runtimeTickMs < 20 ? 'met' : 'not met'} on this run).`);
activeUsers.forEach(({ userId }) => cleanupUser(userId));
positionService.getAllActivePositions = originalGetAllActivePositions;
