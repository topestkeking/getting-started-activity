import './style.css';
import { DiscordSDK } from "@discord/embedded-app-sdk";
import { io } from "socket.io-client";

let discordSdk;
let socket;
let auth;
let currentUser;
let gameState = null;
let selectedPiece = null; // {r, c}
let assets = {};

const PIECES = {
  EMPTY: 0,
  RED: 1,
  BLACK: 2,
  RED_KING: 3,
  BLACK_KING: 4,
};

async function loadAssets() {
  try {
    const response = await fetch('/assets.json');
    assets = await response.json();
    console.log('Assets loaded:', assets);
  } catch (e) {
    console.error('Failed to load assets manifest:', e);
  }
}

async function setupDiscord() {
  await loadAssets();
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
      'role_connections.write',
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

  // Cross-platform compatibility settings
  try {
    // Enable interactive PIP for desktop
    await discordSdk.commands.setConfig({ use_interactive_pip: true });

    // Lock orientation for mobile (Landscape is usually better for board games)
    await discordSdk.commands.setOrientationLockState({
      lock_state: 3, // LANDSCAPE
      picture_in_picture_lock_state: 3, // LANDSCAPE
      grid_lock_state: 1, // UNLOCKED
    });
  } catch (e) {
    console.warn('Cross-platform commands not supported in this environment', e);
  }

  // Subscribe to layout and orientation changes
  discordSdk.subscribe('ACTIVITY_LAYOUT_MODE_UPDATE', ({ layout_mode }) => {
    const app = document.querySelector('#app');
    if (layout_mode === 1) { // PIP
      app.classList.add('pip-mode');
    } else {
      app.classList.remove('pip-mode');
    }
  });

  discordSdk.subscribe('ORIENTATION_UPDATE', ({ screen_orientation }) => {
    const app = document.querySelector('#app');
    if (screen_orientation === 0) { // PORTRAIT
      app.classList.add('portrait-mode');
    } else {
      app.classList.remove('portrait-mode');
    }
  });
}

async function pushMetadata() {
  if (!auth || !currentUser) return;
  try {
    await fetch('/api/users/@me/metadata', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: auth.access_token, userId: currentUser.id }),
    });
    console.log('Metadata pushed to Discord');
  } catch (e) {
    console.error('Failed to push metadata:', e);
  }
}

async function updateRichPresence() {
  if (!gameState) return;
  const { game, players } = gameState;
  const redPlayer = players.find(p => p.role === PIECES.RED);
  const blackPlayer = players.find(p => p.role === PIECES.BLACK);

  let stateText = 'In a match';
  if (game.winner) {
    stateText = game.winner === PIECES.RED ? 'Red won!' : 'Black won!';
  } else if (redPlayer && blackPlayer) {
    stateText = `Red vs Black - Turn: ${game.turn === PIECES.RED ? 'Red' : 'Black'}`;
  } else {
    stateText = 'Waiting for players...';
  }

  await discordSdk.commands.setActivity({
    activity: {
      type: 0,
      details: 'Playing Checkers',
      state: stateText,
      assets: {
        large_image: assets.rocket || 'rocket',
        large_text: 'Checkers',
      },
    },
  });
}

async function handleInvite() {
  await discordSdk.commands.openInviteDialog();
}

