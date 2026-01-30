const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// Load Cards from your .txt files
let whiteCards = fs.readFileSync('white_cards.txt', 'utf-8').split('\n').filter(l => l.trim() !== "");
let blackCards = fs.readFileSync('black_cards.txt', 'utf-8').split('\n').filter(l => l.trim() !== "");

let players = {};
let czarIndex = 0;
let currentBlackCard = "";
let submissions = []; 

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-game', (username) => {
        players[socket.id] = {
            id: socket.id,
            username: username || "Player",
            score: 0,
            hand: [],
            isCzar: false
        };

        // Deal exactly 10 cards
        for (let i = 0; i < 10; i++) {
            players[socket.id].hand.push(drawCard(whiteCards));
        }

        if (Object.keys(players).length === 1) startNewRound();
        updateAll();
    });

    socket.on('play-card', (cardText) => {
        const p = players[socket.id];
        if (!p || p.isCzar) return;

        // Play card and refill hand to exactly 10
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

    // PASSWORD PROTECTED RESET
    socket.on('reset-game', (password) => {
        if (password === 'Firesluts') { 
            players = {};
            submissions = [];
            czarIndex = 0;
            currentBlackCard = "";
            io.emit('force-reload');
        } else {
            socket.emit('error-msg', "Wrong password, buddy.");
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        if (Object.keys(players).length > 0) {
            // Re-assign Czar if the current one left
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
    if (ids.length === 0) return;
    
    currentBlackCard = drawCard(blackCards);
    ids.forEach((id, index) => {
        players[id].isCzar = (index === czarIndex % ids.length);
    });
}

function updateAll() {
    io.emit('game-state', {
        players: Object.values(players),
        blackCard: currentBlackCard,
        submissions: submissions
    });
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
