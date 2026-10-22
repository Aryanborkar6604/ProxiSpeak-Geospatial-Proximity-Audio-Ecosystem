const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const env = require('../config/env');
const User = require('../models/User');

const PASSWORD_ROUNDS = env.NODE_ENV === 'test' ? 4 : 10;
const authUserCache = new Map();
const AUTH_CACHE_TTL_MS = 60 * 1000;
const SESSION_TTL = '1h';
const JWT_ISSUER = 'proxispeak';
const JWT_AUDIENCE = 'proxispeak-client';
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), PASSWORD_ROUNDS);

// In-memory fallback caches when database is disconnected or in local mode
const memoryUsersByEmail = new Map();
const memoryUsersById = new Map();


function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

function ensureDbConnection() {
  if (!isDbConnected()) {
    try {
      const connectDB = require('../config/db');
      connectDB().catch(() => {});
    } catch (_) {}
  }
}

function createAuthError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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
  const token = jwt.sign(
    { userId: user.userId, authVersion: 1 },
    env.JWT_SECRET,
    {
      algorithm: 'HS256',
      audience: JWT_AUDIENCE,
      expiresIn: SESSION_TTL,
      issuer: JWT_ISSUER,
    },
  );
  return { user: serializeUser(user), token };
}

async function findUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  
  if (isDbConnected()) {
    try {
      const exactMatch = await User.findOne({ email: normalized }).select('+passwordHash');
      if (exactMatch) return exactMatch;

      const escapedEmail = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const caseMatch = await User.findOne({ email: new RegExp(`^${escapedEmail}$`, 'i') }).select('+passwordHash');
      if (caseMatch) return caseMatch;
    } catch (err) {
      if (env.NODE_ENV === 'production') {
        throw createAuthError(503, 'Account services are temporarily unavailable.');
      }
      console.warn('[auth] Error querying MongoDB user, falling back to memory:', err.message);
    }
  } else if (env.NODE_ENV === 'production') {
    throw createAuthError(503, 'Account services are temporarily unavailable.');
  }

  if (env.NODE_ENV === 'production') return null;

  // Memory fallback
  return memoryUsersByEmail.get(normalized) || null;
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
  ensureDbConnection();
  if (!isDbConnected() && env.NODE_ENV === 'production') {
    throw createAuthError(503, 'Account services are temporarily unavailable.');
  }
  const credentials = validateCredentials(input, true);
  const existing = await findUserByEmail(credentials.email);
  if (existing?.passwordHash) {
    throw createAuthError(409, 'An account with this email already exists. Sign in instead.');
  }

  const passwordHash = await bcrypt.hash(credentials.password, PASSWORD_ROUNDS);

  if (existing) {
    existing.name = credentials.name;
    existing.email = credentials.email;
    existing.passwordHash = passwordHash;
    if (typeof existing.save === 'function') {
      await existing.save();
    }
    const session = createSession(existing);
    memoryUsersByEmail.set(credentials.email, existing);
    memoryUsersById.set(existing.userId, existing);
    return session;
  }

  if (isDbConnected()) {
    try {
      const user = await User.create({
        userId: `usr_${crypto.randomUUID()}`,
        name: credentials.name,
        email: credentials.email,
        passwordHash,
      });
      const session = createSession(user);
      memoryUsersByEmail.set(credentials.email, user);
      memoryUsersById.set(user.userId, user);
      return session;
    } catch (error) {
      if (error.code === 11000) {
        throw createAuthError(409, 'An account with this email already exists. Sign in instead.');
      }
      if (env.NODE_ENV === 'production') {
        throw createAuthError(503, 'Account services are temporarily unavailable.');
      }
      console.warn('[auth] MongoDB register write error, saving to memory fallback:', error.message);
    }
  }

  // Fallback in-memory registration
  const memoryUser = {
    userId: `usr_${crypto.randomUUID()}`,
    name: credentials.name,
    email: credentials.email,
    passwordHash,
    avatarColor: '#1FA896',
    isActive: true,
  };
  memoryUsersByEmail.set(credentials.email, memoryUser);
  memoryUsersById.set(memoryUser.userId, memoryUser);
  return createSession(memoryUser);
}

async function loginUser(input) {
  ensureDbConnection();
  if (!isDbConnected() && env.NODE_ENV === 'production') {
    throw createAuthError(503, 'Account services are temporarily unavailable.');
  }
  const credentials = validateCredentials(input);
  const user = await findUserByEmail(credentials.email);
  if (!user || user.isActive === false || !user.passwordHash) {
    await bcrypt.compare(credentials.password, DUMMY_PASSWORD_HASH);
    throw createAuthError(401, 'Email or password is incorrect.');
  }

  const passwordMatches = await bcrypt.compare(credentials.password, user.passwordHash);
  if (!passwordMatches) {
    throw createAuthError(401, 'Email or password is incorrect.');
  }

  if (user.save) {
    user.lastLoginAt = new Date();
    user.save().catch(() => {});
  }
  const session = createSession(user);
  memoryUsersByEmail.set(credentials.email, user);
  memoryUsersById.set(user.userId, user);
    return session;
}

async function getAuthenticatedUser(userId) {
  if (typeof userId !== 'string' || !userId) return null;

  if (isDbConnected()) {
    try {
      const user = await User.findOne({ userId })
        .select('userId name email avatarColor isActive')
        .lean();
      if (user && user.isActive !== false) {
        return serializeUser(user);
      }
      if (user && user.isActive === false) {
        return null;
      }
    } catch (err) {
      if (env.NODE_ENV === 'production') {
        throw createAuthError(503, 'Account services are temporarily unavailable.');
      }
      console.warn('[auth] Error in getAuthenticatedUser, falling back to memory:', err.message);
    }
  } else if (env.NODE_ENV === 'production') {
    throw createAuthError(503, 'Account services are temporarily unavailable.');
  }

  if (env.NODE_ENV === 'production') return null;

  const memoryUser = memoryUsersById.get(userId);
  if (memoryUser && memoryUser.isActive !== false) {
    return serializeUser(memoryUser);
  }

  return null;
}

module.exports = {
  createAuthError,
  registerUser,
  loginUser,
  getAuthenticatedUser,
};


