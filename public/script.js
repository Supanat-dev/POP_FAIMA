// ===== STATE =====
let highScore = parseInt(localStorage.getItem('popHighScore') || '0');
let popCount = highScore;
let comboTimer = null;
let comboCount = 0;
let isHolding = false;
let clickTimestamps = [];
let maxPps = parseInt(localStorage.getItem('popMaxPps') || '0');
let maxComboScore = parseInt(localStorage.getItem('popMaxCombo') || '0');
let myPlayerId = null;
let playerName = '';
let ws = null;
let statsChanged = false;
let lastTouchTime = 0;

// ===== DOM ELEMENTS =====
const faceClosed    = document.getElementById('face-closed');
const faceOpen      = document.getElementById('face-open');
const popArea       = document.getElementById('pop-area');
const counterEl     = document.getElementById('counter');
const comboEl       = document.getElementById('combo');
const comboTextEl   = document.getElementById('combo-text');
const instructionEl = document.getElementById('instruction');
const ppsEl         = document.getElementById('pps');
const particles     = document.getElementById('particles');
const highscoreEl   = document.getElementById('highscore');

// MODAL ELs
const nameModal     = document.getElementById('name-modal');
const nameInput     = document.getElementById('name-input');
const nameSubmit    = document.getElementById('name-submit');
const editNameBtn   = document.getElementById('edit-name-btn');
const lbList        = document.getElementById('leaderboard-list');
const onlineText    = document.getElementById('online-text');

// ===== INIT LOCAL STATS =====
if(highscoreEl) highscoreEl.textContent = highScore.toLocaleString();
if(counterEl) counterEl.textContent = popCount.toLocaleString();

// ===== NAME MODAL =====
let gameStarted = false;
const saved = localStorage.getItem('popPlayerName');
if (saved) {
    playerName = saved;
    nameModal.classList.add('hidden');
    gameStarted = true;
    startGame();
} else {
    nameInput.focus();
}

nameSubmit.addEventListener('click', submitName);
if (editNameBtn) {
    editNameBtn.addEventListener('click', () => {
        nameModal.classList.remove('hidden');
        nameInput.value = playerName;
        nameInput.focus();
    });
}
nameInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') submitName(); });
nameInput.addEventListener('mousedown', (e) => e.stopPropagation());
nameInput.addEventListener('touchstart', (e) => e.stopPropagation());

function submitName() {
    const n = nameInput.value.trim();
    if (!n) { nameInput.style.borderColor = 'rgba(255,50,50,0.6)'; return; }
    nameInput.style.borderColor = 'rgba(255,255,255,0.1)';
    playerName = n.substring(0, 20);
    localStorage.setItem('popPlayerName', playerName);
    nameModal.classList.add('hidden');
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'setName', name: playerName }));
    }
    
    if (!gameStarted) {
        gameStarted = true;
        startGame();
    }
}

