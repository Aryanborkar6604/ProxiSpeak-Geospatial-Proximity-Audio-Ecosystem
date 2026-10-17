const express = require('express');
const router = express.Router();
const officeService = require('../services/office.service');
const env = require('../config/env');
const { requireAuth } = require('../middlewares/auth.middleware');
const { createRateLimiter } = require('../middlewares/rate-limit.middleware');

const OFFICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const readRateLimit = createRateLimiter({ windowMs: 60_000, max: 120 });
const editRateLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 20 });

function requireOfficeAdmin(req, res, next) {
  if (!env.OFFICE_ADMIN_USER_IDS.includes(req.user.userId)) {
    return res.status(403).json({ error: 'Office administrator access is required.' });
  }
  return next();
}

function validNumber(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function validateObstacles(obstacles, width, height) {
  if (!Array.isArray(obstacles) || obstacles.length > 300) return false;
  return obstacles.every((obstacle) => (
    obstacle && typeof obstacle === 'object' &&
    validNumber(obstacle.x1, 0, width) && validNumber(obstacle.y1, 0, height) &&
    validNumber(obstacle.x2, 0, width) && validNumber(obstacle.y2, 0, height) &&
    (obstacle.attenuation === undefined || validNumber(obstacle.attenuation, 0, 1))
  ));
}

function validateZones(zones, width, height) {
  if (!Array.isArray(zones) || zones.length > 100) return false;
  return zones.every((zone) => (
    zone && typeof zone === 'object' &&
    typeof zone.name === 'string' && zone.name.trim().length > 0 && zone.name.length <= 80 &&
    (zone.shape === undefined || zone.shape === 'rect') &&
    validNumber(zone.x, 0, width) && validNumber(zone.y, 0, height) &&
    validNumber(zone.w, 1, width) && validNumber(zone.h, 1, height) &&
    zone.x + zone.w <= width && zone.y + zone.h <= height
  ));
}

// GET /api/offices/:officeId - Public / member view of office layout and obstacles
router.get('/:officeId', readRateLimit, async (req, res) => {
  try {
    const { officeId } = req.params;
    if (!OFFICE_ID_PATTERN.test(officeId)) {
      return res.status(400).json({ error: 'Office ID is invalid.' });
    }
    const office = await officeService.getOffice(officeId);
    if (!office) {
      return res.status(404).json({ error: 'Office not found' });
    }
    res.json(office);
  } catch (err) {
    console.error('Error fetching office:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/offices/:officeId - Authenticated admin endpoint to update obstacles, zones, and layout (Rule R-20)
router.put('/:officeId', requireAuth, requireOfficeAdmin, editRateLimit, async (req, res) => {
  try {
    const { officeId } = req.params;
    if (!OFFICE_ID_PATTERN.test(officeId)) {
      return res.status(400).json({ error: 'Office ID is invalid.' });
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'A JSON object is required.' });
    }
    const { name, obstacles, zones, width, height, hearingRadiusPx } = req.body;
    const currentOffice = await officeService.getOffice(officeId);
    if (!currentOffice) return res.status(404).json({ error: 'Office not found.' });

    const nextWidth = width === undefined ? currentOffice.width : width;
    const nextHeight = height === undefined ? currentOffice.height : height;
    if (!Number.isInteger(nextWidth) || nextWidth < 100 || nextWidth > 5000 ||
      !Number.isInteger(nextHeight) || nextHeight < 100 || nextHeight > 5000) {
      return res.status(400).json({ error: 'Office dimensions must be integers between 100 and 5000.' });
    }
    if (hearingRadiusPx !== undefined && (!Number.isInteger(hearingRadiusPx) || hearingRadiusPx < 10 || hearingRadiusPx > 1000)) {
      return res.status(400).json({ error: 'Hearing radius must be an integer between 10 and 1000.' });
    }
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 80)) {
      return res.status(400).json({ error: 'Office name must be between 1 and 80 characters.' });
    }

    if (obstacles !== undefined && !validateObstacles(obstacles, nextWidth, nextHeight)) {
      return res.status(400).json({ error: 'Obstacles must contain at most 300 in-bounds wall segments.' });
    }
    if (zones !== undefined && !validateZones(zones, nextWidth, nextHeight)) {
      return res.status(400).json({ error: 'Zones must contain at most 100 in-bounds rectangles.' });
    }
    if ([name, obstacles, zones, width, height, hearingRadiusPx].every((value) => value === undefined)) {
      return res.status(400).json({ error: 'Provide at least one office field to update.' });
    }

    const updated = await officeService.updateOffice(officeId, {
      ...(name === undefined ? {} : { name: name.trim() }),
      obstacles,
      zones,
      width,
      height,
      hearingRadiusPx,
    });

    // Notify connected clients via Socket.io if io is attached to app
    const io = req.app.get('io');
    if (io) {
      io.to(officeId).emit('office:updated', {
        officeId,
        obstacles: updated.obstacles,
        zones: updated.zones,
      });
    }

    res.json({
      message: 'Office layout updated successfully',
      office: updated,
    });
  } catch (err) {
    console.error('Error updating office layout:', err);
    res.status(500).json({ error: 'Failed to update office layout' });
  }
});

module.exports = router;

