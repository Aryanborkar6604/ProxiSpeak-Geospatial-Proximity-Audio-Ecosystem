
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const httpServer = http.createServer(app);

const PORT = 3001;

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://mw5t024c-5173.inc1.devtunnels.ms",
];

app.use(express.json({ limit: "10kb" }));

// CORS for REST API requests
app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Socket.IO configuration
const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  },
});

// JWT configuration
// Use a strong environment variable for deployments.
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error(
    "WARNING: JWT_SECRET is not configured. Set it before starting the server."
  );
  process.exit(1);
}

// SQLite database
const db = new Database(path.join(__dirname, "proxispeak.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

const createUser = db.prepare(`
  INSERT INTO users (name, email, password_hash)
  VALUES (?, ?, ?)
`);

const findUserByEmail = db.prepare(`
  SELECT id, name, email, password_hash
  FROM users
  WHERE email = ?
`);

const findUserById = db.prepare(`
  SELECT id, name, email, created_at
  FROM users
  WHERE id = ?
`);

function createToken(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

function authenticateToken(req, res, next) {
  const authorization = req.headers.authorization || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      message: "Please log in to continue.",
    });
  }

  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      message: "Your login session is invalid or expired. Please log in again.",
    });
  }
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "ProxiSpeak server is running",
  });
});

// Create account
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        message: "Please enter your name, email, and password.",
      });
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (cleanName.length < 2 || cleanName.length > 60) {
      return res.status(400).json({
        message: "Name must contain 2 to 60 characters.",
      });
    }

    if (
      cleanEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
    ) {
      return res.status(400).json({
        message: "Please enter a valid email address.",
      });
    }

    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({
        message: "Password must contain 8 to 72 characters.",
      });
    }

    if (findUserByEmail.get(cleanEmail)) {
      return res.status(409).json({
        message: "An account with this email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = createUser.run(cleanName, cleanEmail, passwordHash);
    const user = findUserById.get(Number(result.lastInsertRowid));
    const token = createToken(user);

    return res.status(201).json({
      message: "Account created successfully.",
      token,
      user,
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({
        message: "An account with this email already exists.",
      });
    }

    console.error("Registration error:", error.message);

    return res.status(500).json({
      message: "Could not create your account. Please try again.",
    });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.length > 254 ||
      password.length > 72
    ) {
      return res.status(400).json({
        message: "Please enter a valid email and password.",
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = findUserByEmail.get(cleanEmail);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        message: "Incorrect email or password.",
      });
    }

    const token = createToken(user);
    const profile = findUserById.get(user.id);

    return res.json({
      message: "Login successful.",
      token,
      user: profile,
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      message: "Could not log in. Please try again.",
    });
  }
});

// Protected profile endpoint
app.get("/api/auth/me", authenticateToken, (req, res) => {
  const user = findUserById.get(req.auth.id);

  if (!user) {
    return res.status(401).json({
      message: "User account not found. Please log in again.",
    });
  }

  return res.json({ user });
});

// Authenticate Socket.IO connections
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(new Error("Authentication required. Please log in."));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = findUserById.get(decoded.id);

    if (!user) {
      return next(new Error("User account not found."));
    }

    socket.data.user = {
      id: user.id,
      name: user.name,
      email: user.email,
    };

    next();
  } catch {
    next(new Error("Invalid or expired login session."));
  }
});

// Virtual office and WebRTC signaling
const users = {};

io.on("connection", (socket) => {
  const profile = socket.data.user;

  users[socket.id] = {
    id: socket.id,
    name: profile.name,
    userId: profile.id,
    x: 150 + Math.floor(Math.random() * 200),
    y: 100 + Math.floor(Math.random() * 150),
  };

  socket.emit("current-users", users);
  socket.broadcast.emit("user-joined", users[socket.id]);

  socket.on("move", (position) => {
    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      return;
    }

    users[socket.id] = {
      ...users[socket.id],
      x: Math.max(0, Math.min(2000, position.x)),
      y: Math.max(0, Math.min(2000, position.y)),
    };

    io.emit("user-moved", users[socket.id]);
  });

  socket.on("webrtc-offer", ({ targetId, offer } = {}) => {
    if (users[targetId] && offer) {
      io.to(targetId).emit("webrtc-offer", {
        fromId: socket.id,
        offer,
      });
    }
  });

  socket.on("webrtc-answer", ({ targetId, answer } = {}) => {
    if (users[targetId] && answer) {
      io.to(targetId).emit("webrtc-answer", {
        fromId: socket.id,
        answer,
      });
    }
  });

  socket.on("webrtc-ice-candidate", ({ targetId, candidate } = {}) => {
    if (users[targetId] && candidate) {
      io.to(targetId).emit("webrtc-ice-candidate", {
        fromId: socket.id,
        candidate,
      });
    }
  });

  socket.on("disconnect", () => {
    delete users[socket.id];
    io.emit("user-left", socket.id);
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`ProxiSpeak server running on port ${PORT}`);
});
