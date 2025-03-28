const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
require("dotenv").config();

const app = express();

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.ALLOWED_ORIGINS?.split(',') || "http://localhost:3000"
    : "*",
  methods: ["GET", "POST"],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

const server = http.createServer(app);

// Socket.io setup with improved error handling
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? process.env.ALLOWED_ORIGINS?.split(',') || "http://localhost:3000"
      : "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: 60000, // Increase timeout for slower connections
  maxHttpBufferSize: 1e6 // 1 MB
});

// Socket connection handling
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Join a room based on user ID if provided
  if (socket.handshake.query.userId) {
    const userId = socket.handshake.query.userId;
    socket.join(`user:${userId}`);
    console.log(`User ${userId} joined personal room`);
  }

  // Listen for notification events
  socket.on("sendNotification", (data) => {
    console.log("Notification received:", data);
    
    // If the notification has a specific recipient, send to their room
    if (data.recipient && data.recipient !== 'all') {
      io.to(`user:${data.recipient}`).emit("notification", data);
      console.log(`Notification sent to specific user: ${data.recipient}`);
    } else {
      // Otherwise broadcast to everyone
      io.emit("notification", data);
      console.log("Notification broadcast to all users");
    }
  });

  // Handle ping/pong for connection testing
  socket.on("ping", (data) => {
    console.log(`Ping received from ${socket.id}:`, data);
    socket.emit("pong", { message: "Server pong", timestamp: Date.now() });
  });

  // Handle disconnect
  socket.on("disconnect", (reason) => {
    console.log(`User disconnected: ${socket.id}, reason: ${reason}`);
  });

  // Handle errors
  socket.on("error", (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

// Regular server-side error handling for Socket.io
io.engine.on("connection_error", (err) => {
  console.error('Socket.io connection error:', err);
});

// API Routes

// Health check endpoint
app.get("/", (req, res) => {
  res.send("Socket notification server is running");
});

// Status endpoint
app.get("/api/status", (req, res) => {
  return res.status(200).json({ 
    status: "ok", 
    socketConnections: io.engine.clientsCount,
    connectedSockets: Array.from(io.sockets.sockets).map(([id]) => id),
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Send notification endpoint
app.post("/api/send-notification", (req, res) => {
  try {
    const { type, message, recipient } = req.body;
    
    if (!type || !message) {
      return res.status(400).json({ error: "Type and message are required" });
    }
    
    // Create notification object
    const notification = {
      _id: Date.now().toString(), // Simple unique ID for the front-end
      type,
      message,
      recipient: recipient || 'all',
      read: false,
      createdAt: new Date().toISOString()
    };
    
    console.log(`Sending notification to ${recipient || 'all'} clients:`, notification);
    
    // If the notification has a specific recipient, send to their room
    if (recipient && recipient !== 'all') {
      io.to(`user:${recipient}`).emit("notification", notification);
    } else {
      // Otherwise broadcast to everyone
      io.emit("notification", notification);
    }
    
    return res.status(200).json({ success: true, notification });
  } catch (error) {
    console.error("Error sending notification:", error);
    return res.status(500).json({ error: "Internal server error", details: error.message });
  }
});

// Catch-all for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: "Not Found", message: "The requested resource was not found" });
});

// Start the server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🔔 WebSocket Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});