import { useCallback, useEffect, useRef, useState } from 'react';
import deviceCache from '../utils/deviceCache';

const THROTTLE_MS = 1000 / 30; // 30Hz high-responsiveness move rate
const AVATAR_COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#06B6D4', '#EC4899'];

// Static friendly office avatars to give the virtual office a populated, lively feel matching the concept image
const STATIC_TEAMMATES = [
  { id: 'sim-amit', name: 'Amit', x: 382, y: 395, zone: 'Open Workstations', color: '#3B82F6', isSeated: true },
  { id: 'sim-rohan', name: 'Rohan', x: 508, y: 395, zone: 'Open Workstations', color: '#8B5CF6', isSeated: true },
  { id: 'sim-sneha', name: 'Sneha', x: 508, y: 520, zone: 'Open Workstations', color: '#EC4899', isSeated: true },
  { id: 'sim-priya', name: 'Priya', x: 105, y: 462, zone: 'Lounge', color: '#F59E0B', isSeated: true },
  { id: 'sim-rahul', name: 'Rahul', x: 182, y: 495, zone: 'Lounge', color: '#06B6D4', isSeated: true },
  { id: 'sim-vikas', name: 'Vikas', x: 672, y: 535, zone: 'Project Hub', color: '#10B981', isSeated: true },
  { id: 'sim-tanvi', name: 'Tanvi', x: 745, y: 545, zone: 'Project Hub', color: '#8B5CF6', isSeated: true },
  { id: 'sim-aditya', name: 'Aditya', x: 902, y: 568, zone: 'Focus Zone', color: '#3B82F6', isSeated: true },
  { id: 'sim-sahil', name: 'Sahil', x: 295, y: 648, zone: 'Game Zone', color: '#10B981', isSeated: true },
  { id: 'sim-meera', name: 'Meera', x: 438, y: 652, zone: 'Cafeteria', color: '#F59E0B', isSeated: true },
  { id: 'sim-arjun', name: 'Arjun', x: 524, y: 648, zone: 'Cafeteria', color: '#06B6D4', isSeated: true },
  { id: 'sim-karan', name: 'Karan', x: 698, y: 298, zone: 'Corridor', color: '#8B5CF6', isSeated: false },
];

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
  const interpolatedPeers = useRef({});
  const localPos = useRef(
    deviceCache.loadPosition(officeState?.officeId, localUserId) || { x: 442, y: 420 }
  );
  const localPosInitialized = useRef(Boolean(deviceCache.loadPosition(officeState?.officeId, localUserId)));
  const lastEmitTime = useRef(0);
  const trailingMoveTimeout = useRef(null);
  const syncTimeoutRef = useRef(null);

  const [canvasSize, setCanvasSize] = useState({ width: officeState?.width || 1000, height: officeState?.height || 700 });
  
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
      const sx = width / (officeState?.width || 1000);
      const sy = height / (officeState?.height || 700);
      const curAudio = audioStateRef.current;
      const dark = curAudio.isDarkMode;

      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      ctx.save();
      ctx.scale(sx, sy);

      // ==========================================
      // 1. ARCHITECTURAL FLOORS & FOUNDATION
      // ==========================================
      drawOfficeFloors(ctx, dark);

      // ==========================================
      // 2. TEN DISTINCT INTERACTIVE ZONES & ROOMS
      // ==========================================
      // Top row
      drawReception(ctx, 20, 20, 320, 260, dark);
      drawMeetingRoom1(ctx, 360, 20, 360, 260, dark);
      drawMeetingRoom2(ctx, 740, 20, 240, 280, dark);

      // Middle row
      drawLounge(ctx, 20, 300, 290, 260, dark);
      drawWorkstations(ctx, 330, 300, 270, 260, dark);
      drawProjectHub(ctx, 620, 320, 200, 260, dark);
      drawFocusZone(ctx, 840, 320, 140, 300, dark);

      // Bottom row
      drawGameZone(ctx, 20, 580, 310, 105, dark);
      drawCafeteria(ctx, 350, 580, 320, 105, dark);
      drawTownHall(ctx, 690, 600, 290, 85, dark);

      // ==========================================
      // 3. SOUND-BLOCKING GLASS & STRUCTURAL WALLS
      // ==========================================
      drawWallsAndPartitions(ctx, officeState?.obstacles || [], dark);

      // ==========================================
      // 4. CORRIDOR DETAILS & INDOOR GREENERY
      // ==========================================
      drawOfficePlants(ctx, dark);

      // ==========================================
      // 5. ZONE BADGES (Exact pills from reference image)
      // ==========================================
      drawZoneBadge(ctx, 150, 208, 'Reception', 'dot', dark);
      drawZoneBadge(ctx, 480, 128, 'Meeting Room 1', 'group', dark);
      drawZoneBadge(ctx, 888, 168, 'Meeting Room 2', 'screen', dark);
      drawZoneBadge(ctx, 185, 385, 'Lounge', 'coffee', dark);
      drawZoneBadge(ctx, 720, 402, 'Project Hub', 'code', dark);
      drawZoneBadge(ctx, 924, 385, 'Focus Zone', 'headphones', dark);
      drawZoneBadge(ctx, 125, 650, 'Game Zone', 'game', dark);
      drawZoneBadge(ctx, 490, 680, 'Cafeteria', 'coffee', dark);
      drawZoneBadge(ctx, 770, 715, 'Town Hall', 'presentation', dark);

      const { x: localX, y: localY } = localPos.current;

      // ==========================================
      // 6. POPULATE AMBIENT / STATIC TEAMMATES
      // ==========================================
      // Render static teammates if not superseded by real connected peers
      STATIC_TEAMMATES.forEach((sim) => {
        // Skip if a live user has taken this position
        const isLiveNearby = Object.values(peersRef.current).some(
          (p) => Math.hypot(p.x - sim.x, p.y - sim.y) < 22
        ) || Math.hypot(localX - sim.x, localY - sim.y) < 22;

        if (!isLiveNearby) {
          drawRealisticAvatar(ctx, sim.x, sim.y, sim.color, sim.name, false, false, false, false, 1.0, dark, sim.isSeated);
        }
      });

      // ==========================================
      // 7. DYNAMIC SOUND WAVES (SPATIAL VOICE EXPANSION)
      // ==========================================
      const now = Date.now();
      if (now - lastWaveSpawn.current > 140) {
        if (curAudio.isSpeaking) {
          soundWaves.current.push({
            x: localX,
            y: localY,
            radius: 20,
            maxRadius: 105,
            color: '#38BDF8', // Cyan/sky glow matching reference image
          });
        }
        Object.entries(peersRef.current).forEach(([peerId, point]) => {
          if (curAudio.speakingPeers[peerId]) {
            soundWaves.current.push({
              x: point.x,
              y: point.y,
              radius: 20,
              maxRadius: 105,
              color: '#38BDF8',
            });
          }
        });
        lastWaveSpawn.current = now;
      }

      ctx.save();
      for (let i = soundWaves.current.length - 1; i >= 0; i--) {
        const wave = soundWaves.current[i];
        wave.radius += 1.4;
        const alpha = Math.max(0, (1 - wave.radius / wave.maxRadius) * 0.7);
        if (wave.radius >= wave.maxRadius) {
          soundWaves.current.splice(i, 1);
          continue;
        }

        ctx.strokeStyle = wave.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(wave.x, wave.y, wave.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // ==========================================
      // 8. PROXIMITY TETHERS & SPATIAL AUDIO HUD
      // ==========================================
      Object.entries(peersRef.current).forEach(([peerId, peer]) => {
        let interp = interpolatedPeers.current[peerId];
        if (!interp) {
          interp = { x: peer.x, y: peer.y };
          interpolatedPeers.current[peerId] = interp;
        } else {
          interp.x += (peer.x - interp.x) * 0.35;
          interp.y += (peer.y - interp.y) * 0.35;
        }

        const hearingRadius = officeState?.hearingRadiusPx || 100;
        const dist = Math.hypot(interp.x - localX, interp.y - localY);
        const inRange = dist <= hearingRadius;
        const peerAtt = curAudio.peerAttenuations[peerId] ?? 1.0;
        const isMuffled = peerAtt < 0.9;

        if (inRange) {
          ctx.save();
          const norm = dist / hearingRadius;
          const baseVolume = Math.max(0.18, 1 - Math.pow(norm, 1.3));
          const finalVolumePct = Math.round(baseVolume * peerAtt * 100);

          const tetherGrad = ctx.createLinearGradient(localX, localY, interp.x, interp.y);
          tetherGrad.addColorStop(0, 'rgba(56, 189, 248, 0.8)');
          tetherGrad.addColorStop(1, isMuffled ? 'rgba(245, 158, 11, 0.7)' : 'rgba(56, 189, 248, 0.8)');

          ctx.strokeStyle = tetherGrad;
          ctx.lineWidth = isMuffled ? 1.5 : 2;
          ctx.setLineDash(isMuffled ? [4, 4] : [6, 4]);
          ctx.lineDashOffset = -Date.now() / 60;
          ctx.beginPath();
          ctx.moveTo(localX, localY);
          ctx.lineTo(interp.x, interp.y);
          ctx.stroke();
          ctx.setLineDash([]);

          const midX = (localX + interp.x) / 2;
          const midY = (localY + interp.y) / 2;
          const badgeText = isMuffled ? `▤ WALL ${finalVolumePct}%` : `🔊 ${finalVolumePct}% • ${Math.round(dist)}px`;
          
          ctx.font = '700 8.5px "JetBrains Mono", monospace, sans-serif';
          const textMetrics = ctx.measureText(badgeText);
          const badgeW = textMetrics.width + 14;
          const badgeH = 17;

          ctx.fillStyle = dark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.95)';
          ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
          ctx.shadowBlur = 6;
          roundedRect(ctx, midX - badgeW / 2, midY - badgeH / 2, badgeW, badgeH, 6);
          ctx.fill();

          ctx.shadowColor = 'transparent';
          ctx.strokeStyle = isMuffled ? 'rgba(245, 158, 11, 0.6)' : 'rgba(56, 189, 248, 0.6)';
          ctx.lineWidth = 1;
          roundedRect(ctx, midX - badgeW / 2, midY - badgeH / 2, badgeW, badgeH, 6);
          ctx.stroke();

          ctx.fillStyle = isMuffled ? '#FBBF24' : '#38BDF8';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(badgeText, midX, midY + 0.5);
          ctx.restore();
        }
      });

      // ==========================================
      // 9. LOCAL USER RADIANT PROXIMITY AURA (EXACT IMAGE MATCH)
      // ==========================================
      const hearingRadius = officeState?.hearingRadiusPx || 100;
      const pulseWave = Math.sin(Date.now() / 400) * 2;
      const currentRadius = hearingRadius + pulseWave;

      // Radiant glowing blue translucent proximity floor disc
      ctx.save();
      const auraGrad = ctx.createRadialGradient(localX, localY, 12, localX, localY, currentRadius);
      auraGrad.addColorStop(0, 'rgba(56, 189, 248, 0.28)');
      auraGrad.addColorStop(0.45, 'rgba(14, 165, 233, 0.16)');
      auraGrad.addColorStop(0.85, 'rgba(2, 132, 199, 0.08)');
      auraGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');

      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.arc(localX, localY, currentRadius, 0, Math.PI * 2);
      ctx.fill();

      // Outer luminous perimeter ring
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(56, 189, 248, 0.8)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(localX, localY, currentRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Inner subtle concentric radar ripples
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.lineDashOffset = -Date.now() / 80;
      ctx.beginPath();
      ctx.arc(localX, localY, currentRadius * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // ==========================================
      // 10. DRAW AVATARS (LOCAL USER & REMOTE PEERS)
      // ==========================================
      // Local User ("YOU")
      drawRealisticAvatar(
        ctx,
        localX,
        localY,
        '#38BDF8',
        'You',
        true,
        curAudio.isSpeaking,
        false,
        curAudio.isMuted,
        1.0,
        dark,
        false
      );

      // Connected Remote Peers
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
        drawRealisticAvatar(
          ctx,
          interp.x,
          interp.y,
          getAvatarColor(peerId),
          avatarLabel,
          false,
          isPeerSpeaking,
          isPeerNearby,
          isPeerMuted,
          peerAtt,
          dark,
          false
        );
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
      const pace = event.shiftKey ? 18 : 10;
      const nextX = Math.max(35, Math.min(localPos.current.x + direction[0] * pace, (officeState?.width || 1000) - 35));
      const nextY = Math.max(35, Math.min(localPos.current.y + direction[1] * pace, (officeState?.height || 700) - 35));
      localPos.current = { x: nextX, y: nextY };
      deviceCache.savePosition(officeState?.officeId, localUserId, localPos.current);
      scheduleSync();

      const now = Date.now();
      if (trailingMoveTimeout.current) clearTimeout(trailingMoveTimeout.current);
      if (socket && now - lastEmitTime.current >= THROTTLE_MS) {
        socket.emit('player:move', { x: nextX, y: nextY });
        lastEmitTime.current = now;
      } else if (socket) {
        trailingMoveTimeout.current = setTimeout(() => {
          socket.emit('player:move', { x: localPos.current.x, y: localPos.current.y });
          lastEmitTime.current = Date.now();
        }, THROTTLE_MS);
      }
    };
    window.addEventListener('keydown', move);
    return () => window.removeEventListener('keydown', move);
  }, [socket, officeState, scheduleSync, localUserId]);

  const handleCanvasClick = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * (officeState?.width || 1000);
    const y = ((event.clientY - rect.top) / rect.height) * (officeState?.height || 700);
    localPos.current = { x, y };
    deviceCache.savePosition(officeState?.officeId, localUserId, localPos.current);
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
      aria-label="Interactive Spatial Virtual Office Map. Move with WASD or arrow keys."
      tabIndex={0}
    />
  );
}

