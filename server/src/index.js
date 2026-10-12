const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const env = require('./config/env');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth.routes');
const rtcRoutes = require('./routes/rtc.routes');
const socketHandler = require('./sockets');

async function startServer() {
  const dbConnected = await connectDB();
  if (!dbConnected) {
    console.log('[server] Running in local fallback mode without MongoDB persistence.');
    if (env.NODE_ENV === 'production') {
      throw new Error('MongoDB must be connected before starting ProxiSpeak in production.');
    }
  }

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: true,
      credentials: true,
      methods: ["GET", "POST"]
    }
  });

  // Phase 3: Redis Pub/Sub for horizontal multi-instance scaling
  if (process.env.REDIS_URL) {
    try {
      const { createAdapter } = require('@socket.io/redis-adapter');
      const Redis = require('ioredis');
      const pubClient = new Redis(process.env.REDIS_URL);
      const subClient = pubClient.duplicate();
      io.adapter(createAdapter(pubClient, subClient));
      console.log('[Phase 3] Redis Pub/Sub adapter connected for horizontal clustering');
    } catch (err) {
      console.warn('[Phase 3] Could not initialize Redis adapter, running in single-instance mode:', err.message);
    }
  } else {
    console.log('[Phase 3] Single-instance mode active (provide REDIS_URL to enable cross-server cluster scaling)');
  }

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

  app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.url}`);
    next();
  });

  const officeRoutes = require('./routes/office.routes');

  app.set('io', io);
  app.use('/api/auth', authRoutes);
  app.use('/api/rtc', rtcRoutes);
  app.use('/api/offices', officeRoutes);
  
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  const clientBuildPath = path.resolve(__dirname, '../../client/dist');
  const clientEntryPath = path.join(clientBuildPath, 'index.html');
  if (fs.existsSync(clientEntryPath)) {
    app.use(express.static(clientBuildPath, { index: false }));
    app.get(/.*/, (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      return res.sendFile(clientEntryPath);
    });
  }

  const { startProximityService, meshTelemetry } = require('./services/proximity.service');
  app.get('/api/telemetry/mesh', (req, res) => {
    res.json(meshTelemetry.getStats());
  });

  // Initialize sockets
  socketHandler(io);

  startProximityService(io);

  server.listen(env.PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${env.PORT} (0.0.0.0)`);
  });
}

startServer().catch((error) => {
  console.error('[server] Startup failed:', error.message);
  process.exitCode = 1;
});
