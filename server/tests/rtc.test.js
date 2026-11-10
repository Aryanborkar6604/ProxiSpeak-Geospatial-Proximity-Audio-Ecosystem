const assert = require('assert');
const crypto = require('crypto');
const { AccessToken, TokenVerifier } = require('livekit-server-sdk');
const { createRtcConfiguration, createLiveKitToken } = require('../src/services/rtc.service');

const now = 1_800_000_000_000;
const ttlSeconds = 900;
const secret = 'rtc-test-shared-secret';
const config = createRtcConfiguration({
  turnUrls: ['turn:turn.example.test:3478?transport=udp', ' turns:turn.example.test:5349?transport=tcp '],
  sharedSecret: secret,
  userId: 'user-123',
  ttlSeconds,
  now,
});

const turnServer = config.iceServers.at(-1);
const expectedUsername = `${Math.floor(now / 1000) + ttlSeconds}:user-123`;
assert.deepStrictEqual(turnServer.urls, [
  'turn:turn.example.test:3478?transport=udp',
  'turns:turn.example.test:5349?transport=tcp',
]);
assert.strictEqual(turnServer.username, expectedUsername);
assert.strictEqual(
  turnServer.credential,
  crypto.createHmac('sha1', secret).update(expectedUsername).digest('base64'),
);
assert.strictEqual(config.iceServers.length, 5, 'Default STUN servers should remain available');

const stunOnlyConfig = createRtcConfiguration({});
assert.strictEqual(stunOnlyConfig.iceServers.length, 4, 'STUN-only mode should work without TURN settings');
assert.throws(
  () => createRtcConfiguration({ turnUrls: ['turn:turn.example.test'], userId: 'user-123' }),
  /TURN_URLS and TURN_SHARED_SECRET/,
);
assert.throws(
  () => createRtcConfiguration({ turnUrls: ['turn:turn.example.test'], sharedSecret: secret, userId: 'user-123', ttlSeconds: 30 }),
  /between 60 and 86400/,
);
assert.throws(
  () => createRtcConfiguration({ turnUrls: ['https://turn.example.test'], sharedSecret: secret, userId: 'user-123' }),
  /turn: or turns:/,
);

(async () => {
  let accessToken;
  class FakeAccessToken {
    constructor(apiKey, apiSecret, options) {
      this.apiKey = apiKey;
      this.apiSecret = apiSecret;
      this.options = options;
      this.grants = [];
      accessToken = this;
    }
    addGrant(grant) { this.grants.push(grant); }
    async toJwt() { return 'signed-livekit-test-token'; }
  }

  const livekitToken = await createLiveKitToken({
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
    userId: 'user-123',
    userName: 'Alex Example',
    officeId: 'main-office',
    ttlSeconds: 300,
    AccessTokenClass: FakeAccessToken,
  });
  assert.strictEqual(livekitToken, 'signed-livekit-test-token');
  assert.strictEqual(accessToken.options.identity, 'user-123');
  assert.strictEqual(accessToken.options.name, 'Alex Example');
  assert.strictEqual(accessToken.options.ttl, 300);
  assert.deepStrictEqual(accessToken.grants, [{
    roomJoin: true,
    room: 'main-office',
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  }]);
  const apiSecret = 'test-livekit-secret';
  const signedToken = await createLiveKitToken({
    apiKey: 'test-livekit-key',
    apiSecret,
    userId: 'verified-user',
    userName: 'Verified User',
    officeId: 'research-office',
    ttlSeconds: 300,
    AccessTokenClass: AccessToken,
  });
  const verifiedClaims = await new TokenVerifier('test-livekit-key', apiSecret).verify(signedToken);
  assert.strictEqual(verifiedClaims.sub, 'verified-user');
  assert.strictEqual(verifiedClaims.name, 'Verified User');
  assert.strictEqual(verifiedClaims.video.room, 'research-office');
  await assert.rejects(
    () => createLiveKitToken({
      apiKey: 'test-api-key',
      apiSecret: 'test-api-secret',
      userId: 'user-123',
      officeId: 'bad office',
      AccessTokenClass: FakeAccessToken,
    }),
    /invalid format/,
  );
  console.log('RTC configuration and LiveKit token tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
