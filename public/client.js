// Socket connection
const socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true
});

// DOM elements
const joinScreen = document.getElementById('join-screen');
const mainApp = document.getElementById('main-app');
const usernameInput = document.getElementById('username');
const roomIdInput = document.getElementById('room-id');
const roomDisplay = document.getElementById('room-display');
const videoGrid = document.getElementById('video-grid');
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const usersList = document.getElementById('users-list');
const userCount = document.getElementById('user-count');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

// State
let localStream = null;
let peerConnections = {};
let currentRoom = null;
let username = null;
let isAudioEnabled = true;
let isVideoEnabled = true;
let isScreenSharing = false;

// STUN servers for NAT traversal
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

// Connection status
socket.on('connect', () => {
    console.log('Connected to server');
    statusDot.className = 'dot connected';
    statusText.textContent = 'Connected to server';
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    statusDot.className = 'dot';
    statusText.textContent = 'Disconnected - reconnecting...';
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    statusDot.className = 'dot';
    statusText.textContent = 'Connection error - retrying...';
});

// Join/Create room
async function joinRoom() {
    const roomId = roomIdInput.value.trim().toUpperCase();
    const name = usernameInput.value.trim();
    
    if (!name) {
        alert('Please enter your name');
        return;
    }
    
    if (!roomId) {
        alert('Please enter a room ID');
        return;
    }
    
    username = name;
    currentRoom = roomId;
    
    try {
        // Get user media
        console.log('Requesting camera and microphone...');
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            }
        });
        
        console.log('Media access granted');
        
        // Add local video
        addLocalVideo();
        
        // Switch to main app
        joinScreen.style.display = 'none';
        mainApp.classList.add('active');
        roomDisplay.textContent = `Room: ${roomId}`;
        
        // Join room via socket
        socket.emit('join-room', roomId, username);
        
    } catch (err) {
        console.error('Media error:', err);
        let message = 'Cannot access camera/microphone. ';
        if (err.name === 'NotAllowedError') {
            message += 'Please allow access in your browser.';
        } else if (err.name === 'NotFoundError') {
            message += 'No camera or microphone found.';
        } else {
            message += 'Please check your devices.';
        }
        alert(message);
    }
}

function createRoom() {
    const roomId = 'ROOM-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    roomIdInput.value = roomId;
    joinRoom();
}

function copyRoomId() {
    navigator.clipboard.writeText(currentRoom);
    alert('Room ID copied!');
}

// Video management
function addLocalVideo() {
    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = 'local-container';
    
    const video = document.createElement('video');
    video.id = 'local-video';
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = localStream;
    
    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = `${username} (you)`;
    
    container.appendChild(video);
    container.appendChild(label);
    videoGrid.appendChild(container);
}

function addRemoteVideo(userId, username, stream) {
    let container = document.getElementById(`remote-${userId}`);
    
    if (!container) {
        container = document.createElement('div');
        container.className = 'video-container';
        container.id = `remote-${userId}`;
        
        const video = document.createElement('video');
        video.id = `video-${userId}`;
        video.autoplay = true;
        video.playsInline = true;
        
        const label = document.createElement('div');
        label.className = 'video-label';
        label.id = `label-${userId}`;
        label.textContent = username;
        
        container.appendChild(video);
        container.appendChild(label);
        videoGrid.appendChild(container);
    }
    
    const video = document.getElementById(`video-${userId}`);
    if (video && !video.srcObject) {
        video.srcObject = stream;
    }
}

function removeRemoteVideo(userId) {
    const container = document.getElementById(`remote-${userId}`);
    if (container) {
        container.remove();
    }
}

