const crypto = require('crypto');
const { AccessToken } = require('livekit-server-sdk');

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

function createRtcConfiguration({
  turnUrls = [],
  sharedSecret = '',
  userId,
  ttlSeconds = 3600,
  now = Date.now(),
  livekitEnabled = false,
}) {
  const iceServers = [...DEFAULT_ICE_SERVERS];
  const urls = turnUrls.map((url) => url.trim()).filter(Boolean);

  if (urls.length === 0 && !sharedSecret) {
    return { iceServers, mode: livekitEnabled ? 'livekit' : 'peer' };
  }

  if (urls.length === 0 || !sharedSecret) {
    throw new Error('TURN_URLS and TURN_SHARED_SECRET must both be configured.');
  }
  if (!userId) {
    throw new Error('A user ID is required to create TURN credentials.');
  }
  if (urls.some((url) => !/^turns?:/i.test(url))) {
    throw new Error('Every TURN_URLS entry must use the turn: or turns: scheme.');
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86400) {
    throw new Error('TURN_CREDENTIAL_TTL_SECONDS must be between 60 and 86400.');
  }

  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const username = `${expiresAt}:${userId}`;
  const credential = crypto.createHmac('sha1', sharedSecret).update(username).digest('base64');

  iceServers.push({ urls, username, credential });
  return { iceServers, mode: livekitEnabled ? 'livekit' : 'peer' };
}

async function createLiveKitToken({
  apiKey,
  apiSecret,
  userId,
  userName,
  officeId,
  ttlSeconds = 600,
  AccessTokenClass = AccessToken,
}) {
  if (!apiKey || !apiSecret) throw new Error('LiveKit API credentials are not configured.');
  if (!userId || !officeId) throw new Error('User and office IDs are required for a LiveKit token.');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(officeId)) throw new Error('Office ID has an invalid format.');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) {
    throw new Error('LIVEKIT_TOKEN_TTL_SECONDS must be between 60 and 3600.');
  }

  const token = new AccessTokenClass(apiKey, apiSecret, {
    identity: String(userId),
    name: String(userName || `Guest ${String(userId).slice(-4)}`).slice(0, 100),
    ttl: ttlSeconds,
  });
  token.addGrant({
    roomJoin: true,
    room: officeId,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });
  return token.toJwt();
}

module.exports = { createRtcConfiguration, createLiveKitToken };
