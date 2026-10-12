const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const env = require('../config/env');
const User = require('../models/User');

const PASSWORD_ROUNDS = 12;
const SESSION_TTL = '8h';

function createAuthError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requireDatabase() {
  if (mongoose.connection.readyState !== 1) {
    throw createAuthError(503, 'Account services are unavailable until MongoDB reconnects.');
  }
}

function serializeUser(user) {
  return {
    userId: user.userId,
    name: user.name,
    email: user.email,
    avatarColor: user.avatarColor || '#1FA896',
  };
}

function createSession(user) {
  const token = jwt.sign({ userId: user.userId, authVersion: 1 }, env.JWT_SECRET, { expiresIn: SESSION_TTL });
  return { user: serializeUser(user), token };
}

async function findUserByEmail(email) {
  const exactMatch = await User.findOne({ email }).select('+passwordHash');
  if (exactMatch) return exactMatch;

  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return User.findOne({ email: new RegExp(`^${escapedEmail}$`, 'i') }).select('+passwordHash');
}

function validateCredentials({ name, email, password }, includeName = false) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedName = String(name || '').trim();
  const passwordValue = String(password || '');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw createAuthError(400, 'Enter a valid email address.');
  }
  if (includeName && (normalizedName.length < 2 || normalizedName.length > 80)) {
    throw createAuthError(400, 'Your name must be between 2 and 80 characters.');
  }
  if (Buffer.byteLength(passwordValue, 'utf8') < 8 || Buffer.byteLength(passwordValue, 'utf8') > 72) {
    throw createAuthError(400, 'Password must be between 8 and 72 bytes.');
  }

  return { name: normalizedName, email: normalizedEmail, password: passwordValue };
}

async function registerUser(input) {
  requireDatabase();
  const credentials = validateCredentials(input, true);
  const existing = await findUserByEmail(credentials.email);
  if (existing?.passwordHash) {
    throw createAuthError(409, 'An account with this email already exists. Sign in instead.');
  }

  const passwordHash = await bcrypt.hash(credentials.password, PASSWORD_ROUNDS);
  try {
    if (existing) {
      existing.name = credentials.name;
      existing.email = credentials.email;
      existing.passwordHash = passwordHash;
      existing.isActive = true;
      await existing.save();
      return createSession(existing);
    }

    const user = await User.create({
      userId: `usr_${crypto.randomUUID()}`,
      name: credentials.name,
      email: credentials.email,
      passwordHash,
    });
    return createSession(user);
  } catch (error) {
    if (error.code === 11000) {
      throw createAuthError(409, 'An account with this email already exists. Sign in instead.');
    }
    throw error;
  }
}

async function loginUser(input) {
  requireDatabase();
  const credentials = validateCredentials(input);
  const user = await findUserByEmail(credentials.email);
  if (!user || user.isActive === false || !user.passwordHash) {
    throw createAuthError(401, 'Email or password is incorrect.');
  }

  const passwordMatches = await bcrypt.compare(credentials.password, user.passwordHash);
  if (!passwordMatches) {
    throw createAuthError(401, 'Email or password is incorrect.');
  }

  user.lastLoginAt = new Date();
  await user.save();
  return createSession(user);
}

async function getAuthenticatedUser(userId) {
  requireDatabase();
  if (typeof userId !== 'string' || !userId) return null;

  const user = await User.findOne({ userId })
    .select('userId name email avatarColor isActive');
  if (!user || user.isActive === false) return null;
  return serializeUser(user);
}

module.exports = {
  createAuthError,
  registerUser,
  loginUser,
  getAuthenticatedUser,
};
