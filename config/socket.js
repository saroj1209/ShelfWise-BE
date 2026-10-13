const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

let io;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
      ],
      credentials: true,
    },
  });

  const SECRET = process.env.JWT_SECRET;

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Not logged in"));

      const decoded = jwt.verify(token, SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.user.id}`);
    if (socket.user.role === "librarian") {
      socket.join("admin");
    }

    const libraryStore = require("./libraryStore");
    socket.emit("library_state_update", libraryStore.getState());

    socket.on("disconnect", () => {});
  });

  return io;
}

function broadcastState(state) {
  if (io) {
    io.emit("library_state_update", state);
  }
}

function broadcastHistoryUpdate() {
  if (io) {
    io.emit("borrow_history_update");
  }
}

module.exports = { initSocket, broadcastState, broadcastHistoryUpdate };
