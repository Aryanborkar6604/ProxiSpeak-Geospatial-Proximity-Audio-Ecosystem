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
  const lastSaveTime = useRef(0);
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

    // Offscreen canvas for the static floor background (grid + room bases + walls)
    // Rebuilt only on resize or theme change — never every frame.
    let bgCanvas = document.createElement('canvas');
    let bgCtx = bgCanvas.getContext('2d');
    let bgDark = null; // track last rendered theme
    let bgWidth = 0;
    let bgHeight = 0;

    function buildBgCanvas(width, height, dark, offW, offH) {
      bgCanvas.width = Math.round(width * pixelRatio);
      bgCanvas.height = Math.round(height * pixelRatio);
      bgWidth = width;
      bgHeight = height;
      bgDark = dark;

      const bc = bgCtx;
      bc.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      bc.clearRect(0, 0, width, height);

      // Background gradient
      const bgGrad = bc.createRadialGradient(
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
      bc.fillStyle = bgGrad;
      bc.fillRect(0, 0, width, height);

      const sx = width / offW;
      const sy = height / offH;
      bc.save();
      bc.scale(sx, sy);

      // Matrix floor grid – drawn once into bg cache
      // Use a single path for all dots to minimize draw calls
      bc.fillStyle = dark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)';
      bc.beginPath();
      for (let gx = 32; gx < offW; gx += 32) {
        for (let gy = 32; gy < offH; gy += 32) {
          if (gx % 128 === 0 && gy % 128 === 0) continue; // cross markers drawn separately
          bc.moveTo(gx + 1, gy);
          bc.arc(gx, gy, 1, 0, Math.PI * 2);
        }
      }
      bc.fill();

      // Cross markers
      bc.strokeStyle = dark ? 'rgba(0,245,155,0.18)' : 'rgba(31,168,150,0.22)';
      bc.lineWidth = 1;
      bc.beginPath();
      for (let gx = 128; gx < offW; gx += 128) {
        for (let gy = 128; gy < offH; gy += 128) {
          bc.moveTo(gx - 4, gy); bc.lineTo(gx + 4, gy);
          bc.moveTo(gx, gy - 4); bc.lineTo(gx, gy + 4);
        }
      }
      bc.stroke();

      // Floor waypoint pathway lines
      bc.strokeStyle = dark ? 'rgba(0,210,255,0.08)' : 'rgba(14,165,233,0.1)';
      bc.lineWidth = 1.2;
      bc.setLineDash([8, 12]);
      bc.beginPath();
      bc.moveTo(255, 255); bc.lineTo(255, 445);
      bc.moveTo(745, 255); bc.lineTo(745, 445);
      bc.moveTo(255, 350); bc.lineTo(325, 350);
      bc.moveTo(675, 350); bc.lineTo(745, 350);
      bc.moveTo(500, 255); bc.lineTo(500, 285);
      bc.stroke();
      bc.setLineDash([]);

      bc.restore();
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * pixelRatio);
      canvas.height = Math.round(rect.height * pixelRatio);
      setCanvasSize({ width: rect.width, height: rect.height });
      bgDark = null; // force bg rebuild on next frame
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

      // Rebuild bg cache if theme or size changed
      if (bgDark !== dark || bgWidth !== width || bgHeight !== height) {
        buildBgCanvas(width, height, dark, officeState?.width || 1000, officeState?.height || 700);
      }

      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      // 1 + 2: Blit the pre-rendered static floor in one fast drawImage call
      ctx.drawImage(bgCanvas, 0, 0, bgCanvas.width, bgCanvas.height, 0, 0, width, height);

      ctx.save();
      ctx.scale(sx, sy);

      // 3. Architectural Room Floors & Customized Furniture
      drawMeetingZone(ctx, 325, 35, 350, 220, dark);
      drawManagerZone(ctx, 705, 35, 260, 220, dark);
      drawHRZone(ctx, 35, 445, 260, 220, dark);
      drawWorkstationsZone(ctx, 325, 285, 350, 380, dark);

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
    return () => { cancelAnimationFrame(frame); observer.disconnect(); bgCanvas = null; bgCtx = null; };
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
      // Throttle position saves to every 2s – avoids sync localStorage writes each keydown
      const saveNow = Date.now();
      if (saveNow - lastSaveTime.current >= 2000) {
        deviceCache.savePosition(officeState?.officeId, localUserId, localPos.current);
        lastSaveTime.current = saveNow;
      }
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
// 1. RECEPTION AREA (Welcome Desk, Sign-in iPad, Guest Lounge, Brand Wall)
// -------------------------------------------------------------
function drawReceptionZone(ctx, x, y, w, h, isDark = true) {
  ctx.save();

  // Floor Base (Polished Lobby Marble/Terrazzo)
  const floorGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  if (isDark) {
    floorGrad.addColorStop(0, 'rgba(19, 29, 26, 0.55)');
    floorGrad.addColorStop(1, 'rgba(12, 20, 18, 0.55)');
  } else {
    floorGrad.addColorStop(0, 'rgba(240, 253, 244, 0.9)');
    floorGrad.addColorStop(1, 'rgba(230, 248, 237, 0.9)');
  }
  ctx.fillStyle = floorGrad;
  roundedRect(ctx, x, y, w, h, 14);
  ctx.fill();

  // Polished Tile Grid Lines
  ctx.strokeStyle = isDark ? 'rgba(16, 185, 129, 0.06)' : 'rgba(16, 185, 129, 0.08)';
  ctx.lineWidth = 1;
  for (let px = x + 30; px < x + w - 10; px += 35) {
    ctx.beginPath();
    ctx.moveTo(px, y + 4);
    ctx.lineTo(px, y + h - 4);
    ctx.stroke();
  }

  // Zone Boundary & Corners
  ctx.strokeStyle = isDark ? 'rgba(16, 185, 129, 0.35)' : 'rgba(16, 185, 129, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  roundedRect(ctx, x, y, w, h, 14);
  ctx.stroke();
  ctx.setLineDash([]);

  // Company Brand Wall Sign along Top
  drawBrandLogoWall(ctx, x + w / 2 - 55, y + 10, 110, 16, isDark);

  // Modern Curved Reception Counter & Desk
  drawReceptionDesk(ctx, x + 55, y + 62, 140, 48, isDark);

  // Visitor Lounge Area (Welcome Rug, Sofa, Glass Table)
  drawVisitorLounge(ctx, x + 40, y + 148, isDark);

  // Executive Floor Plants
  drawPlant(ctx, x + w - 24, y + 36, isDark);
  drawMonsteraPlant(ctx, x + 24, y + h - 26, isDark);

  // Zone Label Badge
  drawZoneBadge(ctx, x + 14, y + 20, '🛎️ RECEPTION', 'Welcome Lobby · Open Audio', isDark ? '#10B981' : '#059669', isDark);

  ctx.restore();
}

