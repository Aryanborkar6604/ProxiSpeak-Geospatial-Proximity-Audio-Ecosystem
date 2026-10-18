import { useCallback, useEffect, useRef, useState } from 'react';
import deviceCache from '../utils/deviceCache';

const THROTTLE_MS = 1000 / 30; // 30Hz high-responsiveness move rate (down from 15Hz)
const AVATAR_COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#06B6D4', '#EC4899'];

function labelFor(index) { return `Teammate ${index + 1}`; }

export default function OfficeCanvas({
  socket,
  officeState,
  localUserId,
  onPeersChange,
  onPositionChange,
  onFrameRateChange,
  nearbyPeers = {},
  speakingPeers = {},
  mutedPeers = {},
  isSpeaking = false,
  isMuted = false,
  peerAttenuations = {},
  isDarkMode = true,
}) {
  const canvasRef = useRef(null);
  const peersRef = useRef({});
  const interpolatedPeers = useRef({}); // 60 FPS smooth linear interpolation coordinates
  const localPos = useRef(
    deviceCache.loadPosition(officeState?.officeId, localUserId) || { x: 175, y: 335 }
  );
  const localPosInitialized = useRef(Boolean(deviceCache.loadPosition(officeState?.officeId, localUserId)));
  const lastEmitTime = useRef(0);
  const trailingMoveTimeout = useRef(null);
  const syncTimeoutRef = useRef(null);

  const [canvasSize, setCanvasSize] = useState({ width: officeState.width, height: officeState.height });
  
  // Dynamic sound wave ripples: [ { x, y, radius, maxRadius, alpha, color } ]
  const soundWaves = useRef([]);
  const lastWaveSpawn = useRef(0);

  const audioStateRef = useRef({ nearbyPeers, speakingPeers, mutedPeers, isSpeaking, isMuted, peerAttenuations, isDarkMode });
  audioStateRef.current = { nearbyPeers, speakingPeers, mutedPeers, isSpeaking, isMuted, peerAttenuations, isDarkMode };

  const onPeersChangeRef = useRef(onPeersChange);
  const onPositionChangeRef = useRef(onPositionChange);
  const onFrameRateChangeRef = useRef(onFrameRateChange);
  onPeersChangeRef.current = onPeersChange;
  onPositionChangeRef.current = onPositionChange;
  onFrameRateChangeRef.current = onFrameRateChange;

  // Throttled React State Synchronizer: prevents 60 FPS re-render storms on the parent DOM tree
  const scheduleSync = useCallback(() => {
    if (syncTimeoutRef.current) return;
    syncTimeoutRef.current = setTimeout(() => {
      syncTimeoutRef.current = null;
      onPeersChangeRef.current?.({ ...peersRef.current });
      onPositionChangeRef.current?.(localPos.current, peersRef.current);
    }, 100);
  }, []);

  const updatePeers = useCallback((next) => {
    peersRef.current = next;
    onPeersChangeRef.current?.(next);
    onPositionChangeRef.current?.(localPos.current, next);
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    
    // Send our initial position so others see us immediately
    socket.emit('player:move', { x: localPos.current.x, y: localPos.current.y });

    const handlePlayerMoved = ({ userId, x, y, name }) => {
      if (userId === localUserId) return;
      peersRef.current[userId] = { x, y, name };
      if (!interpolatedPeers.current[userId]) {
        interpolatedPeers.current[userId] = { x, y };
      }
      scheduleSync();
    };
    
    const handlePlayerLeft = ({ userId }) => {
      const next = { ...peersRef.current };
      delete next[userId];
      delete interpolatedPeers.current[userId];
      updatePeers(next);
    };

    socket.on('player:moved', handlePlayerMoved);
    socket.on('player:left', handlePlayerLeft);
    return () => {
      socket.off('player:moved', handlePlayerMoved);
      socket.off('player:left', handlePlayerLeft);
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (trailingMoveTimeout.current) clearTimeout(trailingMoveTimeout.current);
    };
  }, [socket, localUserId, officeState?.officeId, updatePeers, scheduleSync]);

  useEffect(() => {
    if (!officeState?.users) return;
    const liveUsers = officeState.users || [];
    const nextPeers = {};
    liveUsers.forEach((user) => {
      if (user.userId !== localUserId && user.location) {
        nextPeers[user.userId] = {
          x: user.location[0],
          y: user.location[1],
          name: user.name || `Teammate`,
        };
      }
    });

    const currentKeys = Object.keys(peersRef.current);
    const nextKeys = Object.keys(nextPeers);
    const hasChanges = currentKeys.length !== nextKeys.length || nextKeys.some((id) => {
      const cur = peersRef.current[id];
      const nxt = nextPeers[id];
      return !cur || cur.x !== nxt.x || cur.y !== nxt.y || cur.name !== nxt.name;
    });

    const me = liveUsers.find((user) => user.userId === localUserId);
    if (me && me.location && !localPosInitialized.current) {
      localPos.current = { x: me.location[0], y: me.location[1] };
      localPosInitialized.current = true;
      scheduleSync();
    }

    if (hasChanges) {
      updatePeers(nextPeers);
    }
  }, [officeState?.users, localUserId, updatePeers, scheduleSync]);


  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let frame;
    let pixelRatio = window.devicePixelRatio || 1;
    let frameCount = 0;
    let fpsWindowStart = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * pixelRatio);
      canvas.height = Math.round(rect.height * pixelRatio);
      setCanvasSize({ width: rect.width, height: rect.height });
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = () => {
      frameCount += 1;
      const frameNow = performance.now();
      if (frameNow - fpsWindowStart >= 1000) {
        onFrameRateChangeRef.current?.(Math.round((frameCount * 1000) / (frameNow - fpsWindowStart)));
        frameCount = 0;
        fpsWindowStart = frameNow;
      }

      const width = canvas.width / pixelRatio;
      const height = canvas.height / pixelRatio;
      const sx = width / officeState.width;
      const sy = height / officeState.height;
      const curAudio = audioStateRef.current;
      const dark = curAudio.isDarkMode;

      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // 1. Futuristic Spatial Canvas Background
      const bgGrad = ctx.createRadialGradient(
        width / 2, height / 2, 50,
        width / 2, height / 2, Math.max(width, height) * 0.7
      );
      if (dark) {
        bgGrad.addColorStop(0, '#10151E');
        bgGrad.addColorStop(0.5, '#0B0E14');
        bgGrad.addColorStop(1, '#07090C');
      } else {
        bgGrad.addColorStop(0, '#FDFDFE');
        bgGrad.addColorStop(0.6, '#F3F5F9');
        bgGrad.addColorStop(1, '#E9ECF2');
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.scale(sx, sy);

      // 2. Holographic Cyber-Grid & Matrix Dots
      ctx.save();
      for (let x = 32; x < officeState.width; x += 32) {
        for (let y = 32; y < officeState.height; y += 32) {
          const isCross = (x % 128 === 0 && y % 128 === 0);
          if (isCross) {
            ctx.strokeStyle = dark ? 'rgba(0, 245, 155, 0.22)' : 'rgba(31, 168, 150, 0.28)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y);
            ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
            ctx.stroke();
          } else {
            ctx.fillStyle = dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.06)';
            ctx.beginPath();
            ctx.arc(x, y, 1, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();

      // 3. Cyber-Clean Architectural Room Zones
      drawZone(ctx, 73, 87, 252, 172, 'LIBRARY // ACOUSTIC SILENT', 'teal', dark);
      drawZone(ctx, 389, 82, 337, 242, 'DEV STUDIO // SPATIAL HUD', 'cyan', dark);
      drawZone(ctx, 710, 392, 226, 186, 'LOUNGE // SOCIAL COMMONS', 'purple', dark);

      // 4. Sleek Minimalist Architectural Furniture
      drawSofa(ctx, 98, 119, dark);
      drawDesk(ctx, 430, 127, 122, dark);
      drawDesk(ctx, 585, 127, 108, dark);
      drawDesk(ctx, 430, 215, 122, dark);
      drawDesk(ctx, 585, 215, 108, dark);
      drawPlant(ctx, 357, 130, dark);
      drawPlant(ctx, 751, 465, dark);
      drawMeetingTable(ctx, 780, 155, dark);
      drawSmallTable(ctx, 143, 204, dark);

      // 5. Sound-Blocking Laser Acoustic Walls
      const obstacles = officeState?.obstacles || [];
      if (obstacles.length > 0) {
        ctx.save();
        ctx.lineCap = 'round';
        obstacles.forEach((obs) => {
          if (obs.x1 !== undefined && obs.y1 !== undefined && obs.x2 !== undefined && obs.y2 !== undefined) {
            // Neon acoustic shadow glow
            ctx.shadowColor = dark ? 'rgba(0, 210, 255, 0.35)' : 'rgba(31, 168, 150, 0.25)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 2;

            // Outer structural wall core
            ctx.strokeStyle = dark ? '#1E232D' : '#333740';
            ctx.lineWidth = 7;
            ctx.beginPath();
            ctx.moveTo(obs.x1, obs.y1);
            ctx.lineTo(obs.x2, obs.y2);
            ctx.stroke();

            // Laser edge stripe
            ctx.shadowColor = 'transparent';
            ctx.strokeStyle = dark ? '#00E5FF' : '#1FA896';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(obs.x1, obs.y1);
            ctx.lineTo(obs.x2, obs.y2);
            ctx.stroke();

            // End cap terminal dots
            ctx.fillStyle = dark ? '#00F59B' : '#10B981';
            ctx.beginPath();
            ctx.arc(obs.x1, obs.y1, 2.5, 0, Math.PI * 2);
            ctx.arc(obs.x2, obs.y2, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        });
        ctx.restore();
      }

      // 6. Perimeter Shield Border
      ctx.save();
      ctx.strokeStyle = dark ? 'rgba(0, 245, 155, 0.16)' : 'rgba(31, 168, 150, 0.22)';
      ctx.lineWidth = 1.5;
      roundedRect(ctx, 14, 14, officeState.width - 28, officeState.height - 28, 16);
      ctx.stroke();
      ctx.restore();

      const { x: localX, y: localY } = localPos.current;

      // 7. Dynamic Acoustic Sound Waves Spawn & Rendering
      const now = Date.now();
      if (now - lastWaveSpawn.current > 140) {
        if (curAudio.isSpeaking) {
          soundWaves.current.push({
            x: localX,
            y: localY,
            radius: 20,
            maxRadius: 105,
            color: dark ? '#00F59B' : '#10B981',
          });
        }
        Object.entries(peersRef.current).forEach(([peerId, point]) => {
          if (curAudio.speakingPeers[peerId]) {
            soundWaves.current.push({
              x: point.x,
              y: point.y,
              radius: 20,
              maxRadius: 105,
              color: dark ? '#00D2FF' : '#0284C7',
            });
          }
        });
        lastWaveSpawn.current = now;
      }

      // Draw and advance sound wave rings
      ctx.save();
      for (let i = soundWaves.current.length - 1; i >= 0; i--) {
        const wave = soundWaves.current[i];
        wave.radius += 1.4;
        const alpha = Math.max(0, (1 - wave.radius / wave.maxRadius) * 0.65);
        if (wave.radius >= wave.maxRadius) {
          soundWaves.current.splice(i, 1);
          continue;
        }

        ctx.strokeStyle = wave.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(wave.x, wave.y, wave.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // 8. Dynamic Proximity Beams & Spatial HUD Tethers (with 60 FPS LERP)
      Object.entries(peersRef.current).forEach(([peerId, peer]) => {
        let interp = interpolatedPeers.current[peerId];
        if (!interp) {
          interp = { x: peer.x, y: peer.y };
          interpolatedPeers.current[peerId] = interp;
        } else {
          // Smooth glide towards latest network coordinate
          interp.x += (peer.x - interp.x) * 0.35;
          interp.y += (peer.y - interp.y) * 0.35;
        }

        const dist = Math.hypot(interp.x - localX, interp.y - localY);
        const inRange = dist <= (officeState.hearingRadiusPx || 105);
        const peerAtt = curAudio.peerAttenuations[peerId] ?? 1.0;
        const isMuffled = peerAtt < 0.9;

        if (inRange) {
          ctx.save();
          const baseVolume = Math.max(0, 1 - dist / 105);
          const finalVolumePct = Math.round(baseVolume * peerAtt * 100);

          // Animated neon tether
          const tetherGrad = ctx.createLinearGradient(localX, localY, interp.x, interp.y);
          if (dark) {
            tetherGrad.addColorStop(0, 'rgba(0, 245, 155, 0.7)');
            tetherGrad.addColorStop(1, isMuffled ? 'rgba(245, 158, 11, 0.6)' : 'rgba(0, 210, 255, 0.7)');
          } else {
            tetherGrad.addColorStop(0, 'rgba(16, 185, 129, 0.6)');
            tetherGrad.addColorStop(1, isMuffled ? 'rgba(217, 119, 6, 0.6)' : 'rgba(14, 165, 233, 0.6)');
          }

          ctx.strokeStyle = tetherGrad;
          ctx.lineWidth = isMuffled ? 1.5 : 2;
          ctx.setLineDash(isMuffled ? [4, 4] : [6, 4]);
          ctx.lineDashOffset = -Date.now() / 60;
          ctx.beginPath();
          ctx.moveTo(localX, localY);
          ctx.lineTo(interp.x, interp.y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Midpoint Spatial Audio Telemetry Badge
          const midX = (localX + interp.x) / 2;
          const midY = (localY + interp.y) / 2;
          const badgeText = isMuffled ? `▤ WALL ${finalVolumePct}%` : `🔊 ${finalVolumePct}% • ${Math.round(dist)}px`;
          
          ctx.font = '700 8px "JetBrains Mono", monospace, sans-serif';
          const textMetrics = ctx.measureText(badgeText);
          const badgeW = textMetrics.width + 14;
          const badgeH = 17;

          ctx.fillStyle = dark ? 'rgba(11, 15, 22, 0.88)' : 'rgba(255, 255, 255, 0.9)';
          ctx.shadowColor = dark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.12)';
          ctx.shadowBlur = 6;
          roundedRect(ctx, midX - badgeW / 2, midY - badgeH / 2, badgeW, badgeH, 6);
          ctx.fill();

          ctx.shadowColor = 'transparent';
          ctx.strokeStyle = isMuffled ? 'rgba(245, 158, 11, 0.6)' : 'rgba(0, 245, 155, 0.6)';
          ctx.lineWidth = 1;
          roundedRect(ctx, midX - badgeW / 2, midY - badgeH / 2, badgeW, badgeH, 6);
          ctx.stroke();

          ctx.fillStyle = isMuffled ? (dark ? '#FBBF24' : '#D97706') : (dark ? '#00F59B' : '#059669');
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(badgeText, midX, midY + 0.5);
          ctx.restore();
        }
      });

      // 9. Local User Hearing Horizon Aura
      const pulseRadius = 105 + Math.sin(Date.now() / 500) * 2.5;
      const radarGrad = ctx.createRadialGradient(localX, localY, 20, localX, localY, pulseRadius);
      if (dark) {
        radarGrad.addColorStop(0, 'rgba(0, 245, 155, 0.12)');
        radarGrad.addColorStop(0.7, 'rgba(0, 210, 255, 0.05)');
        radarGrad.addColorStop(1, 'rgba(0, 245, 155, 0)');
      } else {
        radarGrad.addColorStop(0, 'rgba(16, 185, 129, 0.10)');
        radarGrad.addColorStop(0.7, 'rgba(14, 165, 233, 0.04)');
        radarGrad.addColorStop(1, 'rgba(16, 185, 129, 0)');
      }
      ctx.fillStyle = radarGrad;
      ctx.beginPath();
      ctx.arc(localX, localY, pulseRadius, 0, Math.PI * 2);
      ctx.fill();

      // Outer radar ring
      ctx.strokeStyle = dark ? 'rgba(0, 245, 155, 0.45)' : 'rgba(16, 185, 129, 0.5)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 6]);
      ctx.lineDashOffset = -Date.now() / 120;
      ctx.beginPath();
      ctx.arc(localX, localY, pulseRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // 10. Draw Avatars (Local & Remote with 60 FPS LERP)
      drawAvatar(ctx, localX, localY, '#00F59B', 'YOU', true, curAudio.isSpeaking, false, curAudio.isMuted, 1.0, dark);

      const getAvatarColor = (id) => {
        let hash = 0;
        for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
      };

      Object.entries(peersRef.current).forEach(([peerId, point], index) => {
        const interp = interpolatedPeers.current[peerId] || point;
        const isPeerSpeaking = Boolean(curAudio.speakingPeers[peerId]);
        const isPeerNearby = Boolean(curAudio.nearbyPeers[peerId]);
        const isPeerMuted = Boolean(curAudio.mutedPeers[peerId]);
        const peerAtt = curAudio.peerAttenuations[peerId] ?? 1.0;
        const avatarLabel = point.name?.trim().split(/\s+/)[0] || labelFor(index);
        drawAvatar(ctx, interp.x, interp.y, getAvatarColor(peerId), avatarLabel, false, isPeerSpeaking, isPeerNearby, isPeerMuted, peerAtt, dark);
      });

      ctx.restore();
      frame = requestAnimationFrame(draw);
    };

    draw();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [officeState]);

  useEffect(() => {
    const move = (event) => {
      const keys = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
      const direction = keys[event.key] || keys[event.key.toLowerCase()];
      if (!direction || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      const pace = event.shiftKey ? 19 : 10;
      const nextX = Math.max(35, Math.min(localPos.current.x + direction[0] * pace, officeState.width - 35));
      const nextY = Math.max(35, Math.min(localPos.current.y + direction[1] * pace, officeState.height - 35));
      localPos.current = { x: nextX, y: nextY };
      scheduleSync();

      const now = Date.now();
      if (trailingMoveTimeout.current) clearTimeout(trailingMoveTimeout.current);
      if (socket && now - lastEmitTime.current >= THROTTLE_MS) {
        socket.emit('player:move', { x: nextX, y: nextY });
        lastEmitTime.current = now;
      } else if (socket) {
        // Trailing emit guarantees the final stopping position is always broadcast
        trailingMoveTimeout.current = setTimeout(() => {
          socket.emit('player:move', { x: localPos.current.x, y: localPos.current.y });
          lastEmitTime.current = Date.now();
        }, THROTTLE_MS);
      }
    };
    window.addEventListener('keydown', move);
    return () => window.removeEventListener('keydown', move);
  }, [socket, officeState, scheduleSync]);

  const handleCanvasClick = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * officeState.width;
    const y = (event.clientY - rect.top) / rect.height * officeState.height;
    localPos.current = { x, y };
    scheduleSync();
    if (socket) socket.emit('player:move', { x, y });
    lastEmitTime.current = Date.now();
  };

  return (
    <canvas
      ref={canvasRef}
      className="office-canvas"
      width={canvasSize.width}
      height={canvasSize.height}
      onClick={handleCanvasClick}
      aria-label="Interactive Spatial Radar Map. Move with WASD or arrow keys."
      tabIndex={0}
    />
  );
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawZone(ctx, x, y, w, h, label, accent, isDark = true) {
  ctx.save();
  const fills = {
    teal: isDark ? 'rgba(0, 245, 155, 0.045)' : 'rgba(16, 185, 129, 0.055)',
    cyan: isDark ? 'rgba(0, 210, 255, 0.045)' : 'rgba(14, 165, 233, 0.055)',
    purple: isDark ? 'rgba(168, 85, 247, 0.045)' : 'rgba(147, 51, 234, 0.055)',
  };
  const borders = {
    teal: isDark ? 'rgba(0, 245, 155, 0.35)' : 'rgba(16, 185, 129, 0.35)',
    cyan: isDark ? 'rgba(0, 210, 255, 0.35)' : 'rgba(14, 165, 233, 0.35)',
    purple: isDark ? 'rgba(168, 85, 247, 0.35)' : 'rgba(147, 51, 234, 0.35)',
  };

  // Glassmorphic zone fill
  ctx.fillStyle = fills[accent] || fills.teal;
  roundedRect(ctx, x, y, w, h, 14);
  ctx.fill();

  // Subtle boundary
  ctx.strokeStyle = borders[accent] || borders.teal;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.stroke();
  ctx.setLineDash([]);

  // High-tech corner angle brackets
  const cornerLen = 12;
  ctx.strokeStyle = borders[accent] || borders.teal;
  ctx.lineWidth = 2;
  // Top-left
  ctx.beginPath(); ctx.moveTo(x, y + cornerLen); ctx.lineTo(x, y); ctx.lineTo(x + cornerLen, y); ctx.stroke();
  // Top-right
  ctx.beginPath(); ctx.moveTo(x + w - cornerLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerLen); ctx.stroke();
  // Bottom-left
  ctx.beginPath(); ctx.moveTo(x, y + h - cornerLen); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerLen, y + h); ctx.stroke();
  // Bottom-right
  ctx.beginPath(); ctx.moveTo(x + w - cornerLen, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cornerLen); ctx.stroke();

  // Zone Label HUD Badge
  ctx.fillStyle = isDark ? '#E5E7EB' : '#1F2937';
  ctx.font = '700 8.5px "JetBrains Mono", monospace, sans-serif';
  ctx.fillText(label, x + 16, y + 20);
  ctx.restore();
}

function drawDesk(ctx, x, y, w, isDark = true) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.08)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = isDark ? '#1C212B' : '#E8EBF2';
  roundedRect(ctx, x, y, w, 36, 8);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.8)';
  roundedRect(ctx, x + 6, y + 6, w - 12, 24, 4);
  ctx.fill();

  // Laptop display pad
  ctx.fillStyle = isDark ? '#2D3748' : '#CBD5E1';
  roundedRect(ctx, x + w / 2 - 12, y + 10, 24, 15, 3);
  ctx.fill();
  ctx.restore();
}

function drawSofa(ctx, x, y, isDark = true) {
  ctx.save();
  ctx.fillStyle = isDark ? '#1F2633' : '#DFE3EB';
  roundedRect(ctx, x, y, 76, 32, 10);
  ctx.fill();
  ctx.fillStyle = isDark ? '#283142' : '#CBD2E1';
  roundedRect(ctx, x + 4, y + 4, 68, 14, 6);
  ctx.fill();
  ctx.restore();
}

function drawPlant(ctx, x, y, isDark = true) {
  ctx.save();
  ctx.fillStyle = isDark ? '#142820' : '#D1E7DD';
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = isDark ? '#10B981' : '#059669';
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMeetingTable(ctx, x, y, isDark = true) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.06)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = isDark ? '#181E29' : '#E5E9F2';
  roundedRect(ctx, x, y, 120, 52, 16);
  ctx.fill();
  ctx.restore();
}

function drawSmallTable(ctx, x, y, isDark = true) {
  ctx.save();
  ctx.fillStyle = isDark ? '#1B222E' : '#E2E6EF';
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawAvatar(ctx, x, y, color, label, isLocal, isSpeaking, isNearby, isMuted, attenuation, isDark) {
  const isMuffled = attenuation < 0.9;
  ctx.save();

  // 1. Equalizer Bars Floating Above When Speaking
  if (isSpeaking) {
    const barCount = 4;
    const barW = 2.5;
    const spacing = 2;
    const totalW = barCount * barW + (barCount - 1) * spacing;
    const startX = x - totalW / 2;
    const baseH = 8;
    const t = Date.now() / 100;

    ctx.save();
    ctx.fillStyle = isLocal ? '#00F59B' : '#00D2FF';
    for (let i = 0; i < barCount; i++) {
      const h = Math.max(3, baseH * Math.abs(Math.sin(t + i * 1.2)));
      roundedRect(ctx, startX + i * (barW + spacing), y - 26 - h, barW, h, 1.5);
      ctx.fill();
    }
    ctx.restore();
  }

  // 2. High-Tech Pulsing Glow Aura
  if (isSpeaking) {
    ctx.save();
    ctx.shadowColor = isLocal ? '#00F59B' : '#00D2FF';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = isLocal ? 'rgba(0, 245, 155, 0.8)' : 'rgba(0, 210, 255, 0.8)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 19, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 3. Base Shadow & Disc
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.65)' : 'rgba(0, 0, 0, 0.15)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = isDark ? '#141822' : '#FFFFFF';
  ctx.beginPath();
  ctx.arc(x, y, 17, 0, Math.PI * 2);
  ctx.fill();

  // 4. Inner Avatar Core
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = isLocal ? (isDark ? '#00F59B' : '#059669') : (isMuffled ? '#64748B' : color);
  ctx.beginPath();
  ctx.arc(x, y, 13.5, 0, Math.PI * 2);
  ctx.fill();

  // 5. Presence / Muffled Rings
  if (isMuffled) {
    ctx.strokeStyle = '#F59E0B'; // Amber wall warning
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(x, y, 17.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (isNearby && !isLocal) {
    ctx.strokeStyle = '#00D2FF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 17.5, 0, Math.PI * 2);
    ctx.stroke();
  } else if (isMuted) {
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 17.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 6. Initials
  ctx.fillStyle = isLocal ? '#07090C' : '#FFFFFF';
  ctx.font = '700 8.5px "JetBrains Mono", monospace, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isLocal ? 'YOU' : label.slice(0, 2).toUpperCase(), x, y + 0.5);

  // 7. Sleek Glassmorphic Label Pill
  const pillW = isMuffled ? 78 : 62;
  ctx.fillStyle = isDark ? 'rgba(17, 24, 39, 0.92)' : 'rgba(255, 255, 255, 0.95)';
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.1)';
  ctx.shadowBlur = 8;
  roundedRect(ctx, x - pillW / 2, y + 22, pillW, 18, 9);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = isSpeaking
    ? (isLocal ? 'rgba(0, 245, 155, 0.6)' : 'rgba(0, 210, 255, 0.6)')
    : (isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)');
  ctx.lineWidth = 1;
  roundedRect(ctx, x - pillW / 2, y + 22, pillW, 18, 9);
  ctx.stroke();

  // Status Dot & Name
  if (isSpeaking) {
    ctx.fillStyle = isMuffled ? '#F59E0B' : (isLocal ? '#00F59B' : '#00D2FF');
    ctx.beginPath();
    ctx.arc(x - pillW / 2 + 8, y + 31, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isDark ? '#F3F4F6' : '#111827';
    ctx.font = '700 8px "JetBrains Mono", monospace, sans-serif';
    ctx.fillText(isMuffled ? `${label} [WALL]` : label, x + 4, y + 31);
  } else {
    ctx.fillStyle = isDark ? '#9CA3AF' : '#4B5563';
    ctx.font = '600 8px "DM Sans", sans-serif';
    ctx.fillText(isMuffled ? `${label} ▤` : label, x, y + 31);
  }

  ctx.restore();
}
