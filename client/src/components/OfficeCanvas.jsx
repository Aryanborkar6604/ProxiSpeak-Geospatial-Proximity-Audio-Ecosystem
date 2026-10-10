import { useCallback, useEffect, useRef, useState } from 'react';

const THROTTLE_MS = 1000 / 15;
const AVATAR_COLORS = ['#bb806d', '#708b7c', '#95809a', '#ba9d66', '#70859e', '#bf8c77'];

function labelFor(index) { return `Teammate ${index + 1}`; }

export default function OfficeCanvas({ socket, officeState, localUserId, onPeersChange }) {
  const canvasRef = useRef(null);
  const peersRef = useRef({});
  const localPos = useRef({ x: 175, y: 335 });
  const lastEmitTime = useRef(0);
  const [canvasSize, setCanvasSize] = useState({ width: officeState.width, height: officeState.height });

  const updatePeers = useCallback((next) => {
    peersRef.current = next;
    onPeersChange?.(next);
  }, [onPeersChange]);

  useEffect(() => {
    if (!socket) return undefined;
    
    // Send our initial position so others see us immediately
    socket.emit('player:move', { x: localPos.current.x, y: localPos.current.y });

    // Load existing people
    if (officeState?.users) {
      const initialPeers = { ...peersRef.current };
      officeState.users.forEach(u => {
        if (u.userId !== localUserId && u.location) {
          initialPeers[u.userId] = { x: u.location[0], y: u.location[1] };
        }
      });
      updatePeers(initialPeers);
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
  }, [socket, localUserId, officeState, updatePeers]);

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
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#f5f4f0';
      ctx.fillRect(0, 0, width, height);

      // A quiet drafting grid makes the canvas feel like a place without adding visual noise.
      ctx.save();
      ctx.scale(sx, sy);
      ctx.strokeStyle = 'rgba(67, 77, 70, 0.045)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= officeState.width; x += 32) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, officeState.height); ctx.stroke();
      }
      for (let y = 0; y <= officeState.height; y += 32) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(officeState.width, y); ctx.stroke();
      }

      // Soft sunlight and a faint focus ring anchor the map.
      const glow = ctx.createRadialGradient(220, 350, 24, 220, 350, 300);
      glow.addColorStop(0, 'rgba(96, 157, 132, 0.10)');
      glow.addColorStop(1, 'rgba(96, 157, 132, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, officeState.width, officeState.height);

      // Quietly drawn work areas and furniture suggest a lived-in office.
      drawZone(ctx, 73, 87, 252, 172, 'THE LIBRARY', 'soft');
      drawZone(ctx, 389, 82, 337, 242, 'STUDIO', 'green');
      drawZone(ctx, 710, 392, 226, 186, 'LOUNGE', 'sand');
      drawSofa(ctx, 98, 119);
      drawDesk(ctx, 430, 127, 122);
      drawDesk(ctx, 585, 127, 108);
      drawDesk(ctx, 430, 215, 122);
      drawDesk(ctx, 585, 215, 108);
      drawPlant(ctx, 357, 130);
      drawPlant(ctx, 751, 465);
      drawMeetingTable(ctx, 780, 155);
      drawSmallTable(ctx, 143, 204);

      // Office boundaries.
      ctx.strokeStyle = 'rgba(81, 91, 83, 0.14)';
      ctx.lineWidth = 1.5;
      roundedRect(ctx, 14, 14, officeState.width - 28, officeState.height - 28, 15);
      ctx.stroke();

      const { x: localX, y: localY } = localPos.current;
      // Hearing radius is illustrative until the proximity service provides live range state.
      ctx.beginPath();
      ctx.arc(localX, localY, 105, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(45, 127, 105, 0.035)';
      ctx.fill();
      ctx.setLineDash([4, 7]);
      ctx.strokeStyle = 'rgba(45, 127, 105, 0.17)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      drawAvatar(ctx, localX, localY, '#286b5e', 'YOU', true);
      
      const getAvatarColor = (id) => {
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
          hash = id.charCodeAt(i) + ((hash << 5) - hash);
        }
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
      };

      Object.entries(peersRef.current).forEach(([peerId, point], index) => {
        drawAvatar(ctx, point.x, point.y, getAvatarColor(peerId), labelFor(index), false);
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
      const now = Date.now();
      if (socket && now - lastEmitTime.current >= THROTTLE_MS) {
        socket.emit('player:move', { x: nextX, y: nextY });
        lastEmitTime.current = now;
      }
    };
    window.addEventListener('keydown', move);
    return () => window.removeEventListener('keydown', move);
  }, [socket, officeState]);

  const handleCanvasClick = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * officeState.width;
    const y = (event.clientY - rect.top) / rect.height * officeState.height;
    localPos.current = { x, y };
    if (socket) socket.emit('player:move', { x, y });
    lastEmitTime.current = Date.now();
  };

  return <canvas ref={canvasRef} className="office-canvas" width={canvasSize.width} height={canvasSize.height} onClick={handleCanvasClick} aria-label="Office map. Use WASD or arrow keys to move your avatar." tabIndex={0} />;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}

