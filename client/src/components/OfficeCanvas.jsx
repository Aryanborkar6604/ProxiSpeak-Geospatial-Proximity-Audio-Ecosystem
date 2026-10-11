import { useCallback, useEffect, useRef, useState } from 'react';

const THROTTLE_MS = 1000 / 15;
const AVATAR_COLORS = ['#bb806d', '#708b7c', '#95809a', '#ba9d66', '#70859e', '#bf8c77'];

function labelFor(index) { return `Teammate ${index + 1}`; }

export default function OfficeCanvas({
  socket,
  officeState,
  localUserId,
  onPeersChange,
  onPositionChange,
  nearbyPeers = {},
  speakingPeers = {},
  mutedPeers = {},
  isSpeaking = false,
  isMuted = false,
  peerAttenuations = {},
  isDarkMode = false,
}) {
  const canvasRef = useRef(null);
  const peersRef = useRef({});
  const localPos = useRef({ x: 175, y: 335 });
  const lastEmitTime = useRef(0);
  const [canvasSize, setCanvasSize] = useState({ width: officeState.width, height: officeState.height });

  const audioStateRef = useRef({ nearbyPeers, speakingPeers, mutedPeers, isSpeaking, isMuted, peerAttenuations, isDarkMode });
  audioStateRef.current = { nearbyPeers, speakingPeers, mutedPeers, isSpeaking, isMuted, peerAttenuations, isDarkMode };

  const onPeersChangeRef = useRef(onPeersChange);
  const onPositionChangeRef = useRef(onPositionChange);
  onPeersChangeRef.current = onPeersChange;
  onPositionChangeRef.current = onPositionChange;

  const updatePeers = useCallback((next) => {
    peersRef.current = next;
    onPeersChangeRef.current?.(next);
    onPositionChangeRef.current?.(localPos.current, next);
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    
    // Send our initial position so others see us immediately
    socket.emit('player:move', { x: localPos.current.x, y: localPos.current.y });

    // Load existing people only if there are new ones
    if (officeState?.users) {
      const current = peersRef.current;
      const initialPeers = { ...current };
      let hasChanges = false;
      officeState.users.forEach((u) => {
        if (u.userId !== localUserId && u.location) {
          if (!current[u.userId] || current[u.userId].x !== u.location[0] || current[u.userId].y !== u.location[1]) {
            initialPeers[u.userId] = { x: u.location[0], y: u.location[1] };
            hasChanges = true;
          }
        }
      });
      if (hasChanges) {
        updatePeers(initialPeers);
      }
    }

    const handlePlayerMoved = ({ userId, x, y }) => {
      if (userId === localUserId) return;
      updatePeers({ ...peersRef.current, [userId]: { x, y } });
    };
    
    const handlePlayerLeft = ({ userId }) => {
      const next = { ...peersRef.current };
      delete next[userId];
      updatePeers(next);
    };

    socket.on('player:moved', handlePlayerMoved);
    socket.on('player:left', handlePlayerLeft);
    return () => {
      socket.off('player:moved', handlePlayerMoved);
      socket.off('player:left', handlePlayerLeft);
    };
  }, [socket, localUserId, officeState?.officeId, updatePeers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let frame;
    let pixelRatio = window.devicePixelRatio || 1;
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
      const width = canvas.width / pixelRatio;
      const height = canvas.height / pixelRatio;
      const sx = width / officeState.width;
      const sy = height / officeState.height;
      const curAudio = audioStateRef.current;
      const dark = curAudio.isDarkMode;

      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = dark ? '#15161A' : '#f5f4f0';
      ctx.fillRect(0, 0, width, height);

      // Drafting grid
      ctx.save();
      ctx.scale(sx, sy);
      ctx.strokeStyle = dark ? 'rgba(255, 255, 255, 0.035)' : 'rgba(67, 77, 70, 0.045)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= officeState.width; x += 32) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, officeState.height); ctx.stroke();
      }
      for (let y = 0; y <= officeState.height; y += 32) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(officeState.width, y); ctx.stroke();
      }

      // Soft ambient light
      const glow = ctx.createRadialGradient(220, 350, 24, 220, 350, 300);
      glow.addColorStop(0, dark ? 'rgba(47, 211, 139, 0.06)' : 'rgba(96, 157, 132, 0.10)');
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, officeState.width, officeState.height);

      // Work areas and furniture
      drawZone(ctx, 73, 87, 252, 172, 'THE LIBRARY', 'soft', dark);
      drawZone(ctx, 389, 82, 337, 242, 'STUDIO', 'green', dark);
      drawZone(ctx, 710, 392, 226, 186, 'LOUNGE', 'sand', dark);
      drawSofa(ctx, 98, 119, dark);
      drawDesk(ctx, 430, 127, 122, dark);
      drawDesk(ctx, 585, 127, 108, dark);
      drawDesk(ctx, 430, 215, 122, dark);
      drawDesk(ctx, 585, 215, 108, dark);
      drawPlant(ctx, 357, 130);
      drawPlant(ctx, 751, 465);
      drawMeetingTable(ctx, 780, 155, dark);
      drawSmallTable(ctx, 143, 204, dark);

      // Phase 4: Render sound-blocking obstacles (walls) per design.md §3.3
      const obstacles = officeState?.obstacles || [];
      if (obstacles.length > 0) {
        ctx.save();
        ctx.lineCap = 'round';
        obstacles.forEach((obs) => {
          if (obs.x1 !== undefined && obs.y1 !== undefined && obs.x2 !== undefined && obs.y2 !== undefined) {
            // Drop shadow
            ctx.shadowColor = dark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(25, 30, 27, 0.15)';
            ctx.shadowBlur = 7;
            ctx.shadowOffsetY = 3;

            // Outer wall
            ctx.strokeStyle = dark ? '#8c959c' : '#3A3D42'; // --ps-wall
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(obs.x1, obs.y1);
            ctx.lineTo(obs.x2, obs.y2);
            ctx.stroke();

            // Inner core stroke
            ctx.shadowColor = 'transparent';
            ctx.strokeStyle = dark ? '#b5bec6' : '#575d65';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(obs.x1, obs.y1);
            ctx.lineTo(obs.x2, obs.y2);
            ctx.stroke();
          }
        });
        ctx.restore();
      }

      // Office boundaries
      ctx.strokeStyle = dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(81, 91, 83, 0.14)';
      ctx.lineWidth = 1.5;
      roundedRect(ctx, 14, 14, officeState.width - 28, officeState.height - 28, 15);
      ctx.stroke();

      const { x: localX, y: localY } = localPos.current;
      // Hearing radius with gentle breathing pulse
      const pulseRadius = 105 + Math.sin(Date.now() / 600) * 2;
      ctx.beginPath();
      ctx.arc(localX, localY, pulseRadius, 0, Math.PI * 2);
      ctx.fillStyle = dark ? 'rgba(47, 211, 139, 0.04)' : 'rgba(45, 127, 105, 0.035)';
      ctx.fill();
      ctx.setLineDash([4, 7]);
      ctx.strokeStyle = dark ? 'rgba(47, 211, 139, 0.28)' : 'rgba(45, 127, 105, 0.22)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);

      drawAvatar(ctx, localX, localY, '#286b5e', 'YOU', true, curAudio.isSpeaking, false, curAudio.isMuted, 1.0, dark);
      
      const getAvatarColor = (id) => {
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
          hash = id.charCodeAt(i) + ((hash << 5) - hash);
        }
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
      };

      Object.entries(peersRef.current).forEach(([peerId, point], index) => {
        const isPeerSpeaking = Boolean(curAudio.speakingPeers[peerId]);
        const isPeerNearby = Boolean(curAudio.nearbyPeers[peerId]);
        const isPeerMuted = Boolean(curAudio.mutedPeers[peerId]);
        const peerAtt = curAudio.peerAttenuations[peerId] ?? 1.0;
        drawAvatar(ctx, point.x, point.y, getAvatarColor(peerId), labelFor(index), false, isPeerSpeaking, isPeerNearby, isPeerMuted, peerAtt, dark);
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
      onPositionChange?.(localPos.current, peersRef.current);
      const now = Date.now();
      if (socket && now - lastEmitTime.current >= THROTTLE_MS) {
        socket.emit('player:move', { x: nextX, y: nextY });
        lastEmitTime.current = now;
      }
    };
    window.addEventListener('keydown', move);
    return () => window.removeEventListener('keydown', move);
  }, [socket, officeState, onPositionChange]);

  const handleCanvasClick = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * officeState.width;
    const y = (event.clientY - rect.top) / rect.height * officeState.height;
    localPos.current = { x, y };
    onPositionChange?.(localPos.current, peersRef.current);
    if (socket) socket.emit('player:move', { x, y });
    lastEmitTime.current = Date.now();
  };

  return <canvas ref={canvasRef} className="office-canvas" width={canvasSize.width} height={canvasSize.height} onClick={handleCanvasClick} aria-label="Office map. Use WASD or arrow keys to move your avatar." tabIndex={0} />;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}

