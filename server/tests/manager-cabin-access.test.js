const assert = require('assert');

function isInsideManagerCabin(x, y) {
  return x >= 705 && x <= 965 && y >= 35 && y <= 255;
}

console.log('--- RUNNING MANAGER CABIN ACCESS & KNOCK UNIT TESTS ---');

// Test 1: Coordinate boundary detection
assert.strictEqual(isInsideManagerCabin(835, 145), true, 'Center of Manager Cabin should be inside');
assert.strictEqual(isInsideManagerCabin(705, 35), true, 'Top-left boundary should be inside');
assert.strictEqual(isInsideManagerCabin(965, 255), true, 'Bottom-right boundary should be inside');
assert.strictEqual(isInsideManagerCabin(500, 200), false, 'Meeting room coordinates should be outside');
assert.strictEqual(isInsideManagerCabin(704, 150), false, 'Just outside left partition should be outside');
assert.strictEqual(isInsideManagerCabin(745, 275), false, 'Outside bottom doorway should be outside');
console.log('✓ Test 1: Manager cabin boundary coordinates verified');

// Test 2: Occupancy logic
const testOccupants = [
  { userId: 'u1', location: [800, 100] }, // inside
  { userId: 'u2', location: [850, 150] }, // inside
  { userId: 'u3', location: [500, 400] }, // outside
];

const insideCabin = testOccupants.filter((u) => isInsideManagerCabin(u.location[0], u.location[1]));
assert.strictEqual(insideCabin.length, 2, 'Should count exactly 2 occupants inside Manager Cabin');
console.log('✓ Test 2: Cabin occupancy counted accurately (2 occupants)');

// Test 3: Entry restriction simulation
const permissions = new Map(); // officeId -> Map<userId, expiresAt>
function hasPermission(officeId, uid) {
  const p = permissions.get(officeId);
  return Boolean(p && p.get(uid) && p.get(uid) > Date.now());
}
function grantPermission(officeId, uid) {
  if (!permissions.has(officeId)) permissions.set(officeId, new Map());
  permissions.get(officeId).set(uid, Date.now() + 10000);
}

const officeId = 'main-office';
const requesterId = 'u3';

// When 2 occupants are inside, u3 attempts to enter without permission:
const canEnterWithoutPerm = insideCabin.length < 2 || hasPermission(officeId, requesterId);
assert.strictEqual(canEnterWithoutPerm, false, 'Entry without permission should be rejected when 2 occupants are inside');
console.log('✓ Test 3: Unpermitted entry blocked when room is at capacity (2/2)');

// Test 4: Approval simulation
grantPermission(officeId, requesterId);
const canEnterWithPerm = insideCabin.length < 2 || hasPermission(officeId, requesterId);
assert.strictEqual(canEnterWithPerm, true, 'Entry with granted permission should be allowed');
console.log('✓ Test 4: Entry permitted after occupant approves knock');

// Test 5: Room drops below capacity
testOccupants.splice(1, 1); // u2 leaves cabin
const remainingInside = testOccupants.filter((u) => isInsideManagerCabin(u.location[0], u.location[1]));
const canEnterWhenOpen = remainingInside.length < 2;
assert.strictEqual(canEnterWhenOpen, true, 'Anyone can enter freely when fewer than 2 avatars are inside');
console.log('✓ Test 5: Open entry restored when cabin has fewer than 2 occupants');

console.log('--- ALL MANAGER CABIN ACCESS TESTS PASSED (5/5) ---\n');