function drawBrandLogoWall(ctx, x, y, w, h, isDark) {
  ctx.save();
  ctx.fillStyle = isDark ? 'rgba(16, 185, 129, 0.12)' : 'rgba(16, 185, 129, 0.15)';
  ctx.strokeStyle = isDark ? 'rgba(16, 185, 129, 0.4)' : '#10B981';
  ctx.lineWidth = 1;
  roundedRect(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.stroke();

  // Glowing status pip & Brand name
  ctx.fillStyle = isDark ? '#00F59B' : '#059669';
  ctx.beginPath();
  ctx.arc(x + 12, y + h / 2, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = isDark ? '#F9FAFB' : '#111827';
  ctx.font = '700 8.5px "Manrope", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('PROXISPEAK HQ', x + 20, y + h / 2);
  ctx.restore();
}

function drawReceptionDesk(ctx, x, y, w, h, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.12)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;

  // Outer curved front counter
  ctx.fillStyle = isDark ? '#182420' : '#D1E7DD';
  roundedRect(ctx, x, y, w, h, 10);
  ctx.fill();

  // Front glowing LED accent bar
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = isDark ? 'rgba(0, 245, 155, 0.75)' : 'rgba(16, 185, 129, 0.75)';
  ctx.fillRect(x + 15, y + h - 3, w - 30, 2);

  // Inner counter desk surface
  ctx.fillStyle = isDark ? '#111A17' : '#E8F5EE';
  roundedRect(ctx, x + 6, y + 6, w - 12, h - 14, 6);
  ctx.fill();

  // Receptionist iMac Screen
  ctx.fillStyle = isDark ? '#334155' : '#94A3B8';
  roundedRect(ctx, x + 35, y + 10, 28, 12, 2);
  ctx.fill();
  ctx.fillStyle = '#38BDF8';
  ctx.fillRect(x + 37, y + 12, 24, 8);

  // Keyboard
  ctx.fillStyle = isDark ? '#475569' : '#CBD5E1';
  roundedRect(ctx, x + 37, y + 26, 24, 5, 1);
  ctx.fill();

  // Visitor Check-in iPad on Stand
  ctx.fillStyle = '#10B981';
  roundedRect(ctx, x + 90, y + 14, 16, 18, 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x + 92, y + 16, 12, 14);
  // iPad micro checkmark
  ctx.strokeStyle = '#10B981';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x + 95, y + 23);
  ctx.lineTo(x + 97, y + 26);
  ctx.lineTo(x + 102, y + 19);
  ctx.stroke();

  // Receptionist Mesh Chair behind desk
  drawMeshChair(ctx, x + 49, y - 8, isDark);

  ctx.restore();
}

function drawVisitorLounge(ctx, x, y, isDark) {
  ctx.save();
  // Welcome Area Rug
  ctx.fillStyle = isDark ? 'rgba(16, 185, 129, 0.08)' : 'rgba(16, 185, 129, 0.12)';
  ctx.strokeStyle = isDark ? 'rgba(16, 185, 129, 0.2)' : 'rgba(16, 185, 129, 0.25)';
  ctx.lineWidth = 1;
  roundedRect(ctx, x, y, 175, 52, 10);
  ctx.fill();
  ctx.stroke();

  // 2-Seater Waiting Sofa
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.1)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = isDark ? '#1F382E' : '#B4D8C4';
  roundedRect(ctx, x + 15, y + 10, 75, 32, 6);
  ctx.fill();

  // Cushions
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = isDark ? '#2D4E41' : '#CAE4D5';
  roundedRect(ctx, x + 19, y + 14, 31, 24, 4);
  roundedRect(ctx, x + 53, y + 14, 31, 24, 4);
  ctx.fill();

  // Coffee Table with Magazine
  ctx.fillStyle = isDark ? '#26332E' : '#E2E8F0';
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.15)' : '#CBD5E1';
  ctx.lineWidth = 1;
  roundedRect(ctx, x + 110, y + 16, 45, 22, 4);
  ctx.fill();
  ctx.stroke();

  // Magazine & Brochure
  ctx.fillStyle = '#00F59B';
  roundedRect(ctx, x + 116, y + 20, 14, 14, 1);
  ctx.fill();
  ctx.fillStyle = '#38BDF8';
  roundedRect(ctx, x + 134, y + 22, 15, 10, 1);
  ctx.fill();

  ctx.restore();
}

