const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Socket.IO
const io = new Server(server);

// Servimos los archivos del cliente (HTML/CSS/JS)
app.use(express.static(path.join(__dirname, '..', 'client')));

let waitingSocket = null;
const rooms = new Map(); // roomId -> room

// ===== Chat settings =====
const MAX_CHAT_MESSAGES = 25;
const MAX_CHAT_TEXT = 200;
const CHAT_COOLDOWN_MS = 700;

// ===== Helpers =====
function makeRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

function cleanName(raw) {
  const name = (raw ?? '').toString().trim().slice(0, 20);
  return name || 'Jugador';
}

function cleanText(raw) {
  const txt = (raw ?? '').toString().trim().replace(/\s+/g, ' ');
  return txt.slice(0, MAX_CHAT_TEXT);
}

function pushChat(room, msg) {
  room.chat.push(msg);
  if (room.chat.length > MAX_CHAT_MESSAGES) {
    room.chat.splice(0, room.chat.length - MAX_CHAT_MESSAGES);
  }
}

function sendSystem(roomId, text) {
  const room = rooms.get(roomId);
  if (!room) return;

  const msg = {
    kind: 'system',
    text,
    ts: Date.now(),
  };

  pushChat(room, msg);
  io.to(roomId).emit('chat_message', msg);
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
    status: room.status, // 'playing' | 'ended'
    winner: room.winner ?? null,
  };
}

io.on('connection', (socket) => {
  // ===== JOIN GAME =====
  socket.on('join', (payload) => {
    if (socket.data.roomId) return;

    socket.data.name = cleanName(payload?.name);

    // Si ya hay alguien esperando, emparejamos
    if (waitingSocket && waitingSocket.connected && waitingSocket.id !== socket.id) {
      const roomId = makeRoomId();

      const room = {
        board: Array(9).fill(''),
        turn: 'X',
        status: 'playing',
        winner: null,
        players: { X: waitingSocket.id, O: socket.id },
        names: {
          X: waitingSocket.data.name || 'Jugador',
          O: socket.data.name || 'Jugador',
        },
        chat: [],
      };

      rooms.set(roomId, room);

      waitingSocket.join(roomId);
      socket.join(roomId);

      waitingSocket.data.roomId = roomId;
      waitingSocket.data.symbol = 'X';

      socket.data.roomId = roomId;
      socket.data.symbol = 'O';

      waitingSocket.emit('assigned', { symbol: 'X' });
      socket.emit('assigned', { symbol: 'O' });

      // Estado inicial
      io.to(roomId).emit('state', publicState(room));

      // Historial inicial (vacío pero ya listo)
      io.to(roomId).emit('chat_history', room.chat);

      // Mensajitos del sistema
      sendSystem(roomId, `${room.names.X} (X) se unió a la partida.`);
      sendSystem(roomId, `${room.names.O} (O) se unió a la partida.`);
      sendSystem(roomId, `¡Empieza el juego! Turno: X`);

      waitingSocket = null;
    } else {
      waitingSocket = socket;
      socket.emit('waiting', { message: 'Esperando a otro jugador...' });
    }
  });

  // ===== MOVES =====
  socket.on('move', ({ index }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;

    const symbol = socket.data.symbol;

    if (symbol !== room.turn) return;
    if (typeof index !== 'number' || index < 0 || index > 8) return;
    if (room.board[index] !== '') return;

    room.board[index] = symbol;

    const winner = checkWinner(room.board);
    if (winner) {
      room.status = 'ended';
      room.winner = winner;

      io.to(roomId).emit('state', publicState(room));
      io.to(roomId).emit('game_over', { winner });

      sendSystem(roomId, `🏁 Fin del juego. Ganó: ${winner}`);
      return;
    }

    const full = room.board.every((c) => c !== '');
    if (full) {
      room.status = 'ended';
      room.winner = null;

      io.to(roomId).emit('state', publicState(room));
      io.to(roomId).emit('game_over', { winner: null });

      sendSystem(roomId, `🏁 Fin del juego. Empate.`);
      return;
    }

    room.turn = room.turn === 'X' ? 'O' : 'X';
    io.to(roomId).emit('state', publicState(room));

    sendSystem(roomId, `Turno: ${room.turn}`);
  });

  // ===== CHAT SEND =====
  socket.on('chat_send', (payload) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    // anti-spam simple
    const now = Date.now();
    const last = socket.data.lastChatTs || 0;
    if (now - last < CHAT_COOLDOWN_MS) return;
    socket.data.lastChatTs = now;

    const text = cleanText(payload?.text);
    if (!text) return;

    const symbol = socket.data.symbol;
    const name = socket.data.name || 'Jugador';

    const msg = {
      kind: 'user',
      text,
      ts: now,
      fromSymbol: symbol, // X / O
      fromName: name,
    };

    pushChat(room, msg);
    io.to(roomId).emit('chat_message', msg);
  });

  // ===== DISCONNECT =====
  socket.on('disconnect', () => {
    if (waitingSocket && waitingSocket.id === socket.id) {
      waitingSocket = null;
    }

    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    const symbol = socket.data.symbol;
    const name = socket.data.name || 'Jugador';

    // Avisar al otro
    const otherId = Object.values(room.players).find((id) => id !== socket.id);
    if (otherId) {
      io.to(otherId).emit('opponent_left', {
        message: 'Tu rival se desconectó. Recarga para volver a jugar.',
      });
    }

    // Mensaje sistema si todavía existe sala
    sendSystem(roomId, `⚠️ ${name} (${symbol}) se desconectó.`);

    rooms.delete(roomId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Servidor listo en el puerto ${PORT}`);
});


//cd..