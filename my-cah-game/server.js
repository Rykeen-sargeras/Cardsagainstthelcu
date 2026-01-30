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
let submissions = [];
let gameStarted = false;

io.on('connection', (socket) => {
    socket.on('join-game', (username) => {
        players[socket.id] = {
            id: socket.id,
            username: username || "Player",
            score: 0,
            hand: [],
            isCzar: false
        };

        // Check if we can start
        const playerCount = Object.keys(players).length;
        if (!gameStarted && playerCount >= 3) {
            gameStarted = true;
            startNewRound();
        }

        updateAll();
    });

    socket.on('play-card', (cardText) => {
        const p = players[socket.id];
        if (!p || p.isCzar || !gameStarted) return;

        submissions.push({ card: cardText, playerId: socket.id, username: p.username });
        p.hand = p.hand.filter(c => c !== cardText);
        p.hand.push(drawCard(whiteCards));

        updateAll();
    });

    socket.on('pick-winner', (playerId) => {
        if (players[socket.id]?.isCzar) {
            if (players[playerId]) players[playerId].score++;
            czarIndex++;
            startNewRound();
            updateAll();
        }
    });

    socket.on('reset-game', (password) => {
        if (password === 'Firesluts') { 
            players = {};
            submissions = [];
            czarIndex = 0;
            currentBlackCard = "";
            gameStarted = false;
            io.emit('force-reload');
        } else {
            socket.emit('error-msg', "Wrong password.");
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        if (Object.keys(players).length < 3) {
            gameStarted = false;
        } else if (gameStarted) {
            startNewRound();
        }
        updateAll();
    });
});

function drawCard(deck) {
    return deck[Math.floor(Math.random() * deck.length)];
}

function startNewRound() {
    submissions = [];
    const ids = Object.keys(players);
    if (ids.length < 3) return;

    // Deal cards if they don't have them
    ids.forEach(id => {
        while (players[id].hand.length < 10) {
            players[id].hand.push(drawCard(whiteCards));
        }
    });
    
    currentBlackCard = drawCard(blackCards);
    ids.forEach((id, index) => {
        players[id].isCzar = (index === czarIndex % ids.length);
    });
}

function updateAll() {
    io.emit('game-state', {
        players: Object.values(players),
        blackCard: currentBlackCard,
        submissions: submissions,
        gameStarted: gameStarted
    });
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
