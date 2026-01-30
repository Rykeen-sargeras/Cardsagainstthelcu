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

/* ----- Config ----- */
const ADMIN_PASS = process.env.ADMIN_PASS || "Firesluts";
const WIN_POINTS = 10;
const KEEPALIVE_MS = 300000;

/* ----- Load Cards ----- */
let rawWhite = ["Blank White", "Test Card 1", "Test Card 2"];
let rawBlack = ["Blank Black ___", "Test Black ___"];

try {
  if (fs.existsSync("white_cards.txt")) {
    rawWhite = fs.readFileSync("white_cards.txt", "utf8")
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);
  }
  if (fs.existsSync("black_cards.txt")) {
    rawBlack = fs.readFileSync("black_cards.txt", "utf8")
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);
  }
} catch (e) {
  console.log("⚠️  Card files missing, using defaults");
}

/* ----- Deck Logic ----- */
let whiteDeck = [];
let blackDeck = [];

const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const drawWhite = () => {
  if (whiteDeck.length === 0) whiteDeck = shuffle([...rawWhite]);
  const card = whiteDeck.pop();
  return Math.random() < 0.1 ? "__BLANK__" : card;
};

const drawBlack = () => {
  if (blackDeck.length === 0) blackDeck = shuffle([...rawBlack]);
  return blackDeck.pop();
};

/* ----- Game State ----- */
let players = {};
let submissions = [];
let currentBlack = "";
let czarIndex = 0;
let started = false;
let readyCount = 0;
let currentMusic = null;
let skipVotes = new Set();

const filter = new Filter();
filter.removeWords("hell", "damn", "god");

/* ----- Helper Functions ----- */
function broadcast() {
  io.emit("state", {
    players: Object.values(players),
    blackCard: currentBlack,
    submissions,
    started,
    czarName: Object.values(players).find(p => p.isCzar)?.username || "...",
    readyCount
  });
}

function nextRound() {
  submissions = [];
  currentBlack = drawBlack();
  
  const ids = Object.keys(players);
  if (ids.length < 3) {
    started = false;
    return broadcast();
  }
  
  czarIndex = (czarIndex + 1) % ids.length;
  
  ids.forEach((id, i) => {
    players[id].isCzar = (i === czarIndex);
    players[id].hasSubmitted = false;
  });
  
  // Auto-submit for bots after delay
  setTimeout(() => {
    Object.values(players).forEach(p => {
      if (p.isBot && !p.isCzar && !p.hasSubmitted && p.hand.length > 0) {
        const card = p.hand[Math.floor(Math.random() * p.hand.length)];
        const text = card === "__BLANK__" ? "Bot's funny joke" : card;
        submissions.push({ card: text, playerId: p.id });
        p.hand = p.hand.filter(c => c !== card);
        p.hand.push(drawWhite());
        p.hasSubmitted = true;
      }
    });
    
    const nonCzar = Object.values(players).filter(p => !p.isCzar).length;
    if (submissions.length >= nonCzar) {
      submissions = shuffle([...submissions]);
    }
    broadcast();
  }, 2000);
  
  broadcast();
}

function resetGame() {
  players = {};
  submissions = [];
  currentBlack = "";
  czarIndex = 0;
  started = false;
  readyCount = 0;
  currentMusic = null;
  skipVotes.clear();
  io.emit("force-reload");
}

function addBot() {
  const id = "bot_" + Math.random().toString(36).substr(2, 6);
  const botNames = ["🤖 Botrick", "🤖 RoboCard", "🤖 AI McBot", "🤖 ByteBot", "🤖 CardBot"];
  players[id] = {
    id,
    username: botNames[Math.floor(Math.random() * botNames.length)],
    score: 0,
    hand: Array.from({ length: 10 }, drawWhite),
    hasSubmitted: false,
    isCzar: false,
    ready: true,
    isBot: true
  };
  console.log("🤖 Bot added:", players[id].username);
  
  // Auto-ready bots and check start condition
  const humans = Object.values(players).filter(p => !p.isBot);
  const allHumansReady = humans.every(p => p.ready);
  
  if (!started && Object.keys(players).length >= 3 && allHumansReady && readyCount >= humans.length) {
    started = true;
    czarIndex = 0;
    nextRound();
  }
}