function setupSocket() {
  socket = io();

  socket.on('connect', async () => {
    console.log('Connected to server');

    // Sync participants with Discord for accuracy
    const participants = await discordSdk.commands.getInstanceConnectedParticipants();
    console.log('Active participants:', participants);

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
    const prevWinner = gameState?.game?.winner;
    gameState = state;
    render();
    updateRichPresence();

    if (gameState.game.winner && !prevWinner) {
      pushMetadata();
    }
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
  const app = document.querySelector('#app'), active = document.activeElement?.dataset;
  if (!gameState) return (app.innerHTML = '<h1>Loading...</h1>');
  const { game, players } = gameState;
  const winAnnounce = game.winner ? `
    <div class="winner-announcement">
      <h2>🎉 ${game.winner === PIECES.RED ? 'RED' : 'BLACK'} WINS! 🎉</h2>
      <button onclick="socket.emit('reset', { instanceId: discordSdk.instanceId })">Play Again</button>
    </div>` : '';

  app.innerHTML = `
    ${winAnnounce}
    <main class="game-container">
      <header class="header">
        <div class="header-top">
          <h1>Checkers</h1>
          <button id="invite-btn" class="secondary" aria-label="Invite Friends">Invite 👥</button>
        </div>
        <div class="status" aria-live="polite">${getStatusText()}</div>
      </header>
      <div class="main-layout">
        <aside class="player-list side" aria-label="Players">
          ${players.map(p => `<div class="player-item ${game.turn === p.role ? 'active' : ''}" data-user-id="${p.id}">
            <img src="${getAvatarUrl(p)}" class="avatar" alt="${p.username}'s avatar" width="32" height="32" />
            <span>${p.global_name || p.username}</span> <span class="role">(${getRoleName(p.role)})</span>
          </div>`).join('')}
        </aside>
        <section class="board-container"><div class="board" role="grid">${renderBoard(game.board)}</div>
          <div class="controls">
            <div class="timer" id="timer-display">Time: ${gameState.timeLeft}s</div>
            <button id="cheer-btn" aria-label="Cheer">Cheer! 📣</button>
            <button id="reset-btn" aria-label="Reset Game">Reset Game</button>
            ${getSpectatorControls(players)}
          </div>
        </section>
      </div>
    </main>`;
  document.querySelectorAll('.cell').forEach(el => {
    el.onclick = () => handleCellClick(+el.dataset.r, +el.dataset.c);
    el.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), el.click());
  });
  document.getElementById('cheer-btn').onclick = () => socket.emit('cheer', { instanceId: discordSdk.instanceId });
  document.getElementById('reset-btn').onclick = () => confirm('Reset game?') && socket.emit('reset', { instanceId: discordSdk.instanceId });
  document.getElementById('invite-btn').onclick = handleInvite;
  const joinBtn = document.getElementById('join-btn');
  if (joinBtn) {
    joinBtn.onclick = () => socket.emit('join', {
      instanceId: discordSdk.instanceId,
      user: {
        id: currentUser.id,
        username: currentUser.username,
        avatar: currentUser.avatar,
        global_name: currentUser.global_name,
      }
    });
  }
  if (active?.r) document.querySelector(`.cell[data-r="${active.r}"][data-c="${active.c}"]`)?.focus();
}

function renderBoard(board) {
  const { players } = gameState;
  const myPlayer = players.find(p => p.id === currentUser.id);
  const shouldFlip = myPlayer?.role === PIECES.BLACK;

  let displayBoard = board.map((row, r) => row.map((piece, c) => ({ piece, r, c })));

  if (shouldFlip) {
    displayBoard = displayBoard.slice().reverse().map(row => row.slice().reverse());
  }

  return displayBoard.flatMap((row) => row.map(({ piece, r, c }) => {
    const isValid = isPossibleMove(r, c);
    return `
    <div class="cell ${(r + c) % 2 ? 'dark' : 'light'} ${selectedPiece?.r === r && selectedPiece?.c === c ? 'selected' : ''} ${isValid ? 'valid-move' : ''}"
         data-r="${r}" data-c="${c}" tabindex="0" role="gridcell" aria-label="${'ABCDEFGH'[c]}${8 - r}: ${getPieceDesc(piece)}">
      ${renderPiece(piece)}
    </div>`;
  })).join('');
}

function renderPiece(p) {
  if (p === PIECES.EMPTY) return '';
  return `<div class="piece ${p < 3 && p !== 0 ? (p === 1 ? 'red' : 'black') : (p === 3 ? 'red king' : 'black king')}" aria-hidden="true"></div>`;
}

function getPieceDesc(p) {
  if (p === PIECES.EMPTY) return 'Empty';
  return `${p === 1 || p === 3 ? 'Red' : 'Black'} ${p > 2 ? 'King' : 'Pawn'}`;
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
  const { game } = gameState;

  // Find if this cell is a valid destination for the selected piece
  return game.mandatoryJumpMoves.some(m =>
    m.from.r === selectedPiece.r && m.from.c === selectedPiece.c &&
    m.to.r === r && m.to.c === c
  ) || (game.mandatoryJumpMoves.length === 0 && canPieceMoveTo(selectedPiece, r, c));
}

function canPieceMoveTo(from, r, c) {
  const piece = gameState.game.board[from.r][from.c];
  const owner = getPieceOwner(piece);
  const isKing = piece === PIECES.RED_KING || piece === PIECES.BLACK_KING;

  if (gameState.game.board[r][c] !== PIECES.EMPTY) return false;

  const dr = r - from.r;
  const dc = Math.abs(c - from.c);

  if (dc !== 1) return false;

  if (owner === PIECES.RED || isKing) {
    if (dr === -1) return true;
  }
  if (owner === PIECES.BLACK || isKing) {
    if (dr === 1) return true;
  }
  return false;
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

function getSpectatorControls(players) {
  const myPlayer = players.find(p => p.id === currentUser.id);
  if (myPlayer && myPlayer.role !== 'spectator') return '';

  const redOccupied = players.some(p => p.role === PIECES.RED);
  const blackOccupied = players.some(p => p.role === PIECES.BLACK);

  if (!redOccupied || !blackOccupied) {
    return `<button id="join-btn" class="primary">Join Game ⚔️</button>`;
  }
  return '';
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
