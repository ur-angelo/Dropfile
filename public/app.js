const socket = io();

let peer = null;
let dataChannel = null;

let roomId = null;
let isInitiator = false;

let selectedFile = null;
let incomingFile = null;
let incomingChunks = [];

let receivedBytes = 0;
let expectedBytes = 0;
let startTime = 0;

const CHUNK_SIZE = 256 * 1024;
const MAX_BUFFER = 8 * 1024 * 1024;
const LOW_BUFFER = 2 * 1024 * 1024;

const status = document.getElementById("status");
const connectionBadge = document.getElementById("connectionBadge");
const connectionBadgeText = connectionBadge.querySelector("span");
const roomCode = document.getElementById("roomCode");
const qrcode = document.getElementById("qrcode");
const dropArea = document.getElementById("dropArea");
const fileInput = document.getElementById("fileInput");
const selectedFileBox = document.getElementById("selectedFile");
const fileName = document.getElementById("fileName");
const fileSize = document.getElementById("fileSize");
const sendButton = document.getElementById("sendButton");
const progressCard = document.getElementById("progressCard");
const progress = document.getElementById("progress");
const percentage = document.getElementById("percentage");
const transferLabel = document.getElementById("transferLabel");
const transferFileName = document.getElementById("transferFileName");
const transferred = document.getElementById("transferred");
const speed = document.getElementById("speed");
const time = document.getElementById("time");
const receivedCard = document.getElementById("receivedCard");
const receivedFileName = document.getElementById("receivedFileName");
const downloadButton = document.getElementById("downloadButton");

const connectionCard = document.getElementById("connectionCard");
const transferCard = document.getElementById("transferCard");
const copyCodeBtn = document.getElementById("copyCodeBtn");
const tabQrBtn = document.getElementById("tabQrBtn");
const tabCodeBtn = document.getElementById("tabCodeBtn");
const qrMode = document.getElementById("qrMode");
const codeMode = document.getElementById("codeMode");
const joinRoomInput = document.getElementById("joinRoomInput");
const joinRoomBtn = document.getElementById("joinRoomBtn");

function generateRoom() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "";
    for (let i = 0; i < 6; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

const params = new URLSearchParams(location.search);
const urlRoom = params.get("room");

if (urlRoom) {
    roomId = urlRoom.toUpperCase();
} else {
    roomId = generateRoom();
}

roomCode.textContent = roomId;
const joinURL = `${location.origin}/?room=${roomId}`;

new QRCode(qrcode, {
    text: joinURL,
    width: 190,
    height: 190
});

socket.emit("join-room", roomId);

tabQrBtn.addEventListener("click", () => {
    tabQrBtn.classList.add("active");
    tabCodeBtn.classList.remove("active");
    qrMode.classList.remove("hidden");
    codeMode.classList.add("hidden");
});

tabCodeBtn.addEventListener("click", () => {
    tabCodeBtn.classList.add("active");
    tabQrBtn.classList.remove("active");
    codeMode.classList.remove("hidden");
    qrMode.classList.add("hidden");
});

copyCodeBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(roomId).then(() => {
        copyCodeBtn.textContent = "Copied!";
        setTimeout(() => copyCodeBtn.textContent = "Copy", 2000);
    });
});

joinRoomBtn.addEventListener("click", () => {
    const code = joinRoomInput.value.trim().toUpperCase();
    if (code.length === 6) {
        window.location.href = `/?room=${code}`;
    } else {
        alert("Please enter a valid 6-character room code.");
    }
});

socket.on("room-joined", ({ isInitiator: init }) => {
    isInitiator = init;
    setStatus("Waiting for device...");
});

socket.on("peer-joined", async () => {
    setStatus("Connecting...");
    if (isInitiator) {
        createPeer();
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        sendSignal(peer.localDescription);
    }
});

socket.on("signal", async data => {
    if (!peer) createPeer();

    if (data.type === "offer") {
        await peer.setRemoteDescription(data);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        sendSignal(peer.localDescription);
    } else if (data.type === "answer") {
        await peer.setRemoteDescription(data);
    } else if (data.type === "candidate") {
        try {
            await peer.addIceCandidate(data.candidate);
        } catch (e) {
            console.log("ICE error", e);
        }
    }
});

socket.on("room-full", () => {
    setStatus("Room is full");
});

function createPeer() {
    if (peer) return;

    peer = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" }
        ]
    });

    peer.onicecandidate = event => {
        if (event.candidate) {
            sendSignal({
                type: "candidate",
                candidate: event.candidate
            });
        }
    };

    peer.onconnectionstatechange = () => {
        const state = peer.connectionState;
        if (state === "connected") {
            setConnected();
        }
        if (state === "disconnected" || state === "failed") {
            setStatus("Connection lost");
            connectionBadge.classList.remove("connected");
            connectionBadge.classList.add("waiting");
            connectionBadgeText.textContent = "Disconnected";
            
            connectionCard.classList.remove("hidden");
            transferCard.classList.add("hidden");
        }
    };

    if (isInitiator) {
        dataChannel = peer.createDataChannel("file-transfer", { ordered: true });
        setupDataChannel(dataChannel);
    } else {
        peer.ondatachannel = event => {
            dataChannel = event.channel;
            setupDataChannel(dataChannel);
        };
    }
}

function sendSignal(data) {
    socket.emit("signal", { roomId, data });
}