// -------------------------------------------------------------
// 2. MEETING ROOM (Executive Boardroom Table, 8 Chairs, 85" Smart Screen)
// -------------------------------------------------------------
function drawMeetingZone(ctx, x, y, w, h, isDark = true) {
  ctx.save();

  // Floor Base (Acoustic Sound-Dampening Carpet)
  const floorGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  if (isDark) {
    floorGrad.addColorStop(0, 'rgba(15, 23, 42, 0.6)');
    floorGrad.addColorStop(1, 'rgba(10, 18, 34, 0.6)');
  } else {
    floorGrad.addColorStop(0, 'rgba(239, 246, 255, 0.92)');
    floorGrad.addColorStop(1, 'rgba(224, 238, 254, 0.92)');
  }
  ctx.fillStyle = floorGrad;
  roundedRect(ctx, x, y, w, h, 14);
  ctx.fill();

  // Acoustic Herringbone / Carpet Pattern
  ctx.strokeStyle = isDark ? 'rgba(59, 130, 246, 0.05)' : 'rgba(59, 130, 246, 0.08)';
  ctx.lineWidth = 1;
  for (let px = x + 25; px < x + w - 10; px += 35) {
    ctx.beginPath();
    ctx.moveTo(px, y + 4);
    ctx.lineTo(px, y + h - 4);
    ctx.stroke();
  }

  // Zone Boundary & Corners
  ctx.strokeStyle = isDark ? 'rgba(59, 130, 246, 0.35)' : 'rgba(59, 130, 246, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  roundedRect(ctx, x, y, w, h, 14);
  ctx.stroke();
  ctx.setLineDash([]);

  // 85" Wall-Mounted Smart Presentation Screen & 4K Video Bar
  drawSmartPresentationScreen(ctx, x + w / 2 - 80, y + 10, 160, 20, isDark);

  // Grand Boardroom Conference Table with 8 Executive Chairs
  drawConferenceTable(ctx, x + w / 2, y + 125, 210, 78, isDark);

  // Side Refreshment Credenza (Water Carafe & Glasses)
  drawWaterCredenza(ctx, x + 16, y + 90, 16, 55, isDark);

  // Plants
  drawMonsteraPlant(ctx, x + w - 24, y + 36, isDark);
  drawPlant(ctx, x + 24, y + 36, isDark);

  // Zone Label Badge
  drawZoneBadge(ctx, x + 14, y + 20, '👥 MEETING ROOM', 'Conference Suite · 0.20x Silent', isDark ? '#3B82F6' : '#2563EB', isDark);

  ctx.restore();
}

