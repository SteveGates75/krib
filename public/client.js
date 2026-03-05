// Detect Brave browser
const isBrave = navigator.brave ? await navigator.brave.isBrave() : false;
if (isBrave) {
    document.getElementById('brave-warning').classList.add('show');
}

// Socket connection with better error handling
const socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    timeout: 20000
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
const connectionStatus = document.getElementById('connection-status');

// State
let localStream = null;
let peerConnections = {};
let currentRoom = null;
let username = null;
let isAudioEnabled = true;
let isVideoEnabled = true;

// STUN servers - multiple options for better connectivity
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.ekiga.net' },
        { urls: 'stun:stun.ideasip.com' },
        { urls: 'stun:stun.schlund.de' }
    ]
};

// Connection status
socket.on('connect', () => {
    console.log('Connected to server');
    connectionStatus.innerHTML = '🟢 Connected';
    connectionStatus.style.color = '#28a745';
});

socket.on('disconnect', () => {
    console.log('Disconnected');
    connectionStatus.innerHTML = '🔴 Disconnected';
    connectionStatus.style.color = '#888';
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    connectionStatus.innerHTML = '🟡 Connection error - retrying...';
    connectionStatus.style.color = '#ffc107';
});

// Join room
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
        // Request all permissions explicitly
        console.log('Requesting camera and microphone...');
        
        // For Brave, we need to be more explicit
        const constraints = {
            video: {
                width: { ideal: 640 }, // Lower resolution for better compatibility
                height: { ideal: 480 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        console.log('Media access granted');
        console.log('Audio tracks:', localStream.getAudioTracks().length);
        console.log('Video tracks:', localStream.getVideoTracks().length);
        
        // Enable audio tracks explicitly
        localStream.getAudioTracks().forEach(track => {
            track.enabled = true;
            console.log('Audio track enabled:', track.label);
        });
        
        // Add local video
        addLocalVideo();
        
        // Switch to main app
        joinScreen.style.display = 'none';
        mainApp.classList.add('active');
        roomDisplay.textContent = `Room: ${roomId}`;
        
        // Join room
        socket.emit('join-room', roomId, username);
        
    } catch (err) {
        console.error('Media error:', err);
        
        let message = 'Cannot access camera/microphone.\n\n';
        
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            message += 'Please:\n';
            message += '1. Click the camera icon in the address bar\n';
            message += '2. Allow camera and microphone access\n';
            message += '3. If using Brave, disable Shields for this site\n';
            message += '4. Refresh the page and try again';
        } else if (err.name === 'NotFoundError') {
            message += 'No camera or microphone found.';
        } else if (err.name === 'NotReadableError') {
            message += 'Camera or microphone is busy (used by another app).';
        } else {
            message += 'Unknown error. Please check your devices.';
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
    // Remove existing local video if any
    const existing = document.getElementById('local-container');
    if (existing) existing.remove();
    
    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = 'local-container';
    
    const video = document.createElement('video');
    video.id = 'local-video';
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // Mute local video to prevent echo
    video.srcObject = localStream;
    
    // Ensure video plays
    video.play().catch(e => console.log('Video play error:', e));
    
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
        video.play().catch(e => console.log('Remote video play error:', e));
    }
}

function removeRemoteVideo(userId) {
    const container = document.getElementById(`remote-${userId}`);
    if (container) {
        container.remove();
    }
}

// Peer connection
function createPeerConnection(targetUserId, targetUsername) {
    console.log('Creating peer connection for:', targetUserId);
    
    const pc = new RTCPeerConnection(configuration);
    
    // Add all local tracks
    localStream.getTracks().forEach(track => {
        console.log(`Adding ${track.kind} track to peer connection`);
        pc.addTrack(track, localStream);
    });
    
    // Handle remote tracks
    pc.ontrack = (event) => {
        console.log(`Received remote ${event.track.kind} track from:`, targetUserId);
        
        if (event.streams && event.streams[0]) {
            // Ensure audio is enabled
            event.streams[0].getAudioTracks().forEach(track => {
                track.enabled = true;
                console.log('Remote audio track enabled');
            });
            
            addRemoteVideo(targetUserId, targetUsername, event.streams[0]);
        }
    };
    
    // ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: targetUserId,
                candidate: event.candidate
            });
        }
    };
    
    // Connection state
    pc.oniceconnectionstatechange = () => {
        console.log(`ICE state with ${targetUserId}:`, pc.iceConnectionState);
        
        if (pc.iceConnectionState === 'connected') {
            console.log('Successfully connected to', targetUserId);
        } else if (pc.iceConnectionState === 'disconnected' || 
                   pc.iceConnectionState === 'failed') {
            removeRemoteVideo(targetUserId);
        }
    };
    
    // Negotiation needed
    pc.onnegotiationneeded = () => {
        console.log('Negotiation needed for', targetUserId);
    };
    
    peerConnections[targetUserId] = pc;
    return pc;
}

