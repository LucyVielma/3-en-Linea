// Si por alguna razón el CDN no cargó, avisamos
if (typeof io === "undefined") {
  alert("No cargó Socket.IO 😅. Recarga con Ctrl+F5.");
}

let socket = null;

let mySymbol = null; // 'X' o 'O'
let state = null;    // { board, turn, status, winner }

const statusEl = document.getElementById("status");
const joinBtn = document.getElementById("join");
const reloadBtn = document.getElementById("reload");
const boardEl = document.getElementById("board");

// Crear el tablero (9 botones)
const cells = [];
for (let i = 0; i < 9; i++) {
  const btn = document.createElement("button");
  btn.className = "cell";
  btn.type = "button";

  btn.addEventListener("click", () => {
    if (!state) return;
    if (!mySymbol) return;
    if (state.status !== "playing") return;
    if (state.turn !== mySymbol) return;

    socket.emit("move", { index: i });
  });

  boardEl.appendChild(btn);
  cells.push(btn);
}

// Estado inicial UI
setAllCellsDisabled(true);
joinBtn.disabled = true;

// Conectar socket
connectSocket();

// Botones
joinBtn.addEventListener("click", () => {
  joinBtn.disabled = true;
  statusEl.textContent = "Buscando rival...";
  socket.emit("join");
});

reloadBtn.addEventListener("click", () => location.reload());

// -------------------------

function connectSocket() {
  statusEl.textContent =
    "Conectando… (si Render estaba dormido, espera 20–60s)";

  socket = io({
    transports: ["websocket", "polling"],
    timeout: 20000,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 3000,
  });

  socket.on("connect", () => {
    joinBtn.disabled = false;
    statusEl.textContent = "Conectado ✅. Presiona “Entrar a jugar”.";
  });

  socket.on("connect_error", () => {
    joinBtn.disabled = true;
    statusEl.textContent =
      "El servidor está despertando 😴… espera unos segundos y recarga (Ctrl+F5).";
  });

  socket.on("reconnect_attempt", () => {
    joinBtn.disabled = true;
    statusEl.textContent = "Reconectando…";
  });

  socket.on("reconnect", () => {
    joinBtn.disabled = false;
    statusEl.textContent = "Reconectado ✅. Presiona “Entrar a jugar”.";
  });

  // Eventos del juego
  socket.on("waiting", (data) => {
    statusEl.textContent = data.message || "Esperando a otro jugador...";
  });

  socket.on("assigned", (data) => {
    mySymbol = data.symbol;
    statusEl.textContent = `¡Listo! Tú eres ${mySymbol}.`;
  });

  socket.on("state", (newState) => {
    state = newState;
    render();
  });

  socket.on("game_over", ({ winner }) => {
    setAllCellsDisabled(true);

    if (winner === null) {
      statusEl.textContent = "Empate 🙂. Presiona “Reiniciar” para jugar otra vez.";
    } else if (winner === mySymbol) {
      statusEl.textContent = "¡Ganaste! 🎉 Presiona “Reiniciar” para jugar otra vez.";
    } else {
      statusEl.textContent = "Perdiste 😅. Presiona “Reiniciar” para jugar otra vez.";
    }
  });

  socket.on("opponent_left", (data) => {
    setAllCellsDisabled(true);
    statusEl.textContent = data.message || "Tu rival se desconectó.";
  });
}

function render() {
  if (!state) return;

  // Pintar tablero
  for (let i = 0; i < 9; i++) {
    const value = state.board[i] || "";
    cells[i].textContent = value;

    cells[i].classList.remove("x", "o");
    if (value === "X") cells[i].classList.add("x");
    if (value === "O") cells[i].classList.add("o");
  }

  // ¿Me toca?
  const myTurn =
    mySymbol &&
    state.status === "playing" &&
    state.turn === mySymbol;

  setAllCellsDisabled(!myTurn);

  if (state.status === "playing" && mySymbol) {
    statusEl.textContent = myTurn
      ? `Tu turno (${mySymbol}).`
      : `Turno del rival (${state.turn}).`;
  }
}

function setAllCellsDisabled(disabled) {
  for (const cell of cells) cell.disabled = disabled;
}
