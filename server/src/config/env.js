require('dotenv').config();

const env = {
  PORT: Number(process.env.PORT) || 4000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGODB_URI: process.env.MONGODB_URI || '',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-key',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  TURN_URLS: (process.env.TURN_URLS || '').split(',').map((url) => url.trim()).filter(Boolean),
  TURN_SHARED_SECRET: process.env.TURN_SHARED_SECRET || '',
  TURN_CREDENTIAL_TTL_SECONDS: process.env.TURN_CREDENTIAL_TTL_SECONDS === undefined
    ? 3600
    : Number(process.env.TURN_CREDENTIAL_TTL_SECONDS),
  LIVEKIT_URL: process.env.LIVEKIT_URL || '',
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY || '',
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET || '',
  LIVEKIT_TOKEN_TTL_SECONDS: process.env.LIVEKIT_TOKEN_TTL_SECONDS === undefined
    ? 600
    : Number(process.env.LIVEKIT_TOKEN_TTL_SECONDS),
};

if (env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  throw new Error('Set JWT_SECRET to a random value of at least 32 characters in production.');
}

if (!process.env.MONGODB_URI) {
  console.warn('[config/env] No MongoDB URI configured; continuing in local fallback mode.');
}

if (Boolean(env.TURN_URLS.length) !== Boolean(env.TURN_SHARED_SECRET)) {
  throw new Error('Configure both TURN_URLS and TURN_SHARED_SECRET, or leave both unset.');
}
if (!Number.isInteger(env.TURN_CREDENTIAL_TTL_SECONDS) || env.TURN_CREDENTIAL_TTL_SECONDS < 60 || env.TURN_CREDENTIAL_TTL_SECONDS > 86400) {
  throw new Error('TURN_CREDENTIAL_TTL_SECONDS must be between 60 and 86400.');
}
const liveKitSettings = [env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET];
if (liveKitSettings.some(Boolean) && !liveKitSettings.every(Boolean)) {
  throw new Error('Configure LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET together.');
}
if (env.LIVEKIT_URL && !/^wss?:\/\//i.test(env.LIVEKIT_URL)) {
  throw new Error('LIVEKIT_URL must use the ws:// or wss:// scheme.');
}
if (!Number.isInteger(env.LIVEKIT_TOKEN_TTL_SECONDS) || env.LIVEKIT_TOKEN_TTL_SECONDS < 60 || env.LIVEKIT_TOKEN_TTL_SECONDS > 3600) {
  throw new Error('LIVEKIT_TOKEN_TTL_SECONDS must be between 60 and 3600.');
}

module.exports = env;
