import express from "express";
import dotenv from "dotenv";
import { Server } from "socket.io";
import { createServer } from "http";
import { WebSocket } from "ws";
import {
  InteractionType,
  InteractionResponseType,
  verifyKeyMiddleware,
} from "discord-interactions";
import { CheckersGame, PIECES } from "./game.js";
import { updateUserData, storeOAuthTokens, getOAuthTokens, getUserData } from "./storage.js";

dotenv.config({ path: "../.env" });

const app = express();
const port = 3001;

// Allow express to parse JSON bodies
app.use(express.json());

app.post("/api/token", async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).send({ error: "Missing code" });
  }

  try {
    const response = await fetch(`https://discord.com/api/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.VITE_DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return res.status(response.status).send(errorData);
    }

    const tokens = await response.json();

    if (!tokens.access_token) {
      return res.status(502).send({ error: "No access token received from Discord" });
    }

    // We need the user ID to store tokens, so we'll fetch it if not provided
    // In a real app, you'd use a session or JWT
    const userResponse = await fetch(`https://discord.com/api/v10/users/@me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await userResponse.json();

    if (user.id) {
      storeOAuthTokens(user.id, tokens);
    }

    res.send({ access_token: tokens.access_token });
  } catch (error) {
    console.error("Error exchanging token:", error);
    res.status(500).send({ error: "Internal server error" });
  }
});

/**
 * Discord Interactions Endpoint
 */
app.post('/interactions', verifyKeyMiddleware(process.env.DISCORD_PUBLIC_KEY), (req, res) => {
  const { type, data, context, member, user } = req.body;

  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    if (name === 'Checkers Stats') {
      // User Command (context menu) or Slash Command
      // The target user for a User Command is in data.target_id
      const targetId = data.target_id || (user || member.user).id;
      const stats = getUserData(targetId);

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `📊 **Checkers Stats for <@${targetId}>**\n- Wins: ${stats.wins}\n- Total Matches: ${stats.matches}`,
        },
      });
    }
  }

  return res.status(400).send('Unknown interaction type');
});

app.put("/api/users/@me/metadata", async (req, res) => {
  const { access_token, userId } = req.body;
  if (!access_token || !userId) return res.status(400).send({ error: "Missing token or userId" });

  try {
    const { wins, matches } = updateUserData(userId, 0, 0); // Get current

    const response = await fetch(`https://discord.com/api/v10/users/@me/applications/${process.env.VITE_DISCORD_CLIENT_ID}/role-connection`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        platform_name: 'Checkers Deluxe',
        metadata: {
          wins,
          matches,
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return res.status(response.status).send(errorData);
    }

    res.send(await response.json());
  } catch (error) {
    console.error("Error updating metadata:", error);
    res.status(500).send({ error: "Internal server error" });
  }
});

/**
 * Route to initiate the Linked Role connection flow.
 */
app.get('/linked-role', (req, res) => {
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', process.env.VITE_DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', process.env.DISCORD_REDIRECT_URI || 'http://localhost:3001/linked-role-verify');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify role_connections.write');
  url.searchParams.set('prompt', 'consent');
  res.redirect(url.toString());
});

/**
 * Route that Discord redirects back to after the user has authorized the app for role connections.
 */
app.get('/linked-role-verify', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');

  try {
    const response = await fetch(`https://discord.com/api/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.VITE_DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI || 'http://localhost:3001/linked-role-verify',
      }),
    });

    const tokens = await response.json();
    if (!tokens.access_token) return res.status(502).send('Failed to exchange token');

    // Fetch user info to get the ID
    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await userRes.json();

    // Store tokens and sync metadata
    storeOAuthTokens(user.id, tokens);

    const { wins, matches } = updateUserData(user.id, 0, 0);
    await fetch(`https://discord.com/api/v10/users/@me/applications/${process.env.VITE_DISCORD_CLIENT_ID}/role-connection`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        platform_name: 'Checkers Deluxe',
        metadata: { wins, matches },
      }),
    });

    res.send('<h1>Success!</h1><p>Your Checkers stats are now linked to Discord. You can close this window.</p>');
  } catch (e) {
    console.error(e);
    res.status(500).send('Verification failed');
  }
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const gameStates = new Map(); // instanceId -> { game, players: Map, timer, timeLeft }

// --- Discord Gateway Client (Skeleton) ---
let gatewayWs = null;
let heartbeatInterval = null;

function setupGateway() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.warn("DISCORD_BOT_TOKEN not found. Gateway connection skipped.");
    return;
  }

  gatewayWs = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");

  gatewayWs.on("open", () => {
    console.log("Connected to Discord Gateway");
  });

  gatewayWs.on("message", (data) => {
    const payload = JSON.parse(data);
    const { op, d, t, s } = payload;

    switch (op) {
      case 10: // Hello
        const { heartbeat_interval } = d;
        startHeartbeat(heartbeat_interval);
        identify();
        break;
      case 11: // Heartbeat ACK
        // console.log("Heartbeat ACK received");
        break;
      case 0: // Dispatch
        handleEvent(t, d);
        break;
    }
  });

  gatewayWs.on("close", () => {
    console.log("Gateway connection closed. Reconnecting...");
    clearInterval(heartbeatInterval);
    setTimeout(setupGateway, 5000);
  });
}

function startHeartbeat(interval) {
  heartbeatInterval = setInterval(() => {
    gatewayWs.send(JSON.stringify({ op: 1, d: null }));
  }, interval);
}

