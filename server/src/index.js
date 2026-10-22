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
const { requireAuth } = require('./middlewares/auth.middleware');
const { createRateLimiter } = require('./middlewares/rate-limit.middleware');

async function startServer() {
  const dbConnected = await connectDB();
  if (!dbConnected) {
    console.log('[server] Running in local fallback mode without MongoDB persistence.');
    if (env.NODE_ENV === 'production') {
      throw new Error('MongoDB must be connected before starting ProxiSpeak in production.');
    }
  }

  const app = express();
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.disable('x-powered-by');

  const allowedOrigins = new Set([
    ...env.CLIENT_URLS,
    process.env.RENDER_EXTERNAL_URL,
  ].filter(Boolean).map((origin) => {
    try { return new URL(origin).origin; } catch { return ''; }
  }).filter(Boolean));
  const originAllowed = (origin) => {
    if (!origin || allowedOrigins.has(origin)) return true;
    if (env.NODE_ENV === 'production') return false;
    try {
      const parsedOrigin = new URL(origin);
      return parsedOrigin.protocol === 'http:' &&
        (parsedOrigin.hostname === 'localhost' || parsedOrigin.hostname === '127.0.0.1');
    } catch {
      return false;
    }
  };
  const corsOptions = {
    origin(origin, callback) {
      callback(null, originAllowed(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    maxAge: 600,
  };

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: corsOptions,
    maxHttpBufferSize: 128 * 1024,
    allowRequest(req, callback) {
      callback(null, originAllowed(req.headers.origin));
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

  app.use(cors(corsOptions));
  const connectSources = ["'self'"];
  if (env.LIVEKIT_URL) {
    try { connectSources.push(new URL(env.LIVEKIT_URL).origin); } catch { /* invalid values are rejected by env config */ }
  }
  if (env.NODE_ENV !== 'production') {
    connectSources.push(
      'http://localhost:*', 'ws://localhost:*',
      'http://127.0.0.1:*', 'ws://127.0.0.1:*',
    );
  }
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
      'X-Permitted-Cross-Domain-Policies': 'none',
      'Content-Security-Policy': [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob:",
        `connect-src ${connectSources.join(' ')}`,
        "media-src 'self' blob:",
        "worker-src 'self' blob:",
      ].join('; '),
    });
    if (env.NODE_ENV === 'production' && req.secure) {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });
  app.use(express.json({ limit: '32kb', strict: true }));

  app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.path}`);
    next();
  });

  app.use('/api', createRateLimiter({ windowMs: 60_000, max: 300 }));

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
  app.get('/api/telemetry/mesh', requireAuth, (req, res) => {
    res.json(meshTelemetry.getStats());
  });

  // Ensure all API errors return structured JSON instead of HTML
  app.use('/api', (err, req, res, next) => {
    console.error('[API Error]', err);
    if (!res.headersSent) {
      res.status(err.status || err.statusCode || 500).json({
        error: err.message || 'Internal server error',
      });
    }
  });

  // Ensure unhandled /api 404s return JSON
  app.use('/api', (req, res) => {
    if (!res.headersSent) {
      res.status(404).json({ error: `Cannot ${req.method} ${req.path}` });
    }
  });

  // Initialize sockets
  socketHandler(io);

  startProximityService(io);

  const listenHost = process.env.HOST || (env.NODE_ENV === 'production' ? '0.0.0.0' : undefined);
  server.listen(env.PORT, listenHost, () => {
    console.log(`Server listening on port ${env.PORT} (${listenHost || 'dual-stack localhost/all'})`);
  });
}

startServer().catch((error) => {
  console.error('[server] Startup failed:', error.message);
  process.exitCode = 1;
});
