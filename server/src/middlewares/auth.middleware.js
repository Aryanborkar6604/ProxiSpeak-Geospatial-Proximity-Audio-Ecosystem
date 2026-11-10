const jwt = require('jsonwebtoken');
const env = require('../config/env');
const authService = require('../services/auth.service');

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      audience: 'proxispeak-client',
      issuer: 'proxispeak',
    });
    if (decoded.authVersion !== 1 || typeof decoded.userId !== 'string') {
      return res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' });
    }
    const user = await authService.getAuthenticatedUser(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'This account is no longer available. Please sign in again.' });
    }
    req.user = user;
    next();
  } catch (error) {
    if (error.statusCode === 503) {
      return res.status(503).json({ error: error.message });
    }
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' });
    }
    return next(error);
  }
}

module.exports = { requireAuth };
