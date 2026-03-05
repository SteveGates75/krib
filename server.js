const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Updated Socket.io configuration for Render
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Store active rooms and users
const rooms = new Map();

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id, 'IP:', socket.handshake.address);

    // Create or join a room
    socket.on('join-room', (roomId, username) => {
        console.log(`${username} attempting to join room ${roomId}`);
        
        // Leave previous rooms (except the socket's own room)
        socket.rooms.forEach(room => {
            if (room !== socket.id) {
                socket.leave(room);
                console.log(`${username} left room ${room}`);
            }
        });

        // Join new room
        socket.join(roomId);
        console.log(`${username} joined room ${roomId}`);
        
        // Store room info
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
            console.log(`Created new room: ${roomId}`);
        }
        rooms.get(roomId).set(socket.id, username);

        // Notify others in the room
        socket.to(roomId).emit('user-joined', {
            userId: socket.id,
            username: username
        });

        // Send list of existing users to the new user
        const users = Array.from(rooms.get(roomId)).map(([id, name]) => ({
            userId: id,
            username: name
        }));
        
        socket.emit('existing-users', users);
        console.log(`Sent ${users.length} existing users to ${username}`);
    });

    // Handle text messages
    socket.on('send-message', (data) => {
        console.log(`Message from ${data.username} in room ${data.roomId}: ${data.message}`);
        io.to(data.roomId).emit('receive-message', {
            userId: socket.id,
            username: data.username,
            message: data.message,
            timestamp: new Date().toLocaleTimeString()
        });
    });

    // WebRTC signaling events
    socket.on('offer', (data) => {
        console.log(`Offer from ${socket.id} to ${data.target}`);
        socket.to(data.target).emit('offer', {
            offer: data.offer,
            sender: socket.id
        });
    });

    socket.on('answer', (data) => {
        console.log(`Answer from ${socket.id} to ${data.target}`);
        socket.to(data.target).emit('answer', {
            answer: data.answer,
            sender: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        console.log(`ICE candidate from ${socket.id} to ${data.target}`);
        socket.to(data.target).emit('ice-candidate', {
            candidate: data.candidate,
            sender: socket.id
        });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        rooms.forEach((users, roomId) => {
            if (users.has(socket.id)) {
                const username = users.get(socket.id);
                users.delete(socket.id);
                
                // Notify others
                socket.to(roomId).emit('user-left', {
                    userId: socket.id,
                    username: username
                });
                console.log(`${username} left room ${roomId}`);

                // Clean up empty rooms
                if (users.size === 0) {
                    rooms.delete(roomId);
                    console.log(`Room ${roomId} deleted (empty)`);
                }
            }
        });
    });
});

// For Render, use the PORT environment variable
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`WebSocket server ready`);
});