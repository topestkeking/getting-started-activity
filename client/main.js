import './style.css';
import { DiscordSDK } from "@discord/embedded-app-sdk";
import { io } from "socket.io-client";

let discordSdk;
let socket;
let auth;
let currentUser;
let gameState = null;
let selectedPiece = null; // {r, c}

const PIECES = {
  EMPTY: 0,
  RED: 1,
  BLACK: 2,
  RED_KING: 3,
  BLACK_KING: 4,
};

async function setupDiscord() {
  discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);
  await discordSdk.ready();

  // Authorize with Discord Client
  const { code } = await discordSdk.commands.authorize({
    client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: [
      'identify',
      'guilds',
      'applications.commands.permissions.update',
    ],
  });

  // Retrieve an access_token from your activity's server
  const response = await fetch('/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });
  const { access_token } = await response.json();

  // Authenticate with the access_token
  auth = await discordSdk.commands.authenticate({ access_token });

  if (auth == null) {
    throw new Error('Authenticate command failed');
  }

  currentUser = auth.user;
}

function setupSocket() {
  socket = io();

  socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('join', {
      instanceId: discordSdk?.instanceId || 'test-instance',
      user: {
        id: currentUser.id,
        username: currentUser.username,
        avatar: currentUser.avatar,
        global_name: currentUser.global_name,
      }
    });
  });

  socket.on('state', (state) => {
    gameState = state;
    render();
  });

  socket.on('timer', (timeLeft) => {
    if (gameState) {
      gameState.timeLeft = timeLeft;
      updateTimerDisplay();
    }
  });

  socket.on('cheer', ({ userId }) => {
    showCheer(userId);
  });
}

function render() {
  const app = document.querySelector('#app');
  if (!gameState) {
    app.innerHTML = '<h1>Loading...</h1>';
    return;
  }

  const { game, players } = gameState;
  const myPlayer = players.find(p => p.id === currentUser.id);
  const isMyTurn = myPlayer && myPlayer.role === game.turn;

  let html = `
    <div class="game-container">
      <div class="header">
        <h1>Checkers</h1>
        <div class="status">${getStatusText()}</div>
      </div>

      <div class="main-layout">
        <div class="player-list side">
          <h3>Players</h3>
          ${players.map(p => `
            <div class="player-item ${game.turn === p.role ? 'active' : ''}" data-user-id="${p.id}">
              <img src="${getAvatarUrl(p)}" class="avatar" />
              <span>${p.global_name || p.username}</span>
              <span class="role">(${getRoleName(p.role)})</span>
            </div>
          `).join('')}
        </div>

        <div class="board-container">
          <div class="board">
            ${renderBoard(game.board)}
          </div>
          <div class="controls">
            <div class="timer" id="timer-display">Time: ${gameState.timeLeft}s</div>
            <button id="cheer-btn">Cheer! 📣</button>
            <button id="reset-btn">Reset Game</button>
          </div>
        </div>
      </div>
    </div>
  `;

  app.innerHTML = html;

  // Add event listeners
  document.querySelectorAll('.cell').forEach(cell => {
    cell.onclick = () => handleCellClick(parseInt(cell.dataset.r), parseInt(cell.dataset.c));
  });

  document.getElementById('cheer-btn').onclick = () => {
    socket.emit('cheer', { instanceId: discordSdk.instanceId });
  };

  document.getElementById('reset-btn').onclick = () => {
    socket.emit('reset', { instanceId: discordSdk.instanceId });
  };
}

function renderBoard(board) {
  let cells = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      const isDark = (r + c) % 2 === 1;
      const isSelected = selectedPiece && selectedPiece.r === r && selectedPiece.c === c;
      const isValidMove = isPossibleMove(r, c);

      cells += `
        <div class="cell ${isDark ? 'dark' : 'light'} ${isSelected ? 'selected' : ''} ${isValidMove ? 'valid-move' : ''}"
             data-r="${r}" data-c="${c}">
          ${renderPiece(piece)}
        </div>
      `;
    }
  }
  return cells;
}

function renderPiece(piece) {
  if (piece === PIECES.EMPTY) return '';
  const isRed = piece === PIECES.RED || piece === PIECES.RED_KING;
  const isKing = piece === PIECES.RED_KING || piece === PIECES.BLACK_KING;
  return `<div class="piece ${isRed ? 'red' : 'black'} ${isKing ? 'king' : ''}"></div>`;
}

function handleCellClick(r, c) {
  if (!gameState) return;
  const { game, players } = gameState;
  const myPlayer = players.find(p => p.id === currentUser.id);
  if (!myPlayer || myPlayer.role !== game.turn) return;

  const piece = game.board[r][c];
  const owner = getPieceOwner(piece);

  if (owner === myPlayer.role) {
    selectedPiece = { r, c };
    render();
  } else if (selectedPiece) {
    // Attempt move
    socket.emit('move', {
      instanceId: discordSdk.instanceId,
      from: selectedPiece,
      to: { r, c }
    });
    selectedPiece = null;
    // We don't render immediately, wait for server state
  }
}

function isPossibleMove(r, c) {
  if (!selectedPiece || !gameState) return false;
  // This is a simple client-side check to highlight potential moves.
  // The server has the final say.
  // For simplicity, we could just let the server decide everything,
  // but highlighting helps UX.
  const { game } = gameState;
  // We can't easily check all rules here without duplicating logic,
  // but we can check if it's one of the valid moves for the selected piece.
  // (Note: mandatory jumps make this tricky if we don't have full logic here)
  return false; // Disable highlighting for now to avoid bugs, or implement light version
}

function getPieceOwner(piece) {
  if (piece === PIECES.RED || piece === PIECES.RED_KING) return PIECES.RED;
  if (piece === PIECES.BLACK || piece === PIECES.BLACK_KING) return PIECES.BLACK;
  return null;
}

function getStatusText() {
  if (gameState.game.winner) {
    const winnerRole = gameState.game.winner;
    return `Winner: ${winnerRole === PIECES.RED ? 'RED' : 'BLACK'}! 🎉`;
  }
  return `Turn: ${gameState.game.turn === PIECES.RED ? 'RED' : 'BLACK'}`;
}

function getRoleName(role) {
  if (role === PIECES.RED) return 'Red';
  if (role === PIECES.BLACK) return 'Black';
  return 'Spectator';
}

function getAvatarUrl(user) {
  if (!user.avatar) return 'https://cdn.discordapp.com/embed/avatars/0.png';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
}

function updateTimerDisplay() {
  const el = document.getElementById('timer-display');
  if (el && gameState) {
    el.innerText = `Time: ${gameState.timeLeft}s`;
  }
}

function showCheer(userId) {
  const playerItem = document.querySelector(`.player-item[data-user-id="${userId}"]`);

  if (playerItem) {
    const cheer = document.createElement('span');
    cheer.innerText = ' 📣 CHEER!';
    cheer.className = 'cheer-popup';
    playerItem.appendChild(cheer);
    setTimeout(() => cheer.remove(), 2000);
  }
}

setupDiscord().then(() => {
  console.log("Discord SDK is ready");
  setupSocket();
}).catch(console.error);
