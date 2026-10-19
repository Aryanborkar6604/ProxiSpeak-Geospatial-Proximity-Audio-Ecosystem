import { useEffect, useRef, useState, useCallback } from 'react';

const DEFAULT_RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ],
};
const runDirectly = (request) => request();

export default function useWebRTC(socket, localUserId, token, officeId, runWithServerActivity = runDirectly, peers = {}) {
  const [rtcConfig, setRtcConfig] = useState(DEFAULT_RTC_CONFIG);
  const [rtcMode, setRtcMode] = useState('peer');
  const [loadedRtcToken, setLoadedRtcToken] = useState(null);
  const rtcConfigReady = !token || loadedRtcToken === token;
  const [voiceConnectionState, setVoiceConnectionState] = useState('idle');
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
  const livekitRoomRef = useRef(null);
  const audioElements = useRef({});
  const iceCandidateQueues = useRef({});
  const pendingOffers = useRef({});
  const audioContextRef = useRef(null);
  const spatialNodesRef = useRef({}); // { [peerId]: { source, gainNode, pannerNode } }
  const positionsRef = useRef({ local: { x: 175, y: 335 }, peers: peers || {} });
  const peerAttenuationsRef = useRef({});
  const nearbyPeersRef = useRef(nearbyPeers);
  const localAnalyserRef = useRef(null);
  const isMutedRef = useRef(false);
  isMutedRef.current = isMuted;

  useEffect(() => {
    nearbyPeersRef.current = nearbyPeers;
  }, [nearbyPeers]);


  useEffect(() => {
    if (!token) {
      return undefined;
    }

    const controller = new AbortController();
    const apiBaseUrl = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
    runWithServerActivity(async () => {
      const response = await fetch(`${apiBaseUrl}/rtc/config`, {
      headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`RTC configuration request failed (${response.status}).`);
      }
      const config = await response.json();
      if (!Array.isArray(config.iceServers) || config.iceServers.length === 0) {
        throw new Error('RTC configuration did not include any ICE servers.');
      }
      return config;
    })
      .then((config) => {
        setRtcConfig({ iceServers: config.iceServers });
        setRtcMode(config.mode === 'livekit' ? 'livekit' : 'peer');
        setLoadedRtcToken(token);
        if (config.mode !== 'livekit') setVoiceConnectionState('ready');
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          console.warn('[WebRTC] Could not load server ICE configuration; using STUN fallback.', error);
          setRtcConfig(DEFAULT_RTC_CONFIG);
          setRtcMode('peer');
          setLoadedRtcToken(token);
          setVoiceConnectionState('ready');
        }
      });

    return () => controller.abort();
  }, [token, runWithServerActivity]);

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

  // Unlock AudioContext on any user interaction (click, keypress, touch) to comply with browser autoplay policies
  useEffect(() => {
    const unlockAudio = () => {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);
    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
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

  // Sync external peers whenever peer coordinates change
  useEffect(() => {
    if (peers) {
      positionsRef.current.peers = peers;
      updateSpatialAudio(positionsRef.current.local, peers);
    }
  }, [peers]);

  // Dynamic distance & obstacle attenuation spatial audio updater (100px range)
  const updateSpatialAudio = useCallback((currentLocalPos, currentPeers, radius = 100) => {
    if (currentLocalPos) positionsRef.current.local = currentLocalPos;
    if (currentPeers) positionsRef.current.peers = currentPeers;

    const ctx = getAudioContext();
    const myPos = positionsRef.current.local;
    const allPeers = positionsRef.current.peers;

    Object.entries(spatialNodesRef.current).forEach(([peerId, nodes]) => {
      const peer = allPeers[peerId];
      let distanceGain = 0.8; // Default audible gain if peer position is awaiting first sync
      let targetPan = 0;

      if (peer && myPos) {
        const dx = peer.x - myPos.x;
        const dy = peer.y - myPos.y;
        const distance = Math.hypot(dx, dy);

        if (distance <= radius) {
          const norm = distance / radius; // 0 (point-blank) to 1 (at 100px limit)
          // Smooth acoustic curve: crystal clear at close range, natural rolloff to 18% at boundary
          distanceGain = Math.max(0.18, 1 - Math.pow(norm, 1.3));
        } else {
          distanceGain = 0;
        }
        targetPan = Math.max(-1, Math.min(1, dx / radius));
      }

      const obstacleAttenuation = peerAttenuationsRef.current[peerId] ?? 1.0;
      const targetGain = distanceGain * obstacleAttenuation;

      // Primary WebAudio spatial output
      if (ctx && nodes.gainNode) {
        const now = ctx.currentTime;
        nodes.gainNode.gain.setTargetAtTime(targetGain, now, 0.05);
        if (nodes.pannerNode) {
          nodes.pannerNode.pan.setTargetAtTime(targetPan, now, 0.05);
        }
      }

      // Secondary direct Audio element fallback for browsers blocking AudioContext
      const audioEl = audioElements.current[peerId];
      if (audioEl) {
        if (!ctx || ctx.state === 'suspended') {
          audioEl.muted = false;
          audioEl.volume = Math.max(0, Math.min(1, targetGain));
        } else {
          // WebAudio is active, mute direct element to prevent echo/double playback
          audioEl.muted = true;
        }
      }
    });
  }, [getAudioContext]);

  const attachRemoteAudio = useCallback((peerId, stream) => {
    // 1. Maintain an HTMLAudioElement playing the stream.
    // In Chromium, if an audio element is not playing the remote stream,
    // WebRTC packet decoding halts and WebAudio createMediaStreamSource goes silent.
    let audioEl = audioElements.current[peerId];
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioElements.current[peerId] = audioEl;
    }
    audioEl.srcObject = stream;
    audioEl.play().catch((playError) => {
      console.warn('[WebRTC] Remote audio play notice:', playError.message);
    });

    const ctx = getAudioContext();
    if (!ctx) {
      audioEl.muted = false;
      return;
    }

    const existing = spatialNodesRef.current[peerId];
    if (existing) {
      try {
        existing.source.disconnect();
        existing.gainNode.disconnect();
        existing.pannerNode?.disconnect();
      } catch (_) {}
    }

    try {
      const source = ctx.createMediaStreamSource(stream);
      const gainNode = ctx.createGain();
      gainNode.gain.value = 1.0;
      const pannerNode = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

      if (pannerNode) {
        source.connect(gainNode);
        gainNode.connect(pannerNode);
        pannerNode.connect(ctx.destination);
      } else {
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
      }

      spatialNodesRef.current[peerId] = { source, gainNode, pannerNode };

      if (ctx.state === 'running') {
        audioEl.muted = true;
      } else {
        audioEl.muted = false;
      }

      updateSpatialAudio(positionsRef.current.local, positionsRef.current.peers);
    } catch (error) {
      console.warn('[WebAudio] Fallback to direct HTML5 audio output:', error.message);
      audioEl.muted = false;
    }
  }, [getAudioContext, updateSpatialAudio]);


  const removeRemoteAudio = useCallback((peerId) => {
    const nodes = spatialNodesRef.current[peerId];
    const ctx = audioContextRef.current;
    if (nodes && ctx) {
      nodes.gainNode.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      setTimeout(() => {
        try {
          nodes.source.disconnect();
          nodes.gainNode.disconnect();
          nodes.pannerNode?.disconnect();
        } catch (_) {}
        if (spatialNodesRef.current[peerId] === nodes) delete spatialNodesRef.current[peerId];
      }, 120);
    }

    const audioEl = audioElements.current[peerId];
    if (audioEl) {
      audioEl.pause();
      audioEl.srcObject = null;
      delete audioElements.current[peerId];
    }
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const handleEnterRange = ({ userId: peerId, attenuation = 1 }) => {
      if (rtcMode !== 'livekit') return;
      peerAttenuationsRef.current[peerId] = attenuation;
      nearbyPeersRef.current = { ...nearbyPeersRef.current, [peerId]: true };
      setPeerAttenuations((previous) => previous[peerId] === attenuation
        ? previous
        : { ...previous, [peerId]: attenuation });
      setNearbyPeers((previous) => previous[peerId] ? previous : { ...previous, [peerId]: true });
      const participant = livekitRoomRef.current?.remoteParticipants.get(peerId);
      participant?.audioTrackPublications.forEach((publication) => publication.setSubscribed(true));
    };
    const handleExitRange = ({ userId: peerId }) => {
      if (rtcMode !== 'livekit') return;
      delete peerAttenuationsRef.current[peerId];
      const nextNearbyPeers = { ...nearbyPeersRef.current };
      delete nextNearbyPeers[peerId];
      nearbyPeersRef.current = nextNearbyPeers;
      setPeerAttenuations((previous) => {
        const next = { ...previous };
        delete next[peerId];
        return next;
      });
      setNearbyPeers((previous) => {
        const next = { ...previous };
        delete next[peerId];
        return next;
      });
      const participant = livekitRoomRef.current?.remoteParticipants.get(peerId);
      participant?.audioTrackPublications.forEach((publication) => publication.setSubscribed(false));
      removeRemoteAudio(peerId);
    };
    const handleAttenuationChanged = ({ userId: peerId, attenuation = 1 }) => {
      if (rtcMode !== 'livekit') return;
      peerAttenuationsRef.current[peerId] = attenuation;
      setPeerAttenuations((previous) => ({ ...previous, [peerId]: attenuation }));
      updateSpatialAudio(positionsRef.current.local, positionsRef.current.peers);
    };
    const handleSpeaking = ({ userId: peerId, isSpeaking }) => {
      setSpeakingPeers((previous) => {
        if (isSpeaking) return { ...previous, [peerId]: true };
        const next = { ...previous };
        delete next[peerId];
        return next;
      });
    };
    const handleMuted = ({ userId: peerId, isMuted: peerMuted }) => {
      setMutedPeers((previous) => {
        if (peerMuted) return { ...previous, [peerId]: true };
        const next = { ...previous };
        delete next[peerId];
        return next;
      });
    };

    socket.on('peer:enter-range', handleEnterRange);
    socket.on('peer:exit-range', handleExitRange);
    socket.on('peer:attenuation-changed', handleAttenuationChanged);
    socket.on('player:speaking', handleSpeaking);
    socket.on('player:muted', handleMuted);
    return () => {
      socket.off('peer:enter-range', handleEnterRange);
      socket.off('peer:exit-range', handleExitRange);
      socket.off('peer:attenuation-changed', handleAttenuationChanged);
      socket.off('player:speaking', handleSpeaking);
      socket.off('player:muted', handleMuted);
    };
  }, [socket, rtcMode, removeRemoteAudio, updateSpatialAudio]);

  useEffect(() => {
    if (!token || !localStream || !officeId || !rtcConfigReady || rtcMode !== 'livekit') {
      return undefined;
    }

    const controller = new AbortController();
    let room;
    let cancelled = false;
    const spatialNodes = spatialNodesRef.current;

    const connectRoom = async () => {
      setVoiceConnectionState('connecting');
      try {
        const { Room, RoomEvent, Track } = await import('livekit-client');
        const apiBaseUrl = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
        const credentials = await runWithServerActivity(async () => {
          const response = await fetch(`${apiBaseUrl}/rtc/livekit-token?officeId=${encodeURIComponent(officeId)}`, {
          headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          });
          const credentials = await response.json();
          if (!response.ok) throw new Error(credentials.error || `LiveKit token request failed (${response.status}).`);
          if (!credentials.url || !credentials.token) throw new Error('LiveKit credentials response is incomplete.');
          return credentials;
        });

        room = new Room({ adaptiveStream: false, dynacast: true });
        livekitRoomRef.current = room;
        const syncSubscriptions = () => {
          room.remoteParticipants.forEach((participant) => {
            const shouldSubscribe = Boolean(nearbyPeersRef.current[participant.identity]);
            participant.audioTrackPublications.forEach((publication) => {
              publication.setSubscribed(shouldSubscribe);
            });
          });
        };
        const participantConnected = (participant) => {
          participant.audioTrackPublications.forEach((publication) => {
            publication.setSubscribed(Boolean(nearbyPeersRef.current[participant.identity]));
          });
        };
        const trackPublished = (publication, participant) => {
          if (publication.kind === Track.Kind.Audio) {
            publication.setSubscribed(Boolean(nearbyPeersRef.current[participant.identity]));
          }
        };
        const trackSubscribed = (track, publication, participant) => {
          if (track.kind === Track.Kind.Audio && nearbyPeersRef.current[participant.identity]) {
            attachRemoteAudio(participant.identity, new MediaStream([track.mediaStreamTrack]));
          } else {
            publication.setSubscribed(false);
          }
        };
        const trackUnsubscribed = (_track, _publication, participant) => {
          removeRemoteAudio(participant.identity);
        };
        const participantDisconnected = (participant) => {
          removeRemoteAudio(participant.identity);
          delete peerAttenuationsRef.current[participant.identity];
          setPeerAttenuations((previous) => {
            const next = { ...previous };
            delete next[participant.identity];
            return next;
          });
          setNearbyPeers((previous) => {
            const next = { ...previous };
            delete next[participant.identity];
            return next;
          });
          setSpeakingPeers((previous) => {
            const next = { ...previous };
            delete next[participant.identity];
            return next;
          });
          setMutedPeers((previous) => {
            const next = { ...previous };
            delete next[participant.identity];
            return next;
          });
        };
        const activeSpeakersChanged = (participants) => {
          const speaking = {};
          participants.forEach((participant) => {
            if (participant.identity !== localUserId) speaking[participant.identity] = true;
          });
          setSpeakingPeers(speaking);
        };

        room.on(RoomEvent.ParticipantConnected, participantConnected);
        room.on(RoomEvent.TrackPublished, trackPublished);
        room.on(RoomEvent.TrackSubscribed, trackSubscribed);
        room.on(RoomEvent.TrackUnsubscribed, trackUnsubscribed);
        room.on(RoomEvent.ParticipantDisconnected, participantDisconnected);
        room.on(RoomEvent.ActiveSpeakersChanged, activeSpeakersChanged);
        room.on(RoomEvent.Connected, () => {
          if (!cancelled) setVoiceConnectionState('connected');
        });
        room.on(RoomEvent.Reconnecting, () => {
          if (!cancelled) setVoiceConnectionState('reconnecting');
        });
        room.on(RoomEvent.Reconnected, () => {
          if (!cancelled) setVoiceConnectionState('connected');
        });
        room.on(RoomEvent.Disconnected, () => {
          if (!cancelled) setVoiceConnectionState('disconnected');
        });

        await room.connect(credentials.url, credentials.token, { autoSubscribe: false });
        if (cancelled) return;
        syncSubscriptions();
        const microphoneTrack = localStream.getAudioTracks()[0];
        if (!microphoneTrack) throw new Error('No microphone track is available to publish.');
        await room.localParticipant.publishTrack(microphoneTrack, { source: Track.Source.Microphone });
        if (!cancelled) setVoiceConnectionState('connected');
      } catch (error) {
        if (!cancelled && error.name !== 'AbortError') {
          console.error('[LiveKit] Could not connect to the SFU:', error);
          if (room) {
            try {
              await room.disconnect(false);
            } catch (cleanupError) {
              console.warn('[LiveKit] Error closing a failed SFU connection:', cleanupError);
            }
          }
          if (livekitRoomRef.current === room) livekitRoomRef.current = null;
          setVoiceConnectionState('error');
          setRtcMode('peer');
        }
      }
    };

    connectRoom();
    return () => {
      cancelled = true;
      controller.abort();
      if (livekitRoomRef.current === room) livekitRoomRef.current = null;
      if (room) {
        room.disconnect(false).catch((error) => {
          console.warn('[LiveKit] Could not cleanly disconnect the SFU room:', error);
        });
      }
      setVoiceConnectionState('ready');
      Object.keys(spatialNodes).forEach(removeRemoteAudio);
    };
  }, [token, localStream, officeId, rtcConfigReady, rtcMode, localUserId, attachRemoteAudio, removeRemoteAudio, runWithServerActivity]);

  useEffect(() => {
    if (!socket || rtcMode === 'livekit') return undefined;

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
      if (!rtcConfigReady) return null;

      const pc = new RTCPeerConnection(rtcConfig);

      // Attach our audio tracks if we have an active microphone
      if (localStream && localStream.getAudioTracks().length > 0) {
        localStream.getAudioTracks().forEach((track) => pc.addTrack(track, localStream));
      } else {
        // RecvOnly for listening avatar without microphone enabled
        try {
          pc.addTransceiver('audio', { direction: 'recvonly' });
        } catch (e) {
          console.warn('[WebRTC] addTransceiver fallback:', e);
        }
      }

      // Emit local ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc:ice-candidate', { toUserId: peerId, candidate: event.candidate });
        }
      };

      pc.ontrack = (event) => {
        console.log(`[WebRTC] Received audio track from ${peerId}`);
        const stream = event.streams[0] || new MediaStream([event.track]);
        attachRemoteAudio(peerId, stream);
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
      nearbyPeersRef.current = { ...nearbyPeersRef.current, [peerId]: true };
      setPeerAttenuations((prev) => (
        prev[peerId] === attenuation ? prev : { ...prev, [peerId]: attenuation }
      ));
      setNearbyPeers((prev) => (prev[peerId] ? prev : { ...prev, [peerId]: true }));

      // Deterministic initiator logic (lexicographical comparison)
      if (rtcConfigReady && !peerConnections.current[peerId] && String(localUserId) > String(peerId)) {
        try {
          const pc = createPeerConnection(peerId);
          if (!pc) return;
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
      const nextNearbyPeers = { ...nearbyPeersRef.current };
      delete nextNearbyPeers[peerId];
      nearbyPeersRef.current = nextNearbyPeers;
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
      if (nodes || audioElements.current[peerId]) removeRemoteAudio(peerId);

      if (peerConnections.current[peerId]) {
        peerConnections.current[peerId].close();
        delete peerConnections.current[peerId];
      }
      delete iceCandidateQueues.current[peerId];
      delete pendingOffers.current[peerId];
    };

    const handleOffer = async ({ fromUserId, sdp }) => {
      if (!rtcConfigReady) {
        pendingOffers.current[fromUserId] = sdp;
        return;
      }
      try {
        let pc = peerConnections.current[fromUserId];
        if (!pc) pc = createPeerConnection(fromUserId);
        if (!pc) {
          pendingOffers.current[fromUserId] = sdp;
          return;
        }

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

    if (localStream && rtcConfigReady) {
      const resumePendingConnections = async () => {
        for (const [peerId, sdp] of Object.entries(pendingOffers.current)) {
          delete pendingOffers.current[peerId];
          await handleOffer({ fromUserId: peerId, sdp });
        }
        Object.keys(nearbyPeersRef.current).forEach((peerId) => {
          handleEnterRange({ userId: peerId, attenuation: peerAttenuationsRef.current[peerId] ?? 1.0 });
        });
      };
      resumePendingConnections().catch((error) => {
        console.error('[WebRTC] Could not resume pending peer connections:', error);
      });
    }

    return () => {
      socket.off('peer:enter-range', handleEnterRange);
      socket.off('peer:exit-range', handleExitRange);
      socket.off('peer:attenuation-changed', handleAttenuationChanged);
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice-candidate', handleIceCandidate);
    };
  }, [socket, localStream, localUserId, token, rtcConfig, rtcConfigReady, rtcMode, attachRemoteAudio, removeRemoteAudio, getAudioContext, updateSpatialAudio]);

  // When localStream becomes active (user clicked "Enable microphone"), seamlessly attach/replace audio track on all active peer connections
  useEffect(() => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    Object.entries(peerConnections.current).forEach(([peerId, pc]) => {
      try {
        const senders = pc.getSenders();
        const audioSender = senders.find((s) => s.track && s.track.kind === 'audio') || senders.find((s) => !s.track);
        if (audioSender) {
          audioSender.replaceTrack(audioTrack).catch((err) => {
            console.warn(`[WebRTC] replaceTrack warning for ${peerId}:`, err.message);
          });
        } else {
          pc.addTrack(audioTrack, localStream);
        }
      } catch (err) {
        console.warn(`[WebRTC] Could not attach track to existing connection ${peerId}:`, err.message);
      }
    });
  }, [localStream]);


  return {
    requestMic,
    micPermissionState,
    voiceConnectionState,
    voiceMode: rtcMode,
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
