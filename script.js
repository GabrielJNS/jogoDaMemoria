const firebaseConfig = {
    apiKey: "AIzaSyDjyK1m44L76tvpRtV6KhEmHHumHxeNqy4",
    authDomain: "meu-jogo-velha.firebaseapp.com",
    databaseURL: "https://meu-jogo-velha-default-rtdb.firebaseio.com",
    projectId: "meu-jogo-velha",
    storageBucket: "meu-jogo-velha.firebasestorage.app",
    messagingSenderId: "699322233191",
    appId: "1:699322233191:web:cbf9ca5cc9153b2b2b7fc2"
};

firebase.initializeApp(firebaseConfig);
firebase.auth().signInAnonymously();

const db = firebase.database();

const createBtn = document.getElementById("create-room");
const shareBtn = document.getElementById("share-room");
const restartBtn = document.getElementById("restart-game");
const playerNameInput = document.getElementById("player-name");
const gridSelect = document.getElementById("grid-size-select");
const roomCodeSpan = document.getElementById("room-code");
const statusMsg = document.getElementById("status-message");
const boardDiv = document.getElementById("memory-board");
const player1NameSpan = document.getElementById("player1-name");
const player2NameSpan = document.getElementById("player2-name");
const scoreP1Span = document.getElementById("score-p1");
const scoreP2Span = document.getElementById("score-p2");
const overlay = document.getElementById("victory-overlay");
const winnerMsgSpan = document.getElementById("winner-message");
const closeOverlayBtn = document.getElementById("close-overlay");

let roomId = null;
let myPlayerId = null;
let playerName = null;
let gameRef = null;
let localLock = false;
let timeoutFlip = null;

const EMOJIS = [
    "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯",
    "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🐤", "🐴",
    "🐺", "🐝", "🐛", "🦋", "🐌", "🐞", "🐜", "🦟", "🦗", "🕷️",
    "🦂", "🐢", "🐍", "🦎", "🐙", "🦑", "🦐", "🦞", "🐠", "🐟",
    "🐡", "🐬", "🐳", "🐋", "🦈", "🦭", "🐊", "🦕", "🦖", "🍎"
];

function generateDeck(gridSize) {
    const totalPairs = (gridSize * gridSize) / 2;
    let selected = [];
    for (let i = 0; i < totalPairs; i++) {
        selected.push(EMOJIS[i % EMOJIS.length]);
    }
    let deck = [];
    selected.forEach(emoji => {
        deck.push(emoji, emoji);
    });
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck.map((emoji, idx) => ({
        id: idx,
        emoji: emoji,
        matched: false,
        flipped: false
    }));
}

function renderBoardFromData(data) {
    if (!data || !data.board) return;
    const board = data.board;
    const gridSize = data.gridSize;
    boardDiv.style.display = "grid";
    boardDiv.style.gridTemplateColumns = `repeat(${gridSize}, 1fr)`;
    boardDiv.style.gap = "12px";
    boardDiv.innerHTML = "";
    for (let i = 0; i < board.length; i++) {
        const card = board[i];
        const cell = document.createElement("div");
        cell.className = "cell";
        if (card.matched) {
            cell.classList.add("matched");
            cell.innerText = card.emoji;
        } else if (card.flipped) {
            cell.classList.add("flipped");
            cell.innerText = card.emoji;
        } else {
            cell.innerText = "?";
        }
        cell.onclick = () => onCardClick(i);
        boardDiv.appendChild(cell);
    }
}

function addTemporarySelection(index) {
    const cells = document.querySelectorAll(".cell");
    if (cells[index]) {
        cells[index].classList.add("selected-effect");
        setTimeout(() => {
            if (cells[index]) cells[index].classList.remove("selected-effect");
        }, 400);
    }
}

function checkGameOver(data) {
    if (!data.board) return false;
    const allMatched = data.board.every(card => card.matched === true);
    if (allMatched && data.active === true) {
        const p1Score = data.scores.player1;
        const p2Score = data.scores.player2;
        let winnerText = "";
        if (p1Score > p2Score) winnerText = `🏆 Jogador 1 (${data.players.player1.name}) venceu! 🎉`;
        else if (p2Score > p1Score) winnerText = `🏆 Jogador 2 (${data.players.player2.name}) venceu! 🎉`;
        else winnerText = "🤝 Empate! 🤝";
        winnerMsgSpan.innerText = winnerText;
        overlay.classList.add("show");
        gameRef.update({ active: false, winner: winnerText });
        return true;
    }
    return false;
}

async function evaluateMatch(data, idxA, idxB, currentPlayerId) {
    const cardA = data.board[idxA];
    const cardB = data.board[idxB];
    const isMatch = (cardA.emoji === cardB.emoji);
    let newBoard = [...data.board];
    let newScores = { ...data.scores };
    let nextTurn = data.currentTurn;

    if (isMatch) {
        newBoard[idxA] = { ...cardA, matched: true, flipped: false };
        newBoard[idxB] = { ...cardB, matched: true, flipped: false };
        newScores[currentPlayerId] += 1;
        nextTurn = currentPlayerId;
    } else {
        newBoard[idxA] = { ...cardA, flipped: false };
        newBoard[idxB] = { ...cardB, flipped: false };
        nextTurn = (currentPlayerId === "player1") ? "player2" : "player1";
    }

    await gameRef.update({
        board: newBoard,
        scores: newScores,
        currentTurn: nextTurn,
        waitingForReset: false,
        flippedPairIndices: []
    });

    const snap = await gameRef.get();
    checkGameOver(snap.val());
}

