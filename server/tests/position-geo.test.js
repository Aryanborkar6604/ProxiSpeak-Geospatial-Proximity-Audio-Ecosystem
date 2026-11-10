const assert = require('assert');
const mongoose = require('mongoose');
const Position = require('../src/models/Position');
const positionService = require('../src/services/position.service');

async function run() {
  const originalReadyState = mongoose.connection.readyState;
  const originalFind = Position.find;
  const queries = [];
  const docs = [{
    userId: 'geo-user',
    officeId: 'main-office',
    location: [120, 140],
    isOnline: true,
  }];

  mongoose.connection.readyState = 1;
  Position.find = (query) => {
    queries.push(query);
    return {
      limit() { return this; },
      lean: async () => docs,
    };
  };

  try {
    const usersInOffice = await positionService.getOnlineUsers('main-office', { width: 1000, height: 700 });
    assert.strictEqual(usersInOffice.length, 1);
    assert.deepStrictEqual(queries[0], {
      officeId: 'main-office',
      isOnline: true,
      location: { $geoWithin: { $box: [[0, 0], [1000, 700]] } },
    });

    const nearbyUsers = await positionService.getNearbyUsers('main-office', 100, 100, 105);
    assert.strictEqual(nearbyUsers.length, 1);
    assert.deepStrictEqual(queries[1], {
      officeId: 'main-office',
      isOnline: true,
      location: { $near: [100, 100], $maxDistance: 105 },
    });
    console.log('MongoDB $geoWithin and $near query tests passed.');
  } finally {
    Position.find = originalFind;
    mongoose.connection.readyState = originalReadyState;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
