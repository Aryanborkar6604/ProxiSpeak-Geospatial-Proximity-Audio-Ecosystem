const { socketAuthMiddleware } = require('./middlewares');
const officeService = require('../services/office.service');
const positionService = require('../services/position.service');
const { cleanupUser, arePeersInRange } = require('../services/proximity.service');

function allowSocketEvent(socket, eventName, { windowMs, max }) {
  const now = Date.now();
  const limits = socket.data.eventLimits || (socket.data.eventLimits = {});
  let bucket = limits[eventName];
  if (!bucket || bucket.resetAt <= now) {
    bucket = limits[eventName] = { count: 0, resetAt: now + windowMs };
  }
  bucket.count += 1;
  return bucket.count <= max;
}

function isValidUserId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isValidSessionDescription(value, expectedType) {
  return Boolean(
    value && typeof value === 'object' &&
    value.type === expectedType &&
    typeof value.sdp === 'string' &&
    value.sdp.length > 0 && value.sdp.length <= 64 * 1024
  );
}

function isValidIceCandidate(value) {
  return Boolean(
    value && typeof value === 'object' &&
    typeof value.candidate === 'string' &&
    value.candidate.length > 0 && value.candidate.length <= 4096 &&
    (value.sdpMid == null || (typeof value.sdpMid === 'string' && value.sdpMid.length <= 64)) &&
    (value.sdpMLineIndex == null || Number.isInteger(value.sdpMLineIndex))
  );
}

async function relayToNearbyPeer(io, socket, targetUserId, eventName, payload) {
  const officeId = socket.data.officeId;
  if (!officeId || !arePeersInRange(socket.data.userId, targetUserId)) return;

  const userSockets = await io.in(`user_${targetUserId}`).fetchSockets();
  userSockets
    .filter((targetSocket) => targetSocket.data.officeId === officeId)
    .forEach((targetSocket) => targetSocket.emit(eventName, payload));
}

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
        if (!allowSocketEvent(socket, 'office:join', { windowMs: 60_000, max: 5 })) return;
        const officeId = payload?.officeId;
        if (typeof officeId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(officeId)) return;
        if (socket.data.officeId && socket.data.officeId !== officeId) return;

        // Resolve the requested office before adding this authenticated socket to its room.
        const office = await officeService.getOffice(officeId);
        if (!office) return;

        socket.join(officeId);
        socket.data.officeId = officeId;

        // Honor client device-cached position if valid and in-bounds, or fallback to saved cloud position / default
        const prefX = payload?.preferredPosition?.x;
        const prefY = payload?.preferredPosition?.y;
        let spawnX;
        let spawnY;

        if (
          Number.isFinite(prefX) &&
          Number.isFinite(prefY) &&
          prefX >= 35 &&
          prefX <= office.width - 35 &&
          prefY >= 35 &&
          prefY <= office.height - 35
        ) {
          spawnX = prefX;
          spawnY = prefY;
        } else {
          const existingPos = await positionService.getPosition(userId, officeId);
          spawnX = existingPos?.location?.[0] ?? (150 + Math.floor(Math.random() * 80));
          spawnY = existingPos?.location?.[1] ?? (320 + Math.floor(Math.random() * 40));
        }

        
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

    socket.on('player:move', (payload) => {
      try {
        if (!allowSocketEvent(socket, 'player:move', { windowMs: 1000, max: 60 })) return;
        const x = payload?.x;
        const y = payload?.y;
        const officeId = socket.data.officeId;
        if (!officeId || !Number.isFinite(x) || !Number.isFinite(y)) return;

        const office = officeService.getCachedOffice(officeId);
        if (!office || x < 0 || y < 0 || x > office.width || y > office.height) return;

        // Instant zero-delay broadcast to other clients in room
        socket.to(officeId).emit('player:moved', { userId, name: socket.data.userName, x, y });

        // Update position state asynchronously in background without blocking network tick
        positionService.updatePosition(userId, officeId, x, y).catch((err) => {
          console.warn('[position] Background update warning:', err.message);
        });
      } catch (err) {
        console.error('player:move error', err);
      }
    });