// Peer connection management
function createPeerConnection(targetUserId, targetUsername) {
    console.log('Creating peer connection for:', targetUserId);
    const pc = new RTCPeerConnection(configuration);
    
    // Add local tracks
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    
    // Handle remote stream
    pc.ontrack = (event) => {
        console.log('Received remote track from:', targetUserId);
        if (event.streams && event.streams[0]) {
            addRemoteVideo(targetUserId, targetUsername, event.streams[0]);
        }
    };
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: targetUserId,
                candidate: event.candidate
            });
        }
    };
    
    // Log connection state
    pc.oniceconnectionstatechange = () => {
        console.log(`ICE state with ${targetUserId}:`, pc.iceConnectionState);
        if (pc.iceConnectionState === 'disconnected' || 
            pc.iceConnectionState === 'failed') {
            removeRemoteVideo(targetUserId);
        }
    };
    
    peerConnections[targetUserId] = pc;
    return pc;
}

// Socket events
socket.on('room-users', (users) => {
    console.log('Users in room:', users);
    updateUsersList(users);
    
    // Create offers for existing users
    users.forEach(user => {
        if (user.userId !== socket.id) {
            createOffer(user.userId, user.username);
        }
    });
});

socket.on('user-connected', (data) => {
    console.log('User connected:', data);
    addUserToList(data.userId, data.username);
    if (data.userId !== socket.id) {
        createOffer(data.userId, data.username);
    }
});

socket.on('user-disconnected', (data) => {
    console.log('User disconnected:', data);
    removeUserFromList(data.userId);
    
    if (peerConnections[data.userId]) {
        peerConnections[data.userId].close();
        delete peerConnections[data.userId];
    }
    
    removeRemoteVideo(data.userId);
});

async function createOffer(targetUserId, targetUsername) {
    const pc = createPeerConnection(targetUserId, targetUsername);
    
    try {
        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        await pc.setLocalDescription(offer);
        
        socket.emit('offer', {
            target: targetUserId,
            offer: offer,
            senderUsername: username
        });
    } catch (err) {
        console.error('Offer error:', err);
    }
}

socket.on('offer', async (data) => {
    console.log('Received offer from:', data.sender);
    
    const pc = createPeerConnection(data.sender, data.senderUsername);
    
    try {
        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('answer', {
            target: data.sender,
            answer: answer
        });
    } catch (err) {
        console.error('Answer error:', err);
    }
});

socket.on('answer', async (data) => {
    console.log('Received answer from:', data.sender);
    const pc = peerConnections[data.sender];
    
    if (pc) {
        try {
            await pc.setRemoteDescription(data.answer);
        } catch (err) {
            console.error('Set remote description error:', err);
        }
    }
});

socket.on('ice-candidate', async (data) => {
    console.log('Received ICE candidate from:', data.sender);
    const pc = peerConnections[data.sender];
    
    if (pc) {
        try {
            await pc.addIceCandidate(data.candidate);
        } catch (err) {
            console.error('Add ICE candidate error:', err);
        }
    }
});

// Users list management
function updateUsersList(users) {
    usersList.innerHTML = '';
    
    // Add self
    const selfBadge = document.createElement('div');
    selfBadge.className = 'user-badge online';
    selfBadge.innerHTML = `<span>${username} (you)</span>`;
    usersList.appendChild(selfBadge);
    
    // Add others
    users.forEach(user => {
        if (user.userId !== socket.id) {
            const badge = document.createElement('div');
            badge.className = 'user-badge online';
            badge.dataset.userId = user.userId;
            badge.innerHTML = `<span>${user.username}</span>`;
            usersList.appendChild(badge);
        }
    });
    
    userCount.textContent = users.length + 1;
}

function addUserToList(userId, username) {
    const badge = document.createElement('div');
    badge.className = 'user-badge online';
    badge.dataset.userId = userId;
    badge.innerHTML = `<span>${username}</span>`;
    usersList.appendChild(badge);
    
    const currentCount = document.querySelectorAll('.user-badge').length;
    userCount.textContent = currentCount;
}

function removeUserFromList(userId) {
    const badges = document.querySelectorAll('.user-badge');
    badges.forEach(badge => {
        if (badge.dataset.userId === userId) {
            badge.remove();
        }
    });
    
    const currentCount = document.querySelectorAll('.user-badge').length;
    userCount.textContent = currentCount;
}

// Chat
socket.on('chat-message', (data) => {
    displayMessage(data);
});

