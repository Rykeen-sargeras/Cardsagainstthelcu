const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

let whiteCards = fs.readFileSync('white_cards.txt', 'utf-8').split('\n').filter(l => l.trim() !== "");
let blackCards = fs.readFileSync('black_cards.txt', 'utf-8').split('\n').filter(l => l.trim() !== "");

let players = {};
let czarIndex = 0;
let currentBlackCard = "";
let czarOptions = [];
let submissions = [];
let gameStarted = false;
let roundTimer = null;
const WIN_LIMIT = 7;

io.on('connection', (socket) => {
    socket.on('join-game', (username) => {
        players[socket.id] = { id: socket.id, username: username || "Player", score: 0, hand: [], isCzar: false, hasSubmitted: false };
        if (!gameStarted && Object.keys(players).length >= 3) { gameStarted = true; startNewRound(); }
        updateAll();
    });

    socket.on('send-chat', (msg) => {
        const p = players[socket.id];
        if (p) io.emit('new-chat', { user: p.username, text: msg });
    });

    socket.on('czar-select-black', (card) => {
        if (players[socket.id]?.isCzar) {
            currentBlackCard = card;
            czarOptions = [];
            startTimeoutCounter();
            updateAll();
        }
    });

    socket.on('submit-card', (cardText) => {
        const p = players[socket.id];
        if (!p || p.isCzar || p.hasSubmitted || !currentBlackCard) return;
        submissions.push({ card: cardText, playerId: socket.id, username: p.username });
        p.hand = p.hand.filter(c => c !== cardText);
        p.hand.push(drawCard(whiteCards));
        p.hasSubmitted = true;
        updateAll();
    });

    socket.on('pick-winner', (playerId) => {
        if (players[socket.id]?.isCzar && submissions.length > 0) {
            const winner = players[playerId];
            if (winner) {
                winner.score++;
                io.emit('round-winner', { name: winner.username, id: winner.id });

                if (winner.score >= WIN_LIMIT) {
                    io.emit('game-over', winner.username);
                    setTimeout(() => { resetGameLogic(); }, 8000);
                } else {
                    setTimeout(() => { czarIndex++; startNewRound(); updateAll(); }, 4000);
                }
            }
        }
    });

    socket.on('reset-game', (password) => {
        if (password === 'Firesluts') resetGameLogic();
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        if (Object.keys(players).length < 3) { gameStarted = false; currentBlackCard = ""; }
        updateAll();
    });
});

function drawCard(deck) { return deck[Math.floor(Math.random() * deck.length)]; }

function resetGameLogic() {
    players = {}; submissions = []; czarIndex = 0; currentBlackCard = ""; gameStarted = false;
    if (roundTimer) clearTimeout(roundTimer);
    io.emit('force-reload');
}

function startNewRound() {
    if (roundTimer) clearTimeout(roundTimer);
    submissions = [];
    currentBlackCard = "";
    const ids = Object.keys(players);
    ids.forEach((id, index) => {
        players[id].isCzar = (index === czarIndex % ids.length);
        players[id].hasSubmitted = false;
        while (players[id].hand.length < 10) players[id].hand.push(drawCard(whiteCards));
    });
    czarOptions = [drawCard(blackCards), drawCard(blackCards)];
}

function startTimeoutCounter() {
    if (roundTimer) clearTimeout(roundTimer);
    roundTimer = setTimeout(() => {
        Object.keys(players).forEach(id => {
            if (!players[id].isCzar && !players[id].hasSubmitted) {
                io.to(id).emit('force-reload', "Kicked for AFK!");
                delete players[id];
            }
        });
        if (Object.keys(players).length >= 3) { czarIndex++; startNewRound(); } 
        else { gameStarted = false; }
        updateAll();
    }, 125000);
}

function updateAll() {
    io.emit('game-state', {
        players: Object.values(players),
        blackCard: currentBlackCard,
        czarOptions: czarOptions,
        submissions: submissions,
        gameStarted: gameStarted,
        czarName: Object.values(players).find(p => p.isCzar)?.username || "..."
    });
}

server.listen(PORT, () => console.log(`Server on ${PORT}`));
