const socket = io();
let localStream;
let peerConnections = {};
let currentRoom = null;
let username = null;
let isAudioEnabled = true;
let isVideoEnabled = true;
let isScreenSharing = false;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const mainScreen = document.getElementById('main-screen');
const usernameInput = document.getElementById('username-input');
const roomIdInput = document.getElementById('room-id-input');
const currentRoomSpan = document.getElementById('current-room');
const videoGrid = document.getElementById('video-grid');
const localVideo = document.getElementById('local-video');
const usersContainer = document.getElementById('users-container');
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');

// WebRTC Configuration with Google's public STUN servers [citation:2]
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// Initialize media devices
async function initLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: true
        });
        
        localVideo.srcObject = localStream;
        return true;
    } catch (err) {
        console.error('Error accessing media devices:', err);
        alert('Could not access camera/microphone. Please check permissions.');
        return false;
    }
}

// Create or join room
async function joinRoom() {
    const roomId = roomIdInput.value.trim();
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
    
    const mediaSuccess = await initLocalStream();
    if (!mediaSuccess) return;
    
    loginScreen.classList.add('hidden');
    mainScreen.classList.remove('hidden');
    
    currentRoomSpan.textContent = `Room: ${roomId}`;
    
    socket.emit('join-room', roomId, username);
}

function createRoom() {
    // Generate a random room ID
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    roomIdInput.value = roomId;
    joinRoom();
}

function copyRoomId() {
    navigator.clipboard.writeText(currentRoom);
    alert('Room ID copied to clipboard!');
}

// WebRTC Peer Connection Management
function createPeerConnection(targetUserId) {
    const pc = new RTCPeerConnection(configuration);
    
    // Add local stream tracks
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    
    // Handle incoming tracks
    pc.ontrack = (event) => {
        let remoteContainer = document.getElementById(`remote-${targetUserId}`);
        if (!remoteContainer) {
            remoteContainer = document.createElement('div');
            remoteContainer.id = `remote-${targetUserId}`;
            remoteContainer.className = 'video-container';
            
            const remoteVideo = document.createElement('video');
            remoteVideo.id = `video-${targetUserId}`;
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            
            const label = document.createElement('div');
            label.className = 'video-label';
            label.id = `label-${targetUserId}`;
            
            remoteContainer.appendChild(remoteVideo);
            remoteContainer.appendChild(label);
            videoGrid.appendChild(remoteContainer);
        }
        
        const remoteVideo = document.getElementById(`video-${targetUserId}`);
        if (remoteVideo) {
            remoteVideo.srcObject = event.streams[0];
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
    
    pc.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', pc.iceConnectionState);
    };
    
    peerConnections[targetUserId] = pc;
    return pc;
}

// Socket.io event handlers
socket.on('existing-users', (users) => {
    users.forEach(user => {
        if (user.userId !== socket.id) {
            makeOffer(user.userId);
        }
    });
});

socket.on('user-joined', async (data) => {
    addUserToList(data.userId, data.username);
    if (data.userId !== socket.id) {
        await makeOffer(data.userId);
    }
});

socket.on('user-left', (data) => {
    removeUserFromList(data.userId);
    
    // Clean up peer connection
    if (peerConnections[data.userId]) {
        peerConnections[data.userId].close();
        delete peerConnections[data.userId];
    }
    
    // Remove remote video
    const remoteContainer = document.getElementById(`remote-${data.userId}`);
    if (remoteContainer) {
        remoteContainer.remove();
    }
});

// WebRTC signaling handlers
async function makeOffer(targetUserId) {
    const pc = createPeerConnection(targetUserId);
    
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        socket.emit('offer', {
            target: targetUserId,
            offer: offer
        });
    } catch (err) {
        console.error('Error making offer:', err);
    }
}

socket.on('offer', async (data) => {
    const pc = createPeerConnection(data.sender);
    
    try {
        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('answer', {
            target: data.sender,
            answer: answer
        });
    } catch (err) {
        console.error('Error handling offer:', err);
    }
});

socket.on('answer', async (data) => {
    const pc = peerConnections[data.sender];
    if (pc) {
        try {
            await pc.setRemoteDescription(data.answer);
        } catch (err) {
            console.error('Error handling answer:', err);
        }
    }
});

socket.on('ice-candidate', async (data) => {
    const pc = peerConnections[data.sender];
    if (pc) {
        try {
            await pc.addIceCandidate(data.candidate);
        } catch (err) {
            console.error('Error adding ICE candidate:', err);
        }
    }
});

// Chat functionality
socket.on('receive-message', (data) => {
    displayMessage(data);
});

