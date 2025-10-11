const WebSocket = require('ws');
const https = require('https');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// SSL certificates
const serverOptions = {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem')
};

const server = https.createServer(serverOptions, app);

// Serve static files
app.use(express.static(__dirname));

const wss = new WebSocket.Server({ server });
const players = new Map();
const SHIP_SELECTION_ENABLED = true;
const DEFAULT_SHIP_TYPE = 1;
const WORLD_WIDTH = 8000;
const WORLD_HEIGHT = 5200;
const DEFAULT_MAX_ENERGY = 1100;
const PLAYFIELD_VERTICAL_MARGIN = 120;
const PLAYFIELD_TOP = PLAYFIELD_VERTICAL_MARGIN;
const PLAYFIELD_BOTTOM = WORLD_HEIGHT - PLAYFIELD_VERTICAL_MARGIN;
const DEFAULT_SHIP_MARGIN = 20;
const WARP_BEACON_LIFETIME_MS = 180000;
const SAFE_ZONE = {
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2,
    radius: 250
};
const ENERGY_TOLERANCE = 1;
const SAFE_ZONE_RADIUS_SQUARED = SAFE_ZONE.radius * SAFE_ZONE.radius;

function isInSafeZone(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return false;
    }
    const dx = x - SAFE_ZONE.x;
    const dy = y - SAFE_ZONE.y;
    return (dx * dx + dy * dy) <= SAFE_ZONE_RADIUS_SQUARED;
}

function clampShipPosition(x, y, margin = DEFAULT_SHIP_MARGIN) {
    const minX = margin;
    const maxX = WORLD_WIDTH - margin;
    const minY = PLAYFIELD_TOP + margin;
    const maxY = PLAYFIELD_BOTTOM - margin;

    const clampedX = Math.max(minX, Math.min(maxX, Number.isFinite(x) ? x : SAFE_ZONE.x));
    const clampedY = Math.max(minY, Math.min(maxY, Number.isFinite(y) ? y : SAFE_ZONE.y));
    return { x: clampedX, y: clampedY };
}

function sanitizeWarpBeacon(beacon) {
    if (!beacon) {
        return null;
    }
    const now = Date.now();
    if (!Number.isFinite(beacon.x) || !Number.isFinite(beacon.y) || !Number.isFinite(beacon.expiresAt)) {
        return null;
    }
    if (typeof beacon.id !== 'string') {
        return null;
    }
    if (now > beacon.expiresAt) {
        return null;
    }
    return {
        id: beacon.id,
        x: beacon.x,
        y: beacon.y,
        createdAt: Number.isFinite(beacon.createdAt) ? beacon.createdAt : now,
        expiresAt: beacon.expiresAt
    };
}

