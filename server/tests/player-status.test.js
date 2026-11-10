const assert = require('assert');

console.log('--- RUNNING AVATAR STATUS & PRESENCE UNIT TESTS ---');

// In-memory status store simulation
const officeUserStatuses = new Map();

function setUserStatus(officeId, uid, emoji, text) {
  if (!officeUserStatuses.has(officeId)) {
    officeUserStatuses.set(officeId, new Map());
  }
  const cleanEmoji = typeof emoji === 'string' ? emoji.trim().slice(0, 8) : '🟢';
  const cleanText = typeof text === 'string' ? text.trim().slice(0, 60) : 'Available';
  officeUserStatuses.get(officeId).set(uid, { emoji: cleanEmoji, text: cleanText, updatedAt: Date.now() });
}

function getUserStatus(officeId, uid) {
  return officeUserStatuses.get(officeId)?.get(uid) || { emoji: '🟢', text: 'Available' };
}

function removeUserStatus(officeId, uid) {
  officeUserStatuses.get(officeId)?.delete(uid);
}

// Test 1: Default status fallback
const def = getUserStatus('office_a', 'user_nonexistent');
assert.strictEqual(def.emoji, '🟢', 'Default status emoji should be 🟢');
assert.strictEqual(def.text, 'Available', 'Default status text should be Available');
console.log('✓ Test 1: Default status fallback verified (🟢 Available)');

// Test 2: Setting standard preset statuses
setUserStatus('office_a', 'user_1', '🎧', 'Deep Focus');
setUserStatus('office_a', 'user_2', '☕', 'Coffee Break');
setUserStatus('office_a', 'user_3', '💡', 'Brainstorming');

assert.strictEqual(getUserStatus('office_a', 'user_1').emoji, '🎧');
assert.strictEqual(getUserStatus('office_a', 'user_1').text, 'Deep Focus');
assert.strictEqual(getUserStatus('office_a', 'user_2').emoji, '☕');
assert.strictEqual(getUserStatus('office_a', 'user_3').text, 'Brainstorming');
console.log('✓ Test 2: Status presets recorded accurately');

// Test 3: Truncation and sanitization of excessively long status
const longText = 'A'.repeat(200);
const longEmoji = '🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉';
setUserStatus('office_a', 'user_long', longEmoji, longText);
const sanitized = getUserStatus('office_a', 'user_long');
assert.ok(sanitized.text.length <= 60, 'Status text must be capped at 60 characters');
assert.ok(sanitized.emoji.length <= 8, 'Status emoji must be capped at 8 bytes/characters');
console.log('✓ Test 3: Length sanitization and truncation verified');

// Test 4: Office isolation
const user1InOfficeB = getUserStatus('office_b', 'user_1');
assert.strictEqual(user1InOfficeB.text, 'Available', 'Status from office_a should not leak into office_b');
console.log('✓ Test 4: Office workspace isolation verified');

// Test 5: Cleanup on disconnect
removeUserStatus('office_a', 'user_1');
const cleaned = getUserStatus('office_a', 'user_1');
assert.strictEqual(cleaned.text, 'Available', 'Removed user should revert to default status');
console.log('✓ Test 5: Disconnect status cleanup verified');

console.log('--- ALL AVATAR STATUS TESTS PASSED (5/5) ---\n');
