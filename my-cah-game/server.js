/**
 * Render‑ready backend for Cards Against The LCU
 * ----------------------------------------------
 *  • Uses env.ADMIN_PASS if present (falls back to Firesluts)
 *  • Minor keep‑alive interval to prevent Render auto‑sleep during play
 *  • No file writes – all state is memory‑only
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const Filter = require("bad-words");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const ADMIN_PASS = process.env.ADMIN_PASS || "Firesluts";
const WIN_POINTS = 10;

let rawWhite = ["Blank White"];
let rawBlack = ["Blank Black"];
try {
  if (fs.existsSync("white_cards.txt"))
    rawWhite = fs.readFileSync("white_cards.txt", "utf8").split("\n").filter(Boolean);
  if (fs.existsSync("black_cards.txt"))
    rawBlack = fs.readFileSync("black_cards.txt", "utf8").split("\n").filter(Boolean);
} catch {
  console.log("Card files missing, using defaults.");
}

let whiteDeck = [];
let blackDeck = [];
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const drawWhite = () => {
  if (!whiteDeck.length) whiteDeck = shuffle([...rawWhite]);
  const card = whiteDeck.pop();
  return Math.random() < 0.1 ? "__BLANK__" : card;
};
const drawBlack = () => {
  if (!blackDeck.length) blackDeck = shuffle([...rawBlack]);
  return blackDeck.pop();
};

// state
let players = {};
let submissions = [];
let currentBlack = "";
let czarIndex = 0;
let started = false;
let readyCount = 0;

const filter = new Filter();
filter.removeWords("hell", "damn");

// util
function broadcast() {
  io.emit("state", {
    players: Object.values(players),
    blackCard: currentBlack,
    submissions,
    started,
    czarName: Object.values(players).find((p) => p.isCzar)?.username || "...",
    readyCount
  });
}
function nextRound() {
  submissions = [];
  currentBlack = drawBlack();
  const ids = Object.keys(players);
  if (ids.length < 3) return (started = false), broadcast();
  czarIndex = (czarIndex + 1) % ids.length;
  ids.forEach((id, i) => {
    players[id].isCzar = i === czarIndex;
    players[id].hasSubmitted = false;
  });
  broadcast();
}
function resetGame() {
  players = {};
  submissions = [];
  currentBlack = "";
  czarIndex = 0;
  started = false;
  readyCount = 0;
  broadcast();
}

// socket io
io.on("connection", (socket) => {
  socket.on("join", (name) => {
    if (!name) return;
    players[socket.id] = {
      id: socket.id,
      username: name.substring(0, 15),
      hand: Array.from({ length: 10 }, drawWhite),
      score: 0,
      hasSubmitted: false,
      isCzar: false,
      ready: false
    };
    broadcast();
  });

  socket.on("ready-up", () => {
    const p = players[socket.id];
    if (!p || p.ready) return;
    p.ready = true;
    readyCount++;
    const humans = Object.values(players);
    if (readyCount >= humans.length && humans.length >= 3) {
      started = true;
      czarIndex = 0;
      nextRound();
    }
    broadcast();
  });

  socket.on("submit", (card, custom) => {
    const p = players[socket.id];
    if (!p || p.isCzar || p.hasSubmitted) return;
    let playText = card;
    if (card === "__BLANK__" && custom)
      playText = filter.clean(custom.slice(0, 140));
    submissions.push({ card: playText, playerId: p.id });
    p.hasSubmitted = true;
    if (submissions.length >= Object.values(players).filter(x => !x.isCzar).length)
      submissions = shuffle(submissions);
    broadcast();
  });

  socket.on("pick", (pid) => {
    const cz = Object.values(players).find((p) => p.isCzar && p.id === socket.id);
    const winner = players[pid];
    if (!cz || !winner) return;
    winner.score++;
    io.emit("announce", winner.username);
    if (winner.score >= WIN_POINTS) {
      io.emit("final-win", winner.username);
      setTimeout(resetGame, 15000);
      return;
    }
    setTimeout(nextRound, 4000);
  });

  socket.on("chat", (msg) => {
    const p = players[socket.id];
    if (!p) return;
    const safe = filter.clean(msg.slice(0, 200));
    io.emit("chat", { user: p.username, text: safe });
  });

  socket.on("admin", (d) => {
    if (d.pw !== ADMIN_PASS) return socket.emit("a_fail");
    if (d.type === "login") socket.emit("a_ok");
    if (d.type === "reset") resetGame();
    broadcast();
  });

  socket.on("music", (data) => io.emit("music-play", data));

  socket.on("disconnect", () => {
    if (!players[socket.id]) return;
    delete players[socket.id];
    broadcast();
  });
});

server.listen(PORT, () => console.log("Server live on", PORT));
// keep-alive pings every 5 min (helps Render keep process active while players exist)
setInterval(() => console.log("⏱ keep-alive ping"), 300000);
