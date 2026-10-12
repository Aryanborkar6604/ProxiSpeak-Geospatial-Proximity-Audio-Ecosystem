import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { MongoClient } from 'mongodb';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' } });
const PORT = process.env.PORT || 3001;
const OFFICE_ID = process.env.OFFICE_ID || 'infotact-hq';
const EARSHOT = 170;
// Project office pixels to a small, valid GeoJSON patch where 1 pixel ≈ 1 meter.
const METERS_PER_DEGREE = 111_320;
const users = new Map();
let people;

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
app.get('/api/health', (_, res) => res.json({ ok: true, officeId: OFFICE_ID, connected: users.size, persistence: people ? 'mongodb' : 'memory' }));
app.get('/api/office/cluster', async (req, res) => {
  const user = users.get(String(req.query.userId || ''));
  if (!user) return res.status(404).json({ error: 'Connected user not found in this office' });
  try { res.json({ officeId: OFFICE_ID, radiusPixels: EARSHOT, peers: await cluster(user) }); }
  catch (err) { res.status(500).json({ error: `Cluster lookup failed: ${err.message}` }); }
});

io.on('connection', socket => {
  const user = { id: socket.id, name: `Guest ${socket.id.slice(0, 4)}`, role: 'In the office', color: '#4c9b77', x: 485 + Math.random() * 60, y: 310 + Math.random() * 70, online: true, speaking: false };
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
    await saveUser(user); io.emit('profile-updated', user);
  });
  socket.on('speaking', ({ speaking }) => { user.speaking = Boolean(speaking); io.emit('speaking', { id: user.id, speaking: user.speaking }); });
  socket.on('signal', ({ to, description, candidate }) => {
    const target = users.get(String(to || ''));
    if (!target || Math.hypot(target.x - user.x, target.y - user.y) > EARSHOT) return;
    io.to(target.id).emit('signal', { from: user.id, description, candidate });
  });
  socket.on('disconnect', async () => { users.delete(user.id); if (people) await people.deleteOne({ _id: user.id }); io.emit('user-left', user.id); await publishPresence(); });
  publishPresence();
});

const mongoUri = process.env.MONGODB_URI;
if (mongoUri) {
  try {
    const client = new MongoClient(mongoUri); await client.connect();
    people = client.db(process.env.MONGODB_DB || 'proxispeak').collection('people');
    await people.createIndex({ location: '2dsphere' }); await people.createIndex({ officeId: 1 });
    console.log('MongoDB connected; geospatial indexes ready');
  } catch (err) { console.warn(`MongoDB unavailable; using live in-memory presence (${err.message})`); }
}
httpServer.listen(PORT, () => console.log(`ProxiSpeak server listening on http://localhost:${PORT} — ${OFFICE_ID}`));
