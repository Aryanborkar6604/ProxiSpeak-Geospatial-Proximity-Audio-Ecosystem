const jwt = require('jsonwebtoken');
const env = require('../config/env');

function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth.token;
  console.log("Socket connection attempt. Token:", token);
  if (!token) {
    console.log("No token provided");
    return next(new Error("Authentication error: No token provided"));
  }
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    console.log("Token decoded:", decoded);
    socket.data.userId = decoded.userId;
    next();
  } catch (err) {
    console.log("Token verification failed:", err.message);
    next(new Error("Authentication error: Invalid token"));
  }
}

module.exports = { socketAuthMiddleware };

