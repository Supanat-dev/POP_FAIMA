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
        // Fetch Top 50 from DB
        const topPlayers = await PlayerModel.find()
            .sort({ score: -1 })
            .limit(50)
            .lean();

        // Merge with online players who might not be in DB yet or have newer scores
        // (Though in this version we update DB on every click)
        const leaderboard = topPlayers.map(p => ({
            name: p.name,
            score: p.score,
            maxPps: p.maxPps,
            maxCombo: p.maxCombo,
            isOnline: Array.from(activePlayers.values()).some(ap => ap.name === p.name)
        }));

        const payload = JSON.stringify({
            type: 'leaderboard',
            players: leaderboard,
            totalPlayers: await PlayerModel.countDocuments()
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
