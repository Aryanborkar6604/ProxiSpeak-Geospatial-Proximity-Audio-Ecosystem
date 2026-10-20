const mongoose = require('mongoose');
const Office = require('../models/Office');

// In-memory cache for office layouts
const officeCache = new Map();
const MAX_CACHED_OFFICES = 1000;

const DEFAULT_OBSTACLES = [
  // Meeting Room 1 glass suite partitions (leaves doorway for hallway access)
  { type: 'wall', x1: 360, y1: 20, x2: 360, y2: 280, attenuation: 0.25 },
  { type: 'wall', x1: 360, y1: 280, x2: 620, y2: 280, attenuation: 0.25 },
  { type: 'wall', x1: 720, y1: 20, x2: 720, y2: 280, attenuation: 0.25 },
  // Meeting Room 2 glass conference suite
  { type: 'wall', x1: 740, y1: 90, x2: 740, y2: 300, attenuation: 0.20 },
  { type: 'wall', x1: 740, y1: 300, x2: 980, y2: 300, attenuation: 0.20 },
  // Project Hub collaboration zone
  { type: 'wall', x1: 620, y1: 320, x2: 820, y2: 320, attenuation: 0.25 },
  { type: 'wall', x1: 620, y1: 320, x2: 620, y2: 570, attenuation: 0.25 },
  // Focus Zone acoustic private pods
  { type: 'wall', x1: 840, y1: 320, x2: 840, y2: 610, attenuation: 0.20 },
  // Game Zone acoustic barrier
  { type: 'wall', x1: 20, y1: 575, x2: 330, y2: 575, attenuation: 0.30 },
];

const DEFAULT_ZONES = [
  { name: 'Reception', shape: 'rect', x: 20, y: 20, w: 320, h: 260 },
  { name: 'Meeting Room 1', shape: 'rect', x: 360, y: 20, w: 360, h: 260 },
  { name: 'Meeting Room 2', shape: 'rect', x: 740, y: 20, w: 240, h: 280 },
  { name: 'Lounge', shape: 'rect', x: 20, y: 300, w: 290, h: 260 },
  { name: 'Open Workstations', shape: 'rect', x: 330, y: 300, w: 270, h: 270 },
  { name: 'Project Hub', shape: 'rect', x: 620, y: 320, w: 200, h: 260 },
  { name: 'Focus Zone', shape: 'rect', x: 840, y: 320, w: 140, h: 300 },
  { name: 'Game Zone', shape: 'rect', x: 20, y: 580, w: 310, h: 100 },
  { name: 'Cafeteria', shape: 'rect', x: 350, y: 590, w: 320, h: 90 },
  { name: 'Town Hall', shape: 'rect', x: 690, y: 600, w: 290, h: 80 },
];
const OFFICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function makeDefaultOffice(officeId) {
  return {
    officeId,
    name: officeId === 'main-office' ? 'The Commons' : `Office ${officeId}`,
    width: 1000,
    height: 700,
    hearingRadiusPx: 100,
    obstacles: DEFAULT_OBSTACLES,
    zones: DEFAULT_ZONES,
  };

}

function cacheOffice(officeId, office) {
  officeCache.delete(officeId);
  officeCache.set(officeId, office);
  if (officeCache.size > MAX_CACHED_OFFICES) {
    const oldestOfficeId = officeCache.keys().next().value;
    officeCache.delete(oldestOfficeId);
  }
}

async function getOffice(officeId) {
  if (typeof officeId !== 'string' || !OFFICE_ID_PATTERN.test(officeId)) return null;
  if (officeCache.has(officeId)) {
    return officeCache.get(officeId);
  }

  const defaultOffice = makeDefaultOffice(officeId);

  if (mongoose.connection.readyState !== 1) {
    cacheOffice(officeId, defaultOffice);
    return defaultOffice;
  }

  let office = await Office.findOne({ officeId }).catch((error) => {
    throw error;
  });
  if (!office) {
    if (officeId === 'main-office') {
      office = new Office(defaultOffice);
      await office.save().catch((err) => console.warn('Office seed save warning:', err.message));
    } else {
      // Custom offices are virtual until an administrator explicitly persists their layout.
      cacheOffice(officeId, defaultOffice);
      return defaultOffice;
    }
  } else if (!office.obstacles || office.obstacles.length === 0) {
    office.obstacles = DEFAULT_OBSTACLES;
    office.zones = DEFAULT_ZONES;
    await office.save().catch(() => {});
  }

  const plainOffice = office.toObject ? office.toObject() : office;
  cacheOffice(officeId, plainOffice);
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
  cacheOffice(officeId, nextOffice);

  if (mongoose.connection.readyState !== 1) {
    return nextOffice;
  }

  const updated = await Office.findOneAndUpdate(
    { officeId },
    { $set: updatePayload },
    { new: true, upsert: true }
  );

  const plain = updated.toObject ? updated.toObject() : updated;
  cacheOffice(officeId, plain);
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