// ==========================================
// RENDERING HELPER FUNCTIONS
// ==========================================

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// 1. Overall Floor Grid & Background
function drawOfficeFloors(ctx, isDark) {
  ctx.save();
  // Base light modern architectural porcelain tile floor
  ctx.fillStyle = isDark ? '#1E232A' : '#E8ECEF';
  ctx.fillRect(0, 0, 1000, 700);

  // Subtle floor grid lines (porcelain floor seams)
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= 1000; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 700); ctx.stroke();
  }
  for (let y = 0; y <= 700; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1000, y); ctx.stroke();
  }

  // Outdoor balcony / terrace glass edge top right
  ctx.fillStyle = isDark ? '#14181F' : '#DCE1E7';
  ctx.fillRect(740, 0, 260, 20);

  ctx.restore();
}

// 2. Zone Badge Pills (Matches reference image: black capsule, icon, label, green presence dot)
function drawZoneBadge(ctx, x, y, label, iconType, isDark) {
  ctx.save();
  ctx.font = '600 10.5px "DM Sans", -apple-system, sans-serif';
  const textW = ctx.measureText(label).width;
  const badgeW = textW + 36;
  const badgeH = 22;
  const rx = x - badgeW / 2;
  const ry = y;

  // Outer shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;

  // Dark glass capsule
  ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
  roundedRect(ctx, rx, ry, badgeW, badgeH, 11);
  ctx.fill();

  // Subtle rim
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  roundedRect(ctx, rx, ry, badgeW, badgeH, 11);
  ctx.stroke();

  // Status Indicator Dot or Icon
  if (iconType === 'dot') {
    ctx.fillStyle = '#22C55E'; // Vibrant green dot
    ctx.beginPath();
    ctx.arc(rx + 11, ry + 11, 3.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Mini Icon Graphic
    ctx.fillStyle = '#94A3B8';
    ctx.font = '9px "JetBrains Mono", monospace';
    let iconChar = '●';
    if (iconType === 'coffee') iconChar = '☕';
    if (iconType === 'group') iconChar = '👥';
    if (iconType === 'screen') iconChar = '🖥️';
    if (iconType === 'code') iconChar = '</>';
    if (iconType === 'headphones') iconChar = '🎧';
    if (iconType === 'game') iconChar = '🎮';
    if (iconType === 'presentation') iconChar = '📊';

    ctx.fillText(iconChar, rx + 8, ry + 14.5);
  }

  // Label text
  ctx.fillStyle = '#F8FAFC';
  ctx.font = '600 10px "DM Sans", sans-serif';
  ctx.fillText(label, rx + 22, ry + 14.5);

  ctx.restore();
}

// 3. Reception Zone
function drawReception(ctx, x, y, w, h, isDark) {
  ctx.save();
  // Floor tone
  ctx.fillStyle = isDark ? '#242B35' : '#F1F4F7';
  roundedRect(ctx, x, y, w, h, 14);
  ctx.fill();

  // Feature Wall: Curved Backlit Timber Panel
  const wallGrad = ctx.createLinearGradient(x + 20, y + 20, x + 240, y + 20);
  wallGrad.addColorStop(0, '#5C4033');
  wallGrad.addColorStop(0.5, '#78543E');
  wallGrad.addColorStop(1, '#5C4033');

  ctx.fillStyle = wallGrad;
  roundedRect(ctx, x + 15, y + 15, 220, 80, 16);
  ctx.fill();

  // Subtle acoustic slats
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.lineWidth = 1.2;
  for (let sx = x + 25; sx < x + 225; sx += 8) {
    ctx.beginPath(); ctx.moveTo(sx, y + 16); ctx.lineTo(sx, y + 94); ctx.stroke();
  }

  // Backlit Signage: "ProxiSpeak Virtual Office - Connect · Collaborate · Create"
  ctx.shadowColor = 'rgba(255, 255, 255, 0.45)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 15px "Manrope", sans-serif';
  ctx.fillText('ProxiSpeak', x + 35, y + 45);

  ctx.shadowBlur = 0;
  ctx.fillStyle = '#E2E8F0';
  ctx.font = '600 9.5px "DM Sans", sans-serif';
  ctx.fillText('Virtual Office', x + 35, y + 60);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 7px "DM Sans", sans-serif';
  ctx.fillText('Connect · Collaborate · Create', x + 35, y + 76);

  // Curved Modern Reception Desk
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = isDark ? '#333D4B' : '#E2E8F0';
  ctx.beginPath();
  ctx.ellipse(x + 105, y + 145, 65, 28, -0.15, 0, Math.PI * 2);
  ctx.fill();

  // Inner counter top
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = isDark ? '#475569' : '#FFFFFF';
  ctx.beginPath();
  ctx.ellipse(x + 105, y + 143, 56, 22, -0.15, 0, Math.PI * 2);
  ctx.fill();

  // Receptionist computer monitor & keyboard
  ctx.fillStyle = '#0F172A';
  roundedRect(ctx, x + 98, y + 132, 18, 11, 2);
  ctx.fill();
  ctx.fillStyle = '#38BDF8'; // Screen glow
  roundedRect(ctx, x + 99.5, y + 133.5, 15, 8, 1);
  ctx.fill();

  // Receptionist Avatar seated behind desk
  drawRealisticAvatar(ctx, x + 105, y + 120, '#F59E0B', 'Staff', false, false, false, false, 1.0, isDark, true);

  // Plants flanking the desk
  drawPottedPlant(ctx, x + 25, y + 120, 12, isDark);
  drawPottedPlant(ctx, x + 195, y + 155, 14, isDark);
  drawPottedPlant(ctx, x + 250, y + 80, 16, isDark);

  ctx.restore();
}

// 4. Meeting Room 1
function drawMeetingRoom1(ctx, x, y, w, h, isDark) {
  ctx.save();
  // Darker executive carpet floor
  ctx.fillStyle = isDark ? '#1A212B' : '#DFE5EC';
  roundedRect(ctx, x, y, w, h, 8);
  ctx.fill();

  // Huge Interactive Whiteboard / Analytics Display Screen on wall
  ctx.fillStyle = '#0B0F17';
  roundedRect(ctx, x + 50, y + 8, 220, 52, 6);
  ctx.fill();
  ctx.strokeStyle = '#38BDF8';
  ctx.lineWidth = 1;
  roundedRect(ctx, x + 50, y + 8, 220, 52, 6);
  ctx.stroke();

  // Mock dashboard analytics on screen
  ctx.fillStyle = 'rgba(56, 189, 248, 0.4)';
  roundedRect(ctx, x + 62, y + 18, 38, 32, 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(34, 197, 94, 0.4)';
  roundedRect(ctx, x + 108, y + 18, 48, 32, 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(168, 85, 247, 0.4)';
  roundedRect(ctx, x + 164, y + 18, 92, 32, 3);
  ctx.fill();

  // Long Boardroom Table
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#C29B72'; // Honey oak
  roundedRect(ctx, x + 70, y + 90, 180, 68, 16);
  ctx.fill();

  // Wood grain bevel
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#966F47';
  ctx.lineWidth = 1.5;
  roundedRect(ctx, x + 72, y + 92, 176, 64, 14);
  ctx.stroke();

  // Chairs around table
  const chairPositions = [
    [x + 85, y + 78], [x + 125, y + 78], [x + 165, y + 78], [x + 205, y + 78], // Top row
    [x + 85, y + 168], [x + 125, y + 168], [x + 165, y + 168], [x + 205, y + 168], // Bottom row
    [x + 55, y + 124], [x + 265, y + 124] // Ends
  ];
  chairPositions.forEach(([cx, cy]) => {
    ctx.fillStyle = '#1E293B';
    roundedRect(ctx, cx - 8, cy - 8, 16, 16, 5);
    ctx.fill();
  });

  // Table tech: center power rail & laptops
  ctx.fillStyle = '#334155';
  roundedRect(ctx, x + 100, y + 121, 120, 6, 2);
  ctx.fill();

  // Plants
  drawPottedPlant(ctx, x + 25, y + 40, 13, isDark);
  drawPottedPlant(ctx, x + 310, y + 45, 14, isDark);

  ctx.restore();
}

// 5. Meeting Room 2
function drawMeetingRoom2(ctx, x, y, w, h, isDark) {
  ctx.save();
  ctx.fillStyle = isDark ? '#1C222B' : '#E2E6EE';
  roundedRect(ctx, x, y, w, h, 8);
  ctx.fill();

  // Giant wall presentation screen
  ctx.fillStyle = '#0F172A';
  roundedRect(ctx, x + 30, y + 10, 160, 48, 6);
  ctx.fill();
  const screenGrad = ctx.createLinearGradient(x + 30, y + 10, x + 190, y + 58);
  screenGrad.addColorStop(0, '#6366F1');
  screenGrad.addColorStop(1, '#EC4899');
  ctx.fillStyle = screenGrad;
  roundedRect(ctx, x + 32, y + 12, 156, 44, 4);
  ctx.fill();

  // Round Conference Table
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#C29B72';
  ctx.beginPath();
  ctx.arc(x + 110, y + 130, 42, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#966F47';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x + 110, y + 130, 39, 0, Math.PI * 2);
  ctx.stroke();

  // Chairs around round table
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
    const cx = x + 110 + Math.cos(angle) * 54;
    const cy = y + 130 + Math.sin(angle) * 54;
    ctx.fillStyle = '#1E293B';
    roundedRect(ctx, cx - 7, cy - 7, 14, 14, 4);
    ctx.fill();
  }

  // Plants
  drawPottedPlant(ctx, x + 25, y + 90, 12, isDark);
  drawPottedPlant(ctx, x + 215, y + 80, 13, isDark);
  drawPottedPlant(ctx, x + 215, y + 210, 14, isDark);

  ctx.restore();
}

// 6. Lounge Zone
function drawLounge(ctx, x, y, w, h, isDark) {
  ctx.save();
  // Circular platform base
  ctx.fillStyle = isDark ? '#232A35' : '#ECEFF4';
  roundedRect(ctx, x, y, w, h, 20);
  ctx.fill();

  // Ambient glowing ring around sofa
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)'; // Warm amber LED underglow
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x + 145, y + 130, 85, 0, Math.PI * 2);
  ctx.stroke();

  // Large curved modular leather sectional sofa (warm caramel/tan leather)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 5;
  ctx.strokeStyle = '#C98A4B';
  ctx.lineWidth = 30;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x + 145, y + 130, 68, Math.PI * 0.7, Math.PI * 2.2);
  ctx.stroke();

  // Inner sofa cushion stripe
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#E0A86C';
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.arc(x + 145, y + 130, 68, Math.PI * 0.7, Math.PI * 2.2);
  ctx.stroke();

  // Circular coffee table in center
  ctx.fillStyle = isDark ? '#1E293B' : '#E2E8F0';
  ctx.beginPath();
  ctx.arc(x + 145, y + 130, 24, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#CBD5E1';
  ctx.beginPath();
  ctx.arc(x + 145, y + 130, 20, 0, Math.PI * 2);
  ctx.fill();

  // Potted indoor trees inside lounge
  drawPottedPlant(ctx, x + 35, y + 45, 16, isDark);
  drawPottedPlant(ctx, x + 245, y + 65, 15, isDark);
  drawPottedPlant(ctx, x + 40, y + 210, 14, isDark);

  ctx.restore();
}

// 7. Workstations (4 Desk Pods)
function drawWorkstations(ctx, x, y, w, h, isDark) {
  ctx.save();
  // 4 desk pods: top-left, top-right, bottom-left, bottom-right
  const pods = [
    { x: x + 15, y: y + 25 },
    { x: x + 145, y: y + 25 },
    { x: x + 15, y: y + 145 },
    { x: x + 145, y: y + 145 },
  ];

  pods.forEach((pod) => {
    // Dual wood desks
    ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#D4A373'; // Warm birch wood
    roundedRect(ctx, pod.x, pod.y, 105, 75, 8);
    ctx.fill();

    // Center divider screen
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = isDark ? '#334155' : '#CBD5E1';
    roundedRect(ctx, pod.x, pod.y + 36, 105, 3, 1.5);
    ctx.fill();

    // Monitors (Dual setup)
    // Top desk monitor
    ctx.fillStyle = '#0F172A';
    roundedRect(ctx, pod.x + 36, pod.y + 12, 34, 4, 1.5);
    ctx.fill();
    ctx.fillStyle = '#38BDF8';
    roundedRect(ctx, pod.x + 37, pod.y + 8, 32, 4, 1);
    ctx.fill();

    // Bottom desk monitor
    ctx.fillStyle = '#0F172A';
    roundedRect(ctx, pod.x + 36, pod.y + 58, 34, 4, 1.5);
    ctx.fill();
    ctx.fillStyle = '#38BDF8';
    roundedRect(ctx, pod.x + 37, pod.y + 62, 32, 4, 1);
    ctx.fill();

    // Laptops
    ctx.fillStyle = '#64748B';
    roundedRect(ctx, pod.x + 78, pod.y + 16, 16, 11, 2);
    roundedRect(ctx, pod.x + 12, pod.y + 48, 16, 11, 2);
    ctx.fill();

    // Chairs
    ctx.fillStyle = '#1E293B';
    roundedRect(ctx, pod.x + 44, pod.y - 12, 18, 14, 4);
    roundedRect(ctx, pod.x + 44, pod.y + 73, 18, 14, 4);
    ctx.fill();
  });

  // Plants between workstation aisles
  drawPottedPlant(ctx, x + 130, y + 10, 11, isDark);
  drawPottedPlant(ctx, x + 130, y + 130, 11, isDark);
  drawPottedPlant(ctx, x + 130, y + 235, 12, isDark);

  ctx.restore();
}

// 8. Project Hub
function drawProjectHub(ctx, x, y, w, h, isDark) {
  ctx.save();
  // Warm wood plank flooring
  ctx.fillStyle = isDark ? '#2B231D' : '#F5EBE1';
  roundedRect(ctx, x, y, w, h, 10);
  ctx.fill();

  // Wood planks pattern
  ctx.strokeStyle = isDark ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.05)';
  ctx.lineWidth = 1;
  for (let px = x; px < x + w; px += 20) {
    ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + h); ctx.stroke();
  }

  // Long collaborative oak workbench table
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#D4A373';
  roundedRect(ctx, x + 35, y + 45, 120, 160, 12);
  ctx.fill();

  // Laptops and tablets on collaborative desk
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#334155';
  roundedRect(ctx, x + 55, y + 65, 20, 14, 2);
  roundedRect(ctx, x + 95, y + 95, 20, 14, 2);
  roundedRect(ctx, x + 55, y + 140, 20, 14, 2);
  ctx.fill();

  // Chairs along the table
  const chairs = [
    [x + 18, y + 70], [x + 18, y + 125], [x + 18, y + 175],
    [x + 162, y + 70], [x + 162, y + 125], [x + 162, y + 175],
  ];
  chairs.forEach(([cx, cy]) => {
    ctx.fillStyle = '#1E293B';
    roundedRect(ctx, cx - 8, cy - 8, 16, 16, 4);
    ctx.fill();
  });

  // Planter hedges along glass border
  drawPlanterBox(ctx, x + 5, y + 5, 80, 14, isDark);
  drawPottedPlant(ctx, x + 175, y + 25, 12, isDark);
  drawPottedPlant(ctx, x + 175, y + 225, 14, isDark);

  ctx.restore();
}