/* ----- Socket Events ----- */
io.on("connection", (socket) => {
  console.log("🔌 Player connected:", socket.id);
  
  socket.on("join", (name) => {
    if (!name || !name.trim()) return;
    
    players[socket.id] = {
      id: socket.id,
      username: name.substring(0, 15),
      hand: Array.from({ length: 10 }, drawWhite),
      score: 0,
      hasSubmitted: false,
      isCzar: false,
      ready: false,
      isBot: false
    };
    
    console.log("👤 Player joined:", name);
    broadcast();
  });

  socket.on("ready-up", () => {
    const p = players[socket.id];
    if (!p || p.ready) return;
    
    p.ready = true;
    readyCount++;
    
    const humans = Object.values(players).filter(pl => !pl.isBot);
    const totalPlayers = Object.keys(players).length;
    
    if (readyCount >= humans.length && totalPlayers >= 3) {
      started = true;
      czarIndex = 0;
      nextRound();
    }
    
    broadcast();
  });

  socket.on("submit", (card, custom) => {
    const p = players[socket.id];
    if (!p || p.isCzar || p.hasSubmitted) return;
    
    let text = card;
    if (card === "__BLANK__" && custom) {
      text = filter.clean(custom.slice(0, 140));
    }
    
    submissions.push({ card: text, playerId: p.id });
    p.hand = p.hand.filter(c => c !== card);
    p.hand.push(drawWhite());
    p.hasSubmitted = true;
    
    const nonCzar = Object.values(players).filter(x => !x.isCzar).length;
    if (submissions.length >= nonCzar) {
      submissions = shuffle([...submissions]);
    }
    
    broadcast();
  });

  socket.on("pick", (pid) => {
    const czar = Object.values(players).find(p => p.isCzar && p.id === socket.id);
    const winner = players[pid];
    
    if (!czar || !winner) return;
    
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
    
    const clean = filter.clean(msg.slice(0, 200));
    io.emit("chat", { user: p.username, text: clean });
  });

  socket.on("admin", (d) => {
    if (!d || d.pw !== ADMIN_PASS) return socket.emit("a_fail");
    
    if (d.type === "login") {
      socket.emit("a_ok");
    }
    
    if (d.type === "reset") {
      resetGame();
    }
    
    if (d.type === "add-bots") {
      const count = parseInt(d.count) || 1;
      for (let i = 0; i < Math.min(count, 5); i++) {
        addBot();
      }
      broadcast();
    }
    
    if (d.type === "music-start") {
      currentMusic = d.url;
      skipVotes.clear();
      io.emit("music-start", { url: d.url });
    }
    
    if (d.type === "wipe-chat") {
      io.emit("wipe-chat");
    }
  });

  socket.on("vote-skip", () => {
    if (!currentMusic) return;
    
    skipVotes.add(socket.id);
    const totalPlayers = Object.keys(players).length;
    
    if (skipVotes.size >= Math.ceil(totalPlayers / 2)) {
      io.emit("music-skip");
      currentMusic = null;
      skipVotes.clear();
    }
  });

  socket.on("disconnect", () => {
    const p = players[socket.id];
    if (!p) return;
    
    console.log("🔌 Player disconnected:", p.username);
    
    const wasCzar = p.isCzar;
    if (p.ready && !p.isBot) readyCount--;
    
    delete players[socket.id];
    submissions = submissions.filter(s => s.playerId !== socket.id);
    skipVotes.delete(socket.id);
    
    const remaining = Object.keys(players).length;
    
    if (remaining < 3) {
      started = false;
      submissions = [];
      currentBlack = "";
    } else if (wasCzar && started) {
      nextRound();
    }
    
    broadcast();
  });
});

/* ----- Start Server ----- */
server.listen(PORT, () => {
  console.log(`🎮 Cards Against The LCU server running on port ${PORT}`);
});

setInterval(() => {
  console.log("⏱ keep-alive ping");
}, KEEPALIVE_MS);
