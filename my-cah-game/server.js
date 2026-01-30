const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

// --- ROBUST DECK MANAGEMENT ---
let rawWhite = ["Blank White Card"];
let rawBlack = ["Blank Black Card"];

try {
    if(fs.existsSync('white_cards.txt')) rawWhite = fs.readFileSync('white_cards.txt', 'utf-8').split('\n').filter(l => l.trim() !== "");
    if(fs.existsSync('black_cards.txt')) rawBlack = fs.readFileSync('black_cards.txt', 'utf-8').split('\n').filter(l => l.trim() !== "");
} catch (e) { console.log("File error - using defaults"); }

let whiteDeck = []; 
let blackDeck = [];

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function drawWhite() {
    if (whiteDeck.length === 0) whiteDeck = shuffle([...rawWhite]);
    return whiteDeck.pop();
}

function drawBlack() {
    if (blackDeck.length === 0) {
        console.log("Black deck empty! Reshuffling used cards...");
        blackDeck = shuffle([...rawBlack]);
    }
    return blackDeck.pop();
}

// --- GAME STATE ---
let players = {};
let czarIndex = 0;
let currentBlackCard = "";
let submissions = [];
let gameStarted = false;
let botModeActive = false;
let debugModeActive = false;
const ADMIN_PASSWORD = "Firesluts";

io.on('connection', (socket) => {
    socket.on('join-game', (username) => {
        const cleanName = (username || "Player").replace(/<[^>]*>?/gm, '').substring(0, 15);
        players[socket.id] = { id: socket.id, username: cleanName, score: 0, hand: [], isCzar: false, hasSubmitted: false, isBot: false };
        for(let i=0; i<10; i++) players[socket.id].hand.push(drawWhite());
        checkGameStart();
        updateAll();
    });

    socket.on('admin-action', (data) => {
        if (data.pw !== ADMIN_PASSWORD) return socket.emit('admin-fail');
        if (data.type === 'login') socket.emit('admin-success');
        if (data.type === 'toggle-bot') { botModeActive = !botModeActive; if (botModeActive) addBot(); }
        if (data.type === 'toggle-debug') debugModeActive = !debugModeActive;
        if (data.type === 'wipe-chat') io.emit('clear-chat-ui');
        if (data.type === 'reset') resetGame();
        updateAll();
    });

    socket.on('submit-card', (cardText) => {
        const p = players[socket.id];
        if (!p || p.isCzar || p.hasSubmitted || !currentBlackCard) return;
        processSubmission(socket.id, cardText);
    });

    socket.on('pick-winner', (winnerId) => {
        const p = players[socket.id];
        if (p && p.isCzar && submissions.length >= (Object.keys(players).length - 1)) {
            const winner = players[winnerId];
            if (winner) {
                winner.score++;
                io.emit('round-winner', { name: winner.username, id: winner.id });
                setTimeout(() => { rotateCzar(); startNewRound(); updateAll(); }, 4000);
            }
        }
    });

    socket.on('send-chat', (msg) => {
        const p = players[socket.id];
        if (p) io.emit('new-chat', { user: p.username, text: msg.replace(/<[^>]*>?/gm, '') });
    });

    socket.on('disconnect', () => {
        setTimeout(() => {
            if (!io.sockets.sockets.get(socket.id)) {
                if (players[socket.id]) {
                    const wasCzar = players[socket.id].isCzar;
                    delete players[socket.id];
                    if (wasCzar && Object.keys(players).length >= 3) { rotateCzar(); startNewRound(); }
                    updateAll();
                }
            }
        }, 2000);
    });
});

function processSubmission(id, cardText) {
    const p = players[id];
    submissions.push({ card: cardText, playerId: id, username: p.username });
    p.hand = p.hand.filter(c => c !== cardText);
    p.hand.push(drawWhite());
    p.hasSubmitted = true;
    if (submissions.length >= (Object.keys(players).length - 1)) shuffle(submissions);
    updateAll();
}

function rotateCzar() {
    const ids = Object.keys(players);
    if(ids.length > 0) czarIndex = (czarIndex + 1) % ids.length;
}

function startNewRound() {
    submissions = [];
    currentBlackCard = drawBlack();
    const ids = Object.keys(players);
    if(ids.length < 3) { gameStarted = false; return; }
    ids.forEach((id, i) => {
        players[id].isCzar = (i === czarIndex);
        players[id].hasSubmitted = false;
    });
    if (botModeActive) handleBotTurns();
}

function handleBotTurns() {
    Object.values(players).forEach(p => {
        if (p.isBot && !p.isCzar) {
            setTimeout(() => { if(!p.hasSubmitted) processSubmission(p.id, p.hand[Math.floor(Math.random()*p.hand.length)]); }, 2000 + Math.random()*2000);
        }
    });
}

function checkGameStart() { if (!gameStarted && Object.keys(players).length >= 3) { gameStarted = true; startNewRound(); } }

function resetGame() { players = {}; submissions = []; czarIndex = 0; currentBlackCard = ""; gameStarted = false; io.emit('force-reload'); }

function updateAll() {
    io.emit('game-state', {
        players: Object.values(players),
        blackCard: currentBlackCard,
        submissions,
        gameStarted,
        botMode: botModeActive,
        debugMode: debugModeActive,
        czarName: Object.values(players).find(p => p.isCzar)?.username || "..."
    });
}

server.listen(PORT, () => console.log(`Server Online - Admin password: ${ADMIN_PASSWORD}`));
