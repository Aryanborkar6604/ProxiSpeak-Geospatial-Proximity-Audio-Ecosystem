const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const env = require('./config/env');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth.routes');
const socketHandler = require('./sockets');

async function startServer() {
  await connectDB();

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: env.CLIENT_URL,
      methods: ["GET", "POST"]
    }
  });

  app.use(cors({ origin: env.CLIENT_URL }));
  app.use(express.json());

  app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.url}`);
    next();
  });

  app.use('/api/auth', authRoutes);
  
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  // Initialize sockets
  socketHandler(io);

  const { startProximityService } = require('./services/proximity.service');
  startProximityService(io);

  server.listen(env.PORT, () => {
    console.log(`Server listening on port ${env.PORT}`);
  });
}

startServer();
