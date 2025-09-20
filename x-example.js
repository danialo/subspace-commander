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

wss.on('connection', function connection(ws, req) {
    const playerId = Math.random().toString(36).substr(2, 9);
    players.set(playerId, { ws, id: playerId, x: 4000, y: 3000 });

    console.log(`Player ${playerId} connected from ${req.socket.remoteAddress}`);

    // Send init message to new player with their ID and existing players
    const existingPlayers = [];
    players.forEach((player, id) => {
        if (id !== playerId) {
            existingPlayers.push({ id, x: player.x, y: player.y });
        }
    });

    ws.send(JSON.stringify({
        type: 'init',
        playerId: playerId,
        players: existingPlayers
    }));

    // Notify other players about new player
    const joinData = {
        type: 'playerJoined',
        player: { id: playerId, x: 4000, y: 3000 }
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
            } else if (message.type === 'playerDamage') {
                // Forward damage message to target player
                const targetPlayer = players.get(message.targetId);
                if (targetPlayer && targetPlayer.ws.readyState === WebSocket.OPEN) {
                    targetPlayer.ws.send(JSON.stringify(message));
                }
            } else if (message.type === 'bombDamage') {
                // Forward bomb damage message to target player
                const targetPlayer = players.get(message.targetId);
                if (targetPlayer && targetPlayer.ws.readyState === WebSocket.OPEN) {
                    targetPlayer.ws.send(JSON.stringify(message));
                }
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
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    ws.on('close', function() {
        console.log(`Player ${playerId} disconnected`);
        players.delete(playerId);

        // Notify other players
        const disconnectData = {
            type: 'playerDisconnected',
            id: playerId
        };

        players.forEach((player) => {
            if (player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(JSON.stringify(disconnectData));
            }
        });
    });

    ws.on('error', function(error) {
        console.error(`WebSocket error for player ${playerId}:`, error);
        players.delete(playerId);
    });
});

const PORT = 8443;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTPS server running on https://0.0.0.0:${PORT}`);
    console.log(`WebSocket server running on wss://0.0.0.0:${PORT}`);
});