function drawZone(ctx, x, y, w, h, label, tone, isDark = false) {
  ctx.save();
  const fill = tone === 'green'
    ? (isDark ? 'rgba(70, 123, 101, 0.08)' : 'rgba(70, 123, 101, 0.055)')
    : tone === 'sand'
    ? (isDark ? 'rgba(185, 154, 107, 0.09)' : 'rgba(185, 154, 107, 0.065)')
    : (isDark ? 'rgba(107, 118, 104, 0.05)' : 'rgba(107, 118, 104, 0.035)');
  ctx.fillStyle = fill;
  roundedRect(ctx, x, y, w, h, 13);
  ctx.fill();
  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = isDark ? 'rgba(130, 145, 135, 0.25)' : 'rgba(94, 105, 95, 0.19)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = isDark ? 'rgba(190, 205, 195, 0.65)' : 'rgba(68, 78, 71, 0.54)';
  ctx.font = '600 9px Inter, sans-serif';
  ctx.letterSpacing = '1.6px';
  ctx.fillText(label, x + 15, y + 20);
  ctx.restore();
}

function drawDesk(ctx, x, y, w, isDark = false) {
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(45, 53, 47, 0.06)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = isDark ? '#24272c' : '#dedbd3';
  roundedRect(ctx, x, y, w, 37, 7);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.68)';
  roundedRect(ctx, x + 8, y + 7, w - 16, 22, 4);
  ctx.fill();
  ctx.fillStyle = isDark ? '#383e44' : '#b5b8aa';
  roundedRect(ctx, x + w / 2 - 10, y + 12, 20, 11, 3);
  ctx.fill();
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(86, 94, 85, 0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 17, y + 38); ctx.lineTo(x + 17, y + 47);
  ctx.moveTo(x + w - 17, y + 38); ctx.lineTo(x + w - 17, y + 47);
  ctx.stroke();
  ctx.restore();
}