function identify() {
  gatewayWs.send(JSON.stringify({
    op: 2,
    d: {
      token: process.env.DISCORD_BOT_TOKEN,
      intents: 513, // GUILD_MEMBERS | GUILDS (Example)
      properties: {
        os: "linux",
        browser: "my_activity_server",
        device: "my_activity_server"
      }
    }
  }));
}

function handleEvent(event, data) {
  // console.log("Received event:", event);
  if (event === "READY") {
    console.log("Gateway is READY!");
  }
}

setupGateway();
// ------------------------------------------

async function getAccessToken(userId) {
  const tokens = getOAuthTokens(userId);
  if (!tokens) return null;

  // Simple check for expiration (Discord tokens last 7 days)
  // For a robust app, you'd store the expiration timestamp
  // Here we'll just implement the refresh logic as a helper
  return tokens.access_token;
}

async function refreshToken(userId) {
  const tokens = getOAuthTokens(userId);
  if (!tokens?.refresh_token) return null;

  try {
    const response = await fetch(`https://discord.com/api/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.VITE_DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      }),
    });

    if (response.ok) {
      const newTokens = await response.json();
      storeOAuthTokens(userId, newTokens);
      return newTokens.access_token;
    }
  } catch (e) {
    console.error('Failed to refresh token for user', userId, e);
  }
  return null;
}

function broadcastState(instanceId) {
  const state = gameStates.get(instanceId);
  if (!state) return;

  io.to(instanceId).emit("state", {
    game: state.game.getState(),
    players: Array.from(state.players.values()),
    timeLeft: state.timeLeft,
  });
}

function resetTimer(instanceId) {
  const state = gameStates.get(instanceId);
  if (!state) return;

  state.timeLeft = 30;
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }

  if (!state.game.winner) {
    startTimer(instanceId);
  }
}

function startTimer(instanceId) {
  const state = gameStates.get(instanceId);
  if (!state || state.timer) return;

  state.timer = setInterval(() => {
    state.timeLeft--;
    if (state.timeLeft <= 0) {
      // Auto-switch turn
      state.game.turn = state.game.turn === PIECES.RED ? PIECES.BLACK : PIECES.RED;
      state.game.updateMandatoryJumps();
      state.game.checkWinner();
      resetTimer(instanceId);
      broadcastState(instanceId);
    } else {
      io.to(instanceId).emit("timer", state.timeLeft);
    }
  }, 1000);
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join", ({ instanceId, user }) => {
    socket.join(instanceId);

    if (!gameStates.has(instanceId)) {
      gameStates.set(instanceId, {
        game: new CheckersGame(),
        players: new Map(),
        timer: null,
        timeLeft: 30,
      });
    }

    const state = gameStates.get(instanceId);

    // Reconnection logic based on user.id
    let existingPlayer = [...state.players.values()].find((p) => p.id === user.id);

    if (existingPlayer) {
      // Update socket ID for reconnection
      state.players.delete(existingPlayer.socketId);
      existingPlayer.socketId = socket.id;
      state.players.set(socket.id, existingPlayer);
    } else {
      const redOccupied = [...state.players.values()].some((p) => p.role === PIECES.RED);
      const blackOccupied = [...state.players.values()].some((p) => p.role === PIECES.BLACK);

      let role;
      if (!redOccupied) role = PIECES.RED;
      else if (!blackOccupied) role = PIECES.BLACK;
      else role = "spectator";

      state.players.set(socket.id, { ...user, role, socketId: socket.id });
    }

    broadcastState(instanceId);
    if (!state.game.winner) startTimer(instanceId);
  });

  socket.on("move", ({ instanceId, from, to }) => {
    const state = gameStates.get(instanceId);
    if (!state || state.game.winner) return;

    const player = state.players.get(socket.id);
    if (!player || player.role !== state.game.turn) return;

    const moved = state.game.applyMove(from, to);
    if (moved) {
      resetTimer(instanceId);
      broadcastState(instanceId);

      // Handle winner metadata update
      if (state.game.winner) {
        const winner = [...state.players.values()].find(p => p.role === state.game.winner);
        const loser = [...state.players.values()].find(p => p.role !== state.game.winner && p.role !== 'spectator');

        if (winner) updateUserData(winner.id, 1, 1);
        if (loser) updateUserData(loser.id, 0, 1);

        console.log(`Game over in ${instanceId}. Winner: ${winner?.username}`);
      }
    }
  });

  socket.on("cheer", ({ instanceId }) => {
    const state = gameStates.get(instanceId);
    const player = state?.players.get(socket.id);
    if (player) {
      io.to(instanceId).emit("cheer", { userId: player.id });
    }
  });

  socket.on("reset", ({ instanceId }) => {
    const state = gameStates.get(instanceId);
    if (!state) return;

    // Only allow players to reset? Or anyone? Let's say anyone for now.
    state.game = new CheckersGame();
    resetTimer(instanceId);
    broadcastState(instanceId);
  });

  socket.on("disconnect", async () => {
    console.log("User disconnected:", socket.id);

    for (const [instanceId, state] of gameStates.entries()) {
      if (state.players.has(socket.id)) {
        // We could remove the player, but for reconnection we might want to keep them.
        // However, the rule is "Reset when everyone leaves".

        // Check how many people are still in the room
        const sockets = await io.in(instanceId).fetchSockets();
        if (sockets.length === 0) {
          console.log(`Cleaning up game for instance ${instanceId}`);
          if (state.timer) clearInterval(state.timer);
          gameStates.delete(instanceId);
        }
      }
    }
  });
});

httpServer.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
