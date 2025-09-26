# Subspace Commander

## Overview
Subspace Commander is a browser-based, real-time space combat demo served from a Node.js backend. Players fly classic Subspace-style ships, gather power-ups, and battle in a shared arena via WebSockets.

## Getting Started
1. Install dependencies once: `npm install`
2. Launch the HTTPS/WebSocket server: `npm start`
3. Open `https://localhost:8443/subspace.html` in a modern browser. Accept the self-signed certificate when prompted.
4. (Optional) Connect an additional client or bot with `node x-example.js` to exercise multiplayer flows.

## Core Mechanics
- **Ship Handling:** Ships use thrust-based movement with collision checks sized to the sprite; the ship hitbox is padded ~10% for consistent bullet and wall interactions.
- **Power-Ups:** Collect floating upgrades to boost stats. Weapon upgrades now progress through all six tiers (Red → Green+) instead of stopping at level 2.
- **Bounty System:** Your bounty increases by 50 every minute of survival. In multiplayer, the killer receives the greater of (victim bounty) or (current bounty +250) to keep firefights rewarding. Bounty updates propagate to all connected clients.
- **Bombs & Walls:** Bombs detonate with shrapnel, and deployable walls block ships and projectiles, matching Subspace expectations.

## Development Notes
- The server runs from `server.js` using Express + `ws`; game logic lives in `subspace.html`.
- Static assets are served directly from the project root. Keep additional art under `assets/` and ship skins under `skins/`.
- Automated tests are not wired up yet. For verification, run the browser client alongside `x-example.js` to simulate a second pilot.
- Example tooling (`x-example.js`) is for reference only; no edits are required for gameplay features.

## Recent Tweaks
- Enlarged ship and power-up hitboxes for more forgiving collisions.
- Ensured multiplayer bounty rewards reflect kills while keeping the passive bounty timer intact.
- Allowed weapon upgrades to continue through all bullet tiers so late-game firepower scales as intended.
