const express = require('express');
const authService = require('../services/auth.service');
const { requireAuth } = require('../middlewares/auth.middleware');

const router = express.Router();

function handleAuthError(error, res, action) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error(`${action} error:`, error);
  return res.status(500).json({ error: 'We could not complete that request. Please try again.' });
}

router.post('/register', async (req, res) => {
  try {
    const result = await authService.registerUser(req.body || {});
    res.status(201).set('Cache-Control', 'no-store').json(result);
  } catch (error) {
    handleAuthError(error, res, 'Registration');
  }
});

router.post('/login', async (req, res) => {
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
