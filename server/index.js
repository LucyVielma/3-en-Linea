const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Socket.IO
const io = new Server(server, {
  // En el mismo dominio no hace falta CORS, pero esto ayuda si algún día lo separas
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// Servir archivos estáticos del cliente
const clientPath = path.join(__dirname, "..", "client");
app.use(express.static(clientPath, { extensions: ["html"] }));

// Health check opcional
app.get("/healthz", (_, res) => res.status(200).send("ok"));

// Si alguien entra a una ruta rara, devuélvele el index.html (evita Not Found)
app.get("*", (_, res) => {
  res.sendFile(path.join(clientPath, "index.html"));
});

// ========== LÓGICA DEL JUEGO ==========
let waitingSocket = null;
const rooms = new Map();

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

function checkWinner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return null;
}

function publicState(room) {
  return {
    board: room.board,
    turn: room.turn,
    status: room.status, // playing | ended
    winner: room.winner ?? null,
  };
}

io.on("connection", (socket) => {
  socket.on("join", () => {
    // Si ya está en partida, no hagas nada
    if (socket.data.roomId) return;

    // Si el que estaba esperando se desconectó, limpialo
    if (waitingSocket && !waitingSocket.connected) {
      waitingSocket = null;
    }

    // Emparejar si ya hay alguien esperando
    if (waitingSocket && waitingSocket.id !== socket.id) {
      const roomId = makeRoomId();

      const room = {
        board: Array(9).fill(""),
        turn: "X",
        status: "playing",
        winner: null,
        players: { X: waitingSocket.id, O: socket.id },
      };

      rooms.set(roomId, room);

      waitingSocket.join(roomId);
      socket.join(roomId);

      waitingSocket.data.roomId = roomId;
      waitingSocket.data.symbol = "X";

      socket.data.roomId = roomId;
      socket.data.symbol = "O";

      waitingSocket.emit("assigned", { symbol: "X" });
      socket.emit("assigned", { symbol: "O" });

      io.to(roomId).emit("state", publicState(room));

      waitingSocket = null;
    } else {
      waitingSocket = socket;
      socket.emit("waiting", { message: "Esperando a otro jugador..." });
    }
  });

  socket.on("move", ({ index }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room || room.status !== "playing") return;

    const symbol = socket.data.symbol;
    if (symbol !== room.turn) return;

    if (typeof index !== "number" || index < 0 || index > 8) return;
    if (room.board[index] !== "") return;

    room.board[index] = symbol;

    const winner = checkWinner(room.board);
    if (winner) {
      room.status = "ended";
      room.winner = winner;
      io.to(roomId).emit("state", publicState(room));
      io.to(roomId).emit("game_over", { winner });
      return;
    }

    const full = room.board.every((c) => c !== "");
    if (full) {
      room.status = "ended";
      room.winner = null;
      io.to(roomId).emit("state", publicState(room));
      io.to(roomId).emit("game_over", { winner: null });
      return;
    }

    room.turn = room.turn === "X" ? "O" : "X";
    io.to(roomId).emit("state", publicState(room));
  });

  socket.on("disconnect", () => {
    // Si estaba esperando, lo quitamos
    if (waitingSocket && waitingSocket.id === socket.id) {
      waitingSocket = null;
    }

    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    const otherId = Object.values(room.players).find((id) => id !== socket.id);
    if (otherId) {
      io.to(otherId).emit("opponent_left", {
        message: "Tu rival se desconectó. Presiona Reiniciar para volver a jugar.",
      });
    }

    rooms.delete(roomId);
  });
});

// Render usa PORT del environment
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Servidor listo en el puerto ${PORT}`);
});
