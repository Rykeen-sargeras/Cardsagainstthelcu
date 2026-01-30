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

/* ----- core config ----- */
const ADMIN_PASS = process.env.ADMIN_PASS || "Firesluts";
const WIN_POINTS = 10;
const KEEPALIVE_MS = 300_000;

/* ----- cards load ----- */
let rawWhite = ["Blank White"];
let rawBlack = ["Blank Black"];
try {
  if (fs.existsSync("white_cards.txt"))
    rawWhite = fs.readFileSync("white_cards.txt", "utf8").split("\n").filter(Boolean);
  if (fs.existsSync("black_cards.txt"))
    rawBlack = fs.readFileSync("black_cards.txt", "utf8").split("\n").filter(Boolean);
} catch {
  console.log("⚠️  Using fallback card text");
}

/* ----- decks ----- */
let whiteDeck=[],blackDeck=[];
const shuffle = (a)=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const drawWhite = ()=>{if(!whiteDeck.length)whiteDeck=shuffle([...rawWhite]);return Math.random()<0.1?"__BLANK__":whiteDeck.pop();};
const drawBlack = ()=>{if(!blackDeck.length)blackDeck=shuffle([...rawBlack]);return blackDeck.pop();};

/* ----- game state ----- */
let players={};
let submissions=[];
let currentBlack="";
let czarIndex=0;
let started=false;
let readyCount=0;
let currentMusic=null;
let skipVotes=new Set();

const filter=new Filter();
filter.removeWords("hell","damn");

function broadcast(){
  io.emit("state",{
    players:Object.values(players),
    blackCard:currentBlack,
    submissions,
    started,
    czarName:Object.values(players).find(p=>p.isCzar)?.username||"...",
    readyCount
  });
}
function nextRound(){
  submissions=[]; currentBlack=drawBlack();
  const ids=Object.keys(players);
  if(ids.length<3){started=false;return broadcast();}
  czarIndex=(czarIndex+1)%ids.length;
  ids.forEach((id,i)=>{players[id].isCzar=i===czarIndex;players[id].hasSubmitted=false;});
  broadcast();
}
function resetGame(){
  players={};submissions=[];currentBlack="";czarIndex=0;started=false;readyCount=0;
  currentMusic=null;skipVotes.clear();
  broadcast();
}

/* ----- sockets ----- */
io.on("connection",socket=>{
  socket.on("join",name=>{
    if(!name)return;
    players[socket.id]={id:socket.id,username:name.substring(0,15),
      hand:Array.from({length:10},drawWhite),
      score:0,hasSubmitted:false,isCzar:false,ready:false};
    broadcast();
  });

  socket.on("ready-up",()=>{
    const p=players[socket.id]; if(!p||p.ready)return;
    p.ready=true; readyCount++;
    const humans=Object.values(players);
    if(readyCount>=humans.length && humans.length>=3){
      started=true; czarIndex=0; nextRound();
    }
    broadcast();
  });

  socket.on("submit",(card,custom)=>{
    const p=players[socket.id];
    if(!p||p.isCzar||p.hasSubmitted)return;
    let text=card==="__BLANK__"&&custom?filter.clean(custom.slice(0,140)):card;
    submissions.push({card:text,playerId:p.id});
    p.hasSubmitted=true;
    const nonC=Object.values(players).filter(x=>!x.isCzar).length;
    if(submissions.length>=nonC)submissions=shuffle(submissions);
    broadcast();
  });

  socket.on("pick",pid=>{
    const cz=Object.values(players).find(p=>p.isCzar&&p.id===socket.id);
    const win=players[pid]; if(!cz||!win)return;
    win.score++; io.emit("announce",win.username);
    if(win.score>=WIN_POINTS){io.emit("final-win",win.username);return setTimeout(resetGame,15000);}
    setTimeout(nextRound,4000);
  });

  socket.on("chat",msg=>{
    const p=players[socket.id]; if(!p)return;
    io.emit("chat",{user:p.username,text:filter.clean(msg.slice(0,200))});
  });

  /* ADMIN + MUSIC */
  socket.on("admin",d=>{
    if(d.pw!==ADMIN_PASS)return socket.emit("a_fail");
    if(d.type==="login")return socket.emit("a_ok");
    if(d.type==="reset")return resetGame();
    if(d.type==="music-start"){currentMusic=d.url;skipVotes.clear();io.emit("music-start",{url:d.url});}
  });
  socket.on("vote-skip",()=>{
    if(!currentMusic)return;
    skipVotes.add(socket.id);
    if(skipVotes.size>=Math.ceil(Object.keys(players).length/2)){
      io.emit("music-skip");
      currentMusic=null; skipVotes.clear();
    }
  });

  socket.on("disconnect",()=>{
    if(!players[socket.id])return;
    delete players[socket.id]; broadcast();
  });
});

server.listen(PORT,()=>console.log("🎮 Server live on "+PORT));
setInterval(()=>console.log("⏱ keep-alive"),KEEPALIVE_MS);
