const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// 1. SERVING FRONTEND FILES
// This makes everything in the 'public' folder (images, html) accessible
app.use(express.static('public'));

// 2. LOADING YOUR CARDS
let whiteCards = [];
let blackCards = [];

try {
    // Reading the text files and splitting them by new line
    whiteCards = fs.readFileSync('white_cards.txt', 'utf-8').split('\n').filter(line => line.trim() !== "");
    blackCards = fs.readFileSync('black_cards.txt', 'utf-8').split('\n').filter(line => line.trim() !== "");
    console.log(`Decks loaded: ${whiteCards.length} white cards, ${blackCards.length} black cards.`);
} catch (err) {
    console.error("Error reading card files. Make sure white_cards.txt and black_cards.txt exist!", err);
}

// 3. GAME STATE (A simple object to keep track of players)
let players = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // When a player joins the lobby
    socket.on('join-game', (username) => {
        players[socket.id] = { username, score: 0, hand: [] };
        
        // Tell everyone a new player joined
        io.emit('update-player-list', Object.values(players));
        console.log(`${username} joined the lobby.`);
    });

    // When a player disconnects
    socket.on('disconnect', () => {
        if (players[socket.id]) {
            console.log(`${players[socket.id].username} left.`);
            delete players[socket.id];
            io.emit('update-player-list', Object.values(players));
        }
    });

    // Simple test event: Draw a random card
    socket.on('draw-card', () => {
        const randomCard = whiteCards[Math.floor(Math.random() * whiteCards.length)];
        socket.emit('receive-card', randomCard);
    });
});

// 4. START THE SERVER
server.listen(PORT, () => {
    console.log(`Server is live at http://localhost:${PORT}`);
});