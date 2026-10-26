import { useCallback, useEffect, useRef, useState } from 'react';
import deviceCache from '../utils/deviceCache';

const THROTTLE_MS = 1000 / 30; // 30Hz high-responsiveness move rate
const AVATAR_COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#06B6D4', '#EC4899', '#14B8A6', '#F43F5E'];

function labelFor(index) { return `Teammate ${index + 1}`; }

export default function OfficeCanvas({
  socket,
  officeState = { width: 1000, height: 700 },
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
  const lastEmitTime = useRef(0);
  const trailingMoveTimeout = useRef(null);
  const syncTimeoutRef = useRef(null);

  const [canvasSize, setCanvasSize] = useState({ width: officeState?.width || 1000, height: officeState?.height || 700 });
  
  // Dynamic sound wave ripples & footsteps
  const soundWaves = useRef([]);
  const moveParticles = useRef([]);
  const lastWaveSpawn = useRef(0);

  const audioStateRef = useRef({
    isSpeaking,
    isMuted,
    speakingPeers,
    nearbyPeers,
    mutedPeers,
    peerAttenuations,
    isDarkMode,
  });
  audioStateRef.current = {
    isSpeaking,
    isMuted,
    speakingPeers,
    nearbyPeers,
    mutedPeers,
    peerAttenuations,
    isDarkMode,
  };

  const onPeersChangeRef = useRef(onPeersChange);
  const onPositionChangeRef = useRef(onPositionChange);
  const onFrameRateChangeRef = useRef(onFrameRateChange);
  onPeersChangeRef.current = onPeersChange;
  onPositionChangeRef.current = onPositionChange;
  onFrameRateChangeRef.current = onFrameRateChange;

  // Throttled React State Synchronizer
  const scheduleSync = useCallback(() => {
    if (syncTimeoutRef.current) return;
    syncTimeoutRef.current = setTimeout(() => {
      syncTimeoutRef.current = null;
      onPositionChangeRef.current?.(localPos.current, peersRef.current);
    }, 16);
  }, []);

  const updatePeers = useCallback((updater) => {
    const nextPeers = typeof updater === 'function' ? updater(peersRef.current) : updater;
    peersRef.current = nextPeers;
    onPeersChangeRef.current?.(nextPeers);
    scheduleSync();
  }, [scheduleSync]);

  useEffect(() => {
    if (!socket) return undefined;
    socket.emit('player:move', { x: localPos.current.x, y: localPos.current.y });

    const handlePlayerMoved = ({ userId, x, y, name }) => {
      if (userId === localUserId) return;
      updatePeers((prev) => ({
        ...prev,
        [userId]: { x, y, name: name || prev[userId]?.name || `Teammate` },
      }));
    };

    const handlePlayerLeft = ({ userId }) => {
      updatePeers((prev) => {
        const next = { ...prev };
        delete next[userId];
        delete interpolatedPeers.current[userId];
        return next;
      });
    };

    socket.on('player:moved', handlePlayerMoved);
    socket.on('player:left', handlePlayerLeft);

    return () => {
      socket.off('player:moved', handlePlayerMoved);
      socket.off('player:left', handlePlayerLeft);
    };
  }, [socket, localUserId, updatePeers]);

  useEffect(() => {
    const initialPeers = {};
    if (officeState?.users) {
      officeState.users.forEach((user) => {
        if (user.userId !== localUserId && user.location) {
          initialPeers[user.userId] = {
            x: user.location[0],
            y: user.location[1],
            name: user.name || `Teammate`,
          };
          interpolatedPeers.current[user.userId] = {
            x: user.location[0],
            y: user.location[1],
          };
        }
      });
    }
    peersRef.current = initialPeers;
    onPeersChangeRef.current?.(initialPeers);
    scheduleSync();
  }, [officeState, localUserId, scheduleSync]);

  // Main 60 FPS Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let frame;
    let pixelRatio = window.devicePixelRatio || 1;
    let frameCount = 0;
    let fpsWindowStart = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pixelRatio = window.devicePixelRatio || 1;
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

      // 1. Executive Modern Matte Canvas Floor with Vignette
      const bgGrad = ctx.createRadialGradient(
        width / 2, height / 2, 40,
        width / 2, height / 2, Math.max(width, height) * 0.75
      );
      if (dark) {
        bgGrad.addColorStop(0, '#0F151E');
        bgGrad.addColorStop(0.55, '#0B0F16');
        bgGrad.addColorStop(1, '#07090D');
      } else {
        bgGrad.addColorStop(0, '#FFFFFF');
        bgGrad.addColorStop(0.55, '#F5F7FA');
        bgGrad.addColorStop(1, '#E9EDF5');
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.scale(sx, sy);

      // 2. High-Tech Matrix Floor Grid & Navigation Channels
      ctx.save();
      for (let x = 32; x < officeState.width; x += 32) {
        for (let y = 32; y < officeState.height; y += 32) {
          const isCross = (x % 128 === 0 && y % 128 === 0);
          if (isCross) {
            ctx.strokeStyle = dark ? 'rgba(0, 245, 155, 0.18)' : 'rgba(31, 168, 150, 0.22)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y);
            ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
            ctx.stroke();
          } else {
            ctx.fillStyle = dark ? 'rgba(255, 255, 255, 0.035)' : 'rgba(0, 0, 0, 0.04)';
            ctx.beginPath();
            ctx.arc(x, y, 1, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Floor Waypoint Pathway Lines between zones
      ctx.strokeStyle = dark ? 'rgba(0, 210, 255, 0.08)' : 'rgba(14, 165, 233, 0.1)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([8, 12]);
      ctx.beginPath();
      // Hallway from Library to Studio
      ctx.moveTo(325, 170); ctx.lineTo(390, 170);
      // Corridor to Lounge
      ctx.moveTo(560, 325); ctx.lineTo(560, 485); ctx.lineTo(710, 485);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // 3. Architectural Zone Floors & Customized Furniture
      drawLibraryZone(ctx, 73, 87, 252, 172, dark);
      drawStudioZone(ctx, 389, 82, 337, 242, dark);
      drawLoungeZone(ctx, 710, 392, 226, 186, dark);

      // 4. Sound-Blocking Laser Acoustic Walls (Rule R-20)
      const obstacles = officeState?.obstacles || [];
      if (obstacles.length > 0) {
        ctx.save();
        ctx.lineCap = 'round';
        obstacles.forEach((obs) => {
          if (obs.x1 !== undefined && obs.y1 !== undefined && obs.x2 !== undefined && obs.y2 !== undefined) {
            drawAcousticLaserWall(ctx, obs, dark);
          }
        });
        ctx.restore();
      }

      // 5. Perimeter Floor Border
      ctx.save();
      ctx.strokeStyle = dark ? 'rgba(0, 245, 155, 0.14)' : 'rgba(31, 168, 150, 0.2)';
      ctx.lineWidth = 1.5;
      roundedRect(ctx, 14, 14, officeState.width - 28, officeState.height - 28, 18);
      ctx.stroke();
      ctx.restore();

      const { x: localX, y: localY } = localPos.current;

      // 6. Movement Particle Footstep Trails
      ctx.save();
      for (let i = moveParticles.current.length - 1; i >= 0; i--) {
        const p = moveParticles.current[i];
        p.size += 0.25;
        p.alpha -= 0.035;
        if (p.alpha <= 0) {
          moveParticles.current.splice(i, 1);
          continue;
        }
        ctx.fillStyle = dark ? `rgba(0, 245, 155, ${p.alpha})` : `rgba(16, 185, 129, ${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

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

          // Animated luminous neon audio tether
          const tetherGrad = ctx.createLinearGradient(localX, localY, interp.x, interp.y);
          if (dark) {
            tetherGrad.addColorStop(0, 'rgba(0, 245, 155, 0.75)');
            tetherGrad.addColorStop(1, isMuffled ? 'rgba(245, 158, 11, 0.7)' : 'rgba(0, 210, 255, 0.75)');
          } else {
            tetherGrad.addColorStop(0, 'rgba(16, 185, 129, 0.7)');
            tetherGrad.addColorStop(1, isMuffled ? 'rgba(217, 119, 6, 0.7)' : 'rgba(14, 165, 233, 0.7)');
          }

          ctx.strokeStyle = tetherGrad;
          ctx.lineWidth = isMuffled ? 1.6 : 2.2;
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
          
          ctx.font = '700 8.5px "JetBrains Mono", monospace, sans-serif';
          const textMetrics = ctx.measureText(badgeText);
          const badgeW = textMetrics.width + 16;
          const badgeH = 18;

          ctx.fillStyle = dark ? 'rgba(11, 15, 22, 0.92)' : 'rgba(255, 255, 255, 0.94)';
          ctx.shadowColor = dark ? 'rgba(0, 0, 0, 0.65)' : 'rgba(0, 0, 0, 0.12)';
          ctx.shadowBlur = 8;
          roundedRect(ctx, midX - badgeW / 2, midY - badgeH / 2, badgeW, badgeH, 6);
          ctx.fill();

          ctx.shadowColor = 'transparent';
          ctx.strokeStyle = isMuffled ? 'rgba(245, 158, 11, 0.7)' : 'rgba(0, 245, 155, 0.7)';
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

      // 9. Local User 100px Hearing Horizon Aura (High-Tech Breathing Sonar)
      drawHearingHorizon(ctx, localX, localY, officeState?.hearingRadiusPx || 100, dark);

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

  // Keyboard navigation with particle spawning
  useEffect(() => {
    const move = (event) => {
      const keys = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
      const direction = keys[event.key] || keys[event.key.toLowerCase()];
      if (!direction || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      const pace = event.shiftKey ? 19 : 10;
      const nextX = Math.max(35, Math.min(localPos.current.x + direction[0] * pace, officeState.width - 35));
      const nextY = Math.max(35, Math.min(localPos.current.y + direction[1] * pace, officeState.height - 35));
      
      // Spawn subtle footstep motes
      moveParticles.current.push({
        x: localPos.current.x,
        y: localPos.current.y,
        size: 3.5,
        alpha: 0.55,
      });
      if (moveParticles.current.length > 25) moveParticles.current.shift();

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
    const x = (event.clientX - rect.left) / rect.width * officeState.width;
    const y = (event.clientY - rect.top) / rect.height * officeState.height;
    
    // Spawn click ripple
    moveParticles.current.push({
      x,
      y,
      size: 5,
      alpha: 0.7,
    });

    localPos.current = { x, y };
    deviceCache.savePosition(officeState?.officeId, localUserId, localPos.current);
    scheduleSync();
    if (socket) socket.emit('player:move', { x, y });
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

// -------------------------------------------------------------
// 1. THE LIBRARY ZONE (Warm Acoustic Wood Flooring, Bookshelves, Armchairs)
// -------------------------------------------------------------
function drawLibraryZone(ctx, x, y, w, h, isDark = true) {
  ctx.save();

  // Zone Floor Base with Warm Glow
  const floorGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  if (isDark) {
    floorGrad.addColorStop(0, 'rgba(28, 23, 17, 0.45)');
    floorGrad.addColorStop(1, 'rgba(18, 16, 14, 0.45)');
  } else {
    floorGrad.addColorStop(0, 'rgba(253, 248, 240, 0.85)');
    floorGrad.addColorStop(1, 'rgba(246, 239, 227, 0.85)');
  }
  ctx.fillStyle = floorGrad;
  roundedRect(ctx, x, y, w, h, 14);
  ctx.fill();

  // Parquet / Acoustic Wood Slats Texture
  ctx.strokeStyle = isDark ? 'rgba(245, 158, 11, 0.05)' : 'rgba(180, 130, 80, 0.08)';
  ctx.lineWidth = 1;
  for (let px = x + 16; px < x + w - 10; px += 20) {
    ctx.beginPath();
    ctx.moveTo(px, y + 4);
    ctx.lineTo(px, y + h - 4);
    ctx.stroke();
  }

  // Soft Ambient Reading Lamp Glow
  const lampGlow = ctx.createRadialGradient(x + 130, y + 105, 5, x + 130, y + 105, 75);
  lampGlow.addColorStop(0, isDark ? 'rgba(251, 191, 36, 0.12)' : 'rgba(251, 191, 36, 0.16)');
  lampGlow.addColorStop(1, 'rgba(251, 191, 36, 0)');
  ctx.fillStyle = lampGlow;
  ctx.beginPath();
  ctx.arc(x + 130, y + 105, 75, 0, Math.PI * 2);
  ctx.fill();

  // Border & Corner Brackets
  ctx.strokeStyle = isDark ? 'rgba(245, 158, 11, 0.35)' : 'rgba(217, 119, 6, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  roundedRect(ctx, x, y, w, h, 14);
  ctx.stroke();
  ctx.setLineDash([]);

  // Bookshelf Wall along Left Edge
  drawBookshelfWall(ctx, x + 8, y + 12, 14, h - 24, isDark);

  // Velvet Reading Armchairs
  drawArmchair(ctx, x + 105, y + 125, isDark ? '#1F382E' : '#B4D8C4', isDark);
  drawArmchair(ctx, x + 165, y + 125, isDark ? '#3D2817' : '#E8C5A5', isDark);

  // Coffee / Reading Table between armchairs
  drawReadingTable(ctx, x + 135, y + 125, isDark);

  // Standing Brass Arc Lamp
  drawStandingLamp(ctx, x + 85, y + 150, isDark);

  // Potted Fiddle-Leaf Fig Plant
  drawPlant(ctx, x + w - 24, y + 32, isDark);

  // Zone Label Badge
  drawZoneBadge(ctx, x + 14, y + 20, '📚 THE LIBRARY', 'Acoustic Silent · 0.25x', isDark ? '#F59E0B' : '#D97706', isDark);

  ctx.restore();
}

// Detailed Bookshelf Wall with colorful book spines
function drawBookshelfWall(ctx, x, y, w, h, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(0, 0, 0, 0.1)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = isDark ? '#1C1510' : '#8B5A2B';
  roundedRect(ctx, x, y, w, h, 3);
  ctx.fill();

  // Shelves and colorful book spines
  ctx.shadowColor = 'transparent';
  const shelfCount = 4;
  const shelfH = (h - 10) / shelfCount;
  const bookColors = ['#DC2626', '#2563EB', '#16A34A', '#D97706', '#9333EA', '#0D9488', '#F59E0B', '#E11D48'];

  for (let s = 0; s < shelfCount; s++) {
    const sy = y + 5 + s * shelfH;
    ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(x + 1, sy + shelfH - 2, w - 2, 2);

    for (let b = 0; b < 5; b++) {
      const bColor = bookColors[(s * 5 + b) % bookColors.length];
      ctx.fillStyle = bColor;
      ctx.fillRect(x + 2, sy + 3 + b * 5, w - 4, 3.5);
    }
  }
  ctx.restore();
}

// Velvet Reading Armchair
function drawArmchair(ctx, x, y, velvetColor, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.1)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;

  // Armchair backrest
  ctx.fillStyle = velvetColor;
  roundedRect(ctx, x - 15, y - 14, 30, 28, 8);
  ctx.fill();

  // Seat cushion
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.4)';
  roundedRect(ctx, x - 11, y - 10, 22, 20, 5);
  ctx.fill();

  // Armrests
  ctx.fillStyle = velvetColor;
  roundedRect(ctx, x - 17, y - 9, 4, 18, 2);
  roundedRect(ctx, x + 13, y - 9, 4, 18, 2);
  ctx.fill();
  ctx.restore();
}

function drawReadingTable(ctx, x, y, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.08)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = isDark ? '#261D15' : '#D7BA9D';
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fill();

  // Open book on table
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = isDark ? '#E2E8F0' : '#FFFFFF';
  roundedRect(ctx, x - 5, y - 4, 10, 8, 1);
  ctx.fill();
  ctx.fillStyle = isDark ? '#94A3B8' : '#CBD5E1';
  ctx.fillRect(x - 0.5, y - 4, 1, 8);
  ctx.restore();
}

function drawStandingLamp(ctx, x, y, isDark) {
  ctx.save();
  // Lamp Base
  ctx.fillStyle = isDark ? '#B45309' : '#D97706';
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();

  // Arc Stem
  ctx.strokeStyle = isDark ? '#F59E0B' : '#B45309';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x + 8, y - 8, 10, Math.PI * 0.7, Math.PI * 1.5);
  ctx.stroke();

  // Lamp Shade with Glow
  ctx.fillStyle = '#FDE68A';
  ctx.beginPath();
  ctx.arc(x + 16, y - 14, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// -------------------------------------------------------------
// 2. DEV STUDIO ZONE (High-Tech Carbon Slate, Dual Monitors, Task Chairs)
// -------------------------------------------------------------
function drawStudioZone(ctx, x, y, w, h, isDark = true) {
  ctx.save();

  // Zone Floor Base with Subtle Cyan/Teal Tech Sheen
  const floorGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  if (isDark) {
    floorGrad.addColorStop(0, 'rgba(14, 23, 33, 0.5)');
    floorGrad.addColorStop(1, 'rgba(10, 17, 26, 0.5)');
  } else {
    floorGrad.addColorStop(0, 'rgba(240, 247, 255, 0.85)');
    floorGrad.addColorStop(1, 'rgba(235, 243, 252, 0.85)');
  }
  ctx.fillStyle = floorGrad;
  roundedRect(ctx, x, y, w, h, 14);
  ctx.fill();

  // Tech Tiles Seams
  ctx.strokeStyle = isDark ? 'rgba(0, 210, 255, 0.04)' : 'rgba(14, 165, 233, 0.06)';
  ctx.lineWidth = 1;
  for (let px = x + 36; px < x + w - 10; px += 45) {
    ctx.beginPath();
    ctx.moveTo(px, y + 4);
    ctx.lineTo(px, y + h - 4);
    ctx.stroke();
  }

  // Zone Boundary & Corners
  ctx.strokeStyle = isDark ? 'rgba(0, 210, 255, 0.35)' : 'rgba(14, 165, 233, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  roundedRect(ctx, x, y, w, h, 14);
  ctx.stroke();
  ctx.setLineDash([]);

  // Glass Collaboration Whiteboard along Top Wall
  drawCollaborationWhiteboard(ctx, x + 55, y + 10, 160, 10, isDark);

  // 4 Workstation Desk Bays with Dual Displays
  drawWorkstationPod(ctx, x + 40, y + 45, 115, isDark);
  drawWorkstationPod(ctx, x + 185, y + 45, 115, isDark);
  drawWorkstationPod(ctx, x + 40, y + 140, 115, isDark);
  drawWorkstationPod(ctx, x + 185, y + 140, 115, isDark);

  // Potted Lush Monstera Plant
  drawMonsteraPlant(ctx, x + w - 24, y + h - 28, isDark);

  // Zone Label Badge
  drawZoneBadge(ctx, x + 14, y + 20, '💻 DEV STUDIO', 'Spatial Audio · Workstations', isDark ? '#00D2FF' : '#0284C7', isDark);

  ctx.restore();
}

function drawCollaborationWhiteboard(ctx, x, y, w, h, isDark) {
  ctx.save();
  ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.95)';
  ctx.strokeStyle = isDark ? 'rgba(0, 210, 255, 0.4)' : '#94A3B8';
  ctx.lineWidth = 1.2;
  roundedRect(ctx, x, y, w, h, 3);
  ctx.fill();
  ctx.stroke();

  // Sticky notes (yellow, cyan, pink)
  const stickyColors = ['#FBBF24', '#38BDF8', '#F472B6', '#34D399'];
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = stickyColors[i % stickyColors.length];
    roundedRect(ctx, x + 15 + i * 22, y + 2, 8, 6, 1);
    ctx.fill();
  }
  ctx.restore();
}

// Modern Workstation Pod with Dual Displays & Mesh Chair
function drawWorkstationPod(ctx, x, y, w, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.1)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;

  // Oak / Carbon Desktop
  ctx.fillStyle = isDark ? '#18202C' : '#E8EDF5';
  roundedRect(ctx, x, y, w, 40, 8);
  ctx.fill();

  // Extended Desk Mat
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = isDark ? '#0F1722' : '#CBD5E1';
  roundedRect(ctx, x + 14, y + 8, w - 28, 26, 4);
  ctx.fill();

  // Dual Curved Ultra-wide Displays
  const dispW = (w - 44) / 2;
  // Screen 1 (Code Editor with Syntax Lines)
  ctx.fillStyle = isDark ? '#090D14' : '#1E293B';
  roundedRect(ctx, x + 18, y + 10, dispW, 14, 2);
  ctx.fill();
  // Glowing Code Lines
  ctx.fillStyle = '#38BDF8'; ctx.fillRect(x + 21, y + 13, 8, 1);
  ctx.fillStyle = '#4ADE80'; ctx.fillRect(x + 31, y + 13, 12, 1);
  ctx.fillStyle = '#F472B6'; ctx.fillRect(x + 21, y + 16, 14, 1);
  ctx.fillStyle = '#CBD5E1'; ctx.fillRect(x + 21, y + 19, 18, 1);

  // Screen 2 (System Telemetry Radar)
  ctx.fillStyle = isDark ? '#090D14' : '#1E293B';
  roundedRect(ctx, x + 24 + dispW, y + 10, dispW, 14, 2);
  ctx.fill();
  ctx.fillStyle = '#22C55E';
  ctx.beginPath();
  ctx.moveTo(x + 27 + dispW, y + 19);
  ctx.lineTo(x + 33 + dispW, y + 14);
  ctx.lineTo(x + 39 + dispW, y + 17);
  ctx.lineTo(x + 45 + dispW, y + 13);
  ctx.strokeStyle = '#22C55E';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Mechanical Keyboard & Mouse
  ctx.fillStyle = isDark ? '#334155' : '#94A3B8';
  roundedRect(ctx, x + w / 2 - 12, y + 27, 24, 5, 1);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + w / 2 + 18, y + 29.5, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Designer Mesh Task Chair with Backrest
  drawMeshChair(ctx, x + w / 2, y + 54, isDark);

  ctx.restore();
}

function drawMeshChair(ctx, x, y, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(0, 0, 0, 0.08)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = isDark ? '#1E293B' : '#94A3B8';
  // Seat cushion
  roundedRect(ctx, x - 10, y - 8, 20, 16, 4);
  ctx.fill();
  // Mesh backrest
  ctx.fillStyle = isDark ? '#334155' : '#64748B';
  roundedRect(ctx, x - 9, y + 6, 18, 4, 2);
  ctx.fill();
  // Armrests
  ctx.fillStyle = isDark ? '#475569' : '#CBD5E1';
  roundedRect(ctx, x - 12, y - 6, 2.5, 12, 1);
  roundedRect(ctx, x + 9.5, y - 6, 2.5, 12, 1);
  ctx.fill();
  ctx.restore();
}

// -------------------------------------------------------------
// 3. THE LOUNGE ZONE (Warm Terrazzo, Plush Sectional Sofa, Coffee Table)
// -------------------------------------------------------------
function drawLoungeZone(ctx, x, y, w, h, isDark = true) {
  ctx.save();

  // Zone Floor Base with Warm Ambient Rose/Amber Glow
  const floorGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  if (isDark) {
    floorGrad.addColorStop(0, 'rgba(26, 18, 30, 0.45)');
    floorGrad.addColorStop(1, 'rgba(16, 14, 24, 0.45)');
  } else {
    floorGrad.addColorStop(0, 'rgba(252, 244, 255, 0.85)');
    floorGrad.addColorStop(1, 'rgba(247, 238, 252, 0.85)');
  }
  ctx.fillStyle = floorGrad;
  roundedRect(ctx, x, y, w, h, 14);
  ctx.fill();

  // Terrazzo Specks
  ctx.fillStyle = isDark ? 'rgba(236, 72, 153, 0.06)' : 'rgba(219, 39, 119, 0.08)';
  for (let px = x + 20; px < x + w - 10; px += 35) {
    for (let py = y + 20; py < y + h - 10; py += 30) {
      ctx.beginPath();
      ctx.arc(px, py, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Soft Area Rug
  ctx.save();
  ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)';
  ctx.strokeStyle = isDark ? 'rgba(236, 72, 153, 0.15)' : 'rgba(219, 39, 119, 0.15)';
  ctx.lineWidth = 1;
  roundedRect(ctx, x + 25, y + 42, w - 50, h - 65, 18);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Zone Boundary & Corners
  ctx.strokeStyle = isDark ? 'rgba(236, 72, 153, 0.35)' : 'rgba(219, 39, 119, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  roundedRect(ctx, x, y, w, h, 14);
  ctx.stroke();
  ctx.setLineDash([]);

  // Luxury L-Sectional Sofa
  drawLSectionalSofa(ctx, x + 38, y + 55, isDark);

  // Circular Marble Coffee Table with Magazines & Coffee Cups
  drawMarbleCoffeeTable(ctx, x + 115, y + 110, isDark);

  // Potted Fiddle Fig Plant
  drawPlant(ctx, x + w - 28, y + 36, isDark);

  // Zone Label Badge
  drawZoneBadge(ctx, x + 14, y + 20, '☕ THE LOUNGE', 'Social Commons · Open Audio', isDark ? '#EC4899' : '#DB2777', isDark);

  ctx.restore();
}

function drawLSectionalSofa(ctx, x, y, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.12)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;

  const sofaColor = isDark ? '#1C292E' : '#9EBEC5';
  const cushionColor = isDark ? '#26383E' : '#B8D5DC';

  // Main horizontal couch section
  ctx.fillStyle = sofaColor;
  roundedRect(ctx, x, y, 105, 36, 10);
  ctx.fill();

  // Cushions
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = cushionColor;
  roundedRect(ctx, x + 5, y + 5, 45, 26, 6);
  roundedRect(ctx, x + 55, y + 5, 45, 26, 6);
  ctx.fill();

  // L-extension downward section
  ctx.fillStyle = sofaColor;
  roundedRect(ctx, x, y + 34, 38, 48, 8);
  ctx.fill();
  ctx.fillStyle = cushionColor;
  roundedRect(ctx, x + 5, y + 38, 28, 40, 6);
  ctx.fill();

  // Accent Throw Pillows (Mustard & Terracotta)
  ctx.fillStyle = '#F59E0B'; // Mustard
  roundedRect(ctx, x + 92, y + 7, 7, 12, 2);
  ctx.fill();
  ctx.fillStyle = '#EA580C'; // Terracotta
  roundedRect(ctx, x + 7, y + 70, 12, 7, 2);
  ctx.fill();

  ctx.restore();
}

function drawMarbleCoffeeTable(ctx, x, y, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(0, 0, 0, 0.1)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;

  // Marble Top with Gold Rim
  ctx.fillStyle = isDark ? '#2A303C' : '#F1F5F9';
  ctx.strokeStyle = isDark ? '#D97706' : '#F59E0B';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y, 19, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Marble Veins
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 10, y - 6); ctx.lineTo(x + 8, y + 8);
  ctx.stroke();

  // Designer Magazine & Espresso Cups
  ctx.fillStyle = '#38BDF8';
  roundedRect(ctx, x - 8, y - 6, 9, 12, 1);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(x + 5, y - 3, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// -------------------------------------------------------------
// 4. SHARED ARCHITECTURAL HELPERS (Badges, Walls, Plants, Avatars)
// -------------------------------------------------------------
function drawZoneBadge(ctx, x, y, title, subtitle, accentColor, isDark) {
  ctx.save();
  ctx.font = '700 9.5px "Manrope", "DM Sans", sans-serif';
  const titleW = ctx.measureText(title).width;
  ctx.font = '500 8px "JetBrains Mono", monospace, sans-serif';
  const subW = ctx.measureText(subtitle).width;
  const badgeW = Math.max(titleW, subW) + 20;
  const badgeH = 28;

  // Glass Badge Pill
  ctx.fillStyle = isDark ? 'rgba(11, 15, 22, 0.88)' : 'rgba(255, 255, 255, 0.92)';
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.08)';
  ctx.shadowBlur = 8;
  roundedRect(ctx, x, y, badgeW, badgeH, 7);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1;
  roundedRect(ctx, x, y, badgeW, badgeH, 7);
  ctx.stroke();

  // Accent Status Pip
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(x + 7, y + 10, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Title & Subtitle
  ctx.fillStyle = isDark ? '#F9FAFB' : '#111827';
  ctx.font = '700 9px "Manrope", sans-serif';
  ctx.fillText(title, x + 13, y + 12);

  ctx.fillStyle = isDark ? '#9CA3AF' : '#6B7280';
  ctx.font = '500 7.5px "JetBrains Mono", monospace, sans-serif';
  ctx.fillText(subtitle, x + 13, y + 23);

  ctx.restore();
}

function drawAcousticLaserWall(ctx, obs, isDark) {
  ctx.save();
  // Wall Floor Shadow
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.65)' : 'rgba(0, 0, 0, 0.18)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;

  // Outer Frosted Glass Casing
  ctx.strokeStyle = isDark ? '#1E2530' : '#475569';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(obs.x1, obs.y1);
  ctx.lineTo(obs.x2, obs.y2);
  ctx.stroke();

  // Glowing Laser Core
  ctx.shadowColor = isDark ? 'rgba(0, 245, 155, 0.65)' : 'rgba(16, 185, 129, 0.45)';
  ctx.shadowBlur = 8;
  ctx.strokeStyle = isDark ? '#00F59B' : '#10B981';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(obs.x1, obs.y1);
  ctx.lineTo(obs.x2, obs.y2);
  ctx.stroke();

  // Terminal End-Caps with Concentric Energy Rings
  ctx.fillStyle = isDark ? '#00F59B' : '#10B981';
  ctx.beginPath();
  ctx.arc(obs.x1, obs.y1, 3.5, 0, Math.PI * 2);
  ctx.arc(obs.x2, obs.y2, 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawPlant(ctx, x, y, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.08)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = isDark ? '#064E3B' : '#A7F3D0';
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = isDark ? '#10B981' : '#059669';
  ctx.beginPath();
  ctx.arc(x - 2, y - 2, 5, 0, Math.PI * 2);
  ctx.arc(x + 3, y - 2, 4.5, 0, Math.PI * 2);
  ctx.arc(x, y + 3, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMonsteraPlant(ctx, x, y, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.1)';
  ctx.shadowBlur = 8;
  // Ceramic Planter
  ctx.fillStyle = isDark ? '#1F2937' : '#E2E8F0';
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fill();
  // Broad Organic Monstera Leaves
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = isDark ? '#059669' : '#10B981';
  ctx.beginPath();
  ctx.arc(x - 5, y - 4, 7, 0, Math.PI * 2);
  ctx.arc(x + 5, y - 3, 6.5, 0, Math.PI * 2);
  ctx.arc(x, y + 5, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// -------------------------------------------------------------
// 5. 100PX VOICE HORIZON AURA & AVATARS
// -------------------------------------------------------------
function drawHearingHorizon(ctx, x, y, radius, isDark) {
  ctx.save();
  const pulse = radius + Math.sin(Date.now() / 450) * 2.2;

  // Multi-stop Luminous Radial Glow
  const radarGrad = ctx.createRadialGradient(x, y, 15, x, y, pulse);
  if (isDark) {
    radarGrad.addColorStop(0, 'rgba(0, 245, 155, 0.12)');
    radarGrad.addColorStop(0.65, 'rgba(0, 210, 255, 0.04)');
    radarGrad.addColorStop(1, 'rgba(0, 245, 155, 0)');
  } else {
    radarGrad.addColorStop(0, 'rgba(16, 185, 129, 0.10)');
    radarGrad.addColorStop(0.65, 'rgba(14, 165, 233, 0.03)');
    radarGrad.addColorStop(1, 'rgba(16, 185, 129, 0)');
  }
  ctx.fillStyle = radarGrad;
  ctx.beginPath();
  ctx.arc(x, y, pulse, 0, Math.PI * 2);
  ctx.fill();

  // Sonar Breathing Outer Ring
  ctx.strokeStyle = isDark ? 'rgba(0, 245, 155, 0.5)' : 'rgba(16, 185, 129, 0.55)';
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 6]);
  ctx.lineDashOffset = -Date.now() / 100;
  ctx.beginPath();
  ctx.arc(x, y, pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Micro-badge tag on bottom edge of aura
  const tagText = '100px • VOICE RANGE';
  ctx.font = '700 7px "JetBrains Mono", monospace, sans-serif';
  const tagW = ctx.measureText(tagText).width + 12;
  const tagY = y + pulse + 4;
  ctx.fillStyle = isDark ? 'rgba(11, 15, 22, 0.85)' : 'rgba(255, 255, 255, 0.9)';
  roundedRect(ctx, x - tagW / 2, tagY - 6, tagW, 12, 4);
  ctx.fill();
  ctx.strokeStyle = isDark ? 'rgba(0, 245, 155, 0.4)' : 'rgba(16, 185, 129, 0.4)';
  ctx.lineWidth = 0.8;
  roundedRect(ctx, x - tagW / 2, tagY - 6, tagW, 12, 4);
  ctx.stroke();
  ctx.fillStyle = isDark ? '#00F59B' : '#059669';
  ctx.textAlign = 'center';
  ctx.fillText(tagText, x, tagY + 2.5);

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
    const baseH = 9;
    const t = Date.now() / 90;

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
    ctx.strokeStyle = isLocal ? 'rgba(0, 245, 155, 0.85)' : 'rgba(0, 210, 255, 0.85)';
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
  const pillW = isMuffled ? 78 : 64;
  ctx.fillStyle = isDark ? 'rgba(17, 24, 39, 0.94)' : 'rgba(255, 255, 255, 0.96)';
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.1)';
  ctx.shadowBlur = 8;
  roundedRect(ctx, x - pillW / 2, y + 22, pillW, 18, 9);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = isSpeaking
    ? (isLocal ? 'rgba(0, 245, 155, 0.65)' : 'rgba(0, 210, 255, 0.65)')
    : (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)');
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
