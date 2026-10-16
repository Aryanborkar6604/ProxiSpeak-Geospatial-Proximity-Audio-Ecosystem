const { socketAuthMiddleware } = require('./middlewares');
const officeService = require('../services/office.service');
const positionService = require('../services/position.service');
const { cleanupUser } = require('../services/proximity.service');

function socketHandler(io) {
  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    console.log(`User connected: ${userId} (socket: ${socket.id})`);
    const sessionExpiresIn = Math.max(0, socket.data.tokenExpiresAt - Date.now());
    const sessionExpiryTimer = setTimeout(() => {
      socket.emit('auth:expired');
      socket.disconnect(true);
    }, sessionExpiresIn);
    sessionExpiryTimer.unref?.();
    
    socket.join(`user_${userId}`); // Join personal room for targeted events

    socket.on('office:join', async (payload) => {
      try {
        const { officeId } = payload;
        if (!officeId) return;

        socket.join(officeId);
        socket.data.officeId = officeId;

        // Check if user already had a saved position or spawn at default
        const office = await officeService.getOffice(officeId);
        const existingPos = await positionService.getPosition(userId, officeId);
        const spawnX = existingPos?.location?.[0] ?? (150 + Math.floor(Math.random() * 80));
        const spawnY = existingPos?.location?.[1] ?? (320 + Math.floor(Math.random() * 40));
        
        // Execute in parallel for instant response
        const [onlinePositions, nearbyPositions] = await Promise.all([
          positionService.getOnlineUsers(officeId, office),
          positionService.getNearbyUsers(officeId, spawnX, spawnY, office.hearingRadiusPx || 105),
          positionService.updatePosition(userId, officeId, spawnX, spawnY),
        ]);
        const positionsByUserId = new Map(
          [...onlinePositions, ...nearbyPositions].map((position) => [position.userId, position]),
        );
        const joinedPositions = [...positionsByUserId.values()];
        const officeSockets = await io.in(officeId).fetchSockets();
        const activeUserIdsInOffice = new Set(
          officeSockets.map((s) => s.data.userId).filter(Boolean)
        );
        activeUserIdsInOffice.add(userId);

        const namesByUserId = new Map(
          officeSockets
            .filter((officeSocket) => officeSocket.data.userName)
            .map((officeSocket) => [officeSocket.data.userId, officeSocket.data.userName]),
        );
        namesByUserId.set(userId, socket.data.userName || `User ${String(userId).slice(-4)}`);

        // Filter joinedPositions strictly to users currently online with an active socket
        const liveUsers = joinedPositions
          .filter((user) => activeUserIdsInOffice.has(user.userId))
          .map((user) => ({
            ...(user.toObject ? user.toObject() : user),
            name: namesByUserId.get(user.userId) || `Teammate`,
          }));
        
        socket.emit('office:state', {
          officeId: office.officeId,
          width: office.width,
          height: office.height,
          obstacles: office.obstacles,
          zones: office.zones,
          users: liveUsers,
        });

        // Broadcast to everyone else in the office so they see the new avatar instantly
        socket.to(officeId).emit('player:moved', { userId, name: socket.data.userName, x: spawnX, y: spawnY });
        
        console.log(`User ${userId} joined office ${officeId} at [${spawnX}, ${spawnY}]`);
      } catch (err) {
        console.error('office:join error', err);
      }
    });

    socket.on('player:move', async (payload) => {
      try {
        const { x, y } = payload;
        const officeId = socket.data.officeId;
        if (!officeId || typeof x !== 'number' || typeof y !== 'number') return;
        
        // Boundary validation
        const validX = Math.max(0, Math.min(x, 1000));
        const validY = Math.max(0, Math.min(y, 700));

        await positionService.updatePosition(userId, officeId, validX, validY);

        // Broadcast to room
        io.to(officeId).emit('player:moved', { userId, name: socket.data.userName, x: validX, y: validY });
      } catch (err) {
        console.error('player:move error', err);
      }
    });

    // Chat Signaling: Office broadcast, direct 1-on-1 messaging, and proximity whisper
    socket.on('chat:send', (payload) => {
      const officeId = socket.data.officeId;
      const text = String(payload?.text || '').trim();
      if (!officeId || !text) return;

      const messageObj = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        senderId: userId,
        senderName: socket.data.userName || 'Teammate',
        text: text.slice(0, 500),
        targetUserId: payload?.targetUserId || null,
        targetUserName: payload?.targetUserName || null,
        mode: payload?.mode || 'office', // 'office' | 'dm'
        timestamp: new Date().toISOString(),
      };

      if (messageObj.mode === 'dm' && messageObj.targetUserId) {
        // Direct Message: emit to target user's personal room and echo back to sender
        io.to(`user_${messageObj.targetUserId}`).emit('chat:message', messageObj);
        socket.emit('chat:message', messageObj);
      } else {
        // Office-wide broadcast
        io.to(officeId).emit('chat:message', messageObj);
      }
    });

    // Voice Activity Detection (VAD) signaling
    socket.on('player:speaking', (payload) => {
      const officeId = socket.data.officeId;
      if (officeId) {
        socket.to(officeId).emit('player:speaking', {
          userId,
          isSpeaking: Boolean(payload?.isSpeaking),
        });
      }
    });

    // Mute status signaling
    socket.on('player:mute', (payload) => {
      const officeId = socket.data.officeId;
      if (officeId) {
        socket.to(officeId).emit('player:muted', {
          userId,
          isMuted: Boolean(payload?.isMuted),
        });
      }
    });

    socket.on('webrtc:offer', (payload) => {
      // SEC-17: Relay offer to peer personal room
      io.to(`user_${payload.toUserId}`).emit('webrtc:offer', { fromUserId: userId, sdp: payload.sdp });
    });

    socket.on('webrtc:answer', (payload) => {
      io.to(`user_${payload.toUserId}`).emit('webrtc:answer', { fromUserId: userId, sdp: payload.sdp });
    });

    socket.on('webrtc:ice-candidate', (payload) => {
      io.to(`user_${payload.toUserId}`).emit('webrtc:ice-candidate', { fromUserId: userId, candidate: payload.candidate });
    });

    socket.on('disconnect', async () => {
      clearTimeout(sessionExpiryTimer);
      console.log(`User disconnected: ${userId}`);
      if (userId) {
        cleanupUser(userId);
        await positionService.markOffline(userId);
        if (socket.data.officeId) {
          io.to(socket.data.officeId).emit('player:left', { userId });
        }
      }
    });
  });
}

module.exports = socketHandler;
