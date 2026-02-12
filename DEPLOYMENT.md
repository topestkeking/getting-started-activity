# Discord Activity Deployment Summary

This document summarizes the progress against the Discord Activity requirements and lists missing steps for a live launch.

## Progress vs GitHub Template
- [x] **SDK Initialization**: Correctly instantiated and awaited `ready()`.
- [x] **Authentication Handshake**: Implemented `authorize` and `authenticate` flow with backend token exchange.
- [x] **Multiplayer Sync**: Integrated Socket.io for authoritative game state.
- [x] **Social Integration**: Implemented `openInviteDialog` and `getInstanceConnectedParticipants`.
- [x] **Rich Presence**: Implemented `setActivity` to show match status.
- [x] **Cross-Platform Compatibility**:
    - [x] **Desktop**: Enabled interactive PIP via `setConfig`.
    - [x] **Mobile**: Implemented orientation locking (`LANDSCAPE`) via `setOrientationLockState`.
    - [x] **Layout Handlers**: Added listeners for `ACTIVITY_LAYOUT_MODE_UPDATE` and `ORIENTATION_UPDATE`.
- [x] **Accessibility**: Added ARIA labels and focus restoration patterns.
- [x] **Asset Management**: Refactored image references into a `assets.json` manifest for easy customization.

## Missing Requirements for "Live" Launch

### 1. Discord Developer Portal Configuration
- **URL Mapping**: Must map the production URL (e.g., `https://my-activity.com`) in the "URL Mappings" section.
- **Redirect URI**: Set `https://127.0.0.1` (or your production callback) in the OAuth2 section.
- **Scopes**: Ensure the app is configured for `identify`, `guilds`, `applications.commands`, and `role_connections.write`.
- **Installation Contexts**: Enable both "User Install" and "Guild Install" in the **Installation** tab.

### 2. Linked Roles Setup
1. In the Developer Portal, go to **Linked Roles**.
2. Add the following metadata fields:
   - `wins` (Integer): Matches Won
   - `matches` (Integer): Total Matches Played
3. Set the **Linked Roles Verification URL** to `https://your-domain.com/linked-role-verify`. (Note: You may need a dedicated endpoint for the "Link" button in Discord settings, but the `PUT` endpoint is already implemented for syncing).

### 3. Environment & Hosting
- **SSL/HTTPS**: The Activity must be served over HTTPS.
- **Production Secrets**: Ensure `VITE_DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are securely set in the production environment (not checked into source).
- **Domain Verification**: Verify the hosting domain in the Discord Dev Portal if required for specific features.

### 3. Review Process
- **Discord Review**: Submit the Activity for review through the Developer Portal once all tests pass in a production-like sandbox.

### 4. Gateway Integration (Backend)
- **Bot Token**:
  1. Go to the **Bot** tab in the Developer Portal.
  2. Click **Reset Token** to get a new token.
  3. Add `DISCORD_BOT_TOKEN=your_token_here` to your `.env` file.
- **Intents**:
  1. Scroll down to **Privileged Gateway Intents**.
  2. Enable **Server Members Intent** if you want to track participant metadata beyond what the Activity SDK provides.
  3. Ensure the `intents` bitmask in `server/server.js` (currently `513`) matches your requirements.

## Final Deployment Estimate
- **Portal Configuration**: 30 mins (URL Mapping, Scopes, Linked Roles).
- **Production Hosting**: 1 hour (SSL, Environment setup).
- **Asset Customization**: 1-2 hours (if replacing visuals).
- **Total**: ~4 hours until live (excluding Discord Review time).

## Customization Instructions
- To replace game assets, simply drop new images into the `client/` directory and update the mapping in `client/assets.json`.