// Socket events
socket.on('all-users', (users) => {
    console.log('Users in room:', users);
    updateUsersList(users);
    
    // Connect to each user
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
    try {
        const pc = createPeerConnection(targetUserId, targetUsername);
        
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
        
        console.log('Offer sent to:', targetUserId);
    } catch (err) {
        console.error('Offer error:', err);
    }
}

socket.on('offer', async (data) => {
    console.log('Received offer from:', data.sender);
    
    try {
        const pc = createPeerConnection(data.sender, data.senderUsername);
        
        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('answer', {
            target: data.sender,
            answer: answer
        });
        
        console.log('Answer sent to:', data.sender);
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
            console.log('Remote description set for:', data.sender);
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

// Users list
function updateUsersList(users) {
    usersList.innerHTML = '';
    
    // Add self
    const selfBadge = document.createElement('span');
    selfBadge.className = 'user-badge online';
    selfBadge.textContent = `${username} (you)`;
    usersList.appendChild(selfBadge);
    
    // Add others
    users.forEach(user => {
        if (user.userId !== socket.id) {
            const badge = document.createElement('span');
            badge.className = 'user-badge online';
            badge.dataset.userId = user.userId;
            badge.textContent = user.username;
            usersList.appendChild(badge);
        }
    });
    
    userCount.textContent = users.length + 1;
}

function addUserToList(userId, username) {
    const badge = document.createElement('span');
    badge.className = 'user-badge online';
    badge.dataset.userId = userId;
    badge.textContent = username;
    usersList.appendChild(badge);
    
    userCount.textContent = document.querySelectorAll('.user-badge').length;
}

function removeUserFromList(userId) {
    const badges = document.querySelectorAll('.user-badge');
    badges.forEach(badge => {
        if (badge.dataset.userId === userId) {
            badge.remove();
        }
    });
    
    userCount.textContent = document.querySelectorAll('.user-badge').length;
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

// Controls
function toggleAudio() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            isAudioEnabled = !isAudioEnabled;
            audioTrack.enabled = isAudioEnabled;
            
            const btn = document.getElementById('audio-btn');
            btn.classList.toggle('active', isAudioEnabled);
            btn.classList.toggle('inactive', !isAudioEnabled);
            btn.textContent = isAudioEnabled ? '🎤 Mute' : '🔇 Unmute';
            
            console.log('Audio', isAudioEnabled ? 'enabled' : 'disabled');
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
            btn.classList.toggle('inactive', !isVideoEnabled);
            btn.textContent = isVideoEnabled ? '📹 Stop Video' : '📹 Start Video';
        }
    }
}

async function toggleScreenShare() {
    try {
        if (!document.getElementById('screen-btn').classList.contains('active')) {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true
            });
            
            const videoTrack = screenStream.getVideoTracks()[0];
            
            // Replace track in all peer connections
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
            
            videoTrack.onended = () => {
                stopScreenShare();
            };
            
            const btn = document.getElementById('screen-btn');
            btn.classList.add('active');
            btn.textContent = '🖥️ Stop Sharing';
            
        } else {
            await stopScreenShare();
        }
    } catch (err) {
        console.error('Screen share error:', err);
    }
}

async function stopScreenShare() {
    try {
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
        
        const btn = document.getElementById('screen-btn');
        btn.classList.remove('active');
        btn.textContent = '🖥️ Share Screen';
        
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
    
    // Clear grid
    videoGrid.innerHTML = '';
    chatMessages.innerHTML = '';
    usersList.innerHTML = '';
    
    // Show join screen
    mainApp.classList.remove('active');
    joinScreen.style.display = 'block';
    
    // Reset
    currentRoom = null;
    username = null;
}