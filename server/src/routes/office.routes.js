const express = require('express');
const router = express.Router();
const officeService = require('../services/office.service');
const { requireAuth } = require('../middlewares/auth.middleware');

// GET /api/offices/:officeId - Public / member view of office layout and obstacles
router.get('/:officeId', async (req, res) => {
  try {
    const { officeId } = req.params;
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
router.put('/:officeId', requireAuth, async (req, res) => {
  try {
    const { officeId } = req.params;
    const { name, obstacles, zones, width, height, hearingRadiusPx } = req.body;

    // Validate obstacles structure if provided
    if (obstacles && !Array.isArray(obstacles)) {
      return res.status(400).json({ error: 'Obstacles must be an array of line segments' });
    }

    if (zones && !Array.isArray(zones)) {
      return res.status(400).json({ error: 'Zones must be an array' });
    }

    const updated = await officeService.updateOffice(officeId, {
      name,
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

