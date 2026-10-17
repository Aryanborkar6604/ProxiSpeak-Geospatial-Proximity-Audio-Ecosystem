const express = require('express');
const authService = require('../services/auth.service');
const { requireAuth } = require('../middlewares/auth.middleware');
const { createRateLimiter } = require('../middlewares/rate-limit.middleware');

const router = express.Router();
const loginRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: 'Too many sign-in attempts. Try again in 15 minutes.',
});
const registrationRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 8,
  message: 'Too many accounts were created from this network. Try again later.',
});

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function handleAuthError(error, res, action) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error(`${action} error:`, error);
  return res.status(500).json({ error: 'We could not complete that request. Please try again.' });
}

router.post('/register', registrationRateLimit, async (req, res) => {
  try {
    const result = await authService.registerUser(req.body || {});
    res.status(201).set('Cache-Control', 'no-store').json(result);
  } catch (error) {
    handleAuthError(error, res, 'Registration');
  }
});

router.post('/login', loginRateLimit, async (req, res) => {
  try {
    const result = await authService.loginUser(req.body || {});
    res.set('Cache-Control', 'no-store').json(result);
  } catch (error) {
    handleAuthError(error, res, 'Login');
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store').json({ user: req.user });
});

module.exports = router;
