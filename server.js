const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: "*" },
  transports: ['websocket', 'polling']
});

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Store users in rooms
const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join', (data) => {
        console.log(data.username, 'joined room', data.room);
        
        socket.join(data.room);
        
        // Store user
        if (!rooms[data.room]) rooms[data.room] = [];
        rooms[data.room].push({
            id: socket.id,
            name: data.username
        });
        
        // Send list of users in room
        io.to(data.room).emit('users', rooms[data.room]);
        
        // Send chat history
        socket.emit('chat-history', global.chatHistory?.[data.room] || []);
    });

    // Chat messages
    socket.on('chat-message', (data) => {
        console.log('Chat:', data);
        
        // Store in history
        if (!global.chatHistory) global.chatHistory = {};
        if (!global.chatHistory[data.room]) global.chatHistory[data.room] = [];
        global.chatHistory[data.room].push(data);
        
        // Send to room
        io.to(data.room).emit('chat-message', data);
    });

    // WebRTC signaling
    socket.on('offer', (data) => {
        socket.to(data.target).emit('offer', {
            offer: data.offer,
            sender: socket.id
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

    socket.on('disconnect', () => {
        // Remove user from rooms
        for (let room in rooms) {
            rooms[room] = rooms[room].filter(u => u.id !== socket.id);
            io.to(room).emit('users', rooms[room]);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});