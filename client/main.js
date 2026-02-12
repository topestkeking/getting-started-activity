import './style.css';
import { DiscordSDK, patchUrlMappings } from "@discord/embedded-app-sdk";
import { io } from "socket.io-client";
import rocketLogo from '/rocket.png';

// Use patchUrlMappings if needed (e.g. for production deployment)
if (typeof window !== 'undefined' && import.meta.env.PROD) {
  // In a real deployment, you would map your backend URL here
  // patchUrlMappings([{ prefix: '/api', target: 'your-app.com/api' }]);
}

let discordSdk;
let socket;
let auth;
let currentUser;
let gameState = null;
let selectedPiece = null; // {r, c}
let validMovesForSelected = []; // List of {to: {r, c}}

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
      accessToken: auth.access_token,
    });
  });

  socket.on('state', (state) => {
    gameState = state;
    // If the turn changed or board changed, clear selection
    selectedPiece = null;
    validMovesForSelected = [];
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

  socket.on('validMoves', ({ r, c, moves }) => {
    if (selectedPiece && selectedPiece.r === r && selectedPiece.c === c) {
      validMovesForSelected = moves;
      render();
    }
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
      ${game.winner ? renderWinnerOverlay() : ''}
      <div class="header">
        <img src="${rocketLogo}" class="logo" alt="Discord" width="48" height="48" />
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

        <div class="history-panel side">
          <h3>Recent Moves</h3>
          <div class="history-list">
            ${renderHistory(game.history)}
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

  const playAgainBtn = document.getElementById('play-again-btn');
  if (playAgainBtn) {
    playAgainBtn.onclick = () => {
      socket.emit('reset', { instanceId: discordSdk.instanceId });
    };
  }
}

function renderBoard(board) {
  let cells = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      const isDark = (r + c) % 2 === 1;
      const isSelected = selectedPiece && selectedPiece.r === r && selectedPiece.c === c;
      const isValidMove = validMovesForSelected.some(m => m.to.r === r && m.to.c === c);

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
    if (selectedPiece && selectedPiece.r === r && selectedPiece.c === c) {
      selectedPiece = null;
      validMovesForSelected = [];
      render();
    } else {
      selectedPiece = { r, c };
      validMovesForSelected = []; // Clear while waiting
      socket.emit('getValidMoves', { instanceId: discordSdk.instanceId, r, c });
      render();
    }
  } else if (selectedPiece) {
    // Attempt move
    const isValid = validMovesForSelected.some(m => m.to.r === r && m.to.c === c);
    if (isValid) {
      socket.emit('move', {
        instanceId: discordSdk.instanceId,
        from: selectedPiece,
        to: { r, c }
      });
      selectedPiece = null;
      validMovesForSelected = [];
    } else {
      selectedPiece = null;
      validMovesForSelected = [];
      render();
    }
  }
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

function renderHistory(history) {
  if (!history || history.length === 0) return '<div class="empty-history">No moves yet</div>';
  return [...history].reverse().map(h => {
    if (h.action === 'timeout') {
      return `<div class="history-item timeout">Turn skipped (Timeout)</div>`;
    }
    return `
      <div class="history-item">
        <span class="history-piece">${h.piece}</span>:
        ${h.from.r},${h.from.c} → ${h.to.r},${h.to.c}
        ${h.captured ? '<span class="history-captured"> (Capture!)</span>' : ''}
        ${h.promoted ? '<span class="history-promoted"> (King!)</span>' : ''}
      </div>
    `;
  }).join('');
}

function renderWinnerOverlay() {
  const winnerRole = gameState.game.winner;
  const winner = gameState.players.find(p => p.role === winnerRole);
  const name = winner ? (winner.global_name || winner.username) : (winnerRole === PIECES.RED ? 'RED' : 'BLACK');

  return `
    <div class="overlay">
      <div class="overlay-content">
        <h2>🎉 ${name} Wins! 🎉</h2>
        <button id="play-again-btn">Play Again</button>
      </div>
    </div>
  `;
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
