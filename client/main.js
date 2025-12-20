// Si por alguna razón el CDN no cargó, avisamos
if (typeof io === "undefined") {
  alert("No cargó Socket.IO 😅. Recarga con Ctrl+F5.");
}

let socket = null;

let mySymbol = null; // 'X' o 'O'
let myName = null;
let state = null;

const statusEl = document.getElementById("status");
const joinBtn = document.getElementById("join");
const reloadBtn = document.getElementById("reload");
const boardEl = document.getElementById("board");

// Chat elements
const chatMessagesEl = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');

// ===== Tablero: 9 casillas =====
const cells = [];
for (let i = 0; i < 9; i++) {
  const btn = document.createElement('button');
  btn.className = 'cell';

  btn.addEventListener('click', () => {
    if (!state) return;
    if (!mySymbol) return;
    if (state.status !== "playing") return;
    if (state.turn !== mySymbol) return;

    socket.emit("move", { index: i });
  });

  boardEl.appendChild(btn);
  cells.push(btn);
}

// ===== Botones =====
joinBtn.addEventListener('click', () => {
  // Pedimos nombre una vez
  if (!myName) {
    const n = prompt('¿Cómo te llamas? (máx 20 letras)') || '';
    myName = n.trim().slice(0, 20) || 'Jugador';
  }

  joinBtn.disabled = true;
  statusEl.textContent = 'Conectando...';

  socket.emit('join', { name: myName });
});

reloadBtn.addEventListener("click", () => location.reload());

// ===== Chat enviar =====
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = (chatInput.value || '').trim();
  if (!text) return;

  socket.emit('chat_send', { text });
  chatInput.value = '';
});

// ===== Recibir del servidor =====
socket.on('waiting', (data) => {
  statusEl.textContent = data.message || 'Esperando a otro jugador...';
});

socket.on('assigned', (data) => {
  mySymbol = data.symbol;
  statusEl.textContent = `¡Listo! Tú eres ${mySymbol}.`;
  setChatEnabled(true);
});

  socket = io({
    transports: ["websocket", "polling"],
    timeout: 20000,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 3000,
  });

socket.on('game_over', ({ winner }) => {
  if (winner === null) {
    statusEl.textContent = 'Empate 🙂. Presiona “Reiniciar” para jugar otra vez.';
  } else if (winner === mySymbol) {
    statusEl.textContent = '¡Ganaste! 🎉 Presiona “Reiniciar” para jugar otra vez.';
  } else {
    statusEl.textContent = 'Perdiste 😅. Presiona “Reiniciar” para jugar otra vez.';
  }

  // Bloquear tablero
  for (const cell of cells) cell.disabled = true;
});

socket.on('opponent_left', (data) => {
  statusEl.textContent = data.message || 'Tu rival se desconectó. Recarga para volver a jugar.';
  for (const cell of cells) cell.disabled = true;
  setChatEnabled(false);
});

// ===== Chat recibir =====
socket.on('chat_history', (messages) => {
  chatMessagesEl.innerHTML = '';
  if (Array.isArray(messages)) {
    for (const msg of messages) addChatMessage(msg);
    scrollChatToBottom();
  }
});

socket.on('chat_message', (msg) => {
  addChatMessage(msg);
  scrollChatToBottom();
});

// ===== Render tablero =====
function render() {
  if (!state) return;

  for (let i = 0; i < 9; i++) {
    const value = state.board[i] || '';
    cells[i].textContent = value;

    cells[i].classList.remove('x', 'o');
    if (value === 'X') cells[i].classList.add('x');
    if (value === 'O') cells[i].classList.add('o');
  }

  const myTurn = mySymbol && state.status === 'playing' && state.turn === mySymbol;

  for (const cell of cells) {
    cell.disabled = !myTurn;
  }

  if (state.status === 'playing' && mySymbol) {
    statusEl.textContent = myTurn
      ? `Tu turno (${mySymbol}).`
      : `Turno del rival (${state.turn}).`;
  }
}

