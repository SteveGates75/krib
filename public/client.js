// Updated client.js for Render deployment
const socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
});

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

// Connection status indicator
const connectionStatus = document.createElement('div');
connectionStatus.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    padding: 5px 10px;
    border-radius: 5px;
    font-size: 12px;
    z-index: 1000;
`;
document.body.appendChild(connectionStatus);

socket.on('connect', () => {
    console.log('Connected to server with ID:', socket.id);
    connectionStatus.textContent = '🟢 Connected';
    connectionStatus.style.backgroundColor = '#c6f6d5';
    connectionStatus.style.color = '#22543d';
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    connectionStatus.textContent = '🔴 Connection Error';
    connectionStatus.style.backgroundColor = '#fed7d7';
    connectionStatus.style.color = '#742a2a';
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    connectionStatus.textContent = '⚪ Disconnected';
    connectionStatus.style.backgroundColor = '#e2e8f0';
    connectionStatus.style.color = '#4a5568';
});

// WebRTC Configuration with multiple STUN servers for better connectivity
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
};

// Initialize media devices with error handling
async function initLocalStream() {
    try {
        console.log('Requesting media devices...');
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                frameRate: { ideal: 30 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            }
        });
        
        console.log('Media devices accessed successfully');
        localVideo.srcObject = localStream;
        return true;
    } catch (err) {
        console.error('Error accessing media devices:', err);
        let errorMessage = 'Could not access camera/microphone. ';
        
        if (err.name === 'NotAllowedError') {
            errorMessage += 'Please allow camera and microphone access.';
        } else if (err.name === 'NotFoundError') {
            errorMessage += 'No camera or microphone found.';
        } else {
            errorMessage += 'Please check your devices and permissions.';
        }
        
        alert(errorMessage);
        return false;
    }
}

// Create or join room with better error handling
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
    
    if (!socket.connected) {
        alert('Not connected to server. Please wait...');
        return;
    }
    
    username = name;
    currentRoom = roomId;
    
    console.log(`Joining room ${roomId} as ${username}`);
    
    const mediaSuccess = await initLocalStream();
    if (!mediaSuccess) return;
    
    loginScreen.classList.add('hidden');
    mainScreen.classList.remove('hidden');
    
    currentRoomSpan.textContent = `Room: ${roomId}`;
    
    socket.emit('join-room', roomId, username);
}

function createRoom() {
    // Generate a random room ID with prefix for easier identification
    const roomId = 'ROOM-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    roomIdInput.value = roomId;
    joinRoom();
}

function copyRoomId() {
    navigator.clipboard.writeText(currentRoom).then(() => {
        // Show temporary success message
        const copyBtn = document.querySelector('.copy-btn');
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => {
            copyBtn.textContent = originalText;
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('Failed to copy room ID');
    });
}

// WebRTC Peer Connection Management with better error handling
function createPeerConnection(targetUserId) {
    console.log(`Creating peer connection for ${targetUserId}`);
    const pc = new RTCPeerConnection(configuration);
    
    // Add local stream tracks
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
        console.log(`Added ${track.kind} track to peer connection`);
    });
    
    // Handle incoming tracks
    pc.ontrack = (event) => {
        console.log(`Received ${event.track.kind} track from ${targetUserId}`);
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
        if (remoteVideo && !remoteVideo.srcObject) {
            remoteVideo.srcObject = event.streams[0];
            
            // Update label with username
            const userItem = document.getElementById(`user-${targetUserId}`);
            if (userItem) {
                const label = document.getElementById(`label-${targetUserId}`);
                if (label) {
                    label.textContent = userItem.textContent;
                }
            }
        }
    };
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Sending ICE candidate to', targetUserId);
            socket.emit('ice-candidate', {
                target: targetUserId,
                candidate: event.candidate
            });
        }
    };
    
    pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection state with ${targetUserId}:`, pc.iceConnectionState);
        if (pc.iceConnectionState === 'disconnected' || 
            pc.iceConnectionState === 'failed' ||
            pc.iceConnectionState === 'closed') {
            // Clean up failed connection
            const remoteContainer = document.getElementById(`remote-${targetUserId}`);
            if (remoteContainer) {
                remoteContainer.remove();
            }
        }
    };
    
    pc.onsignalingstatechange = () => {
        console.log(`Signaling state with ${targetUserId}:`, pc.signalingState);
    };
    
    peerConnections[targetUserId] = pc;
    return pc;
}

// Socket.io event handlers with better logging
socket.on('existing-users', (users) => {
    console.log('Received existing users:', users);
    users.forEach(user => {
        if (user.userId !== socket.id) {
            addUserToList(user.userId, user.username);
            makeOffer(user.userId);
        }
    });
});

socket.on('user-joined', async (data) => {
    console.log('User joined:', data);
    addUserToList(data.userId, data.username);
    if (data.userId !== socket.id) {
        await makeOffer(data.userId);
    }
});

socket.on('user-left', (data) => {
    console.log('User left:', data);
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
    console.log('Making offer to', targetUserId);
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
        console.log('Offer sent to', targetUserId);
    } catch (err) {
        console.error('Error making offer:', err);
    }
}

socket.on('offer', async (data) => {
    console.log('Received offer from', data.sender);
    const pc = createPeerConnection(data.sender);
    
    try {
        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('answer', {
            target: data.sender,
            answer: answer
        });
        console.log('Answer sent to', data.sender);
    } catch (err) {
        console.error('Error handling offer:', err);
    }
});

socket.on('answer', async (data) => {
    console.log('Received answer from', data.sender);
    const pc = peerConnections[data.sender];
    if (pc) {
        try {
            await pc.setRemoteDescription(data.answer);
            console.log('Answer processed successfully');
        } catch (err) {
            console.error('Error handling answer:', err);
        }
    }
});

socket.on('ice-candidate', async (data) => {
    console.log('Received ICE candidate from', data.sender);
    const pc = peerConnections[data.sender];
    if (pc) {
        try {
            await pc.addIceCandidate(data.candidate);
            console.log('ICE candidate added successfully');
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
    // Check if user already exists
    if (document.getElementById(`user-${userId}`)) {
        return;
    }
    
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
                },
                audio: false
            });
            
            // Replace video track in all peer connections
            const videoTrack = screenStream.getVideoTracks()[0];
            
            Object.values(peerConnections).forEach(pc => {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(videoTrack);
                }
            });
            
            // Update local display
            const localVideoTrack = localStream.getVideoTracks()[0];
            localStream.removeTrack(localVideoTrack);
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
            alert('Could not start screen sharing');
        }
    } else {
        stopScreenShare();
    }
}

async function stopScreenShare() {
    try {
        // Restore camera video
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 }
            },
            audio: false
        });
        
        const videoTrack = newStream.getVideoTracks()[0];
        
        // Replace tracks in all peer connections
        Object.values(peerConnections).forEach(pc => {
            const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
            if (videoSender) {
                videoSender.replaceTrack(videoTrack);
            }
        });
        
        // Update local stream
        const oldVideoTrack = localStream.getVideoTracks()[0];
        localStream.removeTrack(oldVideoTrack);
        localStream.addTrack(videoTrack);
        localVideo.srcObject = localStream;
        
        isScreenSharing = false;
        document.getElementById('screen-btn').textContent = '🖥️ Share Screen';
        document.getElementById('screen-btn').classList.remove('active');
        
        const indicator = document.getElementById('screen-indicator');
        if (indicator) indicator.remove();
        
    } catch (err) {
        console.error('Error stopping screen share:', err);
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
    
    currentRoom = null;
    username = null;
}