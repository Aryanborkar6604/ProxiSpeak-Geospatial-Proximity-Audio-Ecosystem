const assert = require('assert');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const env = require('../src/config/env');
const User = require('../src/models/User');
const authService = require('../src/services/auth.service');
const { requireAuth } = require('../src/middlewares/auth.middleware');
const { socketAuthMiddleware } = require('../src/sockets/middlewares');
const authRoutes = require('../src/routes/auth.routes');

async function run() {
  const originalReadyState = mongoose.connection.readyState;
  const originalFindOne = User.findOne;
  const originalCreate = User.create;
  const accounts = [];

  mongoose.connection.readyState = 1;
  User.findOne = (query) => {
    const document = accounts.find((account) => (
      query.email
        ? (query.email instanceof RegExp ? query.email.test(account.email) : account.email === query.email)
        : account.userId === query.userId
    )) || null;
    return {
      select() { return this; },
      lean: async () => document,
      then(resolve, reject) { return Promise.resolve(document).then(resolve, reject); },
    };
  };
  User.create = async (data) => {
    if (accounts.some((account) => account.email === data.email)) {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }
    const document = {
      ...data,
      isActive: true,
      avatarColor: '#1FA896',
      save: async () => {},
    };
    accounts.push(document);
    return document;
  };

  try {
    assert.strictEqual(User.schema.path('passwordHash').options.select, false);
    assert.strictEqual(User.schema.path('email').options.unique, true);

    const registered = await authService.registerUser({
      name: '  Alex Morgan ',
      email: 'Alex@Example.com',
      password: 'a secure passphrase',
    });
    assert.strictEqual(registered.user.name, 'Alex Morgan');
    assert.strictEqual(registered.user.email, 'alex@example.com');
    assert.strictEqual(Object.hasOwn(registered.user, 'passwordHash'), false);
    assert.notStrictEqual(accounts[0].passwordHash, 'a secure passphrase');
    const registeredClaims = jwt.verify(registered.token, env.JWT_SECRET);
    assert.strictEqual(registeredClaims.userId, registered.user.userId);
    assert.strictEqual(registeredClaims.authVersion, 1);

    let nextCalled = false;
    const request = { headers: { authorization: `Bearer ${registered.token}` }, query: {} };
    const response = { status() { return this; }, json() { return this; } };
    await requireAuth(request, response, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(request.user.userId, registered.user.userId);

    const legacyToken = jwt.sign({ userId: registered.user.userId }, env.JWT_SECRET, { expiresIn: '1h' });
    let legacyResponseStatus;
    await requireAuth(
      { headers: { authorization: `Bearer ${legacyToken}` }, query: {} },
      {
        status(code) { legacyResponseStatus = code; return this; },
        json() { return this; },
      },
      () => assert.fail('Legacy name-only token must not authenticate'),
    );
    assert.strictEqual(legacyResponseStatus, 401);

    let socketAuthError;
    await socketAuthMiddleware(
      { handshake: { auth: { token: legacyToken } }, data: {} },
      (error) => { socketAuthError = error; },
    );
    assert.match(socketAuthError.message, /Invalid or expired token/);

    await assert.rejects(
      () => authService.registerUser({ name: 'Other User', email: 'alex@example.com', password: 'a secure passphrase' }),
      (error) => error.statusCode === 409,
    );
    await assert.rejects(
      () => authService.loginUser({ email: 'alex@example.com', password: 'incorrect password' }),
      (error) => error.statusCode === 401,
    );

    const loggedIn = await authService.loginUser({
      email: ' ALEX@example.com ',
      password: 'a secure passphrase',
    });
    assert.strictEqual(loggedIn.user.userId, registered.user.userId);
    assert.ok(accounts[0].lastLoginAt instanceof Date);
    assert.deepStrictEqual(await authService.getAuthenticatedUser(registered.user.userId), registered.user);

    accounts.push({
      userId: 'legacy-user',
      name: 'Legacy Guest',
      email: 'Legacy@Example.com',
      avatarColor: '#1FA896',
      isActive: true,
      save: async () => {},
    });
    const upgraded = await authService.registerUser({
      name: 'Legacy User',
      email: 'legacy@example.com',
      password: 'a secure passphrase',
    });
    assert.strictEqual(upgraded.user.userId, 'legacy-user');
    assert.notStrictEqual(accounts[1].passwordHash, undefined);
    assert.strictEqual(accounts[1].email, 'legacy@example.com');
    assert.strictEqual((await authService.loginUser({
      email: 'LEGACY@example.com',
      password: 'a secure passphrase',
    })).user.userId, 'legacy-user');

    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    const server = app.listen(0);
    try {
      await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
      const { port } = server.address();
      const baseUrl = `http://127.0.0.1:${port}/api/auth`;
      const registrationResponse = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Route User',
          email: 'route@example.com',
          password: 'a secure passphrase',
        }),
      });
      assert.strictEqual(registrationResponse.status, 201);
      const registration = await registrationResponse.json();

      const loginResponse = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ROUTE@example.com', password: 'a secure passphrase' }),
      });
      assert.strictEqual(loginResponse.status, 200);
      const login = await loginResponse.json();
      assert.strictEqual(login.user.userId, registration.user.userId);

      const sessionResponse = await fetch(`${baseUrl}/me`, {
        headers: { Authorization: `Bearer ${login.token}` },
      });
      assert.strictEqual(sessionResponse.status, 200);
      assert.strictEqual((await sessionResponse.json()).user.email, 'route@example.com');

      const unauthorizedResponse = await fetch(`${baseUrl}/me`);
      assert.strictEqual(unauthorizedResponse.status, 401);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    accounts[0].isActive = false;
    assert.strictEqual(await authService.getAuthenticatedUser(registered.user.userId), null);

    const originalNodeEnv = env.NODE_ENV;
    env.NODE_ENV = 'production';
    mongoose.connection.readyState = 0;
    await assert.rejects(
      () => authService.registerUser({ name: 'Offline User', email: 'offline@example.com', password: 'a secure passphrase' }),
      (error) => error.statusCode === 503,
    );
    env.NODE_ENV = originalNodeEnv;
    console.log('MongoDB-backed registration, password verification, and account-state tests passed.');
  } finally {
    User.findOne = originalFindOne;
    User.create = originalCreate;
    mongoose.connection.readyState = originalReadyState;
    await mongoose.disconnect().catch(() => {});
  }
}

run().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
