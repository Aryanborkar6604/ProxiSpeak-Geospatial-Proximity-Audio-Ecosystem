const mongoose = require('mongoose');
const Office = require('../models/Office');

// In-memory cache for office layouts
const officeCache = new Map();

const DEFAULT_OBSTACLES = [
  // Library partition wall (leaves hallway below)
  { type: 'wall', x1: 345, y1: 75, x2: 345, y2: 275, attenuation: 0.25 },
  // Studio focus room glass/acoustic partition
  { type: 'wall', x1: 745, y1: 75, x2: 745, y2: 335, attenuation: 0.20 },
  // Lounge partition wall
  { type: 'wall', x1: 690, y1: 375, x2: 950, y2: 375, attenuation: 0.30 },
];

const DEFAULT_ZONES = [
  { name: 'THE LIBRARY', shape: 'rect', x: 73, y: 87, w: 252, h: 172 },
  { name: 'STUDIO', shape: 'rect', x: 389, y: 82, w: 337, h: 242 },
  { name: 'LOUNGE', shape: 'rect', x: 710, y: 392, w: 226, h: 186 },
];

function makeDefaultOffice(officeId) {
  return {
    officeId,
    name: officeId === 'main-office' ? 'The Commons' : `Office ${officeId}`,
    width: 1000,
    height: 700,
    hearingRadiusPx: 105,
    obstacles: DEFAULT_OBSTACLES,
    zones: DEFAULT_ZONES,
  };
}

async function getOffice(officeId) {
  if (officeCache.has(officeId)) {
    return officeCache.get(officeId);
  }

  const defaultOffice = makeDefaultOffice(officeId);
  officeCache.set(officeId, defaultOffice);

  if (mongoose.connection.readyState !== 1) {
    return defaultOffice;
  }

  let office = await Office.findOne({ officeId }).catch(() => null);
  if (!office) {
    office = new Office(defaultOffice);
    await office.save().catch((err) => console.warn('Office seed save warning:', err.message));
  } else if (!office.obstacles || office.obstacles.length === 0) {
    office.obstacles = DEFAULT_OBSTACLES;
    office.zones = DEFAULT_ZONES;
    await office.save().catch(() => {});
  }

  const plainOffice = office.toObject ? office.toObject() : office;
  officeCache.set(officeId, plainOffice);
  return plainOffice;
}

async function updateOffice(officeId, data) {
  const allowed = ['name', 'obstacles', 'zones', 'width', 'height', 'hearingRadiusPx'];
  const updatePayload = {};
  for (const key of allowed) {
    if (data[key] !== undefined) {
      updatePayload[key] = data[key];
    }
  }

  const nextOffice = {
    ...makeDefaultOffice(officeId),
    ...officeCache.get(officeId),
    ...updatePayload,
  };
  officeCache.set(officeId, nextOffice);

  if (mongoose.connection.readyState !== 1) {
    return nextOffice;
  }

  const updated = await Office.findOneAndUpdate(
    { officeId },
    { $set: updatePayload },
    { new: true, upsert: true }
  );

  const plain = updated.toObject ? updated.toObject() : updated;
  officeCache.set(officeId, plain);
  return plain;
}

function getCachedOffice(officeId) {
  return officeCache.get(officeId) || null;
}

module.exports = {
  getOffice,
  updateOffice,
  getCachedOffice,
  DEFAULT_OBSTACLES,
};

