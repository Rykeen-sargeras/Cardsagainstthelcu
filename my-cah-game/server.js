const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

// --- DECKS ---
const rawWhite = fs.readFileSync('white_cards.txt', 'utf-8').split('\n').filter(l => l.trim() !== "");
const rawBlack = fs.readFileSync('black_cards.txt', 'utf-8').split('\n').filter(l => l.trim() !== "");
let whiteDeck = []; let blackDeck = [];

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
    if (blackDeck.length === 0) blackDeck = shuffle([...rawBlack]);
    return blackDeck.pop();
}

// --- STATE ---
let players = {};
let czarIndex = 0;
let currentBlackCard = "";
let czarOptions = [];
let submissions = [];
let gameStarted = false;
let botModeActive = false;
let debugModeActive = false;

io.on('connection', (socket) => {
    socket.on('join-game', (username) => {
        const cleanName = (username || "Player").replace(/<[^>]*>?/gm, '').substring(0, 15);
        players[socket.id] = { id: socket.id, username: cleanName, score: 0, hand: [], isCzar: false, hasSubmitted: false, isBot: false };
        for(let i=0; i<10; i++) players[socket.id].hand.push(drawWhite());
        checkGameStart();
        updateAll();
    });

    // ADMIN HANDLER
    socket.on('admin-action', (data) => {
        if (data.pw !== 'Firesluts') return; // Security Check
        
        if (data.type === 'toggle-bot') { 
            botModeActive = !botModeActive; 
            if (botModeActive) addBot(); 
        }
        if (data.type === 'toggle-debug') debugModeActive = !debugModeActive;
        if (data.type === 'wipe-chat') io.emit('clear-chat-ui');
        if (data.type === 'reset') resetGame();
        
        updateAll();
    });

    socket.on('send-chat', (msg) => {
        const p = players[socket.id];
        if (p) io.emit('new-chat', { user: p.username, text: msg.replace(/<[^>]*>?/gm, '') });
    });

    socket.on('czar-select-black', (card) => {
        if (players[socket.id]?.isCzar && !currentBlackCard) {
            currentBlackCard = card;
            czarOptions = [];
            updateAll();
            if (botModeActive) handleBotTurns();
        }
    });

    socket.on('submit-card', (cardText) => {
        const p = players[socket.id];
        if (!p || p.isCzar || p.hasSubmitted || !currentBlackCard) return;
        processSubmission(socket.id, cardText);
    });

    socket.on('pick-winner', (winnerId) => {
        if (players[socket.id]?.isCzar && submissions.length >= (Object.keys(players).length - 1)) {
            const winner = players[winnerId];
            if (winner) {
                winner.score++;
                io.emit('round-winner', { name: winner.username, id: winner.id });
                setTimeout(() => { czarIndex++; startNewRound(); updateAll(); }, 4000);
            }
        }
    });

    socket.on('disconnect', () => {
        const dId = socket.id;
        setTimeout(() => {
            if (!io.sockets.sockets.get(dId)) {
                delete players[dId];
                if (Object.keys(players).length < 3) gameStarted = false;
                updateAll();
            }
        }, 3000);
    });
});

function addBot() {
    const id = 'bot_' + Math.random().toString(36).substr(2, 5);
    players[id] = { id, username: "🤖 Bot_" + id, score: 0, hand: [], isCzar: false, hasSubmitted: false, isBot: true };
    for(let i=0; i<10; i++) players[id].hand.push(drawWhite());
    checkGameStart();
}

function processSubmission(id, cardText) {
    const p = players[id];
    if(!p || p.hasSubmitted) return;
    submissions.push({ card: cardText, playerId: id, username: p.username });
    p.hand = p.hand.filter(c => c !== cardText);
    p.hand.push(drawWhite());
    p.hasSubmitted = true;
    
    // Shuffle submissions on table for anonymity
    if (submissions.length >= (Object.keys(players).length - 1)) {
        shuffle(submissions);
    }
    updateAll();
}

function handleBotTurns() {
    Object.values(players).forEach(p => {
        if (p.isBot && !p.isCzar) {
            setTimeout(() => processSubmission(p.id, p.hand[Math.floor(Math.random()*p.hand.length)]), 2000 + Math.random()*2000);
        }
    });
}

function startNewRound() {
    submissions = []; currentBlackCard = "";
    const ids = Object.keys(players);
    if(ids.length < 3) { gameStarted = false; return; }
    ids.forEach((id, i) => {
        players[id].isCzar = (i === czarIndex % ids.length);
        players[id].hasSubmitted = false;
    });
    czarOptions = [drawBlack(), drawBlack()];
    
    const czar = Object.values(players).find(p => p.isCzar);
    if (czar?.isBot) {
        setTimeout(() => {
            currentBlackCard = czarOptions[Math.floor(Math.random()*2)];
            czarOptions = [];
            updateAll();
            handleBotTurns();
        }, 3000);
    }
}

function checkGameStart() { if (!gameStarted && Object.keys(players).length >= 3) { gameStarted = true; startNewRound(); } }

function resetGame() { players = {}; submissions = []; czarIndex = 0; currentBlackCard = ""; gameStarted = false; io.emit('force-reload'); }

function updateAll() {
    io.emit('game-state', {
        players: Object.values(players),
        blackCard: currentBlackCard,
        czarOptions,
        submissions,
        gameStarted,
        botMode: botModeActive,
        debugMode: debugModeActive,
        czarName: Object.values(players).find(p => p.isCzar)?.username || "..."
    });
}

server.listen(PORT, () => console.log('Engine Live. Admin Access at bottom left.'));
