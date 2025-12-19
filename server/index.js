const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servimos los archivos del cliente (HTML/CSS/JS)
app.use(express.static(path.join(__dirname, '..', 'client')));

let waitingSocket = null; // aquí guardamos a la persona que está esperando rival
const rooms = new Map();  // roomId -> estado del juego

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
      return board[a]; // 'X' o 'O'
    }
  }
  return null;
}

function publicState(room) {
  // mandamos solo lo necesario (sin IDs)
  return {
    board: room.board,
    turn: room.turn,
    status: room.status, // 'playing' | 'ended'
    winner: room.winner ?? null,
  };
}

io.on('connection', (socket) => {
  // 1) Cuando el jugador quiere entrar a jugar
  socket.on('join', () => {
    if (socket.data.roomId) return; // ya está en una partida

    // Si hay alguien esperando, emparejamos
    if (waitingSocket && waitingSocket.connected && waitingSocket.id !== socket.id) {
      const roomId = makeRoomId();

      const room = {
        board: Array(9).fill(''),
        turn: 'X',
        status: 'playing',
        winner: null,
        players: { X: waitingSocket.id, O: socket.id },
      };

      rooms.set(roomId, room);

      // metemos a ambos en la misma sala
      waitingSocket.join(roomId);
      socket.join(roomId);

      // guardamos datos en cada jugador
      waitingSocket.data.roomId = roomId;
      waitingSocket.data.symbol = 'X';
      socket.data.roomId = roomId;
      socket.data.symbol = 'O';

      // avisamos a cada uno su símbolo
      waitingSocket.emit('assigned', { symbol: 'X' });
      socket.emit('assigned', { symbol: 'O' });

      // mandamos el estado inicial a los dos
      io.to(roomId).emit('state', publicState(room));

      // ya no hay nadie esperando
      waitingSocket = null;
    } else {
      // Si no hay rival, queda esperando
      waitingSocket = socket;
      socket.emit('waiting', { message: 'Esperando a otro jugador...' });
    }
  });

  // 2) Cuando alguien intenta jugar un movimiento
  socket.on('move', ({ index }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;

    const symbol = socket.data.symbol;

    // El servidor valida TODO (importantísimo)
    if (symbol !== room.turn) return; // no es tu turno
    if (typeof index !== 'number' || index < 0 || index > 8) return;
    if (room.board[index] !== '') return; // casilla ocupada

    // Aplicamos la jugada
    room.board[index] = symbol;

    // ¿Ganó alguien?
    const winner = checkWinner(room.board);
    if (winner) {
      room.status = 'ended';
      room.winner = winner;
      io.to(roomId).emit('state', publicState(room));
      io.to(roomId).emit('game_over', { winner });
      return;
    }

    // ¿Empate?
    const full = room.board.every((c) => c !== '');
    if (full) {
      room.status = 'ended';
      room.winner = null;
      io.to(roomId).emit('state', publicState(room));
      io.to(roomId).emit('game_over', { winner: null });
      return;
    }

    // Si no terminó, cambiamos turno
    room.turn = room.turn === 'X' ? 'O' : 'X';
    io.to(roomId).emit('state', publicState(room));
  });

  // 3) Si alguien se desconecta
  socket.on('disconnect', () => {
    if (waitingSocket && waitingSocket.id === socket.id) {
      waitingSocket = null;
    }

    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    const otherId = Object.values(room.players).find((id) => id !== socket.id);
    if (otherId) {
      io.to(otherId).emit('opponent_left', {
        message: 'Tu rival se desconectó. Recarga para volver a jugar.'
      });
    }

    rooms.delete(roomId);
  });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Servidor listo en el puerto ${PORT}`);
});


