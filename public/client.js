// Detect device
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
console.log('Device:', isMobile ? 'Mobile' : 'Desktop');

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
const connectionStatus = document.getElementById('connection-status');

// State
let localStream = null;
let peerConnections = {};
let currentRoom = null;
let username = null;
let isAudioEnabled = true;
let isVideoEnabled = true;
let isScreenSharing = false;

// STUN servers
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
    console.log('Connected');
    connectionStatus.innerHTML = '🟢 Connected';
});

socket.on('disconnect', () => {
    console.log('Disconnected');
    connectionStatus.innerHTML = '🔴 Disconnected';
});

// Get video grid based on device
function getVideoGrid() {
    return document.getElementById(isMobile ? 'video-grid-mobile' : 'video-grid-desktop');
}

// Get users list container
function getUsersList() {
    return document.getElementById(isMobile ? 'users-list-mobile' : 'users-list-desktop');
}

// Get chat messages container
function getChatMessages() {
    return document.getElementById(isMobile ? 'chat-messages-mobile' : 'chat-messages-desktop');
}

// Get message input
function getMessageInput() {
    return document.getElementById(isMobile ? 'message-input-mobile' : 'message-input-desktop');
}

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
        // Mobile-friendly video constraints
        const constraints = {
            video: {
                width: { ideal: isMobile ? 480 : 1280 },
                height: { ideal: isMobile ? 360 : 720 },
                facingMode: 'user'
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        console.log('Media access granted');
        
        // Add local video
        addLocalVideo();
        
        // Switch to main app
        joinScreen.style.display = 'none';
        mainApp.classList.add('active');
        
        // Update room display
        if (isMobile) {
            document.getElementById('room-display-mobile').textContent = `Room: ${roomId}`;
        } else {
            document.getElementById('room-display').textContent = `Room: ${roomId}`;
        }
        
        // Join room
        socket.emit('join-room', roomId, username, isMobile);
        
    } catch (err) {
        console.error('Media error:', err);
        alert('Cannot access camera/microphone. Please check permissions.');
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
    const videoGrid = getVideoGrid();
    
    // Remove existing
    const existing = document.getElementById('local-container');
    if (existing) existing.remove();
    
    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = 'local-container';
    
    const video = document.createElement('video');
    video.id = 'local-video';
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = localStream;
    
    video.play().catch(e => console.log('Video play error:', e));
    
    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = `${username} (you)`;
    
    container.appendChild(video);
    container.appendChild(label);
    videoGrid.appendChild(container);
}

function addRemoteVideo(userId, username, stream) {
    const videoGrid = getVideoGrid();
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
    
    // Add tracks
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    
    // Handle remote tracks
    pc.ontrack = (event) => {
        console.log(`Received remote track from:`, targetUserId);
        
        if (event.streams && event.streams[0]) {
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
        
        if (pc.iceConnectionState === 'disconnected' || 
            pc.iceConnectionState === 'failed') {
            removeRemoteVideo(targetUserId);
        }
    };
    
    peerConnections[targetUserId] = pc;
    return pc;
}

// Socket events
socket.on('all-users', (users) => {
    console.log('Users in room:', users);
    updateUsersList(users);
    
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

// Users list
function updateUsersList(users) {
    const usersList = getUsersList();
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
            badge.textContent = user.username + (user.isMobile ? ' 📱' : ' 💻');
            usersList.appendChild(badge);
        }
    });
}

function addUserToList(userId, username) {
    const usersList = getUsersList();
    
    // Check if already exists
    if (document.querySelector(`[data-user-id="${userId}"]`)) return;
    
    const badge = document.createElement('span');
    badge.className = 'user-badge online';
    badge.dataset.userId = userId;
    badge.textContent = username;
    usersList.appendChild(badge);
}

function removeUserFromList(userId) {
    const badge = document.querySelector(`[data-user-id="${userId}"]`);
    if (badge) {
        badge.remove();
    }
}

// Chat
socket.on('chat-message', (data) => {
    displayMessage(data);
});

function sendMessage(device) {
    const input = getMessageInput();
    const message = input.value.trim();
    
    if (message && currentRoom) {
        socket.emit('chat-message', {
            roomId: currentRoom,
            username: username,
            message: message
        });
        input.value = '';
    }
}

// Handle enter key
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !isMobile) {
        sendMessage('desktop');
    }
});