function drawSmartPresentationScreen(ctx, x, y, w, h, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.15)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;

  // Ultra-slim display bezel
  ctx.fillStyle = isDark ? '#090D16' : '#1E293B';
  roundedRect(ctx, x, y, w, h, 4);
  ctx.fill();

  // Active Presentation Display
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = isDark ? '#0F172A' : '#F8FAFC';
  roundedRect(ctx, x + 3, y + 2, w - 6, h - 4, 2);
  ctx.fill();

  // Presentation Graphic: Mini Bar Chart & Roadmap line
  ctx.fillStyle = '#38BDF8';
  ctx.fillRect(x + 12, y + 10, 6, 6);
  ctx.fillRect(x + 22, y + 7, 6, 9);
  ctx.fillStyle = '#10B981';
  ctx.fillRect(x + 32, y + 5, 6, 11);
  ctx.fillRect(x + 42, y + 8, 6, 8);

  ctx.fillStyle = isDark ? '#E2E8F0' : '#0F172A';
  ctx.font = '700 7.5px "Manrope", sans-serif';
  ctx.fillText('Q4 SYNC & OKRs', x + 56, y + 11);

  // Presentation Progress Line
  ctx.strokeStyle = '#F59E0B';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 125, y + 12);
  ctx.lineTo(x + 145, y + 7);
  ctx.lineTo(x + 152, y + 10);
  ctx.stroke();

  // Video Conference Soundbar directly beneath screen
  ctx.fillStyle = isDark ? '#1E293B' : '#475569';
  roundedRect(ctx, x + w / 2 - 25, y + h + 2, 50, 4, 2);
  ctx.fill();
  // Camera active green LED
  ctx.fillStyle = '#22C55E';
  ctx.beginPath();
  ctx.arc(x + w / 2, y + h + 4, 1.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawConferenceTable(ctx, cx, cy, w, h, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.65)' : 'rgba(0, 0, 0, 0.15)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;

  // Solid Walnut / Executive Slate Table Top
  ctx.fillStyle = isDark ? '#1E2536' : '#DCE5F2';
  roundedRect(ctx, cx - w / 2, cy - h / 2, w, h, 18);
  ctx.fill();

  // Beveled Edge Rim
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = isDark ? '#2D3A50' : '#CBD5E1';
  ctx.lineWidth = 1.5;
  roundedRect(ctx, cx - w / 2, cy - h / 2, w, h, 18);
  ctx.stroke();

  // Center Connectivity Inset Trough
  ctx.fillStyle = isDark ? '#131926' : '#B8C7DB';
  roundedRect(ctx, cx - w / 3, cy - 8, (w * 2) / 3, 16, 4);
  ctx.fill();

  // 360° Wireless Conference Speakerphone Puck (Polycom/Jabra)
  ctx.fillStyle = isDark ? '#0F172A' : '#1E293B';
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#38BDF8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
  ctx.stroke();

  // Laptops on Table
  const laptopPositions = [
    { x: cx - 65, y: cy - 16, angle: 0 },
    { x: cx + 45, y: cy - 16, angle: 0 },
    { x: cx - 45, y: cy + 12, angle: Math.PI },
    { x: cx + 65, y: cy + 12, angle: Math.PI },
  ];
  laptopPositions.forEach((lp) => {
    ctx.fillStyle = isDark ? '#334155' : '#94A3B8';
    roundedRect(ctx, lp.x - 7, lp.y - 4, 14, 8, 1.5);
    ctx.fill();
    ctx.fillStyle = '#38BDF8';
    ctx.fillRect(lp.x - 5, lp.y - 2, 10, 4);
  });

  // 8 Executive Conference Chairs
  // 3 along top edge
  drawConferenceChair(ctx, cx - 60, cy - h / 2 - 10, 'down', isDark);
  drawConferenceChair(ctx, cx, cy - h / 2 - 10, 'down', isDark);
  drawConferenceChair(ctx, cx + 60, cy - h / 2 - 10, 'down', isDark);

  // 3 along bottom edge
  drawConferenceChair(ctx, cx - 60, cy + h / 2 + 10, 'up', isDark);
  drawConferenceChair(ctx, cx, cy + h / 2 + 10, 'up', isDark);
  drawConferenceChair(ctx, cx + 60, cy + h / 2 + 10, 'up', isDark);

  // 1 at left head
  drawConferenceChair(ctx, cx - w / 2 - 10, cy, 'right', isDark);

  // 1 at right foot
  drawConferenceChair(ctx, cx + w / 2 + 10, cy, 'left', isDark);

  ctx.restore();
}

function drawConferenceChair(ctx, x, y, direction, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(0, 0, 0, 0.08)';
  ctx.shadowBlur = 6;

  ctx.fillStyle = isDark ? '#232D3F' : '#94A3B8';
  // Seat cushion
  roundedRect(ctx, x - 8, y - 7, 16, 14, 3);
  ctx.fill();

  // Backrest according to direction
  ctx.fillStyle = isDark ? '#384860' : '#64748B';
  if (direction === 'down') {
    roundedRect(ctx, x - 8, y - 10, 16, 3.5, 1.5);
  } else if (direction === 'up') {
    roundedRect(ctx, x - 8, y + 6.5, 16, 3.5, 1.5);
  } else if (direction === 'right') {
    roundedRect(ctx, x - 10, y - 7, 3.5, 14, 1.5);
  } else {
    roundedRect(ctx, x + 6.5, y - 7, 3.5, 14, 1.5);
  }
  ctx.fill();

  ctx.restore();
}