function sendMessage() {
    const message = messageInput.value.trim();
    if (message && currentRoom) {
        socket.emit('send-message', {
            roomId: currentRoom,
            username: username,
            message: message
        });
        messageInput.value = '';
    }
}

function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

function displayMessage(data) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    messageDiv.innerHTML = `
        <span class="username">${data.username}</span>
        <span class="timestamp">${data.timestamp}</span>
        <div>${data.message}</div>
    `;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// User list management
function addUserToList(userId, username) {
    const userDiv = document.createElement('div');
    userDiv.id = `user-${userId}`;
    userDiv.className = 'user-item';
    userDiv.textContent = username;
    usersContainer.appendChild(userDiv);
}

function removeUserFromList(userId) {
    const userDiv = document.getElementById(`user-${userId}`);
    if (userDiv) {
        userDiv.remove();
    }
}

// Media controls
function toggleAudio() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            isAudioEnabled = !isAudioEnabled;
            audioTrack.enabled = isAudioEnabled;
            
            const audioBtn = document.getElementById('audio-btn');
            audioBtn.textContent = isAudioEnabled ? '🎤 Mute' : '🎤 Unmute';
            audioBtn.classList.toggle('active', isAudioEnabled);
        }
    }
}

function toggleVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            isVideoEnabled = !isVideoEnabled;
            videoTrack.enabled = isVideoEnabled;
            
            const videoBtn = document.getElementById('video-btn');
            videoBtn.textContent = isVideoEnabled ? '📹 Stop Video' : '📹 Start Video';
            videoBtn.classList.toggle('active', isVideoEnabled);
        }
    }
}

async function toggleScreenShare() {
    if (!isScreenSharing) {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                }
            });
            
            // Replace video track
            const videoTrack = screenStream.getVideoTracks()[0];
            const sender = peerConnections[Object.keys(peerConnections)[0]]?.getSenders()
                .find(s => s.track?.kind === 'video');
            
            if (sender) {
                sender.replaceTrack(videoTrack);
            }
            
            // Update local display
            localStream.removeTrack(localStream.getVideoTracks()[0]);
            localStream.addTrack(videoTrack);
            localVideo.srcObject = localStream;
            
            // Handle screen share stop
            videoTrack.onended = () => {
                stopScreenShare();
            };
            
            isScreenSharing = true;
            document.getElementById('screen-btn').textContent = '🖥️ Stop Sharing';
            document.getElementById('screen-btn').classList.add('active');
            
            // Add indicator
            const indicator = document.createElement('div');
            indicator.className = 'screen-share-indicator';
            indicator.id = 'screen-indicator';
            indicator.textContent = '🔴 Sharing Screen';
            document.getElementById('local-video-container').appendChild(indicator);
            
        } catch (err) {
            console.error('Error sharing screen:', err);
        }
    } else {
        stopScreenShare();
    }
}

async function stopScreenShare() {
    // Restore camera video
    const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 }
        },
        audio: true
    });
    
    const videoTrack = newStream.getVideoTracks()[0];
    const audioTrack = newStream.getAudioTracks()[0];
    
    // Replace tracks in peer connections
    Object.values(peerConnections).forEach(pc => {
        const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
        const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio');
        
        if (videoSender) videoSender.replaceTrack(videoTrack);
        if (audioSender) audioSender.replaceTrack(audioTrack);
    });
    
    // Update local stream
    localStream.removeTrack(localStream.getVideoTracks()[0]);
    localStream.removeTrack(localStream.getAudioTracks()[0]);
    localStream.addTrack(videoTrack);
    localStream.addTrack(audioTrack);
    localVideo.srcObject = localStream;
    
    isScreenSharing = false;
    document.getElementById('screen-btn').textContent = '🖥️ Share Screen';
    document.getElementById('screen-btn').classList.remove('active');
    
    const indicator = document.getElementById('screen-indicator');
    if (indicator) indicator.remove();
}

function leaveRoom() {
    // Close all peer connections
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    
    // Stop local stream
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    // Clear video grid (except local video)
    const remoteVideos = document.querySelectorAll('[id^="remote-"]');
    remoteVideos.forEach(video => video.remove());
    
    // Clear users list
    usersContainer.innerHTML = '';
    
    // Clear chat
    chatMessages.innerHTML = '';
    
    // Show login screen
    mainScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    
    // Reset inputs
    roomIdInput.value = '';
    
    // Remove screen share indicator if present
    const indicator = document.getElementById('screen-indicator');
    if (indicator) indicator.remove();
}