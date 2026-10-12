const express = require('express');
const env = require('../config/env');
const { requireAuth } = require('../middlewares/auth.middleware');
const { createRtcConfiguration, createLiveKitToken } = require('../services/rtc.service');

const router = express.Router();

router.get('/config', requireAuth, (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(createRtcConfiguration({
      turnUrls: env.TURN_URLS,
      sharedSecret: env.TURN_SHARED_SECRET,
      ttlSeconds: env.TURN_CREDENTIAL_TTL_SECONDS,
      userId: req.user.userId,
      livekitEnabled: Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET),
    }));
  } catch (error) {
    next(error);
  }
});

router.get('/livekit-token', requireAuth, async (req, res, next) => {
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    return res.status(503).json({ error: 'LiveKit SFU is not configured.' });
  }

  try {
    const room = String(req.query.officeId || '');
    const livekitToken = await createLiveKitToken({
      apiKey: env.LIVEKIT_API_KEY,
      apiSecret: env.LIVEKIT_API_SECRET,
      userId: req.user.userId,
      userName: req.user.name,
      officeId: room,
      ttlSeconds: env.LIVEKIT_TOKEN_TTL_SECONDS,
    });
    res.set('Cache-Control', 'no-store');
    res.json({ url: env.LIVEKIT_URL, token: livekitToken, room });
  } catch (error) {
    if (error.message === 'Office ID has an invalid format.') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

module.exports = router;