async function onCardClick(index) {
    if (localLock) return;
    const snap = await gameRef.get();
    const data = snap.val();
    if (!data || !data.active) {
        statusMsg.innerText = "✨ A partida acabou! Clique em Nova Rodada ✨";
        return;
    }
    if (data.currentTurn !== myPlayerId) {
        statusMsg.innerText = `🌟 É a vez de ${data.currentTurn === "player1" ? data.players.player1.name : data.players.player2.name}! Aguarde 🌟`;
        return;
    }
    const card = data.board[index];
    if (card.matched || card.flipped) return;
    if (data.waitingForReset === true) return;

    addTemporarySelection(index);

    let newBoard = [...data.board];
    newBoard[index] = { ...card, flipped: true };
    await gameRef.update({ board: newBoard });

    const updatedSnap = await gameRef.get();
    const updatedData = updatedSnap.val();
    const flippedIndices = updatedData.board.reduce((acc, c, i) => {
        if (c.flipped && !c.matched) acc.push(i);
        return acc;
    }, []);

    if (flippedIndices.length === 2) {
        await gameRef.update({ waitingForReset: true });
        localLock = true;
        const [i1, i2] = flippedIndices;
        setTimeout(async () => {
            const finalSnap = await gameRef.get();
            const finalData = finalSnap.val();
            await evaluateMatch(finalData, i1, i2, updatedData.currentTurn);
            localLock = false;
        }, 550);
    }
}

function startListening() {
    if (gameRef) gameRef.off();
    gameRef = db.ref("rooms/" + roomId);
    gameRef.on("value", (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        renderBoardFromData(data);
        player1NameSpan.innerText = data.players.player1.name;
        player2NameSpan.innerText = data.players.player2.name;
        scoreP1Span.innerText = data.scores.player1;
        scoreP2Span.innerText = data.scores.player2;
        roomCodeSpan.innerText = `🏠 Sala: ${roomId}`;

        if (data.active) {
            if (data.currentTurn === myPlayerId) {
                statusMsg.innerText = "🎯 Sua vez! Escolha uma carta 🎯";
            } else {
                const opponent = data.currentTurn === "player1" ? data.players.player1.name : data.players.player2.name;
                statusMsg.innerText = `🌀 Vez de ${opponent}... aguarde 🌀`;
            }
        } else {
            statusMsg.innerText = "🎮 Jogo finalizado. Clique em Nova Rodada! 🎮";
        }
        checkGameOver(data);
    });
}

async function createRoom() {
    sessionStorage.removeItem("reloaded");
    playerName = playerNameInput.value.trim();
    if (!playerName) {
        alert("Digite seu nome!");
        return;
    }
    const gridSize = parseInt(gridSelect.value);
    myPlayerId = "player1";
    const deck = generateDeck(gridSize);
    const newRoom = db.ref("rooms").push();
    roomId = newRoom.key;

    await newRoom.set({
        gridSize: gridSize,
        board: deck,
        currentTurn: "player1",
        active: true,
        winner: null,
        waitingForReset: false,
        scores: { player1: 0, player2: 0 },
        players: {
            player1: { name: playerName },
            player2: { name: "✨ Esperando... ✨" }
        }
    });
    startListening();
}

async function joinRoom(roomIdFromUrl) {
    playerName = prompt("Digite seu nome:");
    if (!playerName) return;
    const roomRef = db.ref("rooms/" + roomIdFromUrl);
    const snap = await roomRef.get();
    const data = snap.val();
    if (!data) {
        alert("Sala não encontrada!");
        window.location.href = window.location.pathname;
        return;
    }
    if (data.players.player2.name !== "✨ Esperando... ✨") {
        alert("Sala cheia!");
        window.location.href = window.location.pathname;
        return;
    }
    myPlayerId = "player2";
    roomId = roomIdFromUrl;
    await roomRef.child("players/player2").set({ name: playerName });
    startListening();
}

async function restartGame() {
    if (!roomId) return;
    const snap = await gameRef.get();
    const data = snap.val();
    if (!data) return;
    const newDeck = generateDeck(data.gridSize);
    await gameRef.update({
        board: newDeck,
        currentTurn: "player1",
        active: true,
        winner: null,
        waitingForReset: false,
        scores: { player1: 0, player2: 0 }
    });
    localLock = false;
    if (timeoutFlip) clearTimeout(timeoutFlip);
    overlay.classList.remove("show");
}

function shareRoom() {
    if (!roomId) {
        alert("Crie uma sala primeiro!");
        return;
    }
    const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(link);
    alert("Link copiado! Compartilhe com um amigo.");
}

createBtn.onclick = createRoom;
shareBtn.onclick = shareRoom;
restartBtn.onclick = restartGame;
closeOverlayBtn.onclick = () => overlay.classList.remove("show");

window.onload = () => {
    if (!sessionStorage.getItem("reloaded")) {
        sessionStorage.setItem("reloaded", "true");
        location.reload();
        return;
    }
    const roomParam = new URLSearchParams(window.location.search).get("room");
    if (roomParam) {
        joinRoom(roomParam);
    }
};