function drawWaterCredenza(ctx, x, y, w, h, isDark) {
  ctx.save();
  ctx.fillStyle = isDark ? '#18202C' : '#E2E8F0';
  roundedRect(ctx, x, y, w, h, 4);
  ctx.fill();

  // Glass Water Carafe
  ctx.fillStyle = '#38BDF8';
  ctx.beginPath();
  ctx.arc(x + w / 2, y + 16, 4.5, 0, Math.PI * 2);
  ctx.fill();

  // Drinking tumblers
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.beginPath();
  ctx.arc(x + w / 2, y + 32, 2.5, 0, Math.PI * 2);
  ctx.arc(x + w / 2, y + 42, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// -------------------------------------------------------------
// 3. MANAGER CABIN (Executive L-Desk, High-Back Chair, Trophy Bookshelf)
// -------------------------------------------------------------
function drawManagerZone(ctx, x, y, w, h, isDark = true) {
  ctx.save();

  // Floor Base (Executive Dark Parquet / Charcoal Weave)
  const floorGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  if (isDark) {
    floorGrad.addColorStop(0, 'rgba(24, 18, 35, 0.55)');
    floorGrad.addColorStop(1, 'rgba(15, 12, 24, 0.55)');
  } else {
    floorGrad.addColorStop(0, 'rgba(248, 245, 255, 0.92)');
    floorGrad.addColorStop(1, 'rgba(240, 235, 252, 0.92)');
  }
  ctx.fillStyle = floorGrad;
  roundedRect(ctx, x, y, w, h, 14);
  ctx.fill();

  // Parquet Floor Planks Texture
  ctx.strokeStyle = isDark ? 'rgba(139, 92, 246, 0.05)' : 'rgba(139, 92, 246, 0.08)';
  ctx.lineWidth = 1;
  for (let px = x + 30; px < x + w - 10; px += 35) {
    ctx.beginPath();
    ctx.moveTo(px, y + 4);
    ctx.lineTo(px, y + h - 4);
    ctx.stroke();
  }

  // Zone Boundary & Corners
  ctx.strokeStyle = isDark ? 'rgba(139, 92, 246, 0.35)' : 'rgba(139, 92, 246, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  roundedRect(ctx, x, y, w, h, 14);
  ctx.stroke();
  ctx.setLineDash([]);

  // Executive Designer Area Rug
  ctx.save();
  ctx.fillStyle = isDark ? 'rgba(139, 92, 246, 0.08)' : 'rgba(139, 92, 246, 0.12)';
  ctx.strokeStyle = isDark ? 'rgba(139, 92, 246, 0.22)' : 'rgba(139, 92, 246, 0.3)';
  ctx.lineWidth = 1;
  roundedRect(ctx, x + 30, y + 55, w - 60, h - 75, 12);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Executive L-Desk & Leather Chairs
  drawManagerDesk(ctx, x + 50, y + 70, isDark);

  // Executive Bookshelf along Right Wall
  drawExecutiveBookshelf(ctx, x + w - 22, y + 50, 14, h - 80, isDark);

  // Floor Standing Brass Lamp
  drawStandingLamp(ctx, x + 30, y + h - 35, isDark);

  // Potted Ficus Plant
  drawPlant(ctx, x + w - 24, y + 36, isDark);

  // Zone Label Badge
  drawZoneBadge(ctx, x + 14, y + 20, '💼 MANAGER CABIN', 'Executive Suite · 0.15x Silent', isDark ? '#8B5CF6' : '#7C3AED', isDark);

  ctx.restore();
}

function drawManagerDesk(ctx, x, y, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.65)' : 'rgba(0, 0, 0, 0.15)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;

  // Solid Walnut Executive Desk
  ctx.fillStyle = isDark ? '#231B32' : '#DBCFEF';
  roundedRect(ctx, x, y, 125, 46, 8);
  ctx.fill();

  // L-Extension Return Credenza
  ctx.fillStyle = isDark ? '#1C1528' : '#D1C2E8';
  roundedRect(ctx, x + 90, y + 40, 35, 40, 6);
  ctx.fill();

  ctx.shadowColor = 'transparent';

  // Ultra-wide Curved Executive Display
  ctx.fillStyle = isDark ? '#0F172A' : '#1E293B';
  roundedRect(ctx, x + 25, y + 8, 48, 12, 2);
  ctx.fill();
  ctx.fillStyle = '#A78BFA';
  ctx.fillRect(x + 28, y + 10, 42, 8);

  // Slim Laptop on the side
  ctx.fillStyle = isDark ? '#334155' : '#94A3B8';
  roundedRect(ctx, x + 82, y + 10, 18, 12, 1.5);
  ctx.fill();

  // Brass Desk Nameplate ("MANAGER")
  ctx.fillStyle = '#F59E0B';
  roundedRect(ctx, x + 40, y + 26, 24, 6, 1);
  ctx.fill();
  ctx.fillStyle = '#000000';
  ctx.font = '700 4.5px "JetBrains Mono", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('MANAGER', x + 52, y + 30.5);

  // Warm Brass Desk Lamp (casts warm light cone)
  ctx.fillStyle = '#D97706';
  ctx.beginPath();
  ctx.arc(x + 14, y + 15, 4, 0, Math.PI * 2);
  ctx.fill();

  // High-Back Executive Leather Chair (Behind Desk)
  drawExecutiveLeatherChair(ctx, x + 50, y - 8, isDark);

  // Two Visitor Consultation Armchairs (Facing Desk)
  drawArmchair(ctx, x + 35, y + 68, isDark ? '#2E1F42' : '#C7B6E4', isDark);
  drawArmchair(ctx, x + 85, y + 68, isDark ? '#2E1F42' : '#C7B6E4', isDark);

  ctx.restore();
}

function drawExecutiveLeatherChair(ctx, x, y, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.12)';
  ctx.shadowBlur = 8;

  // Leather seat
  ctx.fillStyle = isDark ? '#35214D' : '#8B5CF6';
  roundedRect(ctx, x - 12, y - 10, 24, 20, 5);
  ctx.fill();

  // Padded High-Backrest & Headrest
  ctx.fillStyle = isDark ? '#472B68' : '#7C3AED';
  roundedRect(ctx, x - 11, y - 16, 22, 6, 3);
  ctx.fill();

  // Leather Armrests
  ctx.fillStyle = isDark ? '#5B3785' : '#6D28D9';
  roundedRect(ctx, x - 15, y - 8, 3, 16, 1.5);
  roundedRect(ctx, x + 12, y - 8, 3, 16, 1.5);
  ctx.fill();

  ctx.restore();
}

