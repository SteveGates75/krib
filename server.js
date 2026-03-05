const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

// Store rooms and users
const rooms = new Map();

// Serve static files
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', (roomId, username) => {
        console.log(`${username} joining ${roomId}`);
        
        // Leave previous rooms
        socket.rooms.forEach(room => {
            if (room !== socket.id) {
                socket.leave(room);
            }
        });

        socket.join(roomId);
        
        // Store user
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
        }
        rooms.get(roomId).set(socket.id, username);

        // Notify others
        socket.to(roomId).emit('user-connected', {
            userId: socket.id,
            username: username
        });

        // Send existing users
        const users = Array.from(rooms.get(roomId)).map(([id, name]) => ({
            userId: id,
            username: name
        }));
        
        socket.emit('room-users', users);
    });

    // WebRTC signaling
    socket.on('offer', (data) => {
        socket.to(data.target).emit('offer', {
            offer: data.offer,
            sender: socket.id,
            senderUsername: data.senderUsername
        });
    });

    socket.on('answer', (data) => {
        socket.to(data.target).emit('answer', {
            answer: data.answer,
            sender: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.target).emit('ice-candidate', {
            candidate: data.candidate,
            sender: socket.id
        });
    });

    // Chat
    socket.on('chat-message', (data) => {
        io.to(data.roomId).emit('chat-message', {
            username: data.username,
            message: data.message,
            time: new Date().toLocaleTimeString()
        });
    });

    // Disconnect
    socket.on('disconnect', () => {
        rooms.forEach((users, roomId) => {
            if (users.has(socket.id)) {
                const username = users.get(socket.id);
                users.delete(socket.id);
                
                socket.to(roomId).emit('user-disconnected', {
                    userId: socket.id,
                    username: username
                });

                if (users.size === 0) {
                    rooms.delete(roomId);
                }
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});