import express from "express";
import dotenv from "dotenv";
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
    // Exchange the code for an access_token
    // Using native fetch for better performance and connection pooling
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

    // Retrieve the access_token from the response
    const { access_token } = await response.json();

    if (!access_token) {
      return res.status(502).send({ error: "No access token received from Discord" });
    }

    // Return the access_token to our client as { access_token: "..."}
    res.send({ access_token });
  } catch (error) {
    console.error("Error exchanging token:", error);
    res.status(500).send({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