function drawExecutiveBookshelf(ctx, x, y, w, h, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.1)';
  ctx.shadowBlur = 6;

  ctx.fillStyle = isDark ? '#1C1528' : '#7C3AED';
  roundedRect(ctx, x, y, w, h, 3);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  const shelfCount = 4;
  const shelfH = (h - 8) / shelfCount;
  const bookColors = ['#8B5CF6', '#F59E0B', '#3B82F6', '#10B981', '#EC4899'];

  for (let s = 0; s < shelfCount; s++) {
    const sy = y + 4 + s * shelfH;
    ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(x + 1, sy + shelfH - 2, w - 2, 2);

    if (s === 1) {
      // Golden Excellence Trophy on Shelf 2
      ctx.fillStyle = '#F59E0B';
      ctx.beginPath();
      ctx.arc(x + w / 2, sy + shelfH / 2, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Books
      for (let b = 0; b < 4; b++) {
        ctx.fillStyle = bookColors[(s * 4 + b) % bookColors.length];
        ctx.fillRect(x + 2, sy + 2 + b * 5, w - 4, 3.5);
      }
    }
  }
  ctx.restore();
}

// -------------------------------------------------------------
// 4. HR CABIN (Interview Consultation Desk, Security File Cabinets)
// -------------------------------------------------------------
function drawHRZone(ctx, x, y, w, h, isDark = true) {
  ctx.save();

  // Floor Base (Calm Acoustic Sage / Rose Warm Wood)
  const floorGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  if (isDark) {
    floorGrad.addColorStop(0, 'rgba(32, 17, 28, 0.55)');
    floorGrad.addColorStop(1, 'rgba(20, 11, 18, 0.55)');
  } else {
    floorGrad.addColorStop(0, 'rgba(253, 242, 248, 0.92)');
    floorGrad.addColorStop(1, 'rgba(249, 230, 242, 0.92)');
  }
  ctx.fillStyle = floorGrad;
  roundedRect(ctx, x, y, w, h, 14);
  ctx.fill();

  // Slat Floor Pattern
  ctx.strokeStyle = isDark ? 'rgba(236, 72, 153, 0.05)' : 'rgba(236, 72, 153, 0.08)';
  ctx.lineWidth = 1;
  for (let px = x + 30; px < x + w - 10; px += 35) {
    ctx.beginPath();
    ctx.moveTo(px, y + 4);
    ctx.lineTo(px, y + h - 4);
    ctx.stroke();
  }

  // Zone Boundary & Corners
  ctx.strokeStyle = isDark ? 'rgba(236, 72, 153, 0.35)' : 'rgba(236, 72, 153, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  roundedRect(ctx, x, y, w, h, 14);
  ctx.stroke();
  ctx.setLineDash([]);

  // Acoustic Culture Pinboard on Top Wall
  drawHRPinboard(ctx, x + 85, y + 10, 110, 14, isDark);

  // Secure Steel Filing Cabinets (Confidential Employee Records)
  drawFilingCabinets(ctx, x + 16, y + 70, 24, 75, isDark);

  // HR Interview Consultation Desk & Chairs
  drawHRDesk(ctx, x + 65, y + 75, isDark);

  // Peace Lily Floor Plant
  drawPlant(ctx, x + w - 24, y + 36, isDark);

  // Zone Label Badge
  drawZoneBadge(ctx, x + 14, y + 20, '📋 HR CABIN', 'Interviews & Private · 0.20x Silent', isDark ? '#EC4899' : '#DB2777', isDark);

  ctx.restore();
}

function drawHRPinboard(ctx, x, y, w, h, isDark) {
  ctx.save();
  ctx.fillStyle = isDark ? 'rgba(236, 72, 153, 0.1)' : 'rgba(236, 72, 153, 0.15)';
  ctx.strokeStyle = isDark ? 'rgba(236, 72, 153, 0.35)' : '#EC4899';
  ctx.lineWidth = 1;
  roundedRect(ctx, x, y, w, h, 3);
  ctx.fill();
  ctx.stroke();

  // Pinboard sticky notes (culture, values, benefits)
  const pinColors = ['#F472B6', '#38BDF8', '#FBBF24', '#34D399'];
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = pinColors[i % pinColors.length];
    roundedRect(ctx, x + 10 + i * 20, y + 2.5, 9, 8, 1);
    ctx.fill();
  }
  ctx.restore();
}

function drawFilingCabinets(ctx, x, y, w, h, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.1)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;

  // Metal cabinet frame
  ctx.fillStyle = isDark ? '#1F2937' : '#94A3B8';
  roundedRect(ctx, x, y, w, h, 4);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  // 4 File Drawers
  const drawerH = (h - 10) / 4;
  for (let d = 0; d < 4; d++) {
    const dy = y + 2 + d * (drawerH + 2);
    ctx.fillStyle = isDark ? '#374151' : '#CBD5E1';
    roundedRect(ctx, x + 2, dy, w - 4, drawerH, 2);
    ctx.fill();

    // Pull handle & key lock
    ctx.fillStyle = isDark ? '#9CA3AF' : '#475569';
    roundedRect(ctx, x + w / 2 - 4, dy + drawerH / 2 - 1, 8, 2, 1);
    ctx.fill();
  }

  ctx.restore();
}