function drawZone(ctx, x, y, w, h, label, tone) {
  ctx.save();
  const fill = tone === 'green' ? 'rgba(70, 123, 101, 0.055)' : tone === 'sand' ? 'rgba(185, 154, 107, 0.065)' : 'rgba(107, 118, 104, 0.035)';
  ctx.fillStyle = fill; roundedRect(ctx, x, y, w, h, 13); ctx.fill();
  ctx.setLineDash([3, 5]); ctx.strokeStyle = 'rgba(94, 105, 95, 0.19)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(68, 78, 71, 0.54)'; ctx.font = '600 9px Inter, sans-serif'; ctx.letterSpacing = '1.6px'; ctx.fillText(label, x + 15, y + 20);
  ctx.restore();
}

function drawDesk(ctx, x, y, w) {
  ctx.save();
  ctx.shadowColor = 'rgba(45, 53, 47, 0.06)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#dedbd3'; roundedRect(ctx, x, y, w, 37, 7); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.fillStyle = 'rgba(255,255,255,0.68)'; roundedRect(ctx, x + 8, y + 7, w - 16, 22, 4); ctx.fill();
  ctx.fillStyle = '#b5b8aa'; roundedRect(ctx, x + w / 2 - 10, y + 12, 20, 11, 3); ctx.fill();
  ctx.strokeStyle = 'rgba(86, 94, 85, 0.16)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x + 17, y + 38); ctx.lineTo(x + 17, y + 47); ctx.moveTo(x + w - 17, y + 38); ctx.lineTo(x + w - 17, y + 47); ctx.stroke();
  ctx.restore();
}

function drawSofa(ctx, x, y) {
  ctx.save(); ctx.fillStyle = '#d6cdc1'; roundedRect(ctx, x, y, 126, 42, 10); ctx.fill();
  ctx.fillStyle = '#eee9e1'; roundedRect(ctx, x + 6, y + 6, 55, 30, 7); ctx.fill(); roundedRect(ctx, x + 65, y + 6, 55, 30, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(98, 89, 77, .12)'; ctx.lineWidth = 1; roundedRect(ctx, x, y, 126, 42, 10); ctx.stroke(); ctx.restore();
}

function drawSmallTable(ctx, x, y) {
  ctx.save(); ctx.fillStyle = '#c9b99e'; ctx.beginPath(); ctx.arc(x, y, 24, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#eee6d9'; ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7c9b81'; ctx.beginPath(); ctx.arc(x, y - 1, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

function drawMeetingTable(ctx, x, y) {
  ctx.save(); ctx.fillStyle = '#c8bda9'; roundedRect(ctx, x, y, 103, 54, 23); ctx.fill();
  ctx.fillStyle = '#ded8c9'; roundedRect(ctx, x + 4, y + 4, 95, 46, 20); ctx.fill();
  [[x + 20, y - 10], [x + 51, y - 12], [x + 82, y - 10], [x + 20, y + 64], [x + 51, y + 66], [x + 82, y + 64]].forEach(([cx, cy]) => {
    ctx.fillStyle = '#e4ded3'; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
  });
  ctx.restore();
}

function drawPlant(ctx, x, y) {
  ctx.save(); ctx.fillStyle = '#c8b99f'; roundedRect(ctx, x - 8, y + 10, 16, 14, 4); ctx.fill();
  ctx.strokeStyle = '#80967b'; ctx.lineWidth = 2;
  [[-8, -3], [-3, -11], [3, -8], [9, -3], [0, -16]].forEach(([dx, dy]) => { ctx.beginPath(); ctx.moveTo(x, y + 14); ctx.quadraticCurveTo(x + dx, y + dy + 8, x + dx, y + dy); ctx.stroke(); });
  ctx.restore();
}

function drawAvatar(ctx, x, y, color, label, isLocal) {
  ctx.save();
  ctx.shadowColor = 'rgba(29, 50, 41, 0.15)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 17, 0, Math.PI * 2); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.font = '600 8px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(isLocal ? 'YOU' : label.split(' ').map((part) => part[0]).join(''), x, y + 0.5);
  ctx.fillStyle = '#fff'; roundedRect(ctx, x - 29, y + 22, 58, 17, 8); ctx.fill();
  ctx.fillStyle = '#3e4942'; ctx.font = '500 8px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x, y + 30.5);
  ctx.restore();
}
