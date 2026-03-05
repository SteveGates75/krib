// Socket connection
const socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true
});

// DOM elements
const joinScreen = document.getElementById('join-screen');
const mainApp = document.getElementById('main-app');
const usernameInput = document.getElementById('username');
const roomInput = document.getElementById('room');
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

// STUN servers
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Connection status
socket.on('connect', () => {
    console.log('Connected to server');
    connectionStatus.innerHTML = '🟢 Connected to server';
    connectionStatus.style.color = '#28a745';
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    connectionStatus.innerHTML = '🔴 Disconnected';
    connectionStatus.style.color = '#dc3545';
});

// Join room
async function joinRoom() {
    const roomId = roomInput.value.trim();
    const name = usernameInput.value.trim();
    
    if (!name || !roomId) {
        alert('Please enter name and room ID');
        return;
    }
    
    username = name;
    currentRoom = roomId;
    
    try {
        // Request camera and microphone
        console.log('Requesting camera and microphone...');
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        
        console.log('Media access granted');
        console.log('Audio tracks:', localStream.getAudioTracks().length);
        console.log('Video tracks:', localStream.getVideoTracks().length);
        
        // Make sure audio is enabled
        localStream.getAudioTracks().forEach(track => {
            track.enabled = true;
            console.log('Audio track enabled:', track.label);
        });
        
        // Add local video
        addLocalVideo();
        
        // Switch to main app
        joinScreen.style.display = 'none';
        mainApp.style.display = 'flex';
        roomDisplay.textContent = `Room: ${roomId}`;
        
        // Join room via socket
        socket.emit('join', {
            room: roomId,
            username: name
        });
        
    } catch (err) {
        console.error('Media error:', err);
        alert('Error accessing camera/microphone. Please check permissions.');
    }
}

function createRoom() {
    const roomId = 'ROOM-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    roomInput.value = roomId;
    joinRoom();
}

function copyRoomId() {
    navigator.clipboard.writeText(currentRoom);
    alert('Room ID copied!');
}

// Video functions
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
    
    video.onloadedmetadata = () => {
        video.play().catch(e => console.log('Play error:', e));
    };
    
    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = `${username} (you)`;
    
    container.appendChild(video);
    container.appendChild(label);
    videoGrid.appendChild(container);
}

function addRemoteVideo(userId, stream) {
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
        
        container.appendChild(video);
        container.appendChild(label);
        videoGrid.appendChild(container);
    }
    
    const video = document.getElementById(`video-${userId}`);
    if (video && !video.srcObject) {
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play().catch(e => console.log('Remote play error:', e));
        };
    }
}

function removeRemoteVideo(userId) {
    const container = document.getElementById(`remote-${userId}`);
    if (container) {
        container.remove();
    }
}

// Peer connection
function createPeerConnection(targetUserId) {
    console.log('Creating peer connection for:', targetUserId);
    
    const pc = new RTCPeerConnection(configuration);
    
    // Add local tracks
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
        console.log('Added track:', track.kind);
    });
    
    // Handle remote tracks
    pc.ontrack = (event) => {
        console.log('Received remote track from:', targetUserId, event.track.kind);
        
        if (event.streams && event.streams[0]) {
            // Make sure audio is enabled
            event.streams[0].getAudioTracks().forEach(track => {
                track.enabled = true;
            });
            
            addRemoteVideo(targetUserId, event.streams[0]);
            
            // Update label
            const user = document.querySelector(`[data-user-id="${targetUserId}"]`);
            if (user) {
                const label = document.getElementById(`label-${targetUserId}`);
                if (label) {
                    label.textContent = user.textContent;
                }
            }
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
    
    // Log connection state
    pc.oniceconnectionstatechange = () => {
        console.log('ICE state with', targetUserId, ':', pc.iceConnectionState);
        
        if (pc.iceConnectionState === 'connected') {
            console.log('Successfully connected to', targetUserId);
        } else if (pc.iceConnectionState === 'disconnected' || 
                   pc.iceConnectionState === 'failed') {
            removeRemoteVideo(targetUserId);
        }
    };
    
    peerConnections[targetUserId] = pc;
    return pc;
}

// Socket events for WebRTC
socket.on('users', (users) => {
    console.log('Users in room:', users);
    
    // Update users list
    usersList.innerHTML = '';
    users.forEach(user => {
        const badge = document.createElement('span');
        badge.className = 'user-badge';
        badge.dataset.userId = user.id;
        badge.textContent = user.name;
        if (user.id === socket.id) {
            badge.textContent += ' (you)';
        }
        usersList.appendChild(badge);
    });
    
    userCount.textContent = users.length;
    
    // Create connections to other users
    users.forEach(user => {
        if (user.id !== socket.id && !peerConnections[user.id]) {
            createOffer(user.id);
        }
    });
});

async function createOffer(targetUserId) {
    const pc = createPeerConnection(targetUserId);
    
    try {
        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        
        await pc.setLocalDescription(offer);
        
        socket.emit('offer', {
            target: targetUserId,
            offer: offer
        });
        
        console.log('Offer sent to:', targetUserId);
    } catch (err) {
        console.error('Offer error:', err);
    }
}

socket.on('offer', async (data) => {
    console.log('Received offer from:', data.sender);
    
    const pc = createPeerConnection(data.sender);
    
    try {
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

// Chat
socket.on('chat-message', (data) => {
    displayMessage(data);
});

socket.on('chat-history', (history) => {
    history.forEach(msg => displayMessage(msg));
});

function sendMessage() {
    const message = messageInput.value.trim();
    if (message && currentRoom) {
        const msgData = {
            room: currentRoom,
            username: username,
            message: message,
            time: new Date().toLocaleTimeString()
        };
        
        socket.emit('chat-message', msgData);
        messageInput.value = '';
    }
}

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

function displayMessage(data) {
    const div = document.createElement('div');
    div.className = `message ${data.username === username ? 'own' : ''}`;
    
    div.innerHTML = `
        <div class="sender">${data.username}</div>
        <div class="text">${data.message}</div>
        <div class="time">${data.time}</div>
    `;
    
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Controls
function toggleAudio() {
    if (localStream) {
        const track = localStream.getAudioTracks()[0];
        if (track) {
            isAudioEnabled = !isAudioEnabled;
            track.enabled = isAudioEnabled;
            
            const btn = document.getElementById('audio-btn');
            btn.classList.toggle('active', isAudioEnabled);
            btn.classList.toggle('inactive', !isAudioEnabled);
            btn.innerHTML = isAudioEnabled ? '🎤 <span>Mute</span>' : '🔇 <span>Unmute</span>';
        }
    }
}

function toggleVideo() {
    if (localStream) {
        const track = localStream.getVideoTracks()[0];
        if (track) {
            isVideoEnabled = !isVideoEnabled;
            track.enabled = isVideoEnabled;
            
            const btn = document.getElementById('video-btn');
            btn.classList.toggle('active', isVideoEnabled);
            btn.classList.toggle('inactive', !isVideoEnabled);
            btn.innerHTML = isVideoEnabled ? '📹 <span>Stop Video</span>' : '🚫 <span>Start Video</span>';
        }
    }
}

function leaveRoom() {
    // Close all peer connections
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    
    // Stop local stream
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Clear everything
    videoGrid.innerHTML = '';
    chatMessages.innerHTML = '';
    usersList.innerHTML = '';
    
    // Show join screen
    mainApp.style.display = 'none';
    joinScreen.style.display = 'block';
    
    // Reset
    currentRoom = null;
    username = null;
}