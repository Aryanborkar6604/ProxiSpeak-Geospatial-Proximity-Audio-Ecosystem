const assert = require('assert');
const { createSpatialIndex } = require('../src/services/spatial-index');
const positionService = require('../src/services/position.service');
const { computeObstacleAttenuation } = require('../src/services/proximity.service');
const officeService = require('../src/services/office.service');

console.log('--- RUNNING BACKEND SERVER EFFICIENCY BENCHMARKS ---');

// 1. Benchmark: Spatial Index Search Throughput
const users = Array.from({ length: 100 }, (_, i) => ({
  userId: `bench-user-${i}`,
  location: [Math.random() * 1000, Math.random() * 700],
}));
const index = createSpatialIndex(users, 100);

const t0 = performance.now();
const QUERY_COUNT = 5000;
for (let i = 0; i < QUERY_COUNT; i++) {
  const x = (i * 37) % 1000;
  const y = (i * 73) % 700;
  index.nearby(x, y, 100);
}
const spatialTimeMs = performance.now() - t0;
console.log(`✓ 1. Spatial Index: ${QUERY_COUNT} queries completed in ${spatialTimeMs.toFixed(2)}ms (${(QUERY_COUNT / (spatialTimeMs / 1000)).toFixed(0)} queries/sec)`);
assert.ok(spatialTimeMs < 100, '5,000 spatial queries should complete in under 100ms');

// 2. Benchmark: Obstacle Attenuation with AABB Bounding Box Filtering
const obstacles = officeService.DEFAULT_OBSTACLES;
const t1 = performance.now();
const RAY_COUNT = 10000;
for (let i = 0; i < RAY_COUNT; i++) {
  const p1 = [(i * 17) % 1000, (i * 29) % 700];
  const p2 = [(i * 31) % 1000, (i * 47) % 700];
  computeObstacleAttenuation(p1, p2, obstacles);
}
const rayTimeMs = performance.now() - t1;
console.log(`✓ 2. Obstacle AABB Raycasting: ${RAY_COUNT} ray checks completed in ${rayTimeMs.toFixed(2)}ms (${(RAY_COUNT / (rayTimeMs / 1000)).toFixed(0)} checks/sec)`);
assert.ok(rayTimeMs < 100, '10,000 obstacle ray checks should complete in under 100ms');

// 3. Benchmark: In-Memory Dual-Indexed Position Lookups
const t2 = performance.now();
const UPDATE_COUNT = 2000;
for (let i = 0; i < UPDATE_COUNT; i++) {
  positionService.updatePosition(`user-${i % 50}`, 'bench-office', (i * 7) % 1000, (i * 11) % 700);
}
const posTimeMs = performance.now() - t2;
console.log(`✓ 3. Position Updates: ${UPDATE_COUNT} updates completed in ${posTimeMs.toFixed(2)}ms (${(UPDATE_COUNT / (posTimeMs / 1000)).toFixed(0)} ops/sec)`);
assert.ok(posTimeMs < 100, '2,000 position updates should complete in under 100ms');

// 4. Benchmark: O(1) Office-Scoped Lookup
const t3 = performance.now();
for (let i = 0; i < 5000; i++) {
  const officeUsers = positionService.getActivePositionsForOffice('bench-office');
  assert.ok(officeUsers.length > 0);
}
const officeLookupMs = performance.now() - t3;
console.log(`✓ 4. Office-Scoped Lookups: 5000 lookups completed in ${officeLookupMs.toFixed(2)}ms (${(5000 / (officeLookupMs / 1000)).toFixed(0)} lookups/sec)`);
assert.ok(officeLookupMs < 50, '5,000 office-scoped lookups should complete in under 50ms');

console.log('--- ALL SERVER EFFICIENCY BENCHMARKS PASSED ---\n');
