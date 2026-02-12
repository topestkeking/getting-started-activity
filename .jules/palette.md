# Palette UX & Accessibility Journal

## 2026-02-12 - [Discord Social SDK & Activities UX]

### Learnings:
- **Discord Social SDK Integration**: Using `setActivity` for Rich Presence significantly improves engagement by broadcasting the game state to friends.
- **Activity Layout Management**: Subscribing to `ACTIVITY_LAYOUT_MODE_UPDATE` and `ORIENTATION_UPDATE` is essential for creating a "robust" activity that works in PIP and mobile views.
- **Focus Management**: In vanilla JS apps using `innerHTML` for re-rendering, capturing and restoring `document.activeElement` via data attributes is crucial for keyboard accessibility.
- **User-Centric Feedback**: "Dopamine Max" experience is achieved through satisfying CSS transitions, visual cues (like move highlights), and celebratory UI (winner announcement animations).
- **Spectator Experience**: Providing a clear "Join" path for spectators when slots are available keeps the activity dynamic and social.

### Patterns:
- **Board Flipping**: Automatically reversing the board rendering for the player at the "top" (Black) ensures they always look "down" the board, improving spatial awareness and UX.
- **Invite Flow**: Always provide an in-game "Invite" button calling `discordSdk.commands.openInviteDialog` to lower friction for social growth.
- **ARIA Labels**: Dynamic ARIA labels for game pieces (e.g., "A1: Red King") provide context for screen reader users.