function drawSofa(ctx, x, y, isDark = false) {
  ctx.save();
  ctx.fillStyle = isDark ? '#26292e' : '#d6cdc1';
  roundedRect(ctx, x, y, 126, 42, 10);
  ctx.fill();
  ctx.fillStyle = isDark ? '#32373e' : '#eee9e1';
  roundedRect(ctx, x + 6, y + 6, 55, 30, 7);
  ctx.fill();
  roundedRect(ctx, x + 65, y + 6, 55, 30, 7);
  ctx.fill();
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(98, 89, 77, .12)';
  ctx.lineWidth = 1;
  roundedRect(ctx, x, y, 126, 42, 10);
  ctx.stroke();
  ctx.restore();
}

function drawSmallTable(ctx, x, y, isDark = false) {
  ctx.save();
  ctx.fillStyle = isDark ? '#2a2d32' : '#c9b99e';
  ctx.beginPath(); ctx.arc(x, y, 24, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = isDark ? '#35393f' : '#eee6d9';
  ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7c9b81';
  ctx.beginPath(); ctx.arc(x, y - 1, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawMeetingTable(ctx, x, y, isDark = false) {
  ctx.save();
  ctx.fillStyle = isDark ? '#282b30' : '#c8bda9';
  roundedRect(ctx, x, y, 103, 54, 23);
  ctx.fill();
  ctx.fillStyle = isDark ? '#363a40' : '#ded8c9';
  roundedRect(ctx, x + 4, y + 4, 95, 46, 20);
  ctx.fill();
  [[x + 20, y - 10], [x + 51, y - 12], [x + 82, y - 10], [x + 20, y + 64], [x + 51, y + 66], [x + 82, y + 64]].forEach(([cx, cy]) => {
    ctx.fillStyle = isDark ? '#42474f' : '#e4ded3';
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
  });
  ctx.restore();
}

function drawPlant(ctx, x, y) {
  ctx.save(); ctx.fillStyle = '#c8b99f'; roundedRect(ctx, x - 8, y + 10, 16, 14, 4); ctx.fill();
  ctx.strokeStyle = '#80967b'; ctx.lineWidth = 2;
  [[-8, -3], [-3, -11], [3, -8], [9, -3], [0, -16]].forEach(([dx, dy]) => { ctx.beginPath(); ctx.moveTo(x, y + 14); ctx.quadraticCurveTo(x + dx, y + dy + 8, x + dx, y + dy); ctx.stroke(); });
  ctx.restore();
}

function drawAvatar(ctx, x, y, color, label, isLocal, isSpeaking = false, isNearby = false, isMuted = false, attenuation = 1.0, isDark = false) {
  ctx.save();
  const isMuffled = attenuation < 0.9;
  
  // Voice Activity Detection: animated glowing emerald wave pulse
  if (isSpeaking) {
    const pulse = (Math.sin(Date.now() / 140) + 1) / 2; // 0 to 1 smooth oscillation
    const pulseColor = isMuffled
      ? `rgba(122, 140, 130, ${0.5 - pulse * 0.3})` // Muffled behind wall
      : `rgba(47, 211, 139, ${0.75 - pulse * 0.45})`;
    ctx.strokeStyle = pulseColor;
    ctx.lineWidth = 2.2 + pulse * 1.8;
    ctx.beginPath();
    ctx.arc(x, y, 18 + pulse * 6.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Base shadow
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(29, 50, 41, 0.15)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = isDark ? '#1E2024' : '#fff';
  ctx.beginPath();
  ctx.arc(x, y, 17, 0, Math.PI * 2);
  ctx.fill();

  // Avatar inner circle
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = isMuffled ? '#7b8782' : color;
  ctx.beginPath();
  ctx.arc(x, y, 13, 0, Math.PI * 2);
  ctx.fill();

  // 2px Presence Ring per design.md §3.2 & §8 (Obstacle attenuation)
  if (isSpeaking) {
    ctx.strokeStyle = isMuffled ? '#7A8C82' : '#2FD38B'; // Muffled vs clear speaking
    ctx.lineWidth = 2.5;
    if (isMuffled) ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(x, y, 17, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (isNearby) {
    ctx.strokeStyle = isMuffled ? '#5B666E' : '#1FA896'; // Muffled vs clear nearby
    ctx.lineWidth = 2;
    if (isMuffled) ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(x, y, 17, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (isMuted) {
    ctx.strokeStyle = '#B9BCC2'; // --ps-muted
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 17, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(81, 91, 83, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 17, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Avatar initials / text
  ctx.fillStyle = 'rgba(255,255,255,.94)';
  ctx.font = '600 8px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isLocal ? 'YOU' : label.split(' ').map((part) => part[0]).join(''), x, y + 0.5);

  // Label pill beneath avatar
  const pillW = isMuffled ? 72 : 58;
  ctx.fillStyle = isDark ? '#23262c' : '#fff';
  roundedRect(ctx, x - pillW / 2, y + 22, pillW, 17, 8);
  ctx.fill();

  // Speaking indicator dot or text
  if (isSpeaking) {
    ctx.fillStyle = isMuffled ? '#7A8C82' : '#2FD38B';
    ctx.beginPath();
    ctx.arc(x - pillW / 2 + 8, y + 30.5, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isDark ? '#98f0c5' : (isMuffled ? '#4c5c54' : '#1e382b');
    ctx.font = '600 8px Inter, sans-serif';
    ctx.fillText(isMuffled ? `${label} (wall)` : label, x + 4, y + 30.5);
  } else {
    ctx.fillStyle = isDark ? '#c8ced4' : '#3e4942';
    ctx.font = '500 8px Inter, sans-serif';
    ctx.fillText(isMuffled ? `${label} ▤` : label, x, y + 30.5);
  }

  ctx.restore();
}
