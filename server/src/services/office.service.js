const mongoose = require('mongoose');
const Office = require('../models/Office');

// In-memory cache for office layouts
const officeCache = new Map();
const MAX_CACHED_OFFICES = 1000;

const FLOOR_1_OBSTACLES = [
  // Reception Right Partition (leaves hallway doorway at y: 195-255)
  { type: 'wall', x1: 295, y1: 35, x2: 295, y2: 195, attenuation: 0.25 },
  // Reception Bottom Partition (doorway at x: 215-295)
  { type: 'wall', x1: 35, y1: 255, x2: 215, y2: 255, attenuation: 0.25 },

  // Meeting Room Bottom Partition (center conference doorway at x: 460-540)
  { type: 'wall', x1: 325, y1: 255, x2: 460, y2: 255, attenuation: 0.20 },
  { type: 'wall', x1: 540, y1: 255, x2: 675, y2: 255, attenuation: 0.20 },
  // Meeting Room Side Partitions
  { type: 'wall', x1: 325, y1: 35, x2: 325, y2: 200, attenuation: 0.20 },
  { type: 'wall', x1: 675, y1: 35, x2: 675, y2: 200, attenuation: 0.20 },

  // Elevator & Focus Booths Left Partition (leaves doorway at y: 195-255)
  { type: 'wall', x1: 705, y1: 35, x2: 705, y2: 195, attenuation: 0.15 },
  // Elevator & Focus Booths Bottom Partition (doorway at x: 705-785)
  { type: 'wall', x1: 785, y1: 255, x2: 965, y2: 255, attenuation: 0.15 },

  // Wellness Focus Lounge Top Partition (doorway at x: 215-295)
  { type: 'wall', x1: 35, y1: 445, x2: 215, y2: 445, attenuation: 0.20 },
  // Wellness Focus Lounge Right Partition (doorway at y: 445-495)
  { type: 'wall', x1: 295, y1: 495, x2: 295, y2: 665, attenuation: 0.20 },

  // Lunch Room Top Partition (doorway at x: 705-785)
  { type: 'wall', x1: 785, y1: 445, x2: 965, y2: 445, attenuation: 0.25 },
  // Lunch Room Left Partition (doorway at y: 445-495)
  { type: 'wall', x1: 705, y1: 495, x2: 705, y2: 665, attenuation: 0.25 },
];

const FLOOR_1_ZONES = [
  { name: 'RECEPTION', shape: 'rect', x: 35, y: 35, w: 260, h: 220 },
  { name: 'MEETING ROOM', shape: 'rect', x: 325, y: 35, w: 350, h: 220 },
  { name: 'ELEVATOR & FOCUS', shape: 'rect', x: 705, y: 35, w: 260, h: 220 },
  { name: 'WORKSTATIONS', shape: 'rect', x: 325, y: 285, w: 350, h: 380 },
  { name: 'WELLNESS LOUNGE', shape: 'rect', x: 35, y: 445, w: 260, h: 220 },
  { name: 'LUNCH ROOM', shape: 'rect', x: 705, y: 445, w: 260, h: 220 },
];

const FLOOR_2_OBSTACLES = [
  // HR Cabin Right Partition (leaves doorway at y: 195-255)
  { type: 'wall', x1: 295, y1: 35, x2: 295, y2: 195, attenuation: 0.20 },
  // HR Cabin Bottom Partition (doorway at x: 215-295)
  { type: 'wall', x1: 35, y1: 255, x2: 215, y2: 255, attenuation: 0.20 },

  // Strategy Boardroom Bottom Partition (center doorway at x: 460-540)
  { type: 'wall', x1: 325, y1: 255, x2: 460, y2: 255, attenuation: 0.15 },
  { type: 'wall', x1: 540, y1: 255, x2: 675, y2: 255, attenuation: 0.15 },
  // Strategy Boardroom Side Partitions
  { type: 'wall', x1: 325, y1: 35, x2: 325, y2: 200, attenuation: 0.15 },
  { type: 'wall', x1: 675, y1: 35, x2: 675, y2: 200, attenuation: 0.15 },

  // Manager Cabin Left Partition (leaves doorway at y: 195-255)
  { type: 'wall', x1: 705, y1: 35, x2: 705, y2: 195, attenuation: 0.15 },
  // Manager Cabin Bottom Partition (doorway at x: 705-785)
  { type: 'wall', x1: 785, y1: 255, x2: 965, y2: 255, attenuation: 0.15 },

  // Executive Lounge Top Partition (doorway at x: 215-295)
  { type: 'wall', x1: 35, y1: 445, x2: 215, y2: 445, attenuation: 0.25 },
  // Executive Lounge Right Partition (doorway at y: 445-495)
  { type: 'wall', x1: 295, y1: 495, x2: 295, y2: 665, attenuation: 0.25 },

  // Elevator & Archives Top Partition (doorway at x: 705-785)
  { type: 'wall', x1: 785, y1: 445, x2: 965, y2: 445, attenuation: 0.20 },
  // Elevator & Archives Left Partition (doorway at y: 445-495)
  { type: 'wall', x1: 705, y1: 495, x2: 705, y2: 665, attenuation: 0.20 },
];

const FLOOR_2_ZONES = [
  { name: 'HR CABIN', shape: 'rect', x: 35, y: 35, w: 260, h: 220 },
  { name: 'STRATEGY BOARDROOM', shape: 'rect', x: 325, y: 35, w: 350, h: 220 },
  { name: 'MANAGER CABIN', shape: 'rect', x: 705, y: 35, w: 260, h: 220 },
  { name: 'LEADERSHIP WORKSTATIONS', shape: 'rect', x: 325, y: 285, w: 350, h: 380 },
  { name: 'EXECUTIVE LOUNGE', shape: 'rect', x: 35, y: 445, w: 260, h: 220 },
  { name: 'ELEVATOR & ARCHIVES', shape: 'rect', x: 705, y: 445, w: 260, h: 220 },
];

const DEFAULT_OBSTACLES = FLOOR_1_OBSTACLES;
const DEFAULT_ZONES = FLOOR_1_ZONES;
const OFFICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function makeDefaultOffice(officeId) {
  const isFloor2 = officeId.endsWith('-floor-2');
  let name = 'The Commons (Floor 01)';
  if (officeId === 'main-office-floor-2' || isFloor2) {
    name = 'Executive Suite (Floor 02)';
  } else if (officeId !== 'main-office') {
    name = `Office ${officeId}`;
  }

  return {
    officeId,
    name,
    floor: isFloor2 ? 2 : 1,
    width: 1000,
    height: 700,
    hearingRadiusPx: 100,
    obstacles: isFloor2 ? FLOOR_2_OBSTACLES : FLOOR_1_OBSTACLES,
    zones: isFloor2 ? FLOOR_2_ZONES : FLOOR_1_ZONES,
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
    if (officeId === 'main-office' || officeId === 'main-office-floor-2') {
      office = new Office(defaultOffice);
      await office.save().catch((err) => console.warn('Office seed save warning:', err.message));
    } else {
      // Custom offices are virtual until an administrator explicitly persists their layout.
      cacheOffice(officeId, defaultOffice);
      return defaultOffice;
    }
  } else if (officeId === 'main-office' || officeId === 'main-office-floor-2' || !office.obstacles || office.obstacles.length === 0) {
    office.obstacles = defaultOffice.obstacles;
    office.zones = defaultOffice.zones;
    office.name = defaultOffice.name;
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
  FLOOR_1_OBSTACLES,
  FLOOR_2_OBSTACLES,
  FLOOR_1_ZONES,
  FLOOR_2_ZONES,
};

