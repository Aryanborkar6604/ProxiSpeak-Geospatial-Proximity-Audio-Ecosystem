import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { MongoClient } from 'mongodb';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json());
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true } });
const PORT = process.env.PORT || 3001;
const OFFICE_ID = process.env.OFFICE_ID || 'infotact-hq';
const EARSHOT = 65;
// Project office pixels to a small, valid GeoJSON patch where 1 pixel ≈ 1 meter.
const METERS_PER_DEGREE = 111_320;
const users = new Map();
const demoAccounts = new Map();
const sessions = new Map();
const accountSockets = new Map();
let people, accounts;

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const i = part.indexOf('='); return [part.slice(0, i), decodeURIComponent(part.slice(i + 1))];
  }));
}
function publicAccount(account) { return { id: String(account._id ?? account.id), email: account.email, name: account.displayName ?? account.name }; }
function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `proxi_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`);
}
async function findAccount(email) { return accounts ? accounts.findOne({ email }) : demoAccounts.get(email); }
async function saveAccount(account) {
  if (accounts) await accounts.insertOne(account); else demoAccounts.set(account.email, account);
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
async function publishPresence() {
  for (const user of users.values()) {
    try {
      const peers = (await nearby(user)).filter(peer => peer.online !== false);
      io.to(user.id).emit('presence', { peers, earshot: peers.map(peer => peer.id), officeId: OFFICE_ID });
    } catch (err) { console.error('Presence query failed:', err.message); }
  }
}
app.get('/api/health', (_, res) => res.json({ ok: true, officeId: OFFICE_ID, connected: users.size, earshotPixels: EARSHOT, persistence: people ? 'mongodb' : 'memory' }));
app.post('/api/auth/register', async (req, res) => {
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
    const account = { _id: randomUUID(), email, displayName: name, passwordSalt, passwordHash, createdAt: new Date() };
    await saveAccount(account);
    const token = randomBytes(32).toString('hex'); const profile = publicAccount(account);
    sessions.set(token, profile); setSessionCookie(res, token);
    res.status(201).json({ user: profile });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'An account with that email already exists. Try logging in.' });
    console.error('Account registration failed:', err.message);
    res.status(500).json({ error: 'Could not create your account. Please try again.' });
  }
});
app.post('/api/auth/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password || password.length > 128) return res.status(400).json({ error: 'Enter your email and password.' });
  try {
    const account = await findAccount(email);
    if (!account || !(await passwordMatches(password, account))) return res.status(401).json({ error: 'That email and password do not match.' });
    const token = randomBytes(32).toString('hex'); const profile = publicAccount(account);
    sessions.set(token, profile); setSessionCookie(res, token);
    res.json({ user: profile });
  } catch (err) {
    console.error('Login failed:', err.message);
    res.status(500).json({ error: 'Could not log you in. Please try again.' });
  }
});
app.get('/api/auth/me', (req, res) => {
  const token = parseCookies(req.headers.cookie).proxi_session;
  const user = token && sessions.get(token);
  if (!user) return res.status(401).json({ error: 'Please log in to enter the office.' });
  res.json({ user });
});
app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).proxi_session;
  const user = token && sessions.get(token);
  if (token) sessions.delete(token);
  if (user) for (const socketId of accountSockets.get(user.id) || []) io.sockets.sockets.get(socketId)?.disconnect(true);
  res.setHeader('Set-Cookie', 'proxi_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/office/cluster', async (req, res) => {
  const user = users.get(String(req.query.userId || ''));
  if (!user) return res.status(404).json({ error: 'Connected user not found in this office' });
  try { res.json({ officeId: OFFICE_ID, radiusPixels: EARSHOT, peers: await cluster(user) }); }
  catch (err) { res.status(500).json({ error: `Cluster lookup failed: ${err.message}` }); }
});

io.use((socket, next) => {
  const token = parseCookies(socket.handshake.headers.cookie).proxi_session;
  const account = token && sessions.get(token);
  if (!account) return next(new Error('Please log in to join the office.'));
  socket.data.sessionToken = token; socket.data.account = account; next();
});

io.on('connection', socket => {
  const account = socket.data.account;
  const connected = accountSockets.get(account.id) || new Set(); connected.add(socket.id); accountSockets.set(account.id, connected);
  const user = { id: socket.id, accountId: account.id, name: account.name, email: account.email, role: 'In the office', color: '#6f986e', x: 485 + Math.random() * 60, y: 310 + Math.random() * 70, online: true, speaking: false };
  users.set(user.id, user); socket.join(user.id); saveUser(user).catch(err => console.error('Could not persist new user:', err.message));
  socket.emit('welcome', { user, officeId: OFFICE_ID, earshot: EARSHOT });
  socket.on('move', async ({ x, y }) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    user.x = Math.max(24, Math.min(976, x)); user.y = Math.max(24, Math.min(636, y));
    await saveUser(user); await publishPresence();
  });
  socket.on('profile', async ({ name, role }) => {
    if (typeof name === 'string') user.name = name.slice(0, 32);
    if (typeof role === 'string') user.role = role.slice(0, 48);
    account.name = user.name;
    if (accounts) await accounts.updateOne({ _id: account.id }, { $set: { displayName: user.name } });
    await saveUser(user); io.emit('profile-updated', user);
  });
  socket.on('speaking', ({ speaking }) => { user.speaking = Boolean(speaking); io.emit('speaking', { id: user.id, speaking: user.speaking }); });
  socket.on('signal', ({ to, description, candidate }) => {
    const target = users.get(String(to || ''));
    if (!target || Math.hypot(target.x - user.x, target.y - user.y) > EARSHOT) return;
    io.to(target.id).emit('signal', { from: user.id, description, candidate });
  });
  socket.on('disconnect', async () => { users.delete(user.id); const openSockets = accountSockets.get(account.id); openSockets?.delete(socket.id); if (!openSockets?.size) accountSockets.delete(account.id); if (people) await people.deleteOne({ _id: user.id }); io.emit('user-left', user.id); await publishPresence(); });
  publishPresence();
});

const mongoUri = process.env.MONGODB_URI;
async function connectMongo() {
  if (!mongoUri) return;
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'proxispeak');
    const nextPeople = db.collection('people'), nextAccounts = db.collection('accounts');
    await nextPeople.createIndex({ location: '2dsphere' }); await nextPeople.createIndex({ officeId: 1 });
    await nextAccounts.createIndex({ email: 1 }, { unique: true });
    people = nextPeople; accounts = nextAccounts;
    console.log('MongoDB connected; geospatial indexes ready');
  } catch (err) { await client.close().catch(() => {}); console.warn(`MongoDB unavailable; using live in-memory presence (${err.message})`); }
}
httpServer.listen(PORT, () => console.log(`ProxiSpeak server listening on http://localhost:${PORT} — ${OFFICE_ID}`));
connectMongo();
