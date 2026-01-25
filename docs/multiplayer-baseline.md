# Multiplayer Baseline

## Current Architecture
- HTTPS + WebSocket server (`server.js`) relays state between clients; no physics or reconciliation occurs server-side.
- Browser client (`subspace.html`) stays authoritative for local simulation, pushes position/rotation deltas, and applies remote updates verbatim.
- Power-ups and bounty totals are tracked on the server, then rebroadcast to keep every client aligned.

## Connection Lifecycle
1. Player clicks "Join Multiplayer"; client instantiates `WebSocket('wss://172.233.149.241:8443')` (`subspace.html`).
2. Server allocates `playerId`, seeds default position `(4000,3000)`, stores `WebSocket` handle (`server.js`).
3. Server sends `init` with `playerId`, current power-ups, and a snapshot of other players.
4. Client hydrates remote ships, switches to authoritative power-up mode, and tracks bounty per `playerId`.
5. Server broadcasts `playerJoined` to everyone else.
6. Client teardown resets state on `close` or `error`; server broadcasts `playerDisconnected` when a socket closes.

## Message Types & Direction
- `playerUpdate` (client → server → other clients): position, rotation, thrust flag, optional `shipType`.
- `playerDamage` (attacker → server → victim): bullet hit meta.
- `bombDamage` (attacker → server → victim): bomb splash details.
- `bombExplosion` (client → server → others): explosion location/type for FX.
- `playerKilled` (victim → server → all): killer/victim bounty totals.
- `bountyUpdate` (client → server → all): bounty timer increments.
- `shipChange` (client ↔ server ↔ all): ship selection sync (currently hard-locked to type 1).
- `powerUpSpawn`, `powerUpCollected`, `powerUpDespawn` (server ↔ clients): authoritative item lifecycle.

## Update Cadence & Throttling
- Local ship broadcast fires when any of: moved >2px, rotated >0.02 rad, or 120 ms elapsed (`broadcastPlayerState`).
- Remote ships apply last packet immediately—no interpolation, smoothing, or prediction.
- Server rebroadcast is immediate; no rate limiting beyond client throttling.
- Power-ups spawn every 4000 ms up to 40 items; spawn validation avoids clustering near ships or edges.

## Data Structures
- `players` (`Map`) on server stores `{ws,x,y,bounty,shipType,powerUpsCollected}`.
- Client keeps `otherPlayers` (`Map`) keyed by `playerId`, each containing ship state used by renderer/physics.
- `powerUps` tracked on both sides, with server treating itself as source of truth when multiplayer is on.

## Current Pain Points & Risks
- Remote ships snap/warp because updates arrive sporadically and are applied instantly; no interpolation or buffering.
- Server trusts client-reported positions and velocities, enabling cheating and desync if packets drop or arrive late.
- No acknowledgement/sequence IDs; late packets can overwrite newer positions.
- Hard-coded WS URL prevents LAN/testing flexibility; reconnect tries require full page reset.
- Power-up authority flips between solo/multiplayer modes without diffing, making re-entry fragile after desync.

## Baseline Validation Checklist
- Dual-client session (browser + `node x-example.js`) to observe update frequency and packet order.
- Capture WebSocket traffic (e.g., browser devtools) to verify throttle behavior versus actual movement speed.
- Enable temporary logging on server broadcasts to measure per-second packet volume under typical movement.

## Proposed Next Steps (Draft)
1. Introduce sequence/timestamp metadata and client-side interpolation buffer for smoother remote motion.
2. Move toward server-authoritative physics (or at least validation) and dead-reckoning hints for clients.
3. Add configurable WS endpoint and reconnection/backoff logic for robustness.
4. Expand automated diagnostics (ping/RTT display, dropped packet counters) to aid future tuning.

## Roadmap & Milestones
1. **Telemetry & Environment Prep**
   - Add configurable WS endpoint + reconnect/backoff for dev/staging.
   - Instrument client/server logs for packet timing, sequence IDs, RTT.
   - Test: run dual-client session, capture logs to confirm sequence ordering.
2. **Movement Synchronization**
   - Ship `playerUpdate` sequence numbers + timestamps; drop stale packets on client.
   - Buffer remote updates (~100–150 ms) and interpolate/extrapolate positions.
   - Implement server-side relay throttling to cap broadcast rate, with catch-up packets on inactivity.
   - Test: simulate packet loss/delay (Chrome devtools throttling) and verify smooth motion.
3. **Server Authority & Validation**
   - Validate position deltas server-side (speed clamps, world bounds).
   - Move collision/damage adjudication to server or add reconciliation messages.
   - Persist authoritative bounty/power-up stats and reconcile on mismatch.
   - Test: fuzz client with scripted out-of-bounds packets; ensure server clamps and clients recover.
4. **Gameplay Feature Sync**
   - Sync minimap and new ship stats via shared state payloads.
   - Extend power-up spawning to support targeted spawns for testing scenarios.
   - Audit energy/thruster consumption events so updates are deterministic across clients.
   - Test: run regression checklist covering TODO items (minimap, boundaries, thruster tuning).
5. **Quality & Release Prep**
   - Draft smoke-test checklist; include latency scenarios and reconnect flows.
   - Prepare telemetry dashboards or log parsers for live sessions.
   - Document protocol changes and add version gating to avoid mixed-client issues.