// 9. Focus Zone (Soundproof phone booths)
function drawFocusZone(ctx, x, y, w, h, isDark) {
  ctx.save();
  ctx.fillStyle = isDark ? '#1C2028' : '#EDF1F5';
  roundedRect(ctx, x, y, w, h, 10);
  ctx.fill();

  // 4 individual acoustic pods
  const boothH = 58;
  for (let i = 0; i < 4; i++) {
    const by = y + 15 + i * (boothH + 10);

    // Booth shell with acoustic padding
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = isDark ? '#2D3748' : '#FFFFFF';
    roundedRect(ctx, x + 15, by, 110, boothH, 8);
    ctx.fill();

    // Interior desk & monitor
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#C29B72';
    roundedRect(ctx, x + 72, by + 12, 45, 34, 4);
    ctx.fill();

    ctx.fillStyle = '#0F172A';
    roundedRect(ctx, x + 88, by + 20, 18, 5, 1);
    ctx.fill();
    ctx.fillStyle = '#38BDF8';
    roundedRect(ctx, x + 89, by + 18, 16, 3, 0.8);
    ctx.fill();

    // Task chair
    ctx.fillStyle = '#1E293B';
    roundedRect(ctx, x + 42, by + 20, 18, 18, 4);
    ctx.fill();

    // Glass door edge line
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 15, by); ctx.lineTo(x + 15, by + boothH);
    ctx.stroke();
  }

  ctx.restore();
}

