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

// Store rooms
const rooms = new Map();

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', (roomId, username, isMobile) => {
        console.log(`${username} (${isMobile ? 'mobile' : 'desktop'}) joining ${roomId}`);
        
        socket.rooms.forEach(room => {
            if (room !== socket.id) {
                socket.leave(room);
            }
        });

        socket.join(roomId);
        
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
        }
        rooms.get(roomId).set(socket.id, { username, isMobile });

        // Send existing users to new user
        const users = Array.from(rooms.get(roomId)).map(([id, data]) => ({
            userId: id,
            username: data.username,
            isMobile: data.isMobile
        }));
        socket.emit('all-users', users);

        // Notify others
        socket.to(roomId).emit('user-connected', {
            userId: socket.id,
            username: username,
            isMobile: isMobile
        });
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
                const userData = users.get(socket.id);
                users.delete(socket.id);
                
                socket.to(roomId).emit('user-disconnected', {
                    userId: socket.id,
                    username: userData.username
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