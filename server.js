const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

const players = new Map();
let nextId = 1;

setInterval(() => {
    const now = Date.now();
    for (const [id, player] of players) {
        if (now - player.lastActive > 60000) {
            players.delete(id);
        }
    }
    broadcastLeaderboard();
}, 30000);

wss.on('connection', (ws) => {
    const playerId = nextId++;
    players.set(playerId, {
        name: 'Player ' + playerId,
        score: 0,
        maxPps: 0,
        maxCombo: 0,
        ws: ws,
        lastActive: Date.now()
    });

    ws.send(JSON.stringify({ type: 'welcome', id: playerId }));
    broadcastLeaderboard();

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            const player = players.get(playerId);
            if (!player) return;

            player.lastActive = Date.now();

            switch (msg.type) {
                case 'setName':
                    player.name = msg.name.substring(0, 20) || 'Player ' + playerId;
                    broadcastLeaderboard();
                    break;
                case 'updateStats':
                    player.score = Math.max(0, parseInt(msg.score) || player.score);
                    player.maxPps = Math.max(0, parseInt(msg.maxPps) || player.maxPps);
                    player.maxCombo = Math.max(0, parseInt(msg.maxCombo) || player.maxCombo);
                    broadcastLeaderboard();
                    break;
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        players.delete(playerId);
        broadcastLeaderboard();
    });
});

function broadcastLeaderboard() {
    const leaderboard = [];
    for (const [id, player] of players) {
        leaderboard.push({
            id,
            name: player.name,
            score: player.score,
            maxPps: player.maxPps,
            maxCombo: player.maxCombo
        });
    }
    leaderboard.sort((a, b) => b.score - a.score);

    const payload = JSON.stringify({
        type: 'leaderboard',
        players: leaderboard.slice(0, 50),
        totalPlayers: leaderboard.length
    });

    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(payload);
        }
    });
}

const PORT = process.env.PORT || 8888;
server.listen(PORT, () => {
    console.log(`🔥 POP ใฝ่ม้า server running at http://localhost:${PORT}`);
});
