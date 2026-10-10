const { socketAuthMiddleware } = require('./middlewares');
const officeService = require('../services/office.service');
const positionService = require('../services/position.service');

function socketHandler(io) {
  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    console.log(`User connected: ${userId} (socket: ${socket.id})`);
    
    socket.join(`user_${userId}`); // Join personal room for targeted events

    socket.on('office:join', async (payload) => {
      try {
        const { officeId } = payload;
        if (!officeId) return;

        socket.join(officeId);
        socket.data.officeId = officeId;
        
        const office = await officeService.getOffice(officeId);
        const onlinePositions = await positionService.getOnlineUsers(officeId);
        
        socket.emit('office:state', {
          officeId: office.officeId,
          width: office.width,
          height: office.height,
          obstacles: office.obstacles,
          zones: office.zones,
          users: onlinePositions,
        });
        
        console.log(`User ${userId} joined office ${officeId}`);
      } catch (err) {
        console.error('office:join error', err);
      }
    });

    socket.on('player:move', async (payload) => {
      try {
        const { x, y } = payload;
        const officeId = socket.data.officeId;
        if (!officeId || typeof x !== 'number' || typeof y !== 'number') return;
        
        // Basic boundary validation
        // In real impl, we should fetch office bounds
        const validX = Math.max(0, Math.min(x, 1000));
        const validY = Math.max(0, Math.min(y, 700));

        await positionService.updatePosition(userId, officeId, validX, validY);

        // Broadcast to room
        io.to(officeId).emit('player:moved', { userId, x: validX, y: validY });
      } catch (err) {
        console.error('player:move error', err);
      }
    });

    socket.on('webrtc:offer', (payload) => {
      // SEC-17: Ensure the recipient is in range (simplified for MVP scaffold)
      io.to(`user_${payload.toUserId}`).emit('webrtc:offer', { fromUserId: userId, sdp: payload.sdp });
    });

    socket.on('webrtc:answer', (payload) => {
      io.to(`user_${payload.toUserId}`).emit('webrtc:answer', { fromUserId: userId, sdp: payload.sdp });
    });

    socket.on('webrtc:ice-candidate', (payload) => {
      io.to(`user_${payload.toUserId}`).emit('webrtc:ice-candidate', { fromUserId: userId, candidate: payload.candidate });
    });

    socket.on('disconnect', async () => {
      console.log(`User disconnected: ${userId}`);
      if (userId) {
        await positionService.markOffline(userId);
        if (socket.data.officeId) {
          io.to(socket.data.officeId).emit('player:left', { userId });
        }
      }
    });
  });
}

module.exports = socketHandler;
