
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:5174"],
    methods: ["GET", "POST"],
  },
});

const users = {};

io.on("connection", (socket) => {
  users[socket.id] = {
    id: socket.id,
    x: 150 + Math.floor(Math.random() * 200),
    y: 100 + Math.floor(Math.random() * 150),
  };

  socket.emit("current-users", users);
  socket.broadcast.emit("user-joined", users[socket.id]);

  // Update avatar movement
  socket.on("move", (position) => {
    users[socket.id] = { ...users[socket.id], ...position };
    io.emit("user-moved", users[socket.id]);
  });

  // WebRTC: send an offer to another user
  socket.on("webrtc-offer", ({ targetId, offer }) => {
    if (users[targetId]) {
      io.to(targetId).emit("webrtc-offer", {
        fromId: socket.id,
        offer,
      });
    }
  });

  // WebRTC: send an answer to another user
  socket.on("webrtc-answer", ({ targetId, answer }) => {
    if (users[targetId]) {
      io.to(targetId).emit("webrtc-answer", {
        fromId: socket.id,
        answer,
      });
    }
  });

  // WebRTC: send ICE connection candidates
  socket.on("webrtc-ice-candidate", ({ targetId, candidate }) => {
    if (users[targetId]) {
      io.to(targetId).emit("webrtc-ice-candidate", {
        fromId: socket.id,
        candidate,
      });
    }
  });

  // Remove disconnected users
  socket.on("disconnect", () => {
    delete users[socket.id];
    io.emit("user-left", socket.id);
  });
});

httpServer.listen(3001, () => {
  console.log("ProxiSpeak server running at http://localhost:3001");
});
