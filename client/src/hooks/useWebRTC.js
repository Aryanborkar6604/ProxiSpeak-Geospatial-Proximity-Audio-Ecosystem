import { useEffect, useRef, useState, useCallback } from 'react';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ],
};

export default function useWebRTC(socket, localUserId) {
  const [localStream, setLocalStream] = useState(null);
  const [micPermissionState, setMicPermissionState] = useState('prompt'); // prompt, granted, denied, unsupported, insecure_context
  const [isMuted, setIsMuted] = useState(false);
  const [nearbyPeers, setNearbyPeers] = useState({});
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [localVolume, setLocalVolume] = useState(0);
  const [speakingPeers, setSpeakingPeers] = useState({});
  const [mutedPeers, setMutedPeers] = useState({});
  const [peerAttenuations, setPeerAttenuations] = useState({});
  
  const peerConnections = useRef({});
  const audioElements = useRef({});
  const iceCandidateQueues = useRef({});
  const audioContextRef = useRef(null);
  const spatialNodesRef = useRef({}); // { [peerId]: { source, gainNode, pannerNode } }
  const positionsRef = useRef({ local: { x: 175, y: 335 }, peers: {} });
  const peerAttenuationsRef = useRef({});
  const localAnalyserRef = useRef(null);
  const isMutedRef = useRef(false);
  isMutedRef.current = isMuted;

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioContextRef.current = new AudioCtx();
      }
    }
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {});
    }
    return audioContextRef.current;
  }, []);

  // Check support on mount
  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        setMicPermissionState('insecure_context');
      } else {
        setMicPermissionState('unsupported');
      }
    }
  }, []);

  const requestMic = async () => {
    getAudioContext();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        setMicPermissionState('insecure_context');
      } else {
        setMicPermissionState('unsupported');
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      setLocalStream(stream);
      setMicPermissionState('granted');
    } catch (err) {
      console.error('Mic access denied or error:', err);
      setMicPermissionState('denied');
    }
  };

  // Voice Activity Detection (VAD) via AnalyserNode on local stream
  useEffect(() => {
    if (!localStream) return undefined;
    const ctx = getAudioContext();
    if (!ctx) return undefined;

    let sourceNode;
    let analyserNode;
    let animFrame;
    let lastSpeakingState = false;
    let silenceStart = 0;
    const HANGOVER_MS = 350; // Keep speaking = true for 350ms to prevent flickering
    const VOICE_THRESHOLD = 0.08; // Normalized voice threshold

    try {
      sourceNode = ctx.createMediaStreamSource(localStream);
      analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 256;
      analyserNode.smoothingTimeConstant = 0.4;
      // Connect to analyser ONLY (do NOT connect to ctx.destination to avoid mic feedback)
      sourceNode.connect(analyserNode);
      localAnalyserRef.current = { source: sourceNode, analyser: analyserNode };

      const sampleAudio = () => {
        if (!isMutedRef.current && analyserNode) {
          const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
          analyserNode.getByteFrequencyData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          const vol = Math.min(1, avg / 75);
          setLocalVolume(vol);

          const now = Date.now();
          const currentlyAboveThreshold = vol > VOICE_THRESHOLD;

          if (currentlyAboveThreshold) {
            silenceStart = 0;
            if (!lastSpeakingState) {
              lastSpeakingState = true;
              setIsSpeaking(true);
              socket?.emit('player:speaking', { isSpeaking: true });
            }
          } else if (lastSpeakingState) {
            if (!silenceStart) {
              silenceStart = now;
            } else if (now - silenceStart >= HANGOVER_MS) {
              lastSpeakingState = false;
              silenceStart = 0;
              setIsSpeaking(false);
              socket?.emit('player:speaking', { isSpeaking: false });
            }
          }
        } else {
          setLocalVolume(0);
          if (lastSpeakingState) {
            lastSpeakingState = false;
            silenceStart = 0;
            setIsSpeaking(false);
            socket?.emit('player:speaking', { isSpeaking: false });
          }
        }
        animFrame = requestAnimationFrame(sampleAudio);
      };

      animFrame = requestAnimationFrame(sampleAudio);
    } catch (err) {
      console.warn('[VAD] Could not initialize AnalyserNode:', err);
    }

    return () => {
      cancelAnimationFrame(animFrame);
      if (lastSpeakingState) {
        socket?.emit('player:speaking', { isSpeaking: false });
      }
      try {
        sourceNode?.disconnect();
      } catch (_) {}
      localAnalyserRef.current = null;
    };
  }, [localStream, socket, getAudioContext]);

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        const nextMuted = !isMuted;
        audioTrack.enabled = !nextMuted;
        setIsMuted(nextMuted);
        isMutedRef.current = nextMuted;

        if (nextMuted) {
          setIsSpeaking(false);
          setLocalVolume(0);
          socket?.emit('player:speaking', { isSpeaking: false });
        }
        socket?.emit('player:mute', { isMuted: nextMuted });
      }
    }
  };

  // Dynamic distance & obstacle attenuation spatial audio updater
  const updateSpatialAudio = useCallback((currentLocalPos, currentPeers, radius = 105) => {
    if (currentLocalPos) positionsRef.current.local = currentLocalPos;
    if (currentPeers) positionsRef.current.peers = currentPeers;

    const ctx = getAudioContext();
    if (!ctx) return;

    const myPos = positionsRef.current.local;
    const allPeers = positionsRef.current.peers;

    Object.entries(spatialNodesRef.current).forEach(([peerId, nodes]) => {
      const peer = allPeers[peerId];
      if (!peer || !myPos || !nodes.gainNode) return;

      const dx = peer.x - myPos.x;
      const dy = peer.y - myPos.y;
      const distance = Math.hypot(dx, dy);

      // Distance attenuation:
      // Linear volume drop-off
      const distanceGain = Math.max(0, Math.min(1, 1 - (distance / radius)));
      // Factor in obstacle sound-blocking attenuation factor (0.05 to 1.0)
      const obstacleAttenuation = peerAttenuationsRef.current[peerId] ?? 1.0;
      const targetGain = distanceGain * obstacleAttenuation;
      
      // Stereo pan:
      // Left is -1, Right is +1, Center is 0
      const targetPan = Math.max(-1, Math.min(1, dx / radius));

      const now = ctx.currentTime;
      nodes.gainNode.gain.setTargetAtTime(targetGain, now, 0.05);
      if (nodes.pannerNode) {
        nodes.pannerNode.pan.setTargetAtTime(targetPan, now, 0.05);
      }
    });
  }, [getAudioContext]);

  useEffect(() => {
    if (!socket || !localStream) return undefined;

    const flushIceQueue = async (peerId, pc) => {
      const queue = iceCandidateQueues.current[peerId] || [];
      iceCandidateQueues.current[peerId] = [];
      for (const candidate of queue) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('Error adding queued ICE candidate for peer', peerId, err);
        }
      }
    };

    const createPeerConnection = (peerId) => {
      if (peerConnections.current[peerId]) {
        return peerConnections.current[peerId];
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);

      // Attach our audio tracks
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

      // Emit local ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc:ice-candidate', { toUserId: peerId, candidate: event.candidate });
        }
      };

      // Play received remote audio with Spatial Audio (Web Audio API)
      pc.ontrack = (event) => {
        console.log(`[WebRTC] Received audio track from ${peerId}`);
        const stream = event.streams[0] || new MediaStream([event.track]);
        const ctx = getAudioContext();

        if (ctx) {
          try {
            // Disconnect old nodes if any
            if (spatialNodesRef.current[peerId]) {
              try {
                spatialNodesRef.current[peerId].source.disconnect();
                spatialNodesRef.current[peerId].gainNode.disconnect();
                if (spatialNodesRef.current[peerId].pannerNode) {
                  spatialNodesRef.current[peerId].pannerNode.disconnect();
                }
              } catch (_) {}
            }

            const source = ctx.createMediaStreamSource(stream);
            const gainNode = ctx.createGain();
            const pannerNode = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

            // Connect graph: source -> gain -> panner -> destination
            if (pannerNode) {
              source.connect(gainNode);
              gainNode.connect(pannerNode);
              pannerNode.connect(ctx.destination);
            } else {
              source.connect(gainNode);
              gainNode.connect(ctx.destination);
            }

            spatialNodesRef.current[peerId] = { source, gainNode, pannerNode };
            
            // Calculate initial distance & gain right away
            updateSpatialAudio(positionsRef.current.local, positionsRef.current.peers);
          } catch (err) {
            console.error('[WebAudio] Error connecting spatial graph for peer', peerId, err);
          }
        }

        // Secondary fallback audio element (keeps stream alive in browser background)
        let audioEl = audioElements.current[peerId];
        if (!audioEl) {
          audioEl = new Audio();
          audioElements.current[peerId] = audioEl;
        }
        audioEl.srcObject = stream;
        audioEl.muted = true; // Output is handled by Web Audio API destination
        audioEl.play().catch(() => {});
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] Connection state with ${peerId}:`, pc.connectionState);
      };

      peerConnections.current[peerId] = pc;
      return pc;
    };

    const handleEnterRange = async ({ userId: peerId, attenuation = 1.0 }) => {
      console.log(`[WebRTC] Peer entered range: ${peerId} (attenuation: ${attenuation})`);
      peerAttenuationsRef.current[peerId] = attenuation;
      setPeerAttenuations((prev) => ({ ...prev, [peerId]: attenuation }));
      setNearbyPeers((prev) => ({ ...prev, [peerId]: true }));

      // Deterministic initiator logic (lexicographical comparison)
      if (String(localUserId) > String(peerId)) {
        try {
          const pc = createPeerConnection(peerId);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('webrtc:offer', { toUserId: peerId, sdp: offer });
        } catch (err) {
          console.error(`[WebRTC] Failed to create offer for ${peerId}:`, err);
        }
      }
    };

    const handleExitRange = ({ userId: peerId }) => {
      console.log(`[WebRTC] Peer exited range: ${peerId}`);
      delete peerAttenuationsRef.current[peerId];
      setPeerAttenuations((prev) => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      setNearbyPeers((prev) => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });

      // Smoothly fade out spatial audio
      const nodes = spatialNodesRef.current[peerId];
      const ctx = audioContextRef.current;
      if (nodes && ctx) {
        nodes.gainNode.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        setTimeout(() => {
          try {
            nodes.source.disconnect();
            nodes.gainNode.disconnect();
            if (nodes.pannerNode) nodes.pannerNode.disconnect();
          } catch (_) {}
          delete spatialNodesRef.current[peerId];
        }, 100);
      }

      if (audioElements.current[peerId]) {
        audioElements.current[peerId].pause();
        audioElements.current[peerId].srcObject = null;
        delete audioElements.current[peerId];
      }

      if (peerConnections.current[peerId]) {
        peerConnections.current[peerId].close();
        delete peerConnections.current[peerId];
      }
      delete iceCandidateQueues.current[peerId];
    };

    const handleOffer = async ({ fromUserId, sdp }) => {
      try {
        let pc = peerConnections.current[fromUserId];
        if (!pc) pc = createPeerConnection(fromUserId);

        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await flushIceQueue(fromUserId, pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc:answer', { toUserId: fromUserId, sdp: answer });
      } catch (err) {
        console.error(`[WebRTC] Error handling offer from ${fromUserId}:`, err);
      }
    };

    const handleAnswer = async ({ fromUserId, sdp }) => {
      try {
        const pc = peerConnections.current[fromUserId];
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          await flushIceQueue(fromUserId, pc);
        }
      } catch (err) {
        console.error(`[WebRTC] Error handling answer from ${fromUserId}:`, err);
      }
    };

    const handleIceCandidate = async ({ fromUserId, candidate }) => {
      try {
        const pc = peerConnections.current[fromUserId];
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
          iceCandidateQueues.current[fromUserId] = iceCandidateQueues.current[fromUserId] || [];
          iceCandidateQueues.current[fromUserId].push(candidate);
        }
      } catch (err) {
        console.error(`[WebRTC] Error handling ICE candidate from ${fromUserId}:`, err);
      }
    };

    const handleSpeaking = ({ userId, isSpeaking }) => {
      setSpeakingPeers((prev) => {
        if (!isSpeaking) {
          const next = { ...prev };
          delete next[userId];
          return next;
        }
        return { ...prev, [userId]: true };
      });
    };

    const handleMuted = ({ userId, isMuted }) => {
      setMutedPeers((prev) => {
        if (!isMuted) {
          const next = { ...prev };
          delete next[userId];
          return next;
        }
        return { ...prev, [userId]: true };
      });
    };

    const handleAttenuationChanged = ({ userId: peerId, attenuation = 1.0 }) => {
      console.log(`[Spatial Audio] Attenuation changed for peer ${peerId}: ${attenuation}`);
      peerAttenuationsRef.current[peerId] = attenuation;
      setPeerAttenuations((prev) => ({ ...prev, [peerId]: attenuation }));
      updateSpatialAudio(positionsRef.current.local, positionsRef.current.peers);
    };

    socket.on('peer:enter-range', handleEnterRange);
    socket.on('peer:exit-range', handleExitRange);
    socket.on('peer:attenuation-changed', handleAttenuationChanged);
    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice-candidate', handleIceCandidate);
    socket.on('player:speaking', handleSpeaking);
    socket.on('player:muted', handleMuted);

    return () => {
      socket.off('peer:enter-range', handleEnterRange);
      socket.off('peer:exit-range', handleExitRange);
      socket.off('peer:attenuation-changed', handleAttenuationChanged);
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice-candidate', handleIceCandidate);
      socket.off('player:speaking', handleSpeaking);
      socket.off('player:muted', handleMuted);
    };
  }, [socket, localStream, localUserId, getAudioContext, updateSpatialAudio]);

  return {
    requestMic,
    micPermissionState,
    isMuted,
    toggleMute,
    nearbyPeers,
    updateSpatialAudio,
    isSpeaking,
    localVolume,
    speakingPeers,
    mutedPeers,
    peerAttenuations,
  };
}