if (isMobile) {
    document.getElementById('message-input-mobile').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage('mobile');
        }
    });
}

function displayMessage(data) {
    const chatMessages = getChatMessages();
    
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

// Mobile chat toggle
function toggleChat() {
    const chatPanel = document.getElementById('mobile-chat');
    chatPanel.classList.toggle('open');
}

// Controls
function toggleAudio() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            isAudioEnabled = !isAudioEnabled;
            audioTrack.enabled = isAudioEnabled;
            
            // Update buttons
            const desktopBtn = document.getElementById('audio-btn-desktop');
            const mobileBtn = document.getElementById('audio-btn-mobile');
            
            if (isAudioEnabled) {
                desktopBtn.innerHTML = '🎤 <span>Mute</span>';
                mobileBtn.innerHTML = '🎤';
            } else {
                desktopBtn.innerHTML = '🔇 <span>Unmute</span>';
                mobileBtn.innerHTML = '🔇';
            }
            
            desktopBtn.classList.toggle('active', isAudioEnabled);
            desktopBtn.classList.toggle('inactive', !isAudioEnabled);
            mobileBtn.classList.toggle('active', isAudioEnabled);
            mobileBtn.classList.toggle('inactive', !isAudioEnabled);
        }
    }
}

function toggleVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            isVideoEnabled = !isVideoEnabled;
            videoTrack.enabled = isVideoEnabled;
            
            // Update buttons
            const desktopBtn = document.getElementById('video-btn-desktop');
            const mobileBtn = document.getElementById('video-btn-mobile');
            
            if (isVideoEnabled) {
                desktopBtn.innerHTML = '📹 <span>Stop Video</span>';
                mobileBtn.innerHTML = '📹';
            } else {
                desktopBtn.innerHTML = '🚫 <span>Start Video</span>';
                mobileBtn.innerHTML = '🚫';
            }
            
            desktopBtn.classList.toggle('active', isVideoEnabled);
            desktopBtn.classList.toggle('inactive', !isVideoEnabled);
            mobileBtn.classList.toggle('active', isVideoEnabled);
            mobileBtn.classList.toggle('inactive', !isVideoEnabled);
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
            
            videoTrack.onended = () => {
                stopScreenShare();
            };
            
            isScreenSharing = true;
            
            // Update buttons
            const desktopBtn = document.getElementById('screen-btn-desktop');
            const mobileBtn = document.getElementById('screen-btn-mobile');
            
            desktopBtn.innerHTML = '🖥️ <span>Stop Sharing</span>';
            mobileBtn.innerHTML = '🖥️';
            desktopBtn.classList.add('active');
            mobileBtn.classList.add('active');
            
        } catch (err) {
            console.error('Screen share error:', err);
        }
    } else {
        stopScreenShare();
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
        
        isScreenSharing = false;
        
        // Update buttons
        const desktopBtn = document.getElementById('screen-btn-desktop');
        const mobileBtn = document.getElementById('screen-btn-mobile');
        
        desktopBtn.innerHTML = '🖥️ <span>Share Screen</span>';
        mobileBtn.innerHTML = '🖥️';
        desktopBtn.classList.remove('active');
        mobileBtn.classList.remove('active');
        
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
    
    // Clear video grids
    document.getElementById('video-grid-desktop').innerHTML = '';
    document.getElementById('video-grid-mobile').innerHTML = '';
    
    // Clear chats
    document.getElementById('chat-messages-desktop').innerHTML = '';
    document.getElementById('chat-messages-mobile').innerHTML = '';
    
    // Clear users lists
    document.getElementById('users-list-desktop').innerHTML = '';
    document.getElementById('users-list-mobile').innerHTML = '';
    
    // Close mobile chat if open
    document.getElementById('mobile-chat').classList.remove('open');
    
    // Show join screen
    mainApp.classList.remove('active');
    joinScreen.style.display = 'block';
    
    // Reset
    currentRoom = null;
    username = null;
    isScreenSharing = false;
}