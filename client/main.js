const socket = io();

let mySymbol = null; // 'X' o 'O'
let state = null;    // {board, turn, status, winner}

const statusEl = document.getElementById('status');
const joinBtn = document.getElementById('join');
const reloadBtn = document.getElementById('reload');
const boardEl = document.getElementById('board');

// Creamos las 9 casillas
const cells = [];
for (let i = 0; i < 9; i++) {
  const btn = document.createElement('button');
  btn.className = 'cell';
  btn.addEventListener('click', () => {
    if (!state) return;
    if (!mySymbol) return;
    if (state.status !== 'playing') return;
    if (state.turn !== mySymbol) return;

    socket.emit('move', { index: i });
  });

  boardEl.appendChild(btn);
  cells.push(btn);
}

joinBtn.addEventListener('click', () => {
  joinBtn.disabled = true;
  socket.emit('join');
});

reloadBtn.addEventListener('click', () => location.reload());

// Mensajes del servidor
socket.on('waiting', (data) => {
  statusEl.textContent = data.message;
});

socket.on('assigned', (data) => {
  mySymbol = data.symbol;
  statusEl.textContent = `¡Listo! Tú eres ${mySymbol}.`;
});

socket.on('state', (newState) => {
  state = newState;
  render();
});

socket.on('game_over', ({ winner }) => {
  if (winner === null) {
    statusEl.textContent = 'Empate 🙂. Presiona “Reiniciar” para jugar otra vez.';
  } else if (winner === mySymbol) {
    statusEl.textContent = '¡Ganaste! 🎉 Presiona “Reiniciar” para jugar otra vez.';
  } else {
    statusEl.textContent = 'Perdiste 😅. Presiona “Reiniciar” para jugar otra vez.';
  }
});

socket.on('opponent_left', (data) => {
  statusEl.textContent = data.message;
});

function render() {
  // Dibujar tablero
  for (let i = 0; i < 9; i++) {
    cells[i].textContent = state.board[i] || '';
  }

  // ¿Me toca?
  const myTurn = mySymbol && state.status === 'playing' && state.turn === mySymbol;

  // Solo puedes clicar si es tu turno
  for (const cell of cells) {
    cell.disabled = !myTurn;
  }

  // Mensaje de turno
  if (state.status === 'playing' && mySymbol) {
    statusEl.textContent = myTurn
      ? `Tu turno (${mySymbol}).`
      : `Turno del rival (${state.turn}).`;
  }


}