// 10. Game Zone
function drawGameZone(ctx, x, y, w, h, isDark) {
  ctx.save();
  // Warm dark timber floor
  ctx.fillStyle = isDark ? '#221B16' : '#E8DDD4';
  roundedRect(ctx, x, y, w, h, 12);
  ctx.fill();

  // Neon Sign Wall: "Good IDEAS / Good PEOPLE / Great WORK"
  ctx.fillStyle = '#111827';
  roundedRect(ctx, x + 140, y + 10, 140, 60, 6);
  ctx.fill();

  // Pink neon "Good IDEAS"
  ctx.shadowColor = '#EC4899';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#F472B6';
  ctx.font = '700 9px "Manrope", sans-serif';
  ctx.fillText('Good IDEAS', x + 155, y + 27);

  // Cyan neon "Good PEOPLE"
  ctx.shadowColor = '#06B6D4';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#22D3EE';
  ctx.fillText('Good PEOPLE', x + 155, y + 42);

  // White/Yellow neon "Great WORK"
  ctx.shadowColor = '#FBBF24';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#FDE68A';
  ctx.fillText('Great WORK', x + 155, y + 57);

  // Reset shadow
  ctx.shadowColor = 'transparent';

  // Billiard / Pool Table (Authentic green felt)
  const poolX = x + 25;
  const poolY = y + 25;
  const poolW = 75;
  const poolH = 45;

  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  // Wooden frame
  ctx.fillStyle = '#5C381E';
  roundedRect(ctx, poolX, poolY, poolW, poolH, 6);
  ctx.fill();

  // Green felt pitch
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#15803D'; // Classic green baize
  roundedRect(ctx, poolX + 5, poolY + 5, poolW - 10, poolH - 10, 3);
  ctx.fill();

  // Corner & side pockets
  ctx.fillStyle = '#0F172A';
  const pockets = [
    [poolX + 6, poolY + 6], [poolX + poolW / 2, poolY + 5], [poolX + poolW - 6, poolY + 6],
    [poolX + 6, poolY + poolH - 6], [poolX + poolW / 2, poolY + poolH - 5], [poolX + poolW - 6, poolY + poolH - 6],
  ];
  pockets.forEach(([px, py]) => {
    ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill();
  });

  // Balls and cue stick
  ctx.fillStyle = '#FFFFFF'; // Cue ball
  ctx.beginPath(); ctx.arc(poolX + 22, poolY + poolH / 2, 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#EF4444'; // Red ball
  ctx.beginPath(); ctx.arc(poolX + 55, poolY + poolH / 2, 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#F59E0B'; // Yellow ball
  ctx.beginPath(); ctx.arc(poolX + 59, poolY + poolH / 2 - 3, 2, 0, Math.PI * 2); ctx.fill();

  // Foosball Table
  const foosX = x + 115;
  const foosY = y + 25;
  ctx.fillStyle = '#451A03';
  roundedRect(ctx, foosX, foosY, 45, 55, 4);
  ctx.fill();
  ctx.fillStyle = '#166534';
  roundedRect(ctx, foosX + 4, foosY + 4, 37, 47, 2);
  ctx.fill();

  // Chrome rods with player figures
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.5;
  for (let ry = foosY + 12; ry <= foosY + 44; ry += 10) {
    ctx.beginPath(); ctx.moveTo(foosX - 4, ry); ctx.lineTo(foosX + 49, ry); ctx.stroke();
    // Mini players
    ctx.fillStyle = (ry % 20 === 0) ? '#EF4444' : '#3B82F6';
    roundedRect(ctx, foosX + 12, ry - 3, 5, 6, 1);
    roundedRect(ctx, foosX + 28, ry - 3, 5, 6, 1);
    ctx.fill();
  }

  // Beanbag loungers
  ctx.fillStyle = '#DC2626';
  ctx.beginPath(); ctx.ellipse(x + 295, y + 45, 14, 18, 0.4, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

// 11. Cafeteria
function drawCafeteria(ctx, x, y, w, h, isDark) {
  ctx.save();
  ctx.fillStyle = isDark ? '#262420' : '#F2ECE4';
  roundedRect(ctx, x, y, w, h, 12);
  ctx.fill();

  // Back wall: Espresso Bar Counter & Drink Coolers
  ctx.fillStyle = '#3F2E24';
  roundedRect(ctx, x + 120, y + 8, 120, 22, 4);
  ctx.fill();

  // Espresso Machine
  ctx.fillStyle = '#94A3B8';
  roundedRect(ctx, x + 145, y + 10, 24, 14, 2);
  ctx.fill();

  // Dual Glass-Door Beverage Coolers (glowing blue shelves)
  ctx.fillStyle = '#0F172A';
  roundedRect(ctx, x + 250, y + 6, 45, 30, 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(56, 189, 248, 0.4)';
  roundedRect(ctx, x + 252, y + 8, 41, 26, 2);
  ctx.fill();
  // Beverage shelves
  ctx.strokeStyle = '#38BDF8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 253, y + 16); ctx.lineTo(x + 292, y + 16);
  ctx.moveTo(x + 253, y + 24); ctx.lineTo(x + 292, y + 24);
  ctx.stroke();

  // 3 Round Café Tables
  const tables = [
    { x: x + 50, y: y + 55 },
    { x: x + 140, y: y + 60 },
    { x: x + 230, y: y + 58 },
  ];

  tables.forEach((t) => {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#D4A373';
    ctx.beginPath(); ctx.arc(t.x, t.y, 18, 0, Math.PI * 2); ctx.fill();

    // Chairs around table
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#1E293B';
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI * 0.66) {
      const cx = t.x + Math.cos(angle) * 26;
      const cy = t.y + Math.sin(angle) * 26;
      ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
    }
  });

  // Plants
  drawPottedPlant(ctx, x + 20, y + 20, 13, isDark);
  drawPottedPlant(ctx, x + 300, y + 50, 14, isDark);

  ctx.restore();
}

// 12. Town Hall / Auditorium
function drawTownHall(ctx, x, y, w, h, isDark) {
  ctx.save();
  ctx.fillStyle = isDark ? '#191D24' : '#E2E6EE';
  roundedRect(ctx, x, y, w, h, 12);
  ctx.fill();

  // Massive Ultra-Wide Stage Presentation Screen
  ctx.shadowColor = 'rgba(56, 189, 248, 0.35)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#0F172A';
  roundedRect(ctx, x + 105, y + 8, 170, 48, 6);
  ctx.fill();

  const stageGrad = ctx.createLinearGradient(x + 105, y + 8, x + 275, y + 56);
  stageGrad.addColorStop(0, '#1E3A8A');
  stageGrad.addColorStop(1, '#3B82F6');
  ctx.fillStyle = stageGrad;
  roundedRect(ctx, x + 107, y + 10, 166, 44, 4);
  ctx.fill();

  // Presentation text: "Build Connect Grow Together"
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 8.5px "Manrope", sans-serif';
  ctx.fillText('Build', x + 116, y + 22);
  ctx.fillText('Connect', x + 116, y + 32);
  ctx.fillText('Grow Together', x + 116, y + 42);
  ctx.fillStyle = '#93C5FD';
  ctx.font = '600 6.5px "DM Sans", sans-serif';
  ctx.fillText('✨ ProxiSpeak', x + 215, y + 48);

  // Raised curved wooden stage platform
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#C29B72';
  ctx.beginPath();
  ctx.ellipse(x + 185, y + 58, 65, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tiered theater seat rows
  ctx.shadowColor = 'transparent';
  for (let row = 0; row < 3; row++) {
    const ry = y + 18 + row * 18;
    for (let seat = 0; seat < 5; seat++) {
      const sx = x + 15 + seat * 15;
      ctx.fillStyle = '#334155';
      roundedRect(ctx, sx, ry, 11, 12, 3);
      ctx.fill();
    }
  }

  // Stage plants
  drawPottedPlant(ctx, x + 85, y + 55, 12, isDark);

  ctx.restore();
}

// 13. Physical Glass Partitions and Acoustic Walls
function drawWallsAndPartitions(ctx, obstacles, isDark) {
  ctx.save();
  ctx.lineCap = 'round';

  obstacles.forEach((obs) => {
    if (obs.x1 !== undefined && obs.y1 !== undefined && obs.x2 !== undefined && obs.y2 !== undefined) {
      // Dark metal runner base
      ctx.strokeStyle = isDark ? '#0F172A' : '#334155';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(obs.x1, obs.y1);
      ctx.lineTo(obs.x2, obs.y2);
      ctx.stroke();

      // Translucent cyan glass panel line
      ctx.strokeStyle = isDark ? 'rgba(56, 189, 248, 0.75)' : 'rgba(2, 132, 199, 0.8)';
      ctx.lineWidth = 2.2;
      ctx.shadowColor = 'rgba(56, 189, 248, 0.4)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(obs.x1, obs.y1);
      ctx.lineTo(obs.x2, obs.y2);
      ctx.stroke();

      // End cap chrome dots
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = isDark ? '#38BDF8' : '#0284C7';
      ctx.beginPath();
      ctx.arc(obs.x1, obs.y1, 2.5, 0, Math.PI * 2);
      ctx.arc(obs.x2, obs.y2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Perimeter border
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
  ctx.lineWidth = 2;
  roundedRect(ctx, 12, 12, 976, 676, 16);
  ctx.stroke();

  ctx.restore();
}

// 14. Potted Indoor Plants
function drawPottedPlant(ctx, x, y, size = 12, isDark = true) {
  ctx.save();
  // Ceramic pot shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;

  // White ceramic pot
  ctx.fillStyle = isDark ? '#E2E8F0' : '#FFFFFF';
  ctx.beginPath();
  ctx.arc(x, y, size * 0.6, 0, Math.PI * 2);
  ctx.fill();

  // Soil
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#3E2723';
  ctx.beginPath();
  ctx.arc(x, y, size * 0.45, 0, Math.PI * 2);
  ctx.fill();

  // Lush green leaves (multi-petal fiddle-leaf/monstera cluster)
  const leafColors = ['#15803D', '#22C55E', '#166534', '#4ADE80'];
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI * 2) / 6;
    const lx = x + Math.cos(angle) * (size * 0.65);
    const ly = y + Math.sin(angle) * (size * 0.65);
    ctx.fillStyle = leafColors[i % leafColors.length];
    ctx.beginPath();
    ctx.ellipse(lx, ly, size * 0.5, size * 0.35, angle, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawPlanterBox(ctx, x, y, w, h, isDark) {
  ctx.save();
  ctx.fillStyle = isDark ? '#334155' : '#CBD5E1';
  roundedRect(ctx, x, y, w, h, 4);
  ctx.fill();

  // Foliage cluster
  ctx.fillStyle = '#16A34A';
  for (let px = x + 6; px < x + w - 6; px += 10) {
    ctx.beginPath();
    ctx.arc(px, y + h / 2, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// 15. High-Fidelity Realistic Avatar (Matches Reference Chibi/Isometric Style)
function drawRealisticAvatar(
  ctx,
  x,
  y,
  color,
  label,
  isLocal,
  isSpeaking,
  isNearby,
  isMuted,
  attenuation,
  isDark,
  isSeated = false
) {
  const isMuffled = attenuation < 0.9;
  ctx.save();

  // 1. Equalizer audio bars when speaking
  if (isSpeaking) {
    const barCount = 4;
    const barW = 2.5;
    const spacing = 2;
    const totalW = barCount * barW + (barCount - 1) * spacing;
    const startX = x - totalW / 2;
    const baseH = 8;
    const t = Date.now() / 100;

    ctx.save();
    ctx.fillStyle = isLocal ? '#38BDF8' : '#22C55E';
    for (let i = 0; i < barCount; i++) {
      const h = Math.max(3, baseH * Math.abs(Math.sin(t + i * 1.2)));
      roundedRect(ctx, startX + i * (barW + spacing), y - 32 - h, barW, h, 1.5);
      ctx.fill();
    }
    ctx.restore();
  }

  // 2. Speaking pulsing halo
  if (isSpeaking) {
    ctx.save();
    ctx.shadowColor = isLocal ? '#38BDF8' : '#22C55E';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = isLocal ? 'rgba(56, 189, 248, 0.9)' : 'rgba(34, 197, 94, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y - (isSeated ? 4 : 8), 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 3. Drop shadow on floor
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y + 6, isSeated ? 10 : 12, isSeated ? 4 : 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 4. Character Body & Clothes
  // Shoes / Feet
  if (!isSeated) {
    ctx.fillStyle = '#0F172A';
    roundedRect(ctx, x - 6, y + 2, 4.5, 5, 2);
    roundedRect(ctx, x + 1.5, y + 2, 4.5, 5, 2);
    ctx.fill();

    // Pants / Trousers
    ctx.fillStyle = '#1E293B';
    roundedRect(ctx, x - 6.5, y - 5, 13, 8, 2);
    ctx.fill();
  }

  // Torso / Shirt / Hoodie
  ctx.fillStyle = isLocal ? '#0284C7' : color;
  roundedRect(ctx, x - 8, y - (isSeated ? 10 : 16), 16, isSeated ? 10 : 12, 4);
  ctx.fill();

  // Collar / Inner detail
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(x - 3, y - (isSeated ? 10 : 16));
  ctx.lineTo(x, y - (isSeated ? 6 : 12));
  ctx.lineTo(x + 3, y - (isSeated ? 10 : 16));
  ctx.fill();

  // Head (Skin Tone)
  ctx.fillStyle = '#FBCFE8'; // Natural warm tone
  ctx.beginPath();
  ctx.arc(x, y - (isSeated ? 16 : 22), 7.5, 0, Math.PI * 2);
  ctx.fill();

  // Hair (Stylized anime/chibi haircut)
  ctx.fillStyle = isLocal ? '#1E293B' : '#451A03';
  ctx.beginPath();
  ctx.arc(x, y - (isSeated ? 18 : 24), 8, Math.PI, Math.PI * 2);
  ctx.fill();
  // Bangs
  ctx.beginPath();
  ctx.moveTo(x - 7, y - (isSeated ? 18 : 24));
  ctx.lineTo(x - 2, y - (isSeated ? 15 : 21));
  ctx.lineTo(x + 2, y - (isSeated ? 17 : 23));
  ctx.lineTo(x + 7, y - (isSeated ? 18 : 24));
  ctx.fill();

  // 5. Floating Nameplate (Matches reference image: black capsule, green dot, name)
  const isMe = isLocal;
  const displayName = isMe ? 'You' : label;
  ctx.font = '600 9px "DM Sans", -apple-system, sans-serif';
  const nameW = ctx.measureText(displayName).width;
  const pillW = nameW + 24;
  const pillH = 16;
  const pillX = x - pillW / 2;
  const pillY = y - (isSeated ? 42 : 48);

  // Black floating pill background
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
  roundedRect(ctx, pillX, pillY, pillW, pillH, 8);
  ctx.fill();

  // Capsule border (Cyan for local, Green for teammates)
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = isMe ? 'rgba(56, 189, 248, 0.6)' : 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  roundedRect(ctx, pillX, pillY, pillW, pillH, 8);
  ctx.stroke();

  // Status Indicator Dot inside pill
  ctx.fillStyle = isMe ? '#38BDF8' : (isMuffled ? '#F59E0B' : '#22C55E');
  ctx.beginPath();
  ctx.arc(pillX + 7, pillY + 8, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = isMe ? '700 8.5px "DM Sans", sans-serif' : '600 8.5px "DM Sans", sans-serif';
  ctx.fillText(displayName, pillX + 13, pillY + 11.2);

  ctx.restore();
}