function drawHRDesk(ctx, x, y, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.12)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;

  // Oak Interview Desk
  ctx.fillStyle = isDark ? '#2D1B28' : '#F2D7E6';
  roundedRect(ctx, x, y, 115, 44, 8);
  ctx.fill();

  ctx.shadowColor = 'transparent';

  // Confidential candidate interview folder / clipboard
  ctx.fillStyle = '#F59E0B';
  roundedRect(ctx, x + 22, y + 10, 16, 20, 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x + 25, y + 13, 10, 14);
  // Pen
  ctx.fillStyle = '#3B82F6';
  ctx.fillRect(x + 39, y + 12, 1.5, 14);

  // HR Laptop
  ctx.fillStyle = isDark ? '#334155' : '#94A3B8';
  roundedRect(ctx, x + 55, y + 10, 24, 14, 2);
  ctx.fill();
  ctx.fillStyle = '#F472B6';
  ctx.fillRect(x + 58, y + 12, 18, 10);

  // Warm Desk Lamp
  ctx.fillStyle = '#FBBF24';
  ctx.beginPath();
  ctx.arc(x + 95, y + 18, 4, 0, Math.PI * 2);
  ctx.fill();

  // HR Director Mesh Chair (Behind Desk)
  drawMeshChair(ctx, x + 65, y - 8, isDark);

  // Two Candidate / Employee Consultation Chairs (Facing Desk)
  drawArmchair(ctx, x + 35, y + 66, isDark ? '#3B1E32' : '#E8B6D5', isDark);
  drawArmchair(ctx, x + 85, y + 66, isDark ? '#3B1E32' : '#E8B6D5', isDark);

  ctx.restore();
}

// -------------------------------------------------------------
// 5. WORKSTATIONS (Open Collaborative Floor, Dual Display Pods)
// -------------------------------------------------------------
function drawWorkstationsZone(ctx, x, y, w, h, isDark = true) {
  ctx.save();

  // Floor Base (Tech Matrix Carbon Slate)
  const floorGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  if (isDark) {
    floorGrad.addColorStop(0, 'rgba(14, 23, 33, 0.5)');
    floorGrad.addColorStop(1, 'rgba(10, 17, 26, 0.5)');
  } else {
    floorGrad.addColorStop(0, 'rgba(240, 247, 255, 0.92)');
    floorGrad.addColorStop(1, 'rgba(235, 243, 252, 0.92)');
  }
  ctx.fillStyle = floorGrad;
  roundedRect(ctx, x, y, w, h, 14);
  ctx.fill();

  // Grid Seams
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
  drawCollaborationWhiteboard(ctx, x + 60, y + 12, 170, 10, isDark);

  // 6 Workstation Pods with Dual Curved Displays
  drawWorkstationPod(ctx, x + 35, y + 42, 125, isDark);
  drawWorkstationPod(ctx, x + 190, y + 42, 125, isDark);
  drawWorkstationPod(ctx, x + 35, y + 155, 125, isDark);
  drawWorkstationPod(ctx, x + 190, y + 155, 125, isDark);
  drawWorkstationPod(ctx, x + 35, y + 268, 125, isDark);
  drawWorkstationPod(ctx, x + 190, y + 268, 125, isDark);

  // Lush Corner Greenery
  drawMonsteraPlant(ctx, x + 24, y + h - 26, isDark);
  drawMonsteraPlant(ctx, x + w - 24, y + h - 26, isDark);

  // Zone Label Badge
  drawZoneBadge(ctx, x + 14, y + 20, '💻 WORKSTATIONS', 'Open Floor · Collaborative Audio', isDark ? '#00D2FF' : '#0284C7', isDark);

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

  // Sticky notes (yellow, cyan, pink, green)
  const stickyColors = ['#FBBF24', '#38BDF8', '#F472B6', '#34D399'];
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = stickyColors[i % stickyColors.length];
    roundedRect(ctx, x + 15 + i * 24, y + 2, 8, 6, 1);
    ctx.fill();
  }
  ctx.restore();
}

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
// 6. LUNCH ROOM / CAFETERIA (Kitchenette Bar, Espresso, Dining Tables)
// -------------------------------------------------------------
function drawLunchZone(ctx, x, y, w, h, isDark = true) {
  ctx.save();

  // Floor Base (Bistro Café Terracotta / Amber Slate Tiles)
  const floorGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  if (isDark) {
    floorGrad.addColorStop(0, 'rgba(30, 22, 15, 0.55)');
    floorGrad.addColorStop(1, 'rgba(20, 15, 10, 0.55)');
  } else {
    floorGrad.addColorStop(0, 'rgba(254, 249, 238, 0.92)');
    floorGrad.addColorStop(1, 'rgba(250, 240, 222, 0.92)');
  }
  ctx.fillStyle = floorGrad;
  roundedRect(ctx, x, y, w, h, 14);
  ctx.fill();

  // Bistro Floor Tile Grid
  ctx.strokeStyle = isDark ? 'rgba(245, 158, 11, 0.06)' : 'rgba(217, 119, 6, 0.08)';
  ctx.lineWidth = 1;
  for (let px = x + 25; px < x + w - 10; px += 35) {
    ctx.beginPath();
    ctx.moveTo(px, y + 4);
    ctx.lineTo(px, y + h - 4);
    ctx.stroke();
  }

  // Zone Boundary & Corners
  ctx.strokeStyle = isDark ? 'rgba(245, 158, 11, 0.35)' : 'rgba(217, 119, 6, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  roundedRect(ctx, x, y, w, h, 14);
  ctx.stroke();
  ctx.setLineDash([]);

  // Kitchenette Counter (Espresso Machine, Microwave, Sink, Beverage Fridge)
  drawCafeteriaKitchen(ctx, x + 20, y + 55, w - 40, 38, isDark);

  // Two Round Café Dining Tables with Stools
  drawCafeDiningTable(ctx, x + 70, y + 145, isDark);
  drawCafeDiningTable(ctx, x + 185, y + 145, isDark);

  // Modern Water Cooler Dispenser
  drawWaterCooler(ctx, x + w - 28, y + 115, isDark);

  // Plant
  drawPlant(ctx, x + 24, y + h - 26, isDark);

  // Zone Label Badge
  drawZoneBadge(ctx, x + 14, y + 20, '☕ LUNCH ROOM', 'Cafeteria & Lounge · Open Audio', isDark ? '#F59E0B' : '#D97706', isDark);

  ctx.restore();
}

