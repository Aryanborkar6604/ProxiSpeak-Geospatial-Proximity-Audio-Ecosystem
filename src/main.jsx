import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

const W = 1000, H = 660, RANGE = 170;
const demoPeople = [
  { id: 'maya', name: 'Maya Chen', role: 'Product designer', color: '#df806c', x: 250, y: 220, online: true, demo: true },
  { id: 'arjun', name: 'Arjun Mehta', role: 'Frontend engineer', color: '#6d9b82', x: 310, y: 245, online: true, demo: true },
  { id: 'lena', name: 'Lena Ortiz', role: 'Product manager', color: '#8178b4', x: 705, y: 300, online: true, demo: true },
  { id: 'noah', name: 'Noah Williams', role: 'Engineer', color: '#d3a45d', x: 755, y: 330, online: true, demo: true },
  { id: 'sofia', name: 'Sofia Kim', role: 'Researcher', color: '#6799ad', x: 510, y: 500, online: true, demo: true },
];
const Icon = ({ name, size = 18 }) => {
  const paths = { logo: <><path d="M5 8v8M10 5v14M15 8v8"/><path d="M2 10v4M18 10v4"/></>, sound: <><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15 9a5 5 0 0 1 0 6M17.5 6.5a9 9 0 0 1 0 11"/></>, mic: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"/></>, arrow: <><path d="M7 17 17 7M7 7h10v10"/></>, users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 8v6m3-3h-6"/></>, pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2"/></>, menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>, grid: <><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></>, wave: <><path d="M3 12h2l2-7 4 14 4-14 2 7h4"/></> };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
};
function App() {
  const canvasRef = useRef(null), socketRef = useRef(null), meRef = useRef(null), peersRef = useRef(new Map()), audioRef = useRef(null), positionRef = useRef({ x: 500, y: 335 }), movementRef = useRef({ keys: new Set(), target: null, lastFrame: 0, lastBroadcast: 0, lastUi: 0, dirty: false });
  const [me, setMe] = useState(null), [peers, setPeers] = useState(demoPeople), [earshot, setEarshot] = useState([]), [connected, setConnected] = useState(false), [micOn, setMicOn] = useState(false), [muted, setMuted] = useState(false), [view, setView] = useState('World'), [toast, setToast] = useState('');
  const people = me ? [...peers.filter(p => p.id !== me.id), me] : peers;
  const nearby = me ? peers.filter(p => Math.hypot((p.x || 0) - me.x, (p.y || 0) - me.y) < RANGE) : [];
  const actualNearby = peers.filter(p => !p.demo && earshot.includes(p.id));

  useEffect(() => {
    const socket = io({ autoConnect: true }); socketRef.current = socket;
    socket.on('connect', () => setConnected(true)); socket.on('disconnect', () => setConnected(false));
    socket.on('welcome', ({ user }) => { meRef.current = user; window.__meId = user.id; positionRef.current = { x: user.x, y: user.y }; setMe(user); });
    socket.on('presence', ({ peers: next, earshot: ids }) => { setEarshot(ids); setPeers(previous => { const demos = previous.filter(p => p.demo); return [...demos, ...next.map(p => ({ ...p, x: p.x ?? p.location?.coordinates?.[0] }))]; }); });
    socket.on('profile-updated', p => setPeers(curr => curr.map(x => x.id === p.id ? { ...x, ...p } : x)));
    socket.on('speaking', ({ id, speaking }) => setPeers(curr => curr.map(p => p.id === id ? { ...p, speaking } : p)));
    socket.on('user-left', id => { setPeers(curr => curr.filter(p => p.id !== id)); closePeer(id); });
    socket.on('signal', async ({ from, description, candidate }) => { let pc = peersRef.current.get(from); if (!pc) pc = createPeer(from, false); try { if (description) { await pc.setRemoteDescription(description); if (description.type === 'offer') { const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); socket.emit('signal', { to: from, description: pc.localDescription }); } } if (candidate) await pc.addIceCandidate(candidate); } catch {} });
    return () => { socket.disconnect(); peersRef.current.forEach(pc => pc.close()); };
  }, []);

  function moveTo(x, y) { movementRef.current.target = { x: Math.max(40, Math.min(960, x)), y: Math.max(40, Math.min(620, y)) }; }
  useEffect(() => {
    const movement = movementRef.current;
    const keyMap = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
    const onKeyDown = e => { const key = keyMap[e.key]; if (!key || (e.target instanceof HTMLElement && e.target.closest('input,textarea,button,[contenteditable="true"]'))) return; e.preventDefault(); movement.keys.add(key); movement.target = null; };
    const onKeyUp = e => { const key = keyMap[e.key]; if (key) movement.keys.delete(key); };
    const onBlur = () => movement.keys.clear();
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur);
    let raf;
    const tick = time => {
      const dt = movement.lastFrame ? Math.min((time - movement.lastFrame) / 1000, .05) : 0; movement.lastFrame = time;
      let dx = 0, dy = 0;
      if (movement.keys.size) {
        if (movement.keys.has('left')) dx -= 1; if (movement.keys.has('right')) dx += 1;
        if (movement.keys.has('up')) dy -= 1; if (movement.keys.has('down')) dy += 1;
      } else if (movement.target) {
        dx = movement.target.x - positionRef.current.x; dy = movement.target.y - positionRef.current.y;
        if (Math.hypot(dx, dy) < 3) { positionRef.current = movement.target; movement.target = null; dx = 0; dy = 0; }
      }
      const length = Math.hypot(dx, dy);
      if (length && dt && meRef.current) {
        const distance = Math.min(length, 245 * dt);
        const next = { x: Math.max(40, Math.min(960, positionRef.current.x + dx / length * distance)), y: Math.max(40, Math.min(620, positionRef.current.y + dy / length * distance)) };
        positionRef.current = next; meRef.current = { ...meRef.current, ...next }; movement.dirty = true;
      }
      if (movement.dirty && time - movement.lastBroadcast >= 50) {
        socketRef.current?.emit('move', { x: Math.round(positionRef.current.x), y: Math.round(positionRef.current.y) }); movement.lastBroadcast = time; movement.dirty = false;
      }
      if (movement.dirty && !movement.keys.size && !movement.target) {
        socketRef.current?.emit('move', { x: Math.round(positionRef.current.x), y: Math.round(positionRef.current.y) }); movement.lastBroadcast = time; movement.dirty = false;
      }
      if (time - movement.lastUi >= 40) {
        if (meRef.current) setMe(current => current ? { ...current, x: positionRef.current.x, y: positionRef.current.y } : current); movement.lastUi = time;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); };
  }, []);
  function createPeer(id, initiator) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); peersRef.current.set(id, pc);
    audioRef.current?.stream?.getTracks().forEach(track => pc.addTrack(track, audioRef.current.stream));
    pc.onicecandidate = e => { if (e.candidate) socketRef.current?.emit('signal', { to: id, candidate: e.candidate }); };
    pc.ontrack = e => attachSpatialAudio(id, e.streams[0]);
    if (initiator) pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => socketRef.current?.emit('signal', { to: id, description: pc.localDescription })).catch(() => {});
    return pc;
  }
  function closePeer(id) { peersRef.current.get(id)?.close(); peersRef.current.delete(id); const node = document.getElementById(`audio-${id}`); node?.remove(); }
  function attachSpatialAudio(id, stream) {
    if (!audioRef.current?.context) return;
    const audio = document.createElement('audio'); audio.id = `audio-${id}`; audio.autoplay = true; audio.srcObject = stream; audio.style.display = 'none'; document.body.appendChild(audio);
    const { context, panner, gain } = audioRef.current; const source = context.createMediaStreamSource(stream); const g = context.createGain(); const p = context.createStereoPanner(); source.connect(g).connect(p).connect(context.destination);
    peersRef.current.get(id)?.addEventListener('connectionstatechange', () => { if (peersRef.current.get(id)?.connectionState === 'closed') audio.remove(); });
    audio._spatial = { gain: g, panner: p };
  }
  useEffect(() => {
    if (!micOn || !me || !audioRef.current?.stream) return;
    for (const person of actualNearby) {
      let pc = peersRef.current.get(person.id);
      if (!pc) { if (me.id < person.id) createPeer(person.id, true); continue; }
      const added = audioRef.current.stream.getTracks().some(track => !pc.getSenders().some(sender => sender.track?.id === track.id));
      if (added) {
        audioRef.current.stream.getTracks().forEach(track => { if (!pc.getSenders().some(sender => sender.track?.id === track.id)) pc.addTrack(track, audioRef.current.stream); });
        if (me.id < person.id) pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => socketRef.current?.emit('signal', { to: person.id, description: pc.localDescription })).catch(() => {});
      }
    }
  }, [actualNearby.map(p => p.id).join(','), micOn, me?.id]);
  useEffect(() => {
    const closeIds = [...peersRef.current.keys()].filter(id => !actualNearby.some(person => person.id === id));
    closeIds.forEach(closePeer);
  }, [actualNearby.map(p => p.id).join(',')]);
  useEffect(() => {
    if (!me) return;
    for (const p of peers) {
      const audio = document.getElementById(`audio-${p.id}`); if (!audio?._spatial) continue;
      const dx = p.x - me.x, dy = p.y - me.y, distance = Math.hypot(dx, dy); const gain = Math.max(0, 1 - distance / RANGE) ** 1.45;
      audio._spatial.gain.gain.setTargetAtTime(muted ? 0 : gain, audioRef.current.context.currentTime, .12); audio._spatial.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, dx / 115)), audioRef.current.context.currentTime, .12);
    }
  }, [me?.x, me?.y, peers, muted]);
  async function toggleMic() {
    if (micOn) { audioRef.current?.stream?.getTracks().forEach(t => t.stop()); peersRef.current.forEach(pc => pc.getSenders().forEach(s => s.track?.kind === 'audio' && pc.removeTrack(s))); audioRef.current = null; setMicOn(false); return; }
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); const context = new AudioContext(); audioRef.current = { stream, context }; setMicOn(true); setToast('Mic is on. Walk close to someone to start a conversation.'); setTimeout(() => setToast(''), 3200); } catch { setToast('Microphone access was blocked. Check your browser permissions.'); setTimeout(() => setToast(''), 3200); }
  }

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return; const ctx = canvas.getContext('2d'); let raf;
    function draw(time) {
      const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) { canvas.width = rect.width * dpr; canvas.height = rect.height * dpr; }
      ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#f3f4ef'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(69,86,70,.07)'; ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 26) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); } for (let y = 0; y < H; y += 26) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      // room shell
      ctx.fillStyle = '#fafbf8'; roundRect(ctx, 74, 52, 852, 550, 22); ctx.fill(); ctx.strokeStyle = '#dfe3dc'; ctx.lineWidth = 2; roundRect(ctx, 74, 52, 852, 550, 22); ctx.stroke();
      // room dividers, open circulation gaps
      ctx.strokeStyle = '#dfe3dc'; ctx.lineWidth = 8; ctx.lineCap = 'round';
      line(ctx, 420, 53, 420, 168); line(ctx, 420, 258, 420, 602); line(ctx, 650, 53, 650, 145); line(ctx, 650, 230, 650, 392); line(ctx, 650, 475, 650, 602); line(ctx, 75, 365, 170, 365); line(ctx, 250, 365, 418, 365); line(ctx, 650, 425, 795, 425); line(ctx, 870, 425, 925, 425);
      // rugs
      ctx.fillStyle = '#eef0e9'; roundRect(ctx, 117, 112, 276, 213, 18); ctx.fill(); roundRect(ctx, 695, 108, 196, 248, 18); ctx.fill(); roundRect(ctx, 690, 455, 190, 110, 18); ctx.fill();
      // main shared table
      ctx.fillStyle = '#e6e8df'; roundRect(ctx, 178, 170, 171, 110, 16); ctx.fill(); ctx.strokeStyle = '#d7dbd2'; ctx.lineWidth = 1; roundRect(ctx, 178, 170, 171, 110, 16); ctx.stroke();
      for (const [x,y] of [[204,147],[267,147],[323,147],[204,302],[267,302],[323,302]]) chair(ctx,x,y);
      // lounge pod
      ctx.fillStyle = '#dcebe0'; roundRect(ctx, 717, 143, 150, 46, 18); ctx.fill(); roundRect(ctx, 717, 269, 150, 46, 18); ctx.fill(); ctx.fillStyle = '#ece9df'; roundRect(ctx, 752, 194, 82, 69, 14); ctx.fill();
      plant(ctx, 115, 91); plant(ctx, 382, 318); plant(ctx, 616, 90); plant(ctx, 891, 378); plant(ctx, 124, 552); plant(ctx, 896, 551);
      // focus rooms
      ctx.fillStyle = '#f0f1ec'; roundRect(ctx, 465, 78, 148, 100, 12); ctx.fill(); ctx.strokeStyle = '#e2e5de'; ctx.lineWidth = 1; roundRect(ctx,465,78,148,100,12); ctx.stroke();
      ctx.fillStyle = '#e3e7df'; roundRect(ctx, 493, 105, 92, 43, 8); ctx.fill();
      ctx.fillStyle = '#f0f1ec'; roundRect(ctx, 466, 438, 150, 118, 12); ctx.fill(); roundRect(ctx, 501, 475, 80, 42, 8); ctx.fill();
      // kitchenette
      ctx.fillStyle = '#ebece6'; roundRect(ctx, 790, 475, 65, 65, 13); ctx.fill(); ctx.fillStyle = '#d8ded5'; ctx.beginPath(); ctx.arc(822, 507, 17, 0, Math.PI*2); ctx.fill();
      // labels
      label(ctx, 'DESIGN STUDIO', 115, 86); label(ctx, 'HUDDLE ROOM', 476, 72); label(ctx, 'THE LOUNGE', 712, 126); label(ctx, 'QUIET ZONE', 476, 432); label(ctx, 'KITCHEN', 789, 466);
      // proximity radius
      const current = meRef.current || { x: 500, y: 335 };
      const scale = canvas.width / W; const radius = RANGE;
      const grd = ctx.createRadialGradient(current.x,current.y,12,current.x,current.y,radius); grd.addColorStop(0,'rgba(96,166,124,.18)'); grd.addColorStop(1,'rgba(96,166,124,0)'); ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(current.x,current.y,radius,0,Math.PI*2); ctx.fill();
      ctx.setLineDash([5,6]); ctx.strokeStyle='rgba(65,139,97,.34)'; ctx.lineWidth=1.3; ctx.beginPath(); ctx.arc(current.x,current.y,radius,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
      const all = meRef.current ? [...peers.filter(p=>p.id!==meRef.current.id), meRef.current] : peers;
      all.forEach((p,i)=>drawPerson(ctx,p,time,i));
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw); const resize = () => {}; window.addEventListener('resize', resize); return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [peers]);
  function onCanvasClick(e) { const b = e.currentTarget.getBoundingClientRect(); moveTo(Math.round((e.clientX-b.left)/b.width*W), Math.round((e.clientY-b.top)/b.height*H)); }
  const groupCount = Math.max(1, nearby.length + (me ? 1 : 0));
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Icon name="logo" size={20}/></div><span>proxi<span className="brand-light">speak</span></span><button className="icon-button sidebar-menu"><Icon name="menu"/></button></div>
      <div className="workspace-label">YOUR WORKSPACE</div><div className="workspace-card"><div className="workspace-avatar">I</div><div><strong>Infotact</strong><small>Team workspace</small></div><span className="chevrons">⌃⌄</span></div>
      <div className="nav-label">WORKSPACE</div><button className="nav-item active"><Icon name="grid"/> <span>Office</span><span className="nav-count">1</span></button><button className="nav-item" onClick={()=>setView('People')}><Icon name="users"/> <span>People</span><span className="nav-count">{peers.length + (connected ? 1 : 0)}</span></button>
      <div className="side-spacer"/><div className="office-card"><div className="office-card-top"><span className="live-dot"/> <span>OFFICE IS OPEN</span></div><strong>Good things happen<br/>when we’re together.</strong><div className="office-card-avatars">{people.slice(0,4).map((p,i)=><span key={p.id} style={{background:p.color,zIndex:4-i}}>{p.name.charAt(0)}</span>)}<small>+{Math.max(0,people.length-4)}</small></div></div>
      <button className="profile-row"><div className="self-avatar">{me?.name?.charAt(0) || 'Y'}<i/></div><div className="profile-info"><strong>{me?.name || 'You'}</strong><small>In the office</small></div><span className="more">···</span></button>
    </aside>
    <main className="main"><header className="topbar"><div className="breadcrumb"><span>Infotact</span><b>/</b><strong>{view}</strong></div><div className="top-actions"><div className="connection"><i className={connected?'online':''}/>{connected?'Connected':'Connecting…'}</div><button className="help-btn">? <span>Help</span></button><div className="header-avatar">{me?.name?.charAt(0)||'Y'}</div></div></header>
      <section className="content"><div className="page-heading"><div><div className="eyebrow"><Icon name="pin" size={14}/> YOUR VIRTUAL OFFICE</div><h1>Good morning, {me?.name?.split(' ')[0] || 'there'} <span className="sun">✳</span></h1><p>Your team is here. Find your people and join the conversation.</p></div><button className="invite-button" onClick={()=>{navigator.clipboard?.writeText(location.href);setToast('Office link copied to clipboard.');setTimeout(()=>setToast(''),2600)}}><Icon name="arrow" size={16}/> Invite your team</button></div>
      <div className="office-bar"><div className="office-name"><div className="office-icon"><Icon name="grid" size={16}/></div><div><strong>Infotact Office</strong><span><i className="live-dot"/> Live now</span></div></div><div className="bar-right"><div className="mini-avatars">{people.slice(0,4).map((p,i)=><span key={p.id} style={{background:p.color,zIndex:4-i}}>{p.name.charAt(0)}</span>)}</div><span className="people-count">{people.length} here</span><i className="bar-divider"/><span className="privacy"><span/> Team only</span><button className="more-button">···</button></div></div>
      <div className="canvas-frame"><div className="canvas-stage"><canvas ref={canvasRef} onClick={onCanvasClick} aria-label="Interactive overhead virtual office map"/><div className="map-overlay"><span className="map-live"><i/> LIVE OFFICE</span><span className="map-hint">Click to walk · WASD or arrow keys</span></div><div className="map-controls"><button onClick={()=>moveTo(positionRef.current.x,positionRef.current.y-35)}>+</button><button onClick={()=>moveTo(positionRef.current.x,positionRef.current.y+35)}>−</button><button onClick={()=>moveTo(500,335)} title="Center">⌖</button></div><div className="map-key"><span><i className="key-you"/> You</span><span><i className="key-person"/> Teammates</span><span><i className="key-range"/> Your hearing range</span></div></div></div>
      <div className="below-map"><div className="status-card"><div className="status-icon"><Icon name="sound" size={19}/></div><div className="status-copy"><strong>{nearby.length ? `${nearby.length} ${nearby.length===1?'person':'people'} within earshot` : 'Your office is nice and quiet'}</strong><span>{nearby.length ? 'Audio fades in as you get closer.' : 'Walk over to someone to say hello.'}</span></div><div className="signal-bars"><i/><i/><i/><i/><i/></div></div><div className="audio-controls"><button className={`mic-button ${micOn?'mic-active':''}`} onClick={toggleMic}><Icon name="mic" size={17}/>{micOn?'Mic on':'Turn on mic'}</button><button className={`sound-button ${muted?'is-muted':''}`} onClick={()=>setMuted(v=>!v)}><Icon name="sound" size={17}/>{muted?'Unmute':'Audio on'}</button></div></div>
      <section className="people-section"><div className="section-heading"><div><h2>In the office <span>{people.length}</span></h2><p>See who’s around and what they’re up to.</p></div><button className="see-all" onClick={()=>setView(view==='World'?'People':'World')}>See all <Icon name="arrow" size={14}/></button></div><div className="people-grid">{people.slice(0,4).map(p=><div className="person-card" key={p.id}><div className="person-face" style={{'--person':p.color}}>{p.name.split(' ').map(x=>x[0]).join('').slice(0,2)}<span className={p.speaking?'speaking-dot':'presence-dot'}/></div><div className="person-detail"><strong>{p.name}{p.id===me?.id?' (you)':''}</strong><span>{p.role||'In the office'}</span></div>{nearby.some(n=>n.id===p.id)?<span className="nearby-tag"><i/> Nearby</span>:<span className="quiet-tag">Around</span>}</div>)}</div></section>
      <footer>Made for the moments between meetings <span>✳</span></footer>
    </section></main>{toast&&<div className="toast">{toast}</div>}</div>;
}
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)} function line(ctx,x,y,a,b){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(a,b);ctx.stroke()} function label(ctx,t,x,y){ctx.fillStyle='#9ca497';ctx.font='600 9px DM Sans';ctx.letterSpacing='1.3px';ctx.fillText(t,x,y)}
function chair(ctx,x,y){ctx.fillStyle='#fdfdfa';ctx.strokeStyle='#dfe2db';ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fill();ctx.stroke()} function plant(ctx,x,y){ctx.fillStyle='#dfe8dc';ctx.beginPath();ctx.arc(x,y,14,0,Math.PI*2);ctx.fill();ctx.fillStyle='#7da187';for(let i=0;i<4;i++){ctx.beginPath();ctx.ellipse(x+Math.cos(i*1.6)*6,y+Math.sin(i*1.6)*6,4,8,i*1.4,0,Math.PI*2);ctx.fill()}}
function drawPerson(ctx,p,time,index){if(!p||p.x==null)return;const current=window.__mePosition||null;const x=p.x,y=p.y, isDemo=p.demo;let nearby=false;try{nearby=p.id===window.__meId||document.querySelector('.nearby-tag')!==null&&Math.hypot(x-500,y-335)<170}catch{};const bob=Math.sin(time/450+index)*1.5;ctx.save();ctx.shadowColor='rgba(41,54,43,.13)';ctx.shadowBlur=12;ctx.shadowOffsetY=5;ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y+bob,19,0,Math.PI*2);ctx.fill();ctx.shadowColor='transparent';ctx.fillStyle=p.color||'#4c9b77';ctx.beginPath();ctx.arc(x,y+bob,15,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.font='700 9px DM Sans';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText((p.name||'?').split(' ').map(n=>n[0]).join('').slice(0,2),x,y+bob+1);ctx.restore();ctx.fillStyle='#344039';ctx.font='600 11px DM Sans';ctx.textAlign='center';const name=p.id===window.__meId?'You':p.name?.split(' ')[0]||'Guest';const tw=ctx.measureText(name).width;ctx.fillStyle='rgba(255,255,255,.92)';roundRect(ctx,x-tw/2-8,y+23,tw+16,22,8);ctx.fill();ctx.fillStyle='#465149';ctx.fillText(name,x,y+34);if(p.id===window.__meId){ctx.strokeStyle='#4e9b70';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,22,0,Math.PI*2);ctx.stroke();}}

createRoot(document.getElementById('root')).render(<App/>);
