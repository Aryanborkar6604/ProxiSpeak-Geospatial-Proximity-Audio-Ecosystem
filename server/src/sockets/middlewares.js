const jwt = require('jsonwebtoken');
const env = require('../config/env');
const authService = require('../services/auth.service');

async function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication error: No token provided'));
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (decoded.authVersion !== 1 || typeof decoded.userId !== 'string') {
      return next(new Error('Authentication error: Invalid or expired token'));
    }
    const user = await authService.getAuthenticatedUser(decoded.userId);
    if (!user) {
      return next(new Error('Authentication error: Account is no longer available'));
    }
    socket.data.userId = user.userId;
    socket.data.userName = user.name;
    socket.data.tokenExpiresAt = decoded.exp * 1000;
    next();
  } catch (error) {
    const message = error.statusCode === 503
      ? 'Authentication error: Account services are unavailable'
      : 'Authentication error: Invalid or expired token';
    next(new Error(message));
  }
}

module.exports = { socketAuthMiddleware };