function sendMessage() {
    const message = messageInput.value.trim();
    if (message && currentRoom) {
        socket.emit('chat-message', {
            roomId: currentRoom,
            username: username,
            message: message
        });
        messageInput.value = '';
    }
}

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

function displayMessage(data) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${data.username === username ? 'own' : ''}`;
    
    messageDiv.innerHTML = `
        <div class="sender">${data.username}</div>
        <div class="text">${data.message}</div>
        <div class="time">${data.time}</div>
    `;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Media controls
function toggleAudio() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            isAudioEnabled = !isAudioEnabled;
            audioTrack.enabled = isAudioEnabled;
            
            const btn = document.getElementById('audio-btn');
            btn.classList.toggle('active', isAudioEnabled);
            btn.innerHTML = isAudioEnabled ? 
                '<span>🎤</span><span>Mute</span>' : 
                '<span>🔇</span><span>Unmute</span>';
        }
    }
}

function toggleVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            isVideoEnabled = !isVideoEnabled;
            videoTrack.enabled = isVideoEnabled;
            
            const btn = document.getElementById('video-btn');
            btn.classList.toggle('active', isVideoEnabled);
            btn.innerHTML = isVideoEnabled ? 
                '<span>📹</span><span>Stop Video</span>' : 
                '<span>🚫</span><span>Start Video</span>';
        }
    }
}

async function toggleScreenShare() {
    if (!isScreenSharing) {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true
            });
            
            const videoTrack = screenStream.getVideoTracks()[0];
            
            // Replace video track in all peer connections
            Object.values(peerConnections).forEach(pc => {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(videoTrack);
                }
            });
            
            // Update local stream
            const oldTrack = localStream.getVideoTracks()[0];
            localStream.removeTrack(oldTrack);
            localStream.addTrack(videoTrack);
            
            // Update local video
            const localVideo = document.getElementById('local-video');
            if (localVideo) {
                localVideo.srcObject = localStream;
            }
            
            // Handle stop
            videoTrack.onended = () => {
                stopScreenShare();
            };
            
            isScreenSharing = true;
            
            const btn = document.getElementById('screen-btn');
            btn.innerHTML = '<span>🖥️</span><span>Stop Sharing</span>';
            
            // Add indicator
            const container = document.getElementById('local-container');
            const indicator = document.createElement('div');
            indicator.className = 'screen-indicator';
            indicator.id = 'screen-indicator';
            indicator.textContent = '🔴 Sharing Screen';
            container.appendChild(indicator);
            
        } catch (err) {
            console.error('Screen share error:', err);
        }
    } else {
        stopScreenShare();
    }
}

async function stopScreenShare() {
    try {
        // Get camera again
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
        });
        
        const videoTrack = newStream.getVideoTracks()[0];
        
        // Replace in peer connections
        Object.values(peerConnections).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track?.kind === 'video');
            if (sender) {
                sender.replaceTrack(videoTrack);
            }
        });
        
        // Update local stream
        const oldTrack = localStream.getVideoTracks()[0];
        localStream.removeTrack(oldTrack);
        localStream.addTrack(videoTrack);
        
        // Update local video
        const localVideo = document.getElementById('local-video');
        if (localVideo) {
            localVideo.srcObject = localStream;
        }
        
        isScreenSharing = false;
        
        const btn = document.getElementById('screen-btn');
        btn.innerHTML = '<span>🖥️</span><span>Share Screen</span>';
        
        const indicator = document.getElementById('screen-indicator');
        if (indicator) indicator.remove();
        
    } catch (err) {
        console.error('Stop screen share error:', err);
    }
}

function leaveRoom() {
    // Close all peer connections
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    
    // Stop local stream
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    // Clear video grid
    videoGrid.innerHTML = '';
    
    // Clear chat
    chatMessages.innerHTML = '';
    
    // Clear users list
    usersList.innerHTML = '';
    
    // Show join screen
    mainApp.classList.remove('active');
    joinScreen.style.display = 'block';
    
    // Reset
    currentRoom = null;
    username = null;
    isScreenSharing = false;
    
    // Reset input
    roomIdInput.value = '';
}