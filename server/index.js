import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { MongoClient } from 'mongodb';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const scrypt = promisify(scryptCallback);

const app = express();
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
app.disable('x-powered-by');
app.use((_, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)' });
  next();
});
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '450kb' }));
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: CLIENT_ORIGIN, credentials: true }, maxHttpBufferSize: 256 * 1024 });
const PORT = process.env.PORT || 3001;
const OFFICE_ID = process.env.OFFICE_ID || 'infotact-hq';
const EARSHOT = 70;
const PRESENCE_INTERVAL_MS = 80;
const USER_PERSIST_INTERVAL_MS = 300;
// Project office pixels to a small, valid GeoJSON patch where 1 pixel ≈ 1 meter.
const METERS_PER_DEGREE = 111_320;
const users = new Map();
const sessions = new Map();
const authAttempts = new Map();
const accountSockets = new Map();
let people, accounts;
const localAccounts = new Map();
const localAccountFile = path.join(process.cwd(), '.data', 'accounts.json');
let accountWriteQueue = Promise.resolve();
let presenceTimer;
const userPersistTimers = new Map();

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const i = part.indexOf('=');
    const value = part.slice(i + 1);
    try { return [part.slice(0, i), decodeURIComponent(value)]; }
    catch { return [part.slice(0, i), value]; }
  }));
}
function getSession(token) {
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) { sessions.delete(token); return null; }
  return session;
}
function limitAuthAttempts(req, res, next) {
  const action = req.path.endsWith('/register') ? 'register' : 'login';
  const windowMs = action === 'register' ? 60 * 60 * 1000 : 15 * 60 * 1000;
  const max = action === 'register' ? 5 : 10;
  const key = `${action}:${req.ip}`;
  const now = Date.now();
  let attempt = authAttempts.get(key);
  if (!attempt || attempt.resetAt <= now) attempt = { count: 0, resetAt: now + windowMs };
  attempt.count++;
  authAttempts.set(key, attempt);
  if (attempt.count > max) {
    res.set('Retry-After', String(Math.ceil((attempt.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'Too many attempts. Please wait and try again.' });
  }
  if (authAttempts.size > 10_000) for (const [k, v] of authAttempts) if (v.resetAt <= now) authAttempts.delete(k);
  next();
}
app.use('/api/auth', (req, res, next) => {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && req.get('Origin') && req.get('Origin') !== CLIENT_ORIGIN) {
    return res.status(403).json({ error: 'Request origin is not allowed.' });
  }
  next();
});
function publicAccount(account) { const id = String(account._id ?? account.id); return { id, email: account.email, name: account.displayName ?? account.name, avatarUrl: account.avatarDataUrl ? `/api/avatars/${id}?v=${account.avatarUpdatedAt ?? 0}` : null }; }
function privateProfile(account) { return { phoneNumber: account.phoneNumber ?? '', dateOfBirth: account.dateOfBirth ?? '' }; }
function presenceUser(user) {
  return { id: user.id, name: user.name, avatarUrl: user.avatarUrl ?? null, role: user.role ?? 'In the office', color: user.color ?? '#6f986e', x: user.x, y: user.y, online: user.online !== false, speaking: Boolean(user.speaking) };
}
function setSessionCookie(res, token, remember = false) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const maxAge = remember ? '; Max-Age=604800' : '';
  res.setHeader('Set-Cookie', `proxi_session=${token}; HttpOnly; SameSite=Lax; Path=/${maxAge}${secure}`);
}
async function persistLocalAccounts() {
  const write = accountWriteQueue.catch(() => {}).then(async () => {
    await mkdir(path.dirname(localAccountFile), { recursive: true });
    const tempFile = `${localAccountFile}.tmp`;
    await writeFile(tempFile, JSON.stringify([...localAccounts.values()], null, 2), { mode: 0o600 });
    await rename(tempFile, localAccountFile);
  });
  accountWriteQueue = write;
  return write;
}
async function findAccount(email) { return accounts ? accounts.findOne({ email }) : localAccounts.get(email); }
async function findAccountById(id) { return accounts ? accounts.findOne({ _id: id }) : [...localAccounts.values()].find(account => String(account._id ?? account.id) === id); }
async function saveAccount(account) {
  if (accounts) await accounts.insertOne(account);
  else { localAccounts.set(account.email, account); await persistLocalAccounts(); }
}
async function updateAccount(account, updates) {
  if (accounts) await accounts.updateOne({ _id: account._id }, { $set: updates });
  else { Object.assign(account, updates); localAccounts.set(account.email, account); await persistLocalAccounts(); }
}
async function passwordMatches(password, account) {
  const actual = await scrypt(password, Buffer.from(account.passwordSalt, 'hex'), 64);
  const expected = Buffer.from(account.passwordHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalize(user) { const { _id, ...rest } = user; return { ...rest, id: String(_id ?? user.id) }; }
async function saveUser(user) {
  if (people) await people.updateOne({ _id: user.id }, { $set: { ...user, _id: user.id, location: { type: 'Point', coordinates: [user.x / METERS_PER_DEGREE, user.y / METERS_PER_DEGREE] }, officeId: OFFICE_ID, updatedAt: new Date() } }, { upsert: true });
}
function scheduleUserPersistence(user) {
  if (!people) return;
  clearTimeout(userPersistTimers.get(user.id));
  const timer = setTimeout(() => {
    userPersistTimers.delete(user.id);
    saveUser(user).catch(err => console.error('Could not persist movement:', err.message));
  }, USER_PERSIST_INTERVAL_MS);
  timer.unref?.();
  userPersistTimers.set(user.id, timer);
}
async function nearby(user) {
  if (people) {
    const found = await people.find({ officeId: OFFICE_ID, _id: { $ne: user.id }, location: { $near: { $geometry: { type: 'Point', coordinates: [user.x / METERS_PER_DEGREE, user.y / METERS_PER_DEGREE] }, $maxDistance: EARSHOT } } }, { projection: { location: 0 } }).toArray();
    return found.map(normalize);
  }
  return [...users.values()].filter(other => other.id !== user.id && Math.hypot(other.x - user.x, other.y - user.y) <= EARSHOT);
}
async function cluster(user) {
  if (!people) return nearby(user);
  const center = [user.x / METERS_PER_DEGREE, user.y / METERS_PER_DEGREE];
  const found = await people.find({ officeId: OFFICE_ID, _id: { $ne: user.id }, location: { $geoWithin: { $centerSphere: [center, EARSHOT / 6_371_000] } } }, { projection: { location: 0 } }).toArray();
  return found.map(normalize);
}
function publishPresence() {
  // Send every live office member so clients can render avatars across the
  // whole map. Keep the geospatial result separate for proximity audio.
  const visiblePeers = [...users.values()];
  for (const user of users.values()) {
    const peers = visiblePeers.filter(peer => peer.id !== user.id);
    const earshot = peers.filter(peer => Math.hypot(peer.x - user.x, peer.y - user.y) <= EARSHOT).map(peer => peer.id);
    io.to(user.id).emit('presence', { peers: peers.map(presenceUser), earshot, officeId: OFFICE_ID });
  }
}
function schedulePresence() {
  if (presenceTimer) return;
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    publishPresence();
  }, PRESENCE_INTERVAL_MS);
  presenceTimer.unref?.();
}
app.get('/api/health', (_, res) => res.json({ ok: true, officeId: OFFICE_ID, connected: users.size, earshotPixels: EARSHOT, persistence: accounts ? 'mongodb' : 'local-file' }));
app.use('/api/auth', (_, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.post('/api/auth/register', limitAuthAttempts, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 32) : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (name.length < 2) return res.status(400).json({ error: 'Your name needs at least two characters.' });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Choose a password between 8 and 128 characters.' });
  try {
    if (await findAccount(email)) return res.status(409).json({ error: 'An account with that email already exists. Try logging in.' });
    const passwordSalt = randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(password, Buffer.from(passwordSalt, 'hex'), 64)).toString('hex');
    const account = { _id: randomUUID(), email, displayName: name, avatarDataUrl: null, avatarUpdatedAt: 0, phoneNumber: '', dateOfBirth: '', passwordSalt, passwordHash, createdAt: new Date() };
    await saveAccount(account);
    const token = randomBytes(32).toString('hex'); const profile = publicAccount(account);
    sessions.set(token, { ...profile, expiresAt: Date.now() + SESSION_TTL_MS }); setSessionCookie(res, token);
    res.status(201).json({ user: profile, profile: privateProfile(account) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'An account with that email already exists. Try logging in.' });
    console.error('Account registration failed:', err.message);
    res.status(500).json({ error: 'Could not create your account. Please try again.' });
  }
});
app.post('/api/auth/login', limitAuthAttempts, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const remember = req.body?.remember === true;
  if (!email || !password || password.length > 128) return res.status(400).json({ error: 'Enter your email and password.' });
  try {
    const account = await findAccount(email);
    if (!account || !(await passwordMatches(password, account))) return res.status(401).json({ error: 'That email and password do not match.' });
    const token = randomBytes(32).toString('hex'); const profile = publicAccount(account);
    sessions.set(token, { ...profile, expiresAt: Date.now() + (remember ? SESSION_TTL_MS : 12 * 60 * 60 * 1000) }); setSessionCookie(res, token, remember);
    res.json({ user: profile, profile: privateProfile(account) });
  } catch (err) {
    console.error('Login failed:', err.message);
    res.status(500).json({ error: 'Could not log you in. Please try again.' });
  }
});
app.get('/api/auth/me', async (req, res) => {
  const token = parseCookies(req.headers.cookie).proxi_session;
  const user = getSession(token);
  if (!user) return res.status(401).json({ error: 'Please log in to enter the office.' });
  try {
    const account = await findAccount(user.email);
    if (!account) return res.status(401).json({ error: 'Your account could not be found. Please log in again.' });
    res.json({ user: publicAccount(account), profile: privateProfile(account) });
  } catch (err) { res.status(500).json({ error: 'Could not load your profile.' }); }
});
app.get('/api/avatars/:id', async (req, res) => {
  const token = parseCookies(req.headers.cookie).proxi_session;
  if (!getSession(token)) return res.status(401).end();
  try {
    const account = await findAccountById(String(req.params.id));
    const image = account?.avatarDataUrl?.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
    if (!image) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=300').type(image[1]).send(Buffer.from(image[2], 'base64'));
  } catch { res.status(500).end(); }
});
app.patch('/api/auth/profile', async (req, res) => {
  const token = parseCookies(req.headers.cookie).proxi_session;
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: 'Please log in again to update your profile.' });
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 32) : '';
  const phoneNumber = typeof req.body?.phoneNumber === 'string' ? req.body.phoneNumber.trim().slice(0, 30) : '';
  const dateOfBirth = typeof req.body?.dateOfBirth === 'string' ? req.body.dateOfBirth.trim() : '';
  const avatarUrl = req.body?.avatarUrl;
  if (name.length < 2) return res.status(400).json({ error: 'Your name needs at least two characters.' });
  if (phoneNumber && !/^\+?[\d\s().-]{7,30}$/.test(phoneNumber)) return res.status(400).json({ error: 'Enter a valid phone number, or leave it blank.' });
  if (dateOfBirth) {
    const date = new Date(`${dateOfBirth}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateOfBirth || date > new Date()) return res.status(400).json({ error: 'Enter a valid date of birth that is not in the future.' });
  }
  if (avatarUrl !== null && (typeof avatarUrl !== 'string' || avatarUrl.length > 400_000 || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(avatarUrl))) return res.status(400).json({ error: 'Choose a JPG, PNG, or WebP profile photo smaller than 300 KB.' });
  try {
    const account = await findAccount(session.email);
    if (!account) return res.status(401).json({ error: 'Your account could not be found. Please log in again.' });
    const updates = { displayName: name, phoneNumber, dateOfBirth, avatarDataUrl: avatarUrl, avatarUpdatedAt: Date.now() };
    await updateAccount(account, updates);
    const updated = { ...account, ...updates };
    const publicUser = publicAccount(updated);
    sessions.set(token, { ...publicUser, expiresAt: session.expiresAt });
    for (const user of users.values()) {
      if (user.accountId !== publicUser.id) continue;
      user.name = publicUser.name; user.avatarUrl = publicUser.avatarUrl;
      await saveUser(user); io.emit('profile-updated', presenceUser(user));
    }
    res.json({ user: publicUser, profile: privateProfile(updated) });
  } catch (err) {
    console.error('Profile update failed:', err.message);
    res.status(500).json({ error: 'Could not save your profile. Please try again.' });
  }
});
app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).proxi_session;
  const user = getSession(token);
  if (token) sessions.delete(token);
  if (user) for (const socketId of accountSockets.get(user.id) || []) io.sockets.sockets.get(socketId)?.disconnect(true);
  res.setHeader('Set-Cookie', 'proxi_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});
function requireConnectedUser(req, res) {
  const token = parseCookies(req.headers.cookie).proxi_session;
  const account = getSession(token);
  if (!account) { res.status(401).json({ error: 'Please log in to view office presence.' }); return null; }
  const user = users.get(String(req.query.userId || ''));
  if (!user || user.accountId !== account.id) { res.status(404).json({ error: 'Connected user not found in this office' }); return null; }
  return user;
}
app.get('/api/office/nearby', async (req, res) => {
  const user = requireConnectedUser(req, res);
  if (!user) return;
  try { res.json({ officeId: OFFICE_ID, radiusPixels: EARSHOT, peers: (await nearby(user)).filter(peer => users.has(String(peer.id))).map(presenceUser) }); }
  catch (err) { res.status(500).json({ error: `Nearby lookup failed: ${err.message}` }); }
});
app.get('/api/office/cluster', async (req, res) => {
  const user = requireConnectedUser(req, res);
  if (!user) return;
  try { res.json({ officeId: OFFICE_ID, radiusPixels: EARSHOT, peers: (await cluster(user)).filter(peer => users.has(String(peer.id))).map(presenceUser) }); }
  catch (err) { res.status(500).json({ error: `Cluster lookup failed: ${err.message}` }); }
});

io.use((socket, next) => {
  const origin = socket.handshake.headers.origin;
  if (origin && origin !== CLIENT_ORIGIN) return next(new Error('Request origin is not allowed.'));
  const token = parseCookies(socket.handshake.headers.cookie).proxi_session;
  const account = getSession(token);
  if (!account) return next(new Error('Please log in to join the office.'));
  socket.data.sessionToken = token; socket.data.account = account; next();
});

io.on('connection', socket => {
  const account = socket.data.account;
  const sessionTimer = setTimeout(() => socket.disconnect(true), Math.max(0, account.expiresAt - Date.now()));
  sessionTimer.unref?.();
  const connected = accountSockets.get(account.id) || new Set(); connected.add(socket.id); accountSockets.set(account.id, connected);
  const user = { id: socket.id, accountId: account.id, name: account.name, email: account.email, avatarUrl: account.avatarUrl ?? null, role: 'In the office', color: '#6f986e', x: 485 + Math.random() * 60, y: 310 + Math.random() * 70, online: true, speaking: false };
  users.set(user.id, user); socket.join(user.id);
  const savedUser = saveUser(user).then(async () => {
    if (users.has(user.id)) schedulePresence();
    else if (people) await people.deleteOne({ _id: user.id });
  }).catch(err => { console.error('Could not persist new user:', err.message); schedulePresence(); });
  socket.emit('welcome', { user, officeId: OFFICE_ID, earshot: EARSHOT });
  socket.on('move', ({ x, y } = {}) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    user.x = Math.max(24, Math.min(976, x)); user.y = Math.max(24, Math.min(636, y));
    scheduleUserPersistence(user);
    schedulePresence();
  });
  socket.on('profile', async ({ name, role }) => {
    if (typeof name === 'string') user.name = name.slice(0, 32);
    if (typeof role === 'string') user.role = role.slice(0, 48);
    account.name = user.name;
    const savedAccount = await findAccount(user.email);
    if (savedAccount) await updateAccount(savedAccount, { displayName: user.name });
    await saveUser(user); io.emit('profile-updated', presenceUser(user));
  });
  socket.on('speaking', ({ speaking } = {}) => { user.speaking = Boolean(speaking); io.emit('speaking', { id: user.id, speaking: user.speaking }); schedulePresence(); });
  socket.on('signal', ({ to, description, candidate } = {}) => {
    const target = users.get(String(to || ''));
    if (!target || Math.hypot(target.x - user.x, target.y - user.y) > EARSHOT) return;
    io.to(target.id).emit('signal', { from: user.id, description, candidate });
  });
  socket.on('disconnect', async () => {
    clearTimeout(sessionTimer);
    users.delete(user.id);
    clearTimeout(userPersistTimers.get(user.id)); userPersistTimers.delete(user.id);
    const openSockets = accountSockets.get(account.id); openSockets?.delete(socket.id); if (!openSockets?.size) accountSockets.delete(account.id);
    if (people) await people.deleteOne({ _id: user.id });
    io.emit('user-left', user.id); schedulePresence();
  });
});

const mongoUri = process.env.MONGODB_URI;
async function loadLocalAccounts() {
  try {
    const saved = JSON.parse(await readFile(localAccountFile, 'utf8'));
    if (!Array.isArray(saved)) throw new Error('Account store must contain a JSON array');
    for (const account of saved) if (account?.email && account?.passwordHash && account?.passwordSalt) localAccounts.set(account.email, account);
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`Could not load local accounts: ${err.message}`);
  }
}
async function connectMongo() {
  if (!mongoUri) return;
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'proxispeak');
    const nextPeople = db.collection('people'), nextAccounts = db.collection('accounts');
    await nextPeople.createIndex({ location: '2dsphere' }); await nextPeople.createIndex({ officeId: 1 });
    await nextAccounts.createIndex({ email: 1 }, { unique: true });
    if (localAccounts.size) await nextAccounts.bulkWrite([...localAccounts.values()].map(account => ({ updateOne: { filter: { email: account.email }, update: { $setOnInsert: account }, upsert: true } })));
    people = nextPeople; accounts = nextAccounts;
    console.log('MongoDB connected; geospatial indexes ready');
  } catch (err) { await client.close().catch(() => {}); console.warn(`MongoDB unavailable; using live in-memory presence (${err.message})`); }
}
async function startServer() {
  try {
    if (process.env.NODE_ENV === 'production' && !CLIENT_ORIGIN.startsWith('https://')) throw new Error('Production requires CLIENT_ORIGIN to use HTTPS.');
    if (process.env.NODE_ENV === 'production' && !mongoUri) throw new Error('Production requires MongoDB; local-file account storage is for development only.');
    await loadLocalAccounts();
    await connectMongo();
    httpServer.listen(PORT, () => console.log(`ProxiSpeak server listening on http://localhost:${PORT} — ${OFFICE_ID} (${accounts ? 'MongoDB' : 'local account file'} persistence)`));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
startServer();