function sanitizeHtmlText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
}

    // Chat Signaling: Office broadcast, direct 1-on-1 messaging, and proximity whisper
    socket.on('chat:send', async (payload) => {
      if (!allowSocketEvent(socket, 'chat:send', { windowMs: 60_000, max: 12 })) return;
      const officeId = socket.data.officeId;
      const rawText = typeof payload?.text === 'string' ? payload.text.trim() : '';
      const mode = payload?.mode || 'office';
      if (!officeId || !rawText || rawText.length > 500 || !['office', 'dm'].includes(mode)) return;

      const sanitizedText = sanitizeHtmlText(rawText);
      if (!sanitizedText) return;

      const messageObj = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        senderId: userId,
        senderName: sanitizeHtmlText(socket.data.userName || 'Teammate'),
        text: sanitizedText,
        targetUserId: null,
        targetUserName: null,
        mode,
        timestamp: new Date().toISOString(),
      };

      if (mode === 'dm') {
        const targetUserId = payload?.targetUserId;
        if (!isValidUserId(targetUserId) || targetUserId === userId) return;
        try {
          const officeSockets = await io.in(officeId).fetchSockets();
          const targetSockets = officeSockets.filter((officeSocket) => officeSocket.data.userId === targetUserId);
          if (targetSockets.length === 0) return;
          messageObj.targetUserId = targetUserId;
          messageObj.targetUserName = targetSockets[0].data.userName || 'Teammate';
          targetSockets.forEach((targetSocket) => targetSocket.emit('chat:message', messageObj));
          socket.emit('chat:message', messageObj);
        } catch (error) {
          console.warn('[chat] Could not deliver a direct message:', error.message);
        }
      } else {
        // Office-wide broadcast
        io.to(officeId).emit('chat:message', messageObj);
      }
    });

    // Voice Activity Detection (VAD) signaling
    socket.on('player:speaking', (payload) => {
      const officeId = socket.data.officeId;
      if (officeId && typeof payload?.isSpeaking === 'boolean' &&
        allowSocketEvent(socket, 'player:speaking', { windowMs: 10_000, max: 30 })) {
        socket.to(officeId).emit('player:speaking', {
          userId,
          isSpeaking: payload.isSpeaking,
        });
      }
    });

    // Mute status signaling
    socket.on('player:mute', (payload) => {
      const officeId = socket.data.officeId;
      if (officeId && typeof payload?.isMuted === 'boolean' &&
        allowSocketEvent(socket, 'player:mute', { windowMs: 60_000, max: 30 })) {
        socket.to(officeId).emit('player:muted', {
          userId,
          isMuted: payload.isMuted,
        });
      }
    });

    socket.on('webrtc:offer', async (payload) => {
      const targetUserId = payload?.toUserId;
      if (!isValidUserId(targetUserId) ||
        !isValidSessionDescription(payload?.sdp, 'offer') ||
        !allowSocketEvent(socket, 'webrtc:offer', { windowMs: 60_000, max: 20 })) return;
      try {
        await relayToNearbyPeer(io, socket, targetUserId, 'webrtc:offer', { fromUserId: userId, sdp: payload.sdp });
      } catch (error) {
        console.warn('[webrtc] Could not relay offer:', error.message);
      }
    });

    socket.on('webrtc:answer', async (payload) => {
      const targetUserId = payload?.toUserId;
      if (!isValidUserId(targetUserId) ||
        !isValidSessionDescription(payload?.sdp, 'answer') ||
        !allowSocketEvent(socket, 'webrtc:answer', { windowMs: 60_000, max: 20 })) return;
      try {
        await relayToNearbyPeer(io, socket, targetUserId, 'webrtc:answer', { fromUserId: userId, sdp: payload.sdp });
      } catch (error) {
        console.warn('[webrtc] Could not relay answer:', error.message);
      }
    });

    socket.on('webrtc:ice-candidate', async (payload) => {
      const targetUserId = payload?.toUserId;
      if (!isValidUserId(targetUserId) ||
        !isValidIceCandidate(payload?.candidate) ||
        !allowSocketEvent(socket, 'webrtc:ice-candidate', { windowMs: 10_000, max: 200 })) return;
      try {
        await relayToNearbyPeer(io, socket, targetUserId, 'webrtc:ice-candidate', { fromUserId: userId, candidate: payload.candidate });
      } catch (error) {
        console.warn('[webrtc] Could not relay ICE candidate:', error.message);
      }
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
