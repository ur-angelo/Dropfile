const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
    console.log("Connected:", socket.id);

    socket.on("join-room", (roomId) => {
        const room = io.sockets.adapter.rooms.get(roomId);

        if (room && room.size >= 2) {
            socket.emit("room-full");
            return;
        }

        socket.join(roomId);

        const clients = Array.from(
            io.sockets.adapter.rooms.get(roomId) || []
        );

        socket.emit("room-joined", {
            roomId,
            isInitiator: clients[0] === socket.id
        });

        socket.to(roomId).emit("peer-joined");
    });

    socket.on("signal", ({ roomId, data }) => {
        socket.to(roomId).emit("signal", data);
    });

    socket.on("disconnect", () => {
        console.log("Disconnected:", socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});