// ===== WEBSOCKET =====
function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}`);

    ws.onopen = () => {
        // intentionally quiet
    };

    ws.onmessage = (ev) => {
        try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'welcome') {
                myPlayerId = msg.id;
                ws.send(JSON.stringify({ type: 'setName', name: playerName }));
                // Send current best stats right away!
                ws.send(JSON.stringify({ type: 'updateStats', score: highScore, maxPps: maxPps, maxCombo: maxComboScore }));
            } else if (msg.type === 'syncScore') {
                popCount = msg.score;
                highScore = msg.score;
                maxPps = msg.maxPps;
                maxComboScore = msg.maxCombo;
                
                // Update UI
                if (counterEl) counterEl.textContent = popCount.toLocaleString();
                if (highscoreEl) highscoreEl.textContent = highScore.toLocaleString();
                
                // Update LocalStorage
                localStorage.setItem('popHighScore', highScore);
                localStorage.setItem('popMaxPps', maxPps);
                localStorage.setItem('popMaxCombo', maxComboScore);
            } else if (msg.type === 'leaderboard') {
                renderLeaderboard(msg.players, msg.totalPlayers);
            }
        } catch (_) {}
    };

    ws.onclose = () => setTimeout(connectWS, 2000);
    ws.onerror = () => ws.close();
}

// ===== LEADERBOARD RENDER =====
function renderLeaderboard(players, total) {
    onlineText.textContent = total + ' ออนไลน์';

    if (!players.length) {
        lbList.innerHTML = '<div class="lb-empty">รอผู้เล่น...</div>';
        return;
    }

    lbList.innerHTML = '';
    const medals = ['', '👑', '🥈', '🥉'];

    players.forEach((p, i) => {
        const rank = i + 1;
        const me   = p.name === playerName;
        const div  = document.createElement('div');
        div.className = 'lb-entry' +
            (rank <= 3 ? ' rank-' + rank : '') +
            (me ? ' is-me' : '') +
            (p.isOnline ? ' online' : ' offline');

        div.innerHTML = `
            <div class="lb-left">
                <div class="lb-rank">${rank <= 3 ? medals[rank] : rank}</div>
                <div class="lb-name">
                    ${esc(p.name)}${me ? ' 👈' : ''}
                    <span class="status-dot"></span>
                </div>
            </div>
            <div class="lb-score" title="Best Score">${p.score.toLocaleString()}</div>
        `;
        lbList.appendChild(div);
    });
}

function esc(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
}

// ===== AUDIO =====
let audioCtx = null;

function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playPop() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const mkOsc = (type, f0, f1, dur, g0) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.connect(g); g.connect(audioCtx.destination);
        o.type = type;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        g.gain.setValueAtTime(g0, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.02);
        o.start(t); o.stop(t + dur + 0.05);
    };
    mkOsc('sine',   600, 180, 0.09, 0.28);
    mkOsc('square', 1100, 350, 0.04, 0.12);
}

// ===== MOUTH =====
function openMouth()  { faceClosed.classList.remove('active'); faceOpen.classList.add('active'); }
function closeMouth() { faceOpen.classList.remove('active'); faceClosed.classList.add('active'); }

// ===== POP =====
function doPop(e) {
    initAudio();

    popCount++;
    counterEl.textContent = popCount.toLocaleString();
    counterEl.classList.remove('bump');
    void counterEl.offsetWidth;
    counterEl.classList.add('bump');
    setTimeout(() => counterEl.classList.remove('bump'), 90);

    openMouth();
    playPop();

    popArea.classList.add('pop-glow');
    setTimeout(() => popArea.classList.remove('pop-glow'), 200);

    // Track High score
    if (popCount > highScore) {
        highScore = popCount;
        if(highscoreEl) highscoreEl.textContent = highScore.toLocaleString();
        localStorage.setItem('popHighScore', highScore);
        statsChanged = true;
    }

    // Track Combo
    comboCount++;
    if (comboCount > maxComboScore) {
        maxComboScore = comboCount;
        localStorage.setItem('popMaxCombo', maxComboScore);
        statsChanged = true;
    }

    clearTimeout(comboTimer);
    comboTimer = setTimeout(() => {
        comboCount = 0;
    }, 500);

    spawnParticles(e);
    spawnRipple(e);

    if (comboCount > 20) {
        document.body.classList.remove('shake');
        void document.body.offsetWidth;
        document.body.classList.add('shake');
        setTimeout(() => document.body.classList.remove('shake'), 150);
    }

    clickTimestamps.push(Date.now());

    if (popCount >= 3) instructionEl.style.opacity = '0';
}

function handleDown(e) {
    if (!nameModal.classList.contains('hidden')) return;
    if (e.cancelable) e.preventDefault();
    isHolding = true;
    doPop(e);
}

function handleUp() {
    if (!isHolding) return;
    isHolding = false;
    closeMouth();
}



// ===== PARTICLES =====
function spawnParticles(e) {
    const cols = ['#ff6b6b','#ee5a24','#f368e0','#ffd32a','#7efff5'];
    const n = comboCount > 20 ? 12 : comboCount > 10 ? 8 : 4;
    const cx = e.clientX ?? window.innerWidth  / 2;
    const cy = e.clientY ?? window.innerHeight / 2;
    for (let i = 0; i < n; i++) {
        const p   = document.createElement('div');
        const sz  = Math.random() * 11 + 4;
        const col = cols[Math.floor(Math.random() * cols.length)];
        p.className = 'particle';
        p.style.cssText = `left:${cx + (Math.random()-.5)*90}px;top:${cy + (Math.random()-.5)*45}px;width:${sz}px;height:${sz}px;background:${col};box-shadow:0 0 ${sz*2}px ${col};`;
        particles.appendChild(p);
        setTimeout(() => p.remove(), 1400);
    }
}

// ===== RIPPLE =====
function spawnRipple(e) {
    const r = document.createElement('div');
    r.className = 'ripple';
    const x = e.clientX ?? window.innerWidth/2;
    const y = e.clientY ?? window.innerHeight/2;
    r.style.left = (x - 90) + 'px';
    r.style.top  = (y - 90) + 'px';
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 600);
}

// ===== PPS =====
setInterval(() => {
    const now = Date.now();
    clickTimestamps = clickTimestamps.filter(t => now - t < 1000);
    const v = clickTimestamps.length;
    ppsEl.textContent = v;
    ppsEl.style.color = v >= 30
        ? 'rgba(255,107,107,0.85)'
        : v >= 15
        ? 'rgba(255,215,0,0.75)'
        : 'rgba(120,255,180,0.65)';

    // Track Max PPS
    if (v > maxPps) {
        maxPps = v;
        localStorage.setItem('popMaxPps', maxPps);
        statsChanged = true;
    }

    if (statsChanged && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'updateStats', score: highScore, maxPps: maxPps, maxCombo: maxComboScore }));
        statsChanged = false;
    }

}, 100);

// ===== START GAME =====
function startGame() {
    connectWS();

    document.addEventListener('mousedown', (e) => {
        if (Date.now() - lastTouchTime < 300) return; // Prevent double fire on mobile
        handleDown(e);
    });
    document.addEventListener('mouseup',   handleUp);

    document.addEventListener('touchstart', (e) => {
        lastTouchTime = Date.now();
        handleDown(e.touches[0]);
    }, { passive: false });

    document.addEventListener('touchend',   handleUp);
    document.addEventListener('touchcancel', handleUp);

    document.addEventListener('keydown', (e) => {
        // e.repeat prevents spamming continuous pop from just holding down a key without re-pressing
        if (e.repeat || !nameModal.classList.contains('hidden') || e.target === nameInput) return;
        isHolding = true;
        doPop({ clientX: window.innerWidth/2, clientY: window.innerHeight/2 });
    });
    document.addEventListener('keyup', (e) => {
        if (e.target === nameInput) return;
        handleUp();
    });

    document.addEventListener('contextmenu', (e) => e.preventDefault());
}

// preload
new Image().src = 'images/mouth-open.jpg';
new Image().src = 'images/mouth-closed.jpg';
