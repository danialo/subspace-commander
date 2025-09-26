# Repository Guidelines

## Project Structure & Module Organization
The realtime game server logic lives in `server.js`, and the browser client loads from `subspace.html`. Static art, bitmap maps, and audio are kept under `assets/`, while alternate ship textures reside in `skins/`. Keep generated or third-party files (`node_modules/`, `*.pem`) out of commits; only ship source, assets, and build scripts.

## Build, Test, and Development Commands
Run `npm install` once to pull the Express and WebSocket dependencies. Use `npm start` to launch the HTTPS + WebSocket server on port 8443; the game is then available at `https://localhost:8443/subspace.html`. The script `node x-example.js` provides a lightweight client you can adapt for debugging or load-testing player events.

## Coding Style & Naming Conventions
Match the existing CommonJS style with `const`/`let`, semicolons, and 4-space indentation. Use descriptive camelCase for variables (`playerId`, `targetPlayer`) and PascalCase only when introducing constructor-like helpers. Keep modules small—extend `server.js` via helper files under a new `lib/` directory if logic grows.

## Testing Guidelines
Automated tests are not yet wired in. When adding coverage, place integration tests beside new modules (e.g., `lib/ship-state.test.js`) and wire them to `npm test`. Always smoke-test WebSocket flows with two local clients (browser + `x-example.js`) before opening a pull request.

## Commit & Pull Request Guidelines
Follow the short, imperative commit style seen in history (e.g., `Fix viewport boundary issue`). Each pull request should summarize gameplay or networking changes, note any client-side asset updates, and include repro steps or screenshots when UI elements shift.

## Security & Configuration Tips
The bundled `cert.pem`/`key.pem` pair is for local use only; replace with environment-specific certificates in deployment configs. Never log sensitive player metadata, and prefer environment variables for future secrets rather than hardcoding.
