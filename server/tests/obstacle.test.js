const assert = require('assert');
const { lineSegmentsIntersect, computeObstacleAttenuation } = require('../src/services/proximity.service');

console.log('--- RUNNING OBSTACLE & LINE-OF-SIGHT UNIT TESTS ---');

// Test 1: Simple perpendicular intersection
// Line AB: (100, 200) -> (300, 200)
// Wall CD: (200, 100) -> (200, 300)
assert.strictEqual(
  lineSegmentsIntersect(100, 200, 300, 200, 200, 100, 200, 300),
  true,
  'Segments crossing perpendicularly should intersect'
);
console.log('✓ Test 1: Crossing segments intersect successfully');

// Test 2: Parallel non-intersecting lines
assert.strictEqual(
  lineSegmentsIntersect(100, 100, 300, 100, 100, 200, 300, 200),
  false,
  'Parallel segments should not intersect'
);
console.log('✓ Test 2: Parallel segments do not intersect');

// Test 3: Segment ending before the wall
assert.strictEqual(
  lineSegmentsIntersect(100, 200, 180, 200, 200, 100, 200, 300),
  false,
  'Segments that do not reach each other should not intersect'
);
console.log('✓ Test 3: Collinear/short segments do not intersect prematurely');

// Test 4: Attenuation calculation with wall
const sampleWalls = [
  { type: 'wall', x1: 200, y1: 100, x2: 200, y2: 300, attenuation: 0.25 },
];

const posA = [100, 200];
const posB = [300, 200]; // separated by wall
const posC = [150, 150]; // on the same side of the wall

const attSeparated = computeObstacleAttenuation(posA, posB, sampleWalls);
assert.strictEqual(attSeparated, 0.25, 'Attenuation across 0.25 wall should be 0.25');
console.log(`✓ Test 4: Obstacle attenuation across wall is ${attSeparated} (expected 0.25)`);

const attSameSide = computeObstacleAttenuation(posA, posC, sampleWalls);
assert.strictEqual(attSameSide, 1.0, 'Attenuation on same side of wall should be 1.0');
console.log(`✓ Test 5: Attenuation without wall obstruction is ${attSameSide} (expected 1.0)`);

console.log('--- ALL OBSTACLE TESTS PASSED (5/5) ---\n');