// ===== Chat UI helpers =====
function setChatEnabled(enabled) {
  chatInput.disabled = !enabled;
  chatSend.disabled = !enabled;
  if (enabled) chatInput.focus();
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function addChatMessage(msg) {
  const wrapper = document.createElement('div');
  wrapper.className = 'msg';

  // Mensaje del sistema
  if (msg?.kind === 'system') {
    wrapper.classList.add('system');

    const top = document.createElement('div');
    top.className = 'msgTop';

    const time = document.createElement('span');
    time.textContent = `[${formatTime(msg.ts)}]`;
    top.appendChild(time);

    const text = document.createElement('div');
    text.className = 'msgText';
    text.textContent = msg.text || '';

    wrapper.appendChild(top);
    wrapper.appendChild(text);
    chatMessagesEl.appendChild(wrapper);
    return;
  }

  // Mensaje normal (usuario)
  const isMine = msg?.fromSymbol === mySymbol;
  if (isMine) wrapper.classList.add('mine');

  const top = document.createElement('div');
  top.className = 'msgTop';

  const time = document.createElement('span');
  time.textContent = `[${formatTime(msg.ts)}]`;

  const who = document.createElement('span');
  const fromName = msg.fromName || 'Jugador';
  const fromSymbol = msg.fromSymbol || '?';
  who.textContent = `${fromName} (${fromSymbol})`;

  top.appendChild(time);
  top.appendChild(who);

  const text = document.createElement('div');
  text.className = 'msgText';
  text.textContent = msg.text || '';

  wrapper.appendChild(top);
  wrapper.appendChild(text);

  chatMessagesEl.appendChild(wrapper);
}

function scrollChatToBottom() {
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

// ===== CHAT: modo flotante + arrastrar + guardar posición =====
const chatBox = document.querySelector('.chat');
const chatHandle = document.getElementById('chatHandle');
const chatToggle = document.getElementById('chatToggle');

const CHAT_FLOAT_KEY = 'chatFloating';
const CHAT_POS_KEY = 'chatPos';

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

function setFloating(on){
  if (!chatBox) return;

  if (on) {
    chatBox.classList.add('floating');
    chatToggle.textContent = '📌';
    chatToggle.title = 'Acoplar chat';

    // cargar posición guardada
    const saved = localStorage.getItem(CHAT_POS_KEY);
    if (saved) {
      try {
        const p = JSON.parse(saved);
        chatBox.style.left = p.left + 'px';
        chatBox.style.top = p.top + 'px';
      } catch {}
    } else {
      // posición por defecto
      chatBox.style.left = '24px';
      chatBox.style.top = '120px';
    }

    // guardar estado
    localStorage.setItem(CHAT_FLOAT_KEY, '1');
    keepChatInsideScreen();
  } else {
    chatBox.classList.remove('floating');
    chatToggle.textContent = '📌';
    chatToggle.title = 'Poner chat flotante';

    // limpiar estilos de posición para volver al layout normal
    chatBox.style.left = '';
    chatBox.style.top = '';
    chatBox.style.width = '';
    chatBox.style.height = '';

    localStorage.setItem(CHAT_FLOAT_KEY, '0');
    localStorage.removeItem(CHAT_POS_KEY);
  }
}

function isFloating(){
  return chatBox && chatBox.classList.contains('floating');
}

function keepChatInsideScreen(){
  if (!chatBox || !isFloating()) return;

  const rect = chatBox.getBoundingClientRect();
  const maxLeft = window.innerWidth - rect.width - 8;
  const maxTop = window.innerHeight - rect.height - 8;

  const left = clamp(rect.left, 8, Math.max(8, maxLeft));
  const top = clamp(rect.top, 8, Math.max(8, maxTop));

  chatBox.style.left = left + 'px';
  chatBox.style.top = top + 'px';

  localStorage.setItem(CHAT_POS_KEY, JSON.stringify({ left, top }));
}

// Toggle flotante
if (chatToggle) {
  chatToggle.addEventListener('click', () => {
    setFloating(!isFloating());
  });
}

// Drag (arrastrar) usando pointer events
let dragging = false;
let offsetX = 0;
let offsetY = 0;

if (chatHandle) {
  chatHandle.addEventListener('pointerdown', (e) => {
    // No arrastrar si estás clickeando botones del header
    if (e.target.closest('button')) return;
    if (!isFloating()) return;

    dragging = true;
    const rect = chatBox.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    chatHandle.setPointerCapture(e.pointerId);
  });

  chatHandle.addEventListener('pointermove', (e) => {
    if (!dragging || !isFloating()) return;

    const rect = chatBox.getBoundingClientRect();
    const newLeft = e.clientX - offsetX;
    const newTop = e.clientY - offsetY;

    // límites
    const maxLeft = window.innerWidth - rect.width - 8;
    const maxTop = window.innerHeight - rect.height - 8;

    chatBox.style.left = clamp(newLeft, 8, Math.max(8, maxLeft)) + 'px';
    chatBox.style.top = clamp(newTop, 8, Math.max(8, maxTop)) + 'px';
  });

  chatHandle.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    keepChatInsideScreen();
  });

  chatHandle.addEventListener('pointercancel', () => {
    dragging = false;
    keepChatInsideScreen();
  });
}

// Al cambiar tamaño de ventana, que no se “pierda”
window.addEventListener('resize', keepChatInsideScreen);

// Al cargar: recordar si estaba flotante
(function loadChatState(){
  const v = localStorage.getItem(CHAT_FLOAT_KEY);
  if (v === '1') setFloating(true);
  else setFloating(false);
})();
