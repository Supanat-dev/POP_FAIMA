const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGODB_URI = 'mongodb+srv://phoomakmoosik_db_user:Supanat12345@cluster0.emvyjpk.mongodb.net/pop_faima?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Player Schema for DB
const playerSchema = new mongoose.Schema({
    name: { type: String, unique: true, required: true },
    score: { type: Number, default: 0 },
    maxPps: { type: Number, default: 0 },
    maxCombo: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now }
});

const PlayerModel = mongoose.model('Player', playerSchema);

// In-memory state for active connections
const activePlayers = new Map();
let nextId = 1;

// Cleanup inactive connections (but keep data in DB)
setInterval(() => {
    const now = Date.now();
    for (const [id, player] of activePlayers) {
        if (now - player.lastActive > 60000) {
            activePlayers.delete(id);
        }
    }
    broadcastLeaderboard();
}, 30000);

wss.on('connection', (ws) => {
    const connectionId = nextId++;
    
    activePlayers.set(connectionId, {
        name: 'Guest ' + connectionId,
        score: 0,
        maxPps: 0,
        maxCombo: 0,
        ws: ws,
        lastActive: Date.now(),
        dbId: null
    });

    ws.send(JSON.stringify({ type: 'welcome', id: connectionId }));
    broadcastLeaderboard();

    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data);
            const player = activePlayers.get(connectionId);
            if (!player) return;

            player.lastActive = Date.now();

            switch (msg.type) {
                case 'setName':
                    const cleanName = msg.name.substring(0, 20).trim() || 'Guest ' + connectionId;
                    player.name = cleanName;
                    
                    // Load or Create player in DB
                    try {
                        let dbPlayer = await PlayerModel.findOne({ name: cleanName });
                        if (dbPlayer) {
                            player.score = dbPlayer.score;
                            player.maxPps = dbPlayer.maxPps;
                            player.maxCombo = dbPlayer.maxCombo;
                        } else {
                            dbPlayer = await PlayerModel.create({ name: cleanName });
                        }
                        player.dbId = dbPlayer._id;
                        
                        // Sync back to client so they see their old score
                        ws.send(JSON.stringify({ 
                            type: 'syncScore', 
                            score: player.score,
                            maxPps: player.maxPps,
                            maxCombo: player.maxCombo
                        }));
                    } catch (err) {
                        console.error('Error handling setName:', err);
                    }
                    broadcastLeaderboard();
                    break;

                case 'updateStats':
                    player.score = Math.max(0, parseInt(msg.score) || player.score);
                    player.maxPps = Math.max(0, parseInt(msg.maxPps) || player.maxPps);
                    player.maxCombo = Math.max(0, parseInt(msg.maxCombo) || player.maxCombo);
                    
                    // Periodically save to DB (or every update for simplicity in small scale)
                    if (player.name && !player.name.startsWith('Guest ')) {
                        await PlayerModel.updateOne(
                            { name: player.name },
                            { 
                                score: player.score, 
                                maxPps: player.maxPps, 
                                maxCombo: player.maxCombo,
                                lastUpdated: new Date()
                            }
                        ).catch(err => console.error('DB Update Error:', err));
                    }
                    broadcastLeaderboard();
                    break;

                case 'adminDelete':
                    if (msg.pass === '1212312121') {
                        const targetName = msg.target;
                        
                        // 1. Delete from DB
                        if (mongoose.connection.readyState === 1) {
                            await PlayerModel.deleteMany({ name: targetName }).catch(e => console.error(e));
                        }
                        
                        // 2. Remove from active players
                        for (const [id, p] of activePlayers) {
                            if (p.name === targetName) {
                                activePlayers.delete(id);
                                // Tell their client their score was reset
                                if (p.ws.readyState === 1) {
                                    p.ws.send(JSON.stringify({ type: 'syncScore', score: 0, maxPps: 0, maxCombo: 0 }));
                                }
                            }
                        }
                        console.log(`💀 Admin deleted player: ${targetName}`);
                        broadcastLeaderboard();
                    }
                    break;
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        activePlayers.delete(connectionId);
        broadcastLeaderboard();
    });
});

async function broadcastLeaderboard() {
    try {
        // Build a map of all known players (name -> data)
        const playerMap = new Map();

        // 1. Try to load from DB first (if connected)
        if (mongoose.connection.readyState === 1) {
            try {
                const topPlayers = await PlayerModel.find()
                    .sort({ score: -1 })
                    .limit(50)
                    .lean();

                for (const p of topPlayers) {
                    playerMap.set(p.name, {
                        name: p.name,
                        score: p.score || 0,
                        maxPps: p.maxPps || 0,
                        maxCombo: p.maxCombo || 0,
                        isOnline: false
                    });
                }
            } catch (dbErr) {
                console.error('DB query error (non-fatal):', dbErr.message);
            }
        }

        // 2. Merge with active online players (always works, even without DB)
        for (const [id, player] of activePlayers) {
            const existing = playerMap.get(player.name);
            if (existing) {
                // Use the higher score between DB and in-memory
                existing.score = Math.max(existing.score, player.score);
                existing.maxPps = Math.max(existing.maxPps, player.maxPps);
                existing.maxCombo = Math.max(existing.maxCombo, player.maxCombo);
                existing.isOnline = true;
            } else {
                playerMap.set(player.name, {
                    name: player.name,
                    score: player.score,
                    maxPps: player.maxPps,
                    maxCombo: player.maxCombo,
                    isOnline: true
                });
            }
        }

        // 3. Sort by score and send
        const leaderboard = Array.from(playerMap.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, 50);

        const onlineCount = Array.from(activePlayers.values())
            .filter(p => !p.name.startsWith('Guest ')).length;

        const payload = JSON.stringify({
            type: 'leaderboard',
            players: leaderboard,
            totalPlayers: Math.max(leaderboard.length, onlineCount)
        });

        wss.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(payload);
            }
        });
    } catch (err) {
        console.error('Leaderboard broadcast error:', err);
    }
}

const PORT = process.env.PORT || 8888;
server.listen(PORT, () => {
    console.log(`🔥 POP ใฝ่ม้า server running at http://localhost:${PORT}`);
});
