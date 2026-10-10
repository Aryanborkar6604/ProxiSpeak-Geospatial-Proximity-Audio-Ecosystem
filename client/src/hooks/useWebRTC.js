import { useEffect, useRef, useState } from 'react';

export default function useWebRTC(socket, localUserId) {
  const [localStream, setLocalStream] = useState(null);
  const [micPermissionState, setMicPermissionState] = useState('prompt'); // prompt, granted, denied
  const [isMuted, setIsMuted] = useState(false);
  const [nearbyPeers, setNearbyPeers] = useState({});
  const peerConnections = useRef({});

  const requestMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      setLocalStream(stream);
      setMicPermissionState('granted');
    } catch (err) {
      console.error("Mic access denied", err);
      setMicPermissionState('denied');
    }
  };

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = isMuted; // If it was muted, set enabled to true
        setIsMuted(!isMuted);
      }
    }
  };

  useEffect(() => {
    if (!socket || !localStream) return;

    const createPeerConnection = (peerId) => {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc:ice-candidate', { toUserId: peerId, candidate: event.candidate });
        }
      };

      pc.ontrack = (event) => {
        console.log(`Received audio track from ${peerId}`);
        const audioEl = new Audio();
        audioEl.srcObject = event.streams[0];
        audioEl.autoplay = true;
        audioEl.play().catch(e => console.error("Audio playback blocked", e));
      };

      peerConnections.current[peerId] = pc;
      return pc;
    };

    const handleEnterRange = async ({ userId: peerId }) => {
      setNearbyPeers(prev => ({ ...prev, [peerId]: true }));
      
      // Determine initiator to prevent double-offers
      if (localUserId > peerId) {
        const pc = createPeerConnection(peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc:offer', { toUserId: peerId, sdp: offer });
      }
    };

    const handleExitRange = ({ userId: peerId }) => {
      setNearbyPeers(prev => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      
      if (peerConnections.current[peerId]) {
        peerConnections.current[peerId].close();
        delete peerConnections.current[peerId];
      }
    };

    const handleOffer = async ({ fromUserId, sdp }) => {
      let pc = peerConnections.current[fromUserId];
      if (!pc) pc = createPeerConnection(fromUserId);
      
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc:answer', { toUserId: fromUserId, sdp: answer });
    };

    const handleAnswer = async ({ fromUserId, sdp }) => {
      const pc = peerConnections.current[fromUserId];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      }
    };

    const handleIceCandidate = async ({ fromUserId, candidate }) => {
      const pc = peerConnections.current[fromUserId];
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    };

    socket.on('peer:enter-range', handleEnterRange);
    socket.on('peer:exit-range', handleExitRange);
    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice-candidate', handleIceCandidate);

    return () => {
      socket.off('peer:enter-range', handleEnterRange);
      socket.off('peer:exit-range', handleExitRange);
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice-candidate', handleIceCandidate);
    };
  }, [socket, localStream, localUserId]);

  return { requestMic, micPermissionState, isMuted, toggleMute, nearbyPeers };
}