function setupDataChannel(channel) {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = LOW_BUFFER;

    channel.onopen = () => {
        setConnected();
    };

    channel.onmessage = event => {
        if (typeof event.data === "string") {
            handleMessage(event.data);
        } else {
            receiveChunk(event.data);
        }
    };

    channel.onerror = error => {
        console.error("DataChannel:", error);
        setStatus("Transfer error");
    };
}

function setStatus(text) {
    status.textContent = text;
}

function setConnected() {
    setStatus("✓ Device connected");
    connectionBadge.classList.remove("waiting");
    connectionBadge.classList.add("connected");
    connectionBadgeText.textContent = "Connected";

    connectionCard.classList.add("hidden");
    transferCard.classList.remove("hidden");
}

fileInput.addEventListener("change", () => {
    if (fileInput.files.length === 0) return;
    selectFile(fileInput.files[0]);
});

function selectFile(file) {
    selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    selectedFileBox.classList.remove("hidden");
}

dropArea.addEventListener("dragover", event => {
    event.preventDefault();
    dropArea.classList.add("dragging");
});

dropArea.addEventListener("dragleave", () => {
    dropArea.classList.remove("dragging");
});

dropArea.addEventListener("drop", event => {
    event.preventDefault();
    dropArea.classList.remove("dragging");
    const file = event.dataTransfer.files[0];
    if (file) selectFile(file);
});

sendButton.addEventListener("click", async () => {
    if (!selectedFile) return;

    if (!dataChannel || dataChannel.readyState !== "open") {
        alert("Connect your device first.");
        return;
    }

    sendButton.disabled = true;
    progressCard.classList.remove("hidden");
    receivedCard.classList.add("hidden");

    transferLabel.textContent = "SENDING";
    transferFileName.textContent = selectedFile.name;
    startTime = performance.now();

    dataChannel.send(JSON.stringify({
        type: "file-start",
        name: selectedFile.name,
        size: selectedFile.size,
        mime: selectedFile.type || "application/octet-stream"
    }));

    await sendFile(selectedFile);

    dataChannel.send(JSON.stringify({ type: "file-end" }));

    updateProgress(
        selectedFile.size,
        selectedFile.size,
        selectedFile.size / ((performance.now() - startTime) / 1000)
    );

    transferLabel.textContent = "COMPLETED";
    sendButton.disabled = false;
});

async function sendFile(file) {
    let offset = 0;
    while (offset < file.size) {
        while (dataChannel.bufferedAmount > MAX_BUFFER) {
            await waitForBuffer();
        }
        const chunk = file.slice(offset, offset + CHUNK_SIZE);
        const buffer = await chunk.arrayBuffer();
        dataChannel.send(buffer);
        offset += buffer.byteLength;
        const elapsed = (performance.now() - startTime) / 1000;
        const bytesPerSecond = offset / elapsed;
        updateProgress(offset, file.size, bytesPerSecond);
        await sleep(0);
    }
}

function waitForBuffer() {
    return new Promise(resolve => {
        const check = () => {
            if (dataChannel.bufferedAmount <= LOW_BUFFER) {
                resolve();
            } else {
                setTimeout(check, 10);
            }
        };
        check();
    });
}

function handleMessage(message) {
    let data;
    try {
        data = JSON.parse(message);
    } catch {
        return;
    }

    if (data.type === "file-start") {
        incomingFile = { name: data.name, size: data.size, mime: data.mime };
        incomingChunks = [];
        receivedBytes = 0;
        expectedBytes = data.size;
        startTime = performance.now();

        progressCard.classList.remove("hidden");
        receivedCard.classList.add("hidden");
        transferLabel.textContent = "RECEIVING";
        transferFileName.textContent = data.name;
        updateProgress(0, data.size, 0);
    }

    if (data.type === "file-end") {
        finishReceive();
    }
}

function receiveChunk(chunk) {
    incomingChunks.push(chunk);
    receivedBytes += chunk.byteLength;
    const elapsed = (performance.now() - startTime) / 1000;
    const bytesPerSecond = receivedBytes / elapsed;
    updateProgress(receivedBytes, expectedBytes, bytesPerSecond);
}

function finishReceive() {
    updateProgress(
        expectedBytes,
        expectedBytes,
        expectedBytes / ((performance.now() - startTime) / 1000)
    );

    transferLabel.textContent = "COMPLETED";
    const blob = new Blob(incomingChunks, { type: incomingFile.mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);

    receivedFileName.textContent = `${incomingFile.name} • ${formatBytes(incomingFile.size)}`;

    downloadButton.onclick = () => {
        const link = document.createElement("a");
        link.href = url;
        link.download = incomingFile.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    receivedCard.classList.remove("hidden");
}

function updateProgress(current, total, bytesPerSecond) {
    const percent = total > 0 ? (current / total) * 100 : 0;
    progress.style.width = `${Math.min(percent, 100)}%`;
    percentage.textContent = `${percent.toFixed(1)}%`;
    transferred.textContent = `${formatBytes(current)} / ${formatBytes(total)}`;
    speed.textContent = `${formatBytes(bytesPerSecond)}/s`;

    if (bytesPerSecond > 0 && current < total) {
        const remaining = total - current;
        const seconds = remaining / bytesPerSecond;
        time.textContent = formatTime(seconds);
    } else {
        time.textContent = "Done";
    }
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 2) + " " + units[index];
}

function formatTime(seconds) {
    if (!isFinite(seconds)) return "--";
    seconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}