function drawCafeteriaKitchen(ctx, x, y, w, h, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.12)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;

  // Solid Quartz / Granite Countertop
  ctx.fillStyle = isDark ? '#261C14' : '#E8DDD0';
  roundedRect(ctx, x, y, w, h, 6);
  ctx.fill();

  ctx.shadowColor = 'transparent';

  // Beverage Refrigerator with Glass Front (Left side)
  ctx.fillStyle = isDark ? '#111827' : '#334155';
  roundedRect(ctx, x + 10, y + 6, 26, 26, 3);
  ctx.fill();
  // Glass glow with soda cans inside
  ctx.fillStyle = isDark ? 'rgba(56, 189, 248, 0.3)' : 'rgba(56, 189, 248, 0.5)';
  roundedRect(ctx, x + 12, y + 8, 22, 22, 2);
  ctx.fill();
  // Cold drink cans (red, green, blue)
  ctx.fillStyle = '#EF4444'; ctx.fillRect(x + 14, y + 12, 4, 6);
  ctx.fillStyle = '#10B981'; ctx.fillRect(x + 20, y + 12, 4, 6);
  ctx.fillStyle = '#3B82F6'; ctx.fillRect(x + 26, y + 12, 4, 6);

  // Italian Espresso Machine (Middle)
  ctx.fillStyle = isDark ? '#475569' : '#94A3B8';
  roundedRect(ctx, x + 55, y + 8, 30, 22, 3);
  ctx.fill();
  // Portafilter & cup
  ctx.fillStyle = '#F59E0B';
  ctx.fillRect(x + 62, y + 22, 6, 4);
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(x + 75, y + 23, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Stainless Sink with Faucet (Right)
  ctx.fillStyle = isDark ? '#1E293B' : '#CBD5E1';
  roundedRect(ctx, x + 105, y + 10, 24, 18, 3);
  ctx.fill();
  // Chrome Gooseneck Faucet
  ctx.strokeStyle = '#94A3B8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + 117, y + 8);
  ctx.lineTo(x + 117, y + 14);
  ctx.stroke();

  // Digital Microwave Oven
  ctx.fillStyle = isDark ? '#1E293B' : '#64748B';
  roundedRect(ctx, x + 145, y + 8, 28, 22, 2);
  ctx.fill();
  // Microwave screen with green clock
  ctx.fillStyle = '#22C55E';
  ctx.fillRect(x + 163, y + 11, 7, 3);

  // Fresh Fruit Bowl (Apples & Oranges)
  ctx.fillStyle = '#F97316';
  ctx.beginPath();
  ctx.arc(x + 190, y + 20, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#EF4444';
  ctx.beginPath();
  ctx.arc(x + 196, y + 19, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawCafeDiningTable(ctx, cx, cy, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(0, 0, 0, 0.08)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;

  // Round Wooden Café Table
  ctx.fillStyle = isDark ? '#3D2A1D' : '#EAD5C3';
  ctx.strokeStyle = isDark ? '#F59E0B' : '#D97706';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Coffee cups on table
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(cx - 6, cy - 5, 3, 0, Math.PI * 2);
  ctx.arc(cx + 6, cy + 5, 3, 0, Math.PI * 2);
  ctx.fill();

  // 3 Café Stools around table
  const stoolAngles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
  stoolAngles.forEach((ang) => {
    const sx = cx + Math.cos(ang) * 30;
    const sy = cy + Math.sin(ang) * 30;
    ctx.fillStyle = isDark ? '#261A12' : '#C7A88E';
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isDark ? '#F59E0B' : '#B45309';
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

function drawWaterCooler(ctx, x, y, isDark) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(0, 0, 0, 0.08)';
  ctx.shadowBlur = 6;

  // Dispenser stand
  ctx.fillStyle = isDark ? '#1E293B' : '#F1F5F9';
  roundedRect(ctx, x - 7, y, 14, 24, 3);
  ctx.fill();

  // Inverted Blue 5-Gallon Water Bottle on Top
  ctx.fillStyle = '#38BDF8';
  roundedRect(ctx, x - 6, y - 16, 12, 16, 4);
  ctx.fill();

  // Hot & Cold spigots
  ctx.fillStyle = '#EF4444'; // Hot
  ctx.fillRect(x - 4, y + 6, 3, 3);
  ctx.fillStyle = '#3B82F6'; // Cold
  ctx.fillRect(x + 1, y + 6, 3, 3);

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