wss.on('connection', function connection(ws, req) {
    const playerId = Math.random().toString(36).substr(2, 9);
    players.set(playerId, {
        ws,
        id: playerId,
        x: SAFE_ZONE.x,
        y: SAFE_ZONE.y,
        bounty: 0,
        shipType: DEFAULT_SHIP_TYPE,
        energy: DEFAULT_MAX_ENERGY,
        maxEnergy: DEFAULT_MAX_ENERGY,
        warpBeacon: null
    });

    console.log(`Player ${playerId} connected from ${req.socket.remoteAddress}`);

    // Send init message to new player with their ID and existing players
    const existingPlayers = [];
    players.forEach((player, id) => {
        if (id !== playerId) {
            existingPlayers.push({
                id,
                x: player.x,
                y: player.y,
                bounty: player.bounty || 0,
                shipType: player.shipType || 1,
                warpBeacon: sanitizeWarpBeacon(player.warpBeacon)
            });
        }
    });

    ws.send(JSON.stringify({
        type: 'init',
        playerId: playerId,
        players: existingPlayers,
        safeZone: SAFE_ZONE,
        world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
        selfWarpBeacon: sanitizeWarpBeacon(players.get(playerId).warpBeacon),
        shipSelectionEnabled: SHIP_SELECTION_ENABLED
    }));

    // Notify other players about new player
    const joinData = {
        type: 'playerJoined',
        player: {
            id: playerId,
            x: SAFE_ZONE.x,
            y: SAFE_ZONE.y,
            bounty: players.get(playerId).bounty || 0,
            shipType: players.get(playerId).shipType || 1
        }
    };

    players.forEach((player, id) => {
        if (id !== playerId && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify(joinData));
        }
    });

    ws.on('message', function incoming(data) {
        try {
            const message = JSON.parse(data);

            if (message.type === 'playerUpdate') {
                const player = players.get(playerId);
                if (player) {
                    const clampedPos = clampShipPosition(message.x, message.y);
                    player.x = clampedPos.x;
                    player.y = clampedPos.y;
                    message.x = player.x;
                    message.y = player.y;
                    if (SHIP_SELECTION_ENABLED) {
                        const parsedShipType = Number(message.shipType);
                        if (Number.isFinite(parsedShipType)) {
                            const normalized = Math.min(8, Math.max(1, Math.floor(parsedShipType)));
                            player.shipType = normalized;
                            message.shipType = normalized;
                        } else if (Number.isFinite(player.shipType)) {
                            message.shipType = Math.min(8, Math.max(1, Math.floor(player.shipType)));
                        } else {
                            player.shipType = DEFAULT_SHIP_TYPE;
                            message.shipType = DEFAULT_SHIP_TYPE;
                        }
                    } else {
                        player.shipType = DEFAULT_SHIP_TYPE;
                        message.shipType = DEFAULT_SHIP_TYPE;
                    }
                    if (Number.isFinite(Number(message.energy))) {
                        player.energy = Number(message.energy);
                    }
                    if (Number.isFinite(Number(message.maxEnergy))) {
                        player.maxEnergy = Number(message.maxEnergy);
                    }
                }
                // Broadcast to all other players
                const updateData = {
                    type: 'playerUpdate',
                    id: playerId,
                    ...message
                };

                players.forEach((player, id) => {
                    if (id !== playerId && player.ws.readyState === WebSocket.OPEN) {
                        player.ws.send(JSON.stringify(updateData));
                    }
                });
            } else if (message.type === 'bomb') {
                const bombData = {
                    type: 'bomb',
                    playerId,
                    x: Number(message.x),
                    y: Number(message.y),
                    vx: Number(message.vx),
                    vy: Number(message.vy),
                    bombType: message.bombType,
                    color: message.color,
                    weaponLevel: message.weaponLevel,
                    isMine: !!message.isMine,
                    createdAt: message.createdAt,
                    bombId: message.bombId
                };

                if (!Number.isFinite(bombData.x) || !Number.isFinite(bombData.y) ||
                    !Number.isFinite(bombData.vx) || !Number.isFinite(bombData.vy)) {
                    return;
                }

                players.forEach((playerEntry, id) => {
                    if (id !== playerId && playerEntry.ws.readyState === WebSocket.OPEN) {
                        playerEntry.ws.send(JSON.stringify(bombData));
                    }
                });
            } else if (message.type === 'bullet') {
                const bulletData = {
                    type: 'bullet',
                    playerId,
                    x: Number(message.x),
                    y: Number(message.y),
                    vx: Number(message.vx),
                    vy: Number(message.vy),
                    weaponLevel: Number(message.weaponLevel) || 0
                };

                if (!Number.isFinite(bulletData.x) || !Number.isFinite(bulletData.y) ||
                    !Number.isFinite(bulletData.vx) || !Number.isFinite(bulletData.vy)) {
                    return;
                }

                players.forEach((playerEntry, id) => {
                    if (id !== playerId && playerEntry.ws.readyState === WebSocket.OPEN) {
                        playerEntry.ws.send(JSON.stringify(bulletData));
                    }
                });
            } else if (message.type === 'burst') {
                const burstX = Number(message.x);
                const burstY = Number(message.y);
                if (!Number.isFinite(burstX) || !Number.isFinite(burstY)) {
                    return;
                }

                const burstData = {
                    type: 'burst',
                    playerId,
                    x: burstX,
                    y: burstY,
                    radius: Number(message.radius),
                    force: Number(message.force),
                    shipSpeedMultiplier: Number(message.shipSpeedMultiplier),
                    bombSpeedCap: Number(message.bombSpeedCap),
                    bulletSpeedCap: Number(message.bulletSpeedCap),
                    shipBoostDuration: Number(message.shipBoostDuration)
                };

                players.forEach((playerEntry) => {
                    if (playerEntry.ws.readyState === WebSocket.OPEN) {
                        playerEntry.ws.send(JSON.stringify(burstData));
                    }
                });
            } else if (message.type === 'warpToSafe') {
                const player = players.get(playerId);
                if (!player) {
                    return;
                }

                const reportedEnergy = Number(message.energy);
                if (Number.isFinite(reportedEnergy)) {
                    player.energy = reportedEnergy;
                }
                const reportedMaxEnergy = Number(message.maxEnergy);
                if (Number.isFinite(reportedMaxEnergy)) {
                    player.maxEnergy = reportedMaxEnergy;
                }

                const effectiveMaxEnergy = Number.isFinite(player.maxEnergy) ? player.maxEnergy : DEFAULT_MAX_ENERGY;
                const effectiveEnergy = Number.isFinite(player.energy) ? player.energy : effectiveMaxEnergy;
                const tolerance = Math.max(ENERGY_TOLERANCE, effectiveMaxEnergy * 0.001);

                if (!Number.isFinite(effectiveEnergy) || effectiveEnergy + tolerance < effectiveMaxEnergy) {
                    if (player.ws.readyState === WebSocket.OPEN) {
                        player.ws.send(JSON.stringify({
                            type: 'warpDenied',
                            reason: 'insufficientEnergy'
                        }));
                    }
                    return;
                }

                player.x = SAFE_ZONE.x;
                player.y = SAFE_ZONE.y;

                const warpData = {
                    type: 'playerWarped',
                    playerId,
                    x: SAFE_ZONE.x,
                    y: SAFE_ZONE.y,
                    energy: effectiveEnergy,
                    maxEnergy: effectiveMaxEnergy,
                    serverTimestamp: Date.now()
                };

                players.forEach((playerEntry) => {
                    if (playerEntry.ws.readyState === WebSocket.OPEN) {
                        playerEntry.ws.send(JSON.stringify(warpData));
                    }
                });
            } else if (message.type === 'warpSet') {
                const player = players.get(playerId);
                if (!player) {
                    return;
                }

                const rawX = Number(message.x);
                const rawY = Number(message.y);
                if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'warpSetFailed',
                            playerId,
                            reason: 'invalid'
                        }));
                    }
                    return;
                }

                const clampedPos = clampShipPosition(rawX, rawY);
                if (isInSafeZone(clampedPos.x, clampedPos.y)) {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'warpSetFailed',
                            playerId,
                            reason: 'safezone'
                        }));
                    }
                    return;
                }

                const beaconId = typeof message.beaconId === 'string'
                    ? message.beaconId
                    : `warp_${Date.now().toString(36)}`;
                const createdAt = Date.now();
                player.warpBeacon = {
                    id: beaconId,
                    x: clampedPos.x,
                    y: clampedPos.y,
                    createdAt,
                    expiresAt: createdAt + WARP_BEACON_LIFETIME_MS
                };

                const payload = {
                    type: 'warpSet',
                    playerId,
                    beaconId,
                    x: player.warpBeacon.x,
                    y: player.warpBeacon.y,
                    createdAt: player.warpBeacon.createdAt,
                    expiresAt: player.warpBeacon.expiresAt
                };

                players.forEach((playerEntry) => {
                    if (playerEntry.ws.readyState === WebSocket.OPEN) {
                        playerEntry.ws.send(JSON.stringify(payload));
                    }
                });
            } else if (message.type === 'warpActivate') {
                const player = players.get(playerId);
                if (!player || !player.warpBeacon) {
                    return;
                }

                if (typeof message.beaconId === 'string' && message.beaconId !== player.warpBeacon.id) {
                    return;
                }

                const now = Date.now();
                if (now > player.warpBeacon.expiresAt) {
                    const expiredPayload = {
                        type: 'warpExpired',
                        playerId,
                        beaconId: player.warpBeacon.id
                    };
                    player.warpBeacon = null;
                    players.forEach((playerEntry) => {
                        if (playerEntry.ws.readyState === WebSocket.OPEN) {
                            playerEntry.ws.send(JSON.stringify(expiredPayload));
                        }
                    });
                    return;
                }

                const clampedPos = clampShipPosition(player.warpBeacon.x, player.warpBeacon.y);
                player.x = clampedPos.x;
                player.y = clampedPos.y;
                const beaconId = player.warpBeacon.id;
                player.warpBeacon = null;

                const payload = {
                    type: 'warpActivate',
                    playerId,
                    beaconId,
                    x: clampedPos.x,
                    y: clampedPos.y
                };

                players.forEach((playerEntry) => {
                    if (playerEntry.ws.readyState === WebSocket.OPEN) {
                        playerEntry.ws.send(JSON.stringify(payload));
                    }
                });
            } else if (message.type === 'warpExpired') {
                const player = players.get(playerId);
                if (!player || !player.warpBeacon) {
                    return;
                }

                if (typeof message.beaconId === 'string' && message.beaconId !== player.warpBeacon.id) {
                    return;
                }

                const beaconId = player.warpBeacon.id;
                player.warpBeacon = null;

                const payload = {
                    type: 'warpExpired',
                    playerId,
                    beaconId
                };

                players.forEach((playerEntry) => {
                    if (playerEntry.ws.readyState === WebSocket.OPEN) {
                        playerEntry.ws.send(JSON.stringify(payload));
                    }
                });
            } else if (message.type === 'mineDislodged') {
                const bombId = typeof message.bombId === 'string' ? message.bombId : null;
                if (!bombId) {
                    return;
                }
                const notice = {
                    type: 'mineDislodged',
                    bombId,
                    playerId
                };
                players.forEach((playerEntry) => {
                    if (playerEntry.ws.readyState === WebSocket.OPEN) {
                        playerEntry.ws.send(JSON.stringify(notice));
                    }
                });
            } else if (message.type === 'playerDamage') {
                // Forward damage message to target player
                const targetPlayer = players.get(message.targetId);
                if (!targetPlayer || targetPlayer.ws.readyState !== WebSocket.OPEN) {
                    return;
                }

                const targetX = Number(targetPlayer.x);
                const targetY = Number(targetPlayer.y);
                if (isInSafeZone(targetX, targetY)) {
                    return;
                }

                const attacker = players.get(playerId);
                const attackerX = attacker ? Number(attacker.x) : NaN;
                const attackerY = attacker ? Number(attacker.y) : NaN;
                if (isInSafeZone(attackerX, attackerY)) {
                    return;
                }

                targetPlayer.ws.send(JSON.stringify(message));
            } else if (message.type === 'bombDamage') {
                // Forward bomb damage message to target player
                const targetPlayer = players.get(message.targetId);
                if (!targetPlayer || targetPlayer.ws.readyState !== WebSocket.OPEN) {
                    return;
                }

                const targetX = Number(targetPlayer.x);
                const targetY = Number(targetPlayer.y);
                if (isInSafeZone(targetX, targetY)) {
                    return;
                }

                const attacker = players.get(playerId);
                const attackerX = attacker ? Number(attacker.x) : NaN;
                const attackerY = attacker ? Number(attacker.y) : NaN;
                if (isInSafeZone(attackerX, attackerY)) {
                    return;
                }

                targetPlayer.ws.send(JSON.stringify(message));
            } else if (message.type === 'bombExplosion') {
                // Broadcast bomb explosion to all other players
                const explosionData = {
                    type: 'bombExplosion',
                    playerId: playerId,
                    ...message
                };

                players.forEach((player, id) => {
                    if (id !== playerId && player.ws.readyState === WebSocket.OPEN) {
                        player.ws.send(JSON.stringify(explosionData));
                    }
                });
            } else if (message.type === 'bountyUpdate') {
                const parsedBounty = Number(message.bounty);
                const bountyValue = Number.isFinite(parsedBounty) ? Math.max(0, Math.floor(parsedBounty)) : 0;

                const player = players.get(playerId);
                if (player) {
                    player.bounty = bountyValue;
                }

                const updateData = {
                    type: 'bountyUpdate',
                    playerId: playerId,
                    bounty: bountyValue
                };

                players.forEach((player) => {
                    if (player.ws.readyState === WebSocket.OPEN) {
                        player.ws.send(JSON.stringify(updateData));
                    }
                });
            } else if (message.type === 'shipChange') {
                const player = players.get(playerId);
                if (player && typeof message.shipType === 'number') {
                    player.shipType = message.shipType;

                    const changeData = {
                        type: 'shipChange',
                        playerId,
                        shipType: message.shipType
                    };

                    players.forEach((p, id) => {
                        if (id !== playerId && p.ws.readyState === WebSocket.OPEN) {
                            p.ws.send(JSON.stringify(changeData));
                        }
                    });
                }
            } else if (message.type === 'playerKilled') {
                const parsedVictimBounty = Number(message.victimBounty);
                const parsedKillerBounty = Number(message.killerBounty);
                const victimBounty = Number.isFinite(parsedVictimBounty) ? Math.max(0, Math.floor(parsedVictimBounty)) : null;
                const killerBounty = Number.isFinite(parsedKillerBounty) ? Math.max(0, Math.floor(parsedKillerBounty)) : null;

                const player = players.get(playerId);
                if (player && victimBounty !== null) {
                    player.bounty = victimBounty;
                }
                let warpExpiredPayload = null;
                if (player && player.warpBeacon) {
                    warpExpiredPayload = {
                        type: 'warpExpired',
                        playerId,
                        beaconId: player.warpBeacon.id
                    };
                    player.warpBeacon = null;
                }
                const killerPlayer = message.killerId ? players.get(message.killerId) : null;
                if (killerPlayer && killerBounty !== null) {
                    killerPlayer.bounty = killerBounty;
                }

                const deathData = {
                    type: 'playerKilled',
                    victimId: playerId,
                    killerId: message.killerId || null,
                    victimBounty,
                    killerBounty
                };

                players.forEach((player) => {
                    if (player.ws.readyState === WebSocket.OPEN) {
                        player.ws.send(JSON.stringify(deathData));
                        if (warpExpiredPayload) {
                            player.ws.send(JSON.stringify(warpExpiredPayload));
                        }
                    }
                });
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    ws.on('close', function() {
        console.log(`Player ${playerId} disconnected`);
        const departing = players.get(playerId);
        let warpExpiredPayload = null;
        if (departing && departing.warpBeacon) {
            warpExpiredPayload = {
                type: 'warpExpired',
                playerId,
                beaconId: departing.warpBeacon.id
            };
        }
        players.delete(playerId);

        // Notify other players
        const disconnectData = {
            type: 'playerDisconnected',
            id: playerId
        };

        players.forEach((player) => {
            if (player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(JSON.stringify(disconnectData));
                if (warpExpiredPayload) {
                    player.ws.send(JSON.stringify(warpExpiredPayload));
                }
            }
        });
    });

    ws.on('error', function(error) {
        console.error(`WebSocket error for player ${playerId}:`, error);
        const erroredPlayer = players.get(playerId);
        let warpExpiredPayload = null;
        if (erroredPlayer && erroredPlayer.warpBeacon) {
            warpExpiredPayload = {
                type: 'warpExpired',
                playerId,
                beaconId: erroredPlayer.warpBeacon.id
            };
        }
        players.delete(playerId);
        if (warpExpiredPayload) {
            players.forEach((player) => {
                if (player.ws.readyState === WebSocket.OPEN) {
                    player.ws.send(JSON.stringify(warpExpiredPayload));
                }
            });
        }
    });
});

setInterval(() => {
    const now = Date.now();
    players.forEach((player) => {
        if (player.warpBeacon && now > player.warpBeacon.expiresAt) {
            const payload = {
                type: 'warpExpired',
                playerId: player.id,
                beaconId: player.warpBeacon.id
            };
            player.warpBeacon = null;
            players.forEach((recipient) => {
                if (recipient.ws.readyState === WebSocket.OPEN) {
                    recipient.ws.send(JSON.stringify(payload));
                }
            });
        }
    });
}, 1000);

const PORT = 8443;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTPS server running on https://0.0.0.0:${PORT}`);
    console.log(`WebSocket server running on wss://0.0.0.0:${PORT}`);
});
