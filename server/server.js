import express from "express";
import dotenv from "dotenv";
import { Server } from "socket.io";
import { createServer } from "http";
import { CheckersGame, PIECES } from "./game.js";

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

    const { access_token } = await response.json();

    if (!access_token) {
      return res.status(502).send({ error: "No access token received from Discord" });
    }

    res.send({ access_token });
  } catch (error) {
    console.error("Error exchanging token:", error);
    res.status(500).send({ error: "Internal server error" });
  }
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const gameStates = new Map(); // instanceId -> { game, players: Map, timer, timeLeft }

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
      state.game.skipTurn();
      resetTimer(instanceId);
      broadcastState(instanceId);
    } else {
      io.to(instanceId).emit("timer", state.timeLeft);
    }
  }, 1000);
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join", async ({ instanceId, accessToken }) => {
    socket.join(instanceId);

    let user;
    try {
      // Fetch user info from Discord API to verify identity (Security Best Practice)
      const response = await fetch(`https://discord.com/api/users/@me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      user = await response.json();

      if (!user.id) {
        throw new Error("Invalid token or user data");
      }
    } catch (error) {
      console.error("Failed to verify user:", error);
      return;
    }

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
    }
  });

  socket.on("getValidMoves", ({ instanceId, r, c }) => {
    const state = gameStates.get(instanceId);
    if (!state) return;
    const moves = state.game.getValidMoves(r, c);
    socket.emit("validMoves", { r, c, moves });
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
