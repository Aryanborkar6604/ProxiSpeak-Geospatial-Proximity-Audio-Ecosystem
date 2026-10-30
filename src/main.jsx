import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

const W = 1000, H = 660, RANGE = 70;
const ICE_SERVERS = (() => {
  try { return JSON.parse(import.meta.env.VITE_ICE_SERVERS || '[{"urls":"stun:stun.l.google.com:19302"}]'); }
  catch { return [{ urls: 'stun:stun.l.google.com:19302' }]; }
})();
const demoPeople = [
  { id: 'maya', name: 'Maya Chen', role: 'Product designer', color: '#df806c', x: 250, y: 220, online: true, demo: true },
  { id: 'arjun', name: 'Arjun Mehta', role: 'Frontend engineer', color: '#6d9b82', x: 310, y: 245, online: true, demo: true },
  { id: 'lena', name: 'Lena Ortiz', role: 'Product manager', color: '#8178b4', x: 705, y: 300, online: true, demo: true },
  { id: 'noah', name: 'Noah Williams', role: 'Engineer', color: '#d3a45d', x: 755, y: 330, online: true, demo: true },
  { id: 'sofia', name: 'Sofia Kim', role: 'Researcher', color: '#6799ad', x: 510, y: 500, online: true, demo: true },
];
const avatarImages = new Map();
const Icon = ({ name, size = 18 }) => {
  const paths = { logo: <><path d="M5 8v8M10 5v14M15 8v8"/><path d="M2 10v4M18 10v4"/></>, sound: <><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15 9a5 5 0 0 1 0 6M17.5 6.5a9 9 0 0 1 0 11"/></>, mic: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"/></>, arrow: <><path d="M7 17 17 7M7 7h10v10"/></>, users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 8v6m3-3h-6"/></>, pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2"/></>, menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>, grid: <><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></>, wave: <><path d="M3 12h2l2-7 4 14 4-14 2 7h4"/></> };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
};
function App() {
  const canvasRef = useRef(null), socketRef = useRef(null), meRef = useRef(null), peersRef = useRef(new Map()), audioRef = useRef(null), remoteStreamsRef = useRef(new Map()), spatialNodesRef = useRef(new Map()), positionRef = useRef({ x: 500, y: 335 }), movementRef = useRef({ keys: new Set(), target: null, lastFrame: 0, lastBroadcast: 0, lastUi: 0, dirty: false });
  const [me, setMe] = useState(null), [peers, setPeers] = useState(demoPeople), [earshot, setEarshot] = useState([]), [connected, setConnected] = useState(false), [micOn, setMicOn] = useState(false), [muted, setMuted] = useState(false), [soundReady, setSoundReady] = useState(false), [view, setView] = useState('Office'), [toast, setToast] = useState(''), [sidebarCollapsed, setSidebarCollapsed] = useState(false), [openMenu, setOpenMenu] = useState(''), [displayName, setDisplayName] = useState(''), [phoneNumber, setPhoneNumber] = useState(''), [dateOfBirth, setDateOfBirth] = useState(''), [profilePhoto, setProfilePhoto] = useState(''), [profileBusy, setProfileBusy] = useState(false);
  const [authUser, setAuthUser] = useState(null), [authChecked, setAuthChecked] = useState(false), [authMode, setAuthMode] = useState('login'), [authName, setAuthName] = useState(''), [authEmail, setAuthEmail] = useState(() => { try { return localStorage.getItem('proxispeak.lastLoginEmail') || ''; } catch { return ''; } }), [lastLoginEmail, setLastLoginEmail] = useState(() => { try { return localStorage.getItem('proxispeak.lastLoginEmail') || ''; } catch { return ''; } }), [rememberLogin, setRememberLogin] = useState(false), [authPassword, setAuthPassword] = useState(''), [authError, setAuthError] = useState(''), [authBusy, setAuthBusy] = useState(false);
  const [audioPeerStates, setAudioPeerStates] = useState({}), [remoteAudioStates, setRemoteAudioStates] = useState({});
  const [audioOutputs, setAudioOutputs] = useState([]), [audioOutputId, setAudioOutputId] = useState(() => { try { return localStorage.getItem('proxispeak.audioOutput') || ''; } catch { return ''; } }), [audioOutputError, setAudioOutputError] = useState('');
  const people = me ? [...peers.filter(p => p.id !== me.id), me] : peers;
  const nearby = me ? peers.filter(p => Math.hypot((p.x || 0) - me.x, (p.y || 0) - me.y) < RANGE) : [];
  const actualNearby = peers.filter(p => !p.demo && earshot.includes(p.id));
  const connectedAudioPeers = actualNearby.filter(p => audioPeerStates[p.id] === 'connected').length;
  const failedAudioPeers = actualNearby.filter(p => audioPeerStates[p.id] === 'failed').length;
  const liveRemoteAudioPeers = actualNearby.filter(p => remoteAudioStates[p.id] === 'live').length;

  useEffect(() => { if (me?.name) setDisplayName(me.name); }, [me?.name]);
  useEffect(() => { if (view === 'Settings') refreshAudioOutputs(); }, [view]);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/me', { credentials: 'include' }).then(response => response.ok ? response.json() : null).then(result => { if (active && result?.user) applyAccountData(result); }).catch(() => {}).finally(() => { if (active) setAuthChecked(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!authUser) { setConnected(false); setMe(null); meRef.current = null; return; }
    const socket = io({ autoConnect: true, withCredentials: true }); socketRef.current = socket;
    socket.on('connect', () => setConnected(true)); socket.on('disconnect', () => setConnected(false));
    socket.on('welcome', ({ user }) => { meRef.current = user; window.__meId = user.id; positionRef.current = { x: user.x, y: user.y }; setMe(user); });
    socket.on('presence', ({ peers: next, earshot: ids }) => { setEarshot(ids); setPeers(previous => { const demos = previous.filter(p => p.demo); return [...demos, ...next.map(p => ({ ...p, x: p.x ?? p.location?.coordinates?.[0] }))]; }); });
    socket.on('profile-updated', p => { setPeers(curr => curr.map(x => x.id === p.id ? { ...x, ...p } : x)); if (p.id === meRef.current?.id) { meRef.current = { ...meRef.current, ...p }; setMe(meRef.current); } });
    socket.on('speaking', ({ id, speaking }) => setPeers(curr => curr.map(p => p.id === id ? { ...p, speaking } : p)));
    socket.on('user-left', id => { setPeers(curr => curr.filter(p => p.id !== id)); closePeer(id); });
    socket.on('signal', ({ from, description, candidate }) => { handleSignal(from, description, candidate).catch(() => {}); });
    return () => { socket.disconnect(); peersRef.current.forEach(pc => pc.close()); };
  }, [authUser?.id]);

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
  function createPeer(id) {
    if (peersRef.current.has(id)) return peersRef.current.get(id);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc._polite = String(meRef.current?.id || '') > String(id); pc._makingOffer = false; pc._ignoreOffer = false; pc._settingRemoteAnswer = false; pc._pendingCandidates = [];
    peersRef.current.set(id, pc);
    setAudioPeerStates(current => ({ ...current, [id]: 'connecting' }));
    const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const localTrack = audioRef.current?.stream?.getAudioTracks()[0]; if (localTrack) audioTransceiver.sender.replaceTrack(localTrack).catch(() => {});
    pc.onicecandidate = e => { if (e.candidate) socketRef.current?.emit('signal', { to: id, candidate: e.candidate }); };
    pc.ontrack = e => {
      const stream = e.streams[0] || remoteStreamsRef.current.get(id) || new MediaStream();
      if (!stream.getTracks().some(track => track.id === e.track.id)) stream.addTrack(e.track);
      const updateRemoteTrackState = () => setRemoteAudioStates(current => ({ ...current, [id]: e.track.readyState === 'ended' ? 'ended' : e.track.muted ? 'waiting' : 'live' }));
      e.track.onunmute = updateRemoteTrackState; e.track.onmute = updateRemoteTrackState; e.track.onended = updateRemoteTrackState;
      updateRemoteTrackState();
      attachSpatialAudio(id, stream);
    };
    pc.onnegotiationneeded = async () => {
      try { pc._makingOffer = true; await pc.setLocalDescription(); socketRef.current?.emit('signal', { to: id, description: pc.localDescription }); }
      catch (err) { console.warn('Audio negotiation failed:', err); }
      finally { pc._makingOffer = false; }
    };
    pc.onconnectionstatechange = () => {
      setAudioPeerStates(current => ({ ...current, [id]: pc.connectionState === 'connected' ? 'connected' : pc.connectionState === 'failed' ? 'failed' : pc.connectionState === 'disconnected' ? 'connecting' : current[id] || 'connecting' }));
      if (pc.connectionState === 'failed') pc.restartIce();
    };
    return pc;
  }
  async function handleSignal(id, description, candidate) {
    let pc = peersRef.current.get(id) || createPeer(id);
    if (description) {
      const readyForOffer = !pc._makingOffer && (pc.signalingState === 'stable' || pc._settingRemoteAnswer);
      const collision = description.type === 'offer' && !readyForOffer;
      pc._ignoreOffer = !pc._polite && collision;
      if (pc._ignoreOffer) { pc._pendingCandidates = []; return; }
      if (collision && pc._polite) await pc.setLocalDescription({ type: 'rollback' });
      pc._settingRemoteAnswer = description.type === 'answer';
      await pc.setRemoteDescription(description);
      pc._settingRemoteAnswer = false;
      for (const queued of pc._pendingCandidates.splice(0)) await pc.addIceCandidate(queued);
      if (description.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); socketRef.current?.emit('signal', { to: id, description: pc.localDescription }); }
    }
    if (candidate && !pc._ignoreOffer) {
      if (pc.remoteDescription) await pc.addIceCandidate(candidate);
      else pc._pendingCandidates.push(candidate);
    }
  }
  function closePeer(id) {
    peersRef.current.get(id)?.close(); peersRef.current.delete(id); remoteStreamsRef.current.delete(id);
    setAudioPeerStates(current => { const next = { ...current }; delete next[id]; return next; });
    setRemoteAudioStates(current => { const next = { ...current }; delete next[id]; return next; });
    const nodes = spatialNodesRef.current.get(id); if (nodes) { nodes.source.disconnect(); nodes.gain.disconnect(); nodes.panner.disconnect(); spatialNodesRef.current.delete(id); }
  }
  function connectSpatialAudio(id, stream) {
    const context = audioRef.current?.context; if (!context || context.state === 'closed' || spatialNodesRef.current.has(id)) return;
    const source = context.createMediaStreamSource(stream), gain = context.createGain(), panner = context.createStereoPanner();
    source.connect(gain).connect(panner).connect(context.destination); spatialNodesRef.current.set(id, { source, gain, panner });
    const person = peers.find(item => item.id === id), current = meRef.current;
    const distance = person && current ? Math.hypot(person.x - current.x, person.y - current.y) : RANGE;
    gain.gain.value = muted ? 0 : Math.max(0, 1 - distance / RANGE) ** 1.45;
  }
  function attachSpatialAudio(id, stream) { remoteStreamsRef.current.set(id, stream); connectSpatialAudio(id, stream); }
  useEffect(() => {
    if (!me) return;
    const active = new Set(actualNearby.map(person => person.id));
    for (const id of active) if (!peersRef.current.has(id)) createPeer(id);
    for (const id of peersRef.current.keys()) if (!active.has(id)) closePeer(id);
  }, [actualNearby.map(p => p.id).join(','), me?.id]);
  useEffect(() => {
    if (!me) return;
    const context = audioRef.current?.context; if (!context || context.state === 'closed') return;
    for (const [id, nodes] of spatialNodesRef.current) {
      const p = peers.find(person => person.id === id); if (!p) continue;
      const dx = p.x - me.x, dy = p.y - me.y, distance = Math.hypot(dx, dy); const gain = Math.max(0, 1 - distance / RANGE) ** 1.45;
      nodes.gain.gain.setTargetAtTime(muted ? 0 : gain, context.currentTime, .12); nodes.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, dx / RANGE)), context.currentTime, .12);
    }
  }, [me?.x, me?.y, peers, muted, soundReady]);
  async function enableOfficeSound() {
    try {
      let context = audioRef.current?.context;
      if (!context || context.state === 'closed') { context = new AudioContext(); audioRef.current = { ...audioRef.current, context }; }
      if (typeof context.setSinkId === 'function') await context.setSinkId(audioOutputId);
      if (context.state !== 'running') await context.resume();
      for (const [id, stream] of remoteStreamsRef.current) connectSpatialAudio(id, stream);
      setSoundReady(true); return true;
    } catch { notify('Your browser could not start audio. Check its sound permissions.'); return false; }
  }
  async function toggleSound() {
    if (!soundReady) { if (await enableOfficeSound()) setMuted(false); return; }
    setMuted(value => !value);
  }
  async function refreshAudioOutputs() {
    if (!navigator.mediaDevices?.enumerateDevices) { setAudioOutputError('This browser cannot list audio output devices.'); return; }
    try {
      const outputs = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audiooutput');
      setAudioOutputs(outputs);
      setAudioOutputError(outputs.length ? '' : 'No output devices are available to this browser.');
    } catch { setAudioOutputError('Could not list audio output devices. Check browser permissions.'); }
  }
  async function selectExternalSpeaker() {
    const mediaDevices = navigator.mediaDevices;
    if (typeof mediaDevices?.selectAudioOutput !== 'function') {
      setAudioOutputError('This browser does not support in-app speaker selection. Set the external speaker as the system output, then choose System default speaker.');
      return;
    }
    try {
      // This must be called directly from a user click so the browser can grant
      // permission and reveal the device to the page.
      const device = await mediaDevices.selectAudioOutput(audioOutputId ? { deviceId: audioOutputId } : undefined);
      setAudioOutputs(await mediaDevices.enumerateDevices().then(devices => devices.filter(item => item.kind === 'audiooutput')));
      setAudioOutputId(device.deviceId);
      try { localStorage.setItem('proxispeak.audioOutput', device.deviceId); } catch {}
      let context = audioRef.current?.context;
      if (!context || context.state === 'closed') {
        context = new AudioContext();
        audioRef.current = { ...audioRef.current, context };
      }
      if (typeof context.setSinkId !== 'function') {
        setAudioOutputError('This browser selected the speaker but cannot route Web Audio to it. Set it as the system output instead.');
        return;
      }
      await context.setSinkId(device.deviceId);
      if (context.state !== 'running') await context.resume();
      for (const [id, stream] of remoteStreamsRef.current) connectSpatialAudio(id, stream);
      setSoundReady(true);
      setAudioOutputError('');
      notify(`Sound is routed to ${device.label || 'your selected speaker'}.`);
    } catch (err) {
      if (err?.name === 'NotAllowedError') setAudioOutputError('Speaker permission was blocked. Allow speaker selection for this site and try again.');
      else if (err?.name !== 'AbortError') setAudioOutputError('Could not select that speaker. Choose System default speaker or retry.');
    }
  }
  async function chooseAudioOutput(event) {
    const deviceId = event.target.value;
    setAudioOutputId(deviceId);
    try { localStorage.setItem('proxispeak.audioOutput', deviceId); } catch {}
    const context = audioRef.current?.context;
    if (!context) { setAudioOutputError('Choose a speaker with the button below. Sound will start when you enable office sound.'); return; }
    if (typeof context.setSinkId !== 'function') { setAudioOutputError('This browser cannot route Web Audio to a selected speaker. Set your external speaker as the system output.'); return; }
    try { await context.setSinkId(deviceId); setAudioOutputError(''); notify('Office audio is now routed to the selected output.'); }
    catch (err) { setAudioOutputError(err?.name === 'NotAllowedError' ? 'The browser blocked speaker selection. Allow this site to select audio output.' : 'Could not switch speaker. Choose the system default and try again.'); }
  }
  async function toggleSoundSetting() {
    if (!soundReady && muted) {
      if (await enableOfficeSound()) setMuted(false);
      return;
    }
    if (!soundReady && !muted) {
      if (await enableOfficeSound()) setMuted(false);
      return;
    }
    setMuted(value => !value);
  }
  async function toggleMic() {
    if (micOn) {
      const stream = audioRef.current?.stream; stream?.getTracks().forEach(track => track.stop());
      audioRef.current = { ...audioRef.current, stream: null };
      await Promise.all([...peersRef.current.values()].map(pc => { const sender = pc.getTransceivers().find(t => t.receiver.track.kind === 'audio')?.sender; return sender?.replaceTrack(null); }));
      socketRef.current?.emit('speaking', { speaking: false }); setMicOn(false); notify('Your microphone is off.'); return;
    }
    try {
      await enableOfficeSound();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      audioRef.current = { ...audioRef.current, stream };
      await Promise.all([...peersRef.current.values()].map(pc => { const sender = pc.getTransceivers().find(t => t.receiver.track.kind === 'audio')?.sender; return sender?.replaceTrack(stream.getAudioTracks()[0]); }));
      setMicOn(true); notify('Mic is on. Walk within 70 pixels of a teammate to chat.');
    } catch (err) { audioRef.current?.stream?.getTracks().forEach(track => track.stop()); notify(err?.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser settings.' : 'Could not start your microphone. Check that one is connected.'); }
  }
  function applyAccountData(result) {
    setAuthUser(result.user); setDisplayName(result.user.name || ''); setProfilePhoto(result.user.avatarUrl || '');
    setPhoneNumber(result.profile?.phoneNumber || ''); setDateOfBirth(result.profile?.dateOfBirth || '');
  }
  async function handlePhotoChange(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { notify('Choose a JPG, PNG, or WebP image.'); return; }
    if (file.size > 8 * 1024 * 1024) { notify('Choose an image smaller than 8 MB. It will be resized before saving.'); return; }
    try {
      const image = await createImageBitmap(file), cropSize = Math.min(image.width, image.height);
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
      canvas.getContext('2d').drawImage(image, (image.width - cropSize) / 2, (image.height - cropSize) / 2, cropSize, cropSize, 0, 0, 256, 256); image.close();
      const dataUrl = canvas.toDataURL('image/jpeg', .82);
      if (dataUrl.length > 400_000) throw new Error('This image could not be compressed enough. Please choose a smaller photo.');
      setProfilePhoto(dataUrl);
    } catch (err) { notify(err.message || 'Could not read this image. Please choose another one.'); }
  }
  async function saveProfile() {
    setProfileBusy(true);
    try {
      const response = await fetch('/api/auth/profile', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: displayName.trim(), phoneNumber, dateOfBirth, avatarUrl: profilePhoto || null }) });
      const raw = await response.text(); let result = {}; try { result = raw ? JSON.parse(raw) : {}; } catch {}
      if (!response.ok) throw new Error(result.error || 'Could not save your profile. Please try again.');
      if (!result.user) throw new Error('The server returned an empty response. Please try again.');
      applyAccountData(result); notify('Your profile is saved.');
    } catch (err) { notify(err.message || 'Could not reach the server. Please try again.'); }
    finally { setProfileBusy(false); }
  }
  async function submitAuth(e) {
    e.preventDefault(); setAuthError(''); setAuthBusy(true);
    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body = authMode === 'register' ? { name: authName, email: authEmail, password: authPassword } : { email: authEmail, password: authPassword, remember: rememberLogin };
      const response = await fetch(endpoint, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const responseText = await response.text();
      let result = {};
      try { result = responseText ? JSON.parse(responseText) : {}; } catch { result = {}; }
      if (!response.ok) throw new Error(result.error || 'Could not sign you in. Please try again.');
      if (!result.user) throw new Error('The server returned an empty response. Check that the ProxiSpeak backend is running, then try again.');
      if (authMode === 'login') {
        const email = authEmail.trim().toLowerCase();
        setLastLoginEmail(email);
        try { localStorage.setItem('proxispeak.lastLoginEmail', email); } catch {}
      }
      applyAccountData(result); setAuthPassword(''); setAuthName('');
    } catch (err) { setAuthError(err instanceof TypeError ? 'Could not reach the ProxiSpeak server. Make sure it is running, then try again.' : err.message || 'Could not sign you in. Please try again.'); }
    finally { setAuthBusy(false); }
  }
  async function signOut() {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
    audioRef.current?.stream?.getTracks().forEach(track => track.stop()); audioRef.current?.context?.close();
    peersRef.current.forEach(pc => pc.close()); peersRef.current.clear();
    for (const nodes of spatialNodesRef.current.values()) { nodes.source.disconnect(); nodes.gain.disconnect(); nodes.panner.disconnect(); }
    spatialNodesRef.current.clear(); remoteStreamsRef.current.clear(); audioRef.current = null;
    setMicOn(false); setMuted(false); setSoundReady(false); setMe(null); meRef.current = null; setPeers(demoPeople); setEarshot([]); setOpenMenu(''); setAuthUser(null); setPhoneNumber(''); setDateOfBirth(''); setProfilePhoto('');
  }

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return; const ctx = canvas.getContext('2d'); let raf;
    function draw(time) {
      const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) { canvas.width = rect.width * dpr; canvas.height = rect.height * dpr; }
      ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#f1e8d9'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(128,101,67,.075)'; ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 26) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); } for (let y = 0; y < H; y += 26) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      // room shell
      ctx.fillStyle = '#fff9ef'; roundRect(ctx, 74, 52, 852, 550, 24); ctx.fill(); ctx.strokeStyle = '#e5d4bb'; ctx.lineWidth = 2; roundRect(ctx, 74, 52, 852, 550, 24); ctx.stroke();
      // room dividers, open circulation gaps
      ctx.strokeStyle = '#e4d3ba'; ctx.lineWidth = 9; ctx.lineCap = 'round';
      line(ctx, 420, 53, 420, 168); line(ctx, 420, 258, 420, 602); line(ctx, 650, 53, 650, 145); line(ctx, 650, 230, 650, 392); line(ctx, 650, 475, 650, 602); line(ctx, 75, 365, 170, 365); line(ctx, 250, 365, 418, 365); line(ctx, 650, 425, 795, 425); line(ctx, 870, 425, 925, 425);
      // rugs
      ctx.fillStyle = '#f5e3d1'; roundRect(ctx, 117, 112, 276, 213, 20); ctx.fill(); ctx.fillStyle = '#e8eedf'; roundRect(ctx, 695, 108, 196, 248, 20); ctx.fill(); ctx.fillStyle = '#f6edda'; roundRect(ctx, 690, 455, 190, 110, 20); ctx.fill();
      // main shared table
      ctx.fillStyle = '#d9b99b'; roundRect(ctx, 178, 170, 171, 110, 18); ctx.fill(); ctx.strokeStyle = '#c8a485'; ctx.lineWidth = 1.3; roundRect(ctx, 178, 170, 171, 110, 18); ctx.stroke();
      for (const [x,y] of [[204,147],[267,147],[323,147],[204,302],[267,302],[323,302]]) chair(ctx,x,y);
      // lounge pod
      ctx.fillStyle = '#b9cfaa'; roundRect(ctx, 717, 143, 150, 46, 18); ctx.fill(); roundRect(ctx, 717, 269, 150, 46, 18); ctx.fill(); ctx.fillStyle = '#d9b99b'; roundRect(ctx, 752, 194, 82, 69, 14); ctx.fill();
      plant(ctx, 115, 91); plant(ctx, 382, 318); plant(ctx, 616, 90); plant(ctx, 891, 378); plant(ctx, 124, 552); plant(ctx, 896, 551);
      // focus rooms
      ctx.fillStyle = '#fff5e6'; roundRect(ctx, 465, 78, 148, 100, 14); ctx.fill(); ctx.strokeStyle = '#ead9c1'; ctx.lineWidth = 1; roundRect(ctx,465,78,148,100,14); ctx.stroke();
      ctx.fillStyle = '#b9cfaa'; roundRect(ctx, 493, 105, 92, 43, 10); ctx.fill();
      ctx.fillStyle = '#f5ebd9'; roundRect(ctx, 466, 438, 150, 118, 14); ctx.fill(); roundRect(ctx, 501, 475, 80, 42, 10); ctx.fill();
      // kitchenette
      ctx.fillStyle = '#dfc3a5'; roundRect(ctx, 790, 475, 65, 65, 15); ctx.fill(); ctx.fillStyle = '#f8f0df'; ctx.beginPath(); ctx.arc(822, 507, 17, 0, Math.PI*2); ctx.fill();
      // labels
      label(ctx, 'DESIGN STUDIO', 115, 86); label(ctx, 'HUDDLE ROOM', 476, 72); label(ctx, 'THE LOUNGE', 712, 126); label(ctx, 'QUIET ZONE', 476, 432); label(ctx, 'KITCHEN', 789, 466);
      // proximity radius
      const current = meRef.current || { x: 500, y: 335 };
      const scale = canvas.width / W; const radius = RANGE;
      const grd = ctx.createRadialGradient(current.x,current.y,12,current.x,current.y,radius); grd.addColorStop(0,'rgba(120,159,105,.2)'); grd.addColorStop(1,'rgba(120,159,105,0)'); ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(current.x,current.y,radius,0,Math.PI*2); ctx.fill();
      ctx.setLineDash([5,6]); ctx.strokeStyle='rgba(117,153,99,.44)'; ctx.lineWidth=1.3; ctx.beginPath(); ctx.arc(current.x,current.y,radius,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
      const all = meRef.current ? [...peers.filter(p=>p.id!==meRef.current.id), meRef.current] : peers;
      all.forEach((p,i)=>drawPerson(ctx,p,time,i));
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw); const resize = () => {}; window.addEventListener('resize', resize); return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [peers]);
  function onCanvasClick(e) { const b = e.currentTarget.getBoundingClientRect(); moveTo(Math.round((e.clientX-b.left)/b.width*W), Math.round((e.clientY-b.top)/b.height*H)); }
  const groupCount = Math.max(1, nearby.length + (me ? 1 : 0));
  const rooms = [
    { name: 'Design studio', note: 'A sunny table for making things', emoji: '🎨', tone: 'peach', x: 268, y: 218, people: peers.filter(p => p.x < 420 && p.y < 365).length },
    { name: 'The lounge', note: 'Soft seats and slow conversations', emoji: '🪴', tone: 'sage', x: 790, y: 225, people: peers.filter(p => p.x > 650 && p.y < 425).length },
    { name: 'Huddle room', note: 'A little space to think together', emoji: '🧩', tone: 'lavender', x: 535, y: 205, people: peers.filter(p => p.x >= 420 && p.x <= 650 && p.y < 300).length },
    { name: 'Quiet corner', note: 'A calm spot to focus', emoji: '☕', tone: 'butter', x: 535, y: 505, people: peers.filter(p => p.x >= 420 && p.x <= 650 && p.y > 400).length },
    { name: 'Kitchen', note: 'Refill your mug, say hello', emoji: '🍵', tone: 'rose', x: 820, y: 510, people: peers.filter(p => p.x > 760 && p.y > 430).length },
  ];
  function notify(message) { setToast(message); window.setTimeout(() => setToast(''), 2800); }
  function inviteTeam() { navigator.clipboard?.writeText(location.href); notify('Office link copied — invite someone in!'); }
  function enterRoom(room) { moveTo(room.x, room.y); setView('Office'); notify(`On your way to ${room.name.toLowerCase()}…`); }
  if (!authChecked) return <main className="auth-screen"><div className="auth-card auth-loading"><div className="brand-mark"><Icon name="logo" size={20}/></div><p>Opening the office…</p></div></main>;
  if (!authUser) return <main className="auth-screen"><section className="auth-card"><div className="auth-brand"><div className="brand-mark"><Icon name="logo" size={20}/></div><span>proxi<span className="brand-light">speak</span></span></div><div className="auth-illustration" aria-hidden="true"><span>🌿</span><span>☕</span><span>💬</span><div>✿</div></div><div className="eyebrow">YOUR INFOTACT OFFICE</div><h1>{authMode === 'login' ? 'Come on in.' : 'Make yourself at home.'}</h1><p className="auth-subtitle">{authMode === 'login' ? 'Sign in to see who’s around and say hello.' : 'Create an account to join your team’s virtual office.'}</p><form className="auth-form" onSubmit={submitAuth}>{authMode === 'register' && <label>Your name<input autoComplete="name" value={authName} onChange={e=>setAuthName(e.target.value)} placeholder="e.g. Alex Rivera" required maxLength={60}/></label>}<label>Email address<input type="email" autoComplete="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} placeholder="you@infotact.com" required/></label>{authMode === 'login' && lastLoginEmail && <div className="last-login-email">Last used: <strong>{lastLoginEmail}</strong></div>}<label>Password<input type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={authPassword} onChange={e=>setAuthPassword(e.target.value)} placeholder={authMode === 'login' ? 'Your password' : 'At least 8 characters'} required minLength={authMode === 'register' ? 8 : undefined}/></label>{authMode === 'login' && <label className="remember-login"><input type="checkbox" checked={rememberLogin} onChange={e=>setRememberLogin(e.target.checked)}/><span>Remember me <small>Keep me signed in on this device for 7 days</small></span></label>}{authError&&<div className="auth-error" role="alert">{authError}</div>}<button className="auth-submit" disabled={authBusy}>{authBusy ? 'One moment…' : authMode === 'login' ? 'Sign in to the office →' : 'Create your account →'}</button></form><p className="auth-switch">{authMode === 'login' ? 'New to ProxiSpeak?' : 'Already have an account?'} <button onClick={()=>{setAuthMode(authMode==='login'?'register':'login');setAuthError('')}}>{authMode === 'login' ? 'Create an account' : 'Sign in'}</button></p><div className="auth-footnote">A cozy little space for your team <span>✿</span></div></section></main>;
  return <div className="app-shell">
    <aside className={`sidebar ${sidebarCollapsed?'is-collapsed':''}`}>
      <div className="brand"><div className="brand-mark"><Icon name="logo" size={20}/></div><span>proxi<span className="brand-light">speak</span></span><button aria-label="Collapse sidebar" className="icon-button sidebar-menu" onClick={()=>setSidebarCollapsed(v=>!v)}><Icon name="menu"/></button></div>
      <div className="workspace-label">YOUR LITTLE CORNER</div><button className="workspace-card" onClick={()=>notify('You’re in the Infotact team workspace.')}><div className="workspace-avatar">I</div><div><strong>Infotact</strong><small>Team workspace</small></div><span className="chevrons">⌄</span></button>
      <div className="nav-label">HANGOUT</div>
      <button className={`nav-item ${view==='Office'?'active':''}`} onClick={()=>setView('Office')}><Icon name="grid"/> <span>Office</span><span className="nav-count">1</span></button>
      <button className={`nav-item ${view==='People'?'active':''}`} onClick={()=>setView('People')}><Icon name="users"/> <span>People</span><span className="nav-count">{people.length}</span></button>
      <button className={`nav-item ${view==='Rooms'?'active':''}`} onClick={()=>setView('Rooms')}><span className="nav-emoji">🛋</span><span>Rooms</span><span className="nav-count">5</span></button>
      <div className="nav-label nav-label-lower">YOUR SPACE</div>
      <button className={`nav-item ${view==='Settings'?'active':''}`} onClick={()=>setView('Settings')}><span className="nav-emoji">⚙</span><span>Settings</span></button>
      <button className="nav-item" onClick={()=>setOpenMenu(openMenu==='help'?'':'help')}><span className="nav-emoji">💌</span><span>Help & tips</span></button>
      <div className="side-spacer"/>
      <div className="office-card"><div className="office-card-top"><span className="live-dot"/> <span>THE OFFICE IS OPEN</span></div><strong>A little hello can<br/>make someone’s day.</strong><div className="office-card-avatars">{people.slice(0,4).map((p,i)=><span key={p.id} style={{background:p.color,zIndex:4-i}}>{p.avatarUrl?<img src={p.avatarUrl} alt=""/>:p.name.charAt(0)}</span>)}<small>{people.length} around</small></div></div>
      <button className="profile-row" onClick={()=>setOpenMenu(openMenu==='profile'?'':'profile')}><div className="self-avatar">{me?.avatarUrl?<img src={me.avatarUrl} alt=""/>:(me?.name?.charAt(0) || 'Y')}<i/></div><div className="profile-info"><strong>{me?.name || 'You'}</strong><small>{soundReady?'Audio ready':'Enable sound to listen'}</small></div><span className="more">⌃</span></button>
    </aside>
    <main className={`main ${sidebarCollapsed?'sidebar-is-collapsed':''}`}>
      <header className="topbar"><div className="breadcrumb"><span>Infotact</span><b>✿</b><strong>{view}</strong></div><div className="top-actions"><div className="connection"><i className={connected?'online':''}/>{connected?'All cozy & connected':'Finding the office…'}</div><button className="help-btn" onClick={()=>setOpenMenu(openMenu==='help'?'':'help')}>? <span>Need a hand?</span></button><button className="header-avatar" aria-label="Open your profile menu" onClick={()=>setOpenMenu(openMenu==='profile'?'':'profile')}>{me?.avatarUrl?<img src={me.avatarUrl} alt=""/>:(me?.name?.charAt(0)||'Y')}</button>
        {openMenu==='profile'&&<div className="header-dropdown"><strong>Your little profile</strong><button onClick={()=>{setView('Settings');setOpenMenu('')}}>✎ Edit your name</button><button onClick={()=>{toggleMic();setOpenMenu('')}}>🎙 {micOn?'Turn mic off':'Turn mic on'}</button><button onClick={()=>{setView('Office');setOpenMenu('')}}>⌂ Back to the office</button><button className="sign-out-action" onClick={signOut}>↪ Sign out</button></div>}
        {openMenu==='help'&&<div className="header-dropdown help-dropdown"><strong>A few friendly tips</strong><p>Click a spot to stroll over, or use WASD / arrow keys. Turn your mic on and get close to say hello.</p><button onClick={()=>{setView('Rooms');setOpenMenu('')}}>Take me to the rooms →</button><button onClick={()=>setOpenMenu('')}>Got it, thanks!</button></div>}
      </div></header>
      <section className="content">
        {view==='Office'&&<>
          <div className="page-heading"><div><div className="eyebrow"><Icon name="pin" size={14}/> YOUR VIRTUAL HANGOUT</div><h1>Come on in{me?.name?`, ${me.name.split(' ')[0]}`:''} <span className="sun">✿</span></h1><p>Your people are here. Wander over and let the conversation find you.</p></div><button className="invite-button" onClick={inviteTeam}><Icon name="arrow" size={16}/> Invite a friend</button></div>
          <div className="office-bar"><div className="office-name"><div className="office-icon">🏡</div><div><strong>The Infotact House</strong><span><i className="live-dot"/> Open for company</span></div></div><div className="bar-right"><div className="mini-avatars">{people.slice(0,4).map((p,i)=><span key={p.id} style={{background:p.color,zIndex:4-i}}>{p.avatarUrl?<img src={p.avatarUrl} alt=""/>:p.name.charAt(0)}</span>)}</div><span className="people-count">{people.length} little neighbors</span><i className="bar-divider"/><span className="privacy"><span/> Just our team</span><div className="office-more-wrap"><button className="more-button" onClick={()=>setOpenMenu(openMenu==='office'?'':'office')} aria-label="Office options">···</button>{openMenu==='office'&&<div className="office-dropdown"><button onClick={()=>{inviteTeam();setOpenMenu('')}}>🔗 Copy invite link</button><button onClick={()=>{setView('Rooms');setOpenMenu('')}}>🪴 Explore the rooms</button><button onClick={()=>{setView('Settings');setOpenMenu('')}}>⚙ Office settings</button></div>}</div></div></div>
          <div className="canvas-frame"><div className="canvas-stage"><canvas ref={canvasRef} onClick={onCanvasClick} aria-label="Interactive overhead virtual office map"/><div className="map-overlay"><span className="map-live"><i/> LITTLE WORLD, LIVE</span><span className="map-hint">Click to stroll · WASD / arrows to wander</span></div><div className="map-controls"><button onClick={()=>moveTo(positionRef.current.x,positionRef.current.y-35)} title="Walk north">↑</button><button onClick={()=>moveTo(positionRef.current.x,positionRef.current.y+35)} title="Walk south">↓</button><button onClick={()=>moveTo(500,335)} title="Come back home">⌂</button></div><div className="map-key"><span><i className="key-you"/> You</span><span><i className="key-person"/> Friends</span><span><i className="key-range"/> Your cozy bubble</span></div></div></div>
          <div className="below-map"><div className="status-card"><div className="status-icon">☀</div><div className="status-copy"><strong>{actualNearby.length?failedAudioPeers?'Audio connection failed':liveRemoteAudioPeers?'Receiving live audio':connectedAudioPeers?'Audio link connected — waiting for their mic':'Connecting audio…':'No live teammate in earshot'}</strong><span>{actualNearby.length?failedAudioPeers?'The peer link failed. A TURN relay may be needed on this network.':liveRemoteAudioPeers?'A teammate’s microphone track is reaching this device. Check Sound on and your device output volume.':connectedAudioPeers?'Confirm the other device says “Mic is on” and has microphone permission.':'Nearby teammate found; negotiating voice connection…':'Move within 70 pixels of a signed-in teammate. Demo avatars are silent.'}</span></div><div className={`signal-bars ${liveRemoteAudioPeers?'signal-active':''}`}><i/><i/><i/><i/><i/></div></div><div className="audio-controls"><button className={`mic-button ${micOn?'mic-active':''}`} onClick={toggleMic}><Icon name="mic" size={17}/>{micOn?'Mic is on':'Say hello'}</button><button className={`sound-button ${muted?'is-muted':''}`} onClick={toggleSound}><Icon name="sound" size={17}/>{!soundReady?'Enable sound':muted?'Unmute sound':'Sound on'}</button></div></div>
          <section className="people-section"><div className="section-heading"><div><h2>Your neighbors <span>{people.length}</span></h2><p>Good company, right around the corner.</p></div><button className="see-all" onClick={()=>setView('People')}>Meet everyone <Icon name="arrow" size={14}/></button></div><div className="people-grid">{people.slice(0,4).map(p=><div className="person-card" key={p.id}><div className="person-face" style={{'--person':p.color}}>{p.avatarUrl?<img src={p.avatarUrl} alt=""/>:p.name.split(' ').map(x=>x[0]).join('').slice(0,2)}<span className={p.speaking?'speaking-dot':'presence-dot'}/></div><div className="person-detail"><strong>{p.name}{p.id===me?.id?' (you)':''}</strong><span>{p.role||'In the office'}</span></div>{nearby.some(n=>n.id===p.id)?<span className="nearby-tag"><i/> Nearby</span>:<span className="quiet-tag">Around</span>}</div>)}</div></section>
          <footer>A softer place to work together <span>✿</span></footer>
        </>}
        {view==='People'&&<div className="subpage"><div className="page-heading"><div><div className="eyebrow">THE FRIENDLY FACES</div><h1>Who’s around? <span className="sun">☀</span></h1><p>Wave hello, wander over, and make a little conversation.</p></div><button className="invite-button" onClick={inviteTeam}>＋ Invite someone</button></div><div className="people-page-grid">{people.map(p=><article className="neighbor-card" key={p.id}><div className="neighbor-banner" style={{'--person':p.color}}><span>{p.demo?'Here for a little demo':'In the office'}</span><span className="presence-dot"/></div><div className="neighbor-body"><div className="person-face neighbor-face" style={{'--person':p.color}}>{p.avatarUrl?<img src={p.avatarUrl} alt=""/>:p.name.split(' ').map(x=>x[0]).join('').slice(0,2)}</div><strong>{p.name}{p.id===me?.id?' (you)':''}</strong><small>{p.role||'In the office'}</small><button onClick={()=>p.id===me?.id?setView('Settings'):enterRoom({name:p.name,x:p.x,y:p.y})}>{p.id===me?.id?'Edit your profile':nearby.some(n=>n.id===p.id)?'Say hello':'Walk over'} →</button></div></article>)}</div></div>}
        {view==='Rooms'&&<div className="subpage"><div className="page-heading"><div><div className="eyebrow">FIND YOUR FEEL-GOOD SPOT</div><h1>Little rooms, big ideas <span className="sun">✿</span></h1><p>Every corner has its own kind of conversation.</p></div><button className="invite-button" onClick={()=>setView('Office')}>⌂ Back to the map</button></div><div className="rooms-grid">{rooms.map(room=><article className={`room-card ${room.tone}`} key={room.name}><div className="room-emoji">{room.emoji}</div><div className="room-count">{room.people} {room.people===1?'neighbor':'neighbors'}</div><h2>{room.name}</h2><p>{room.note}</p><button onClick={()=>enterRoom(room)}>Wander over <span>→</span></button></article>)}</div><div className="room-note">Tip: your voice gets softer as you wander farther away. Find a cozy spot and see who joins you.</div></div>}
        {view==='Settings'&&<div className="subpage settings-page"><div className="page-heading"><div><div className="eyebrow">MAKE YOURSELF AT HOME</div><h1>Your little settings nook <span className="sun">🪴</span></h1><p>A few small things to make this space feel like yours.</p></div></div><div className="settings-card"><div className="settings-section"><div className="settings-heading"><span className="settings-emoji">🙂</span><div><strong>Your profile</strong><small>Manage the details teammates see in the office.</small></div></div><div className="profile-photo-row"><div className="profile-photo-preview">{profilePhoto?<img src={profilePhoto} alt="Profile preview"/>:(displayName.trim().charAt(0)||'Y')}</div><div className="profile-photo-actions"><label className="photo-picker" htmlFor="profile-photo">Choose a photo</label><input id="profile-photo" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoChange}/>{profilePhoto&&<button className="remove-photo" onClick={()=>setProfilePhoto('')}>Remove photo</button>}<small>JPG, PNG, or WebP. Resized to 256 × 256.</small></div></div><div className="profile-fields"><label htmlFor="display-name">Display name<input id="display-name" value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="What should we call you?" maxLength={32}/></label><label htmlFor="phone-number">Phone number<input id="phone-number" type="tel" autoComplete="tel" value={phoneNumber} onChange={e=>setPhoneNumber(e.target.value)} placeholder="Optional" maxLength={30}/></label><label htmlFor="date-of-birth">Date of birth<input id="date-of-birth" type="date" autoComplete="bday" value={dateOfBirth} onChange={e=>setDateOfBirth(e.target.value)}/></label></div><div className="profile-save-row"><small>Your phone number and date of birth are private to your account.</small><button className="save-profile-button" onClick={saveProfile} disabled={profileBusy}>{profileBusy?'Saving…':'Save profile'}</button></div></div><div className="settings-section"><div className="settings-heading"><span className="settings-emoji">🎧</span><div><strong>Sound & conversations</strong><small>Settle in before joining a nearby chat.</small></div></div><div className="setting-row"><span>Microphone</span><button className={`toggle-pill ${micOn?'on':''}`} onClick={toggleMic}>{micOn?'On':'Off'}</button></div><div className="setting-row"><span>Office sound</span><button className={`toggle-pill ${soundReady&&!muted?'on':''}`} onClick={toggleSoundSetting}>{!soundReady?'Enable sound':muted?'Muted':'On'}</button></div><div className="setting-row audio-output-row"><label htmlFor="audio-output">Sound output</label><select id="audio-output" value={audioOutputId} onChange={chooseAudioOutput}><option value="">System default speaker</option>{audioOutputs.filter(device=>device.deviceId && device.deviceId!=='default').map((device,index)=><option key={device.deviceId||index} value={device.deviceId}>{device.label||`Audio output ${index+1}`}</option>)}</select><button className="speaker-picker-button" onClick={selectExternalSpeaker}>Choose speaker…</button></div><div className="audio-output-help">{audioOutputError||'Select your external speaker and enable office sound. If the browser has no speaker selector, set the speaker as the system output.'}</div></div><div className="settings-section"><div className="settings-heading"><span className="settings-emoji">🗺️</span><div><strong>Getting around</strong><small>Click anywhere on the office map to stroll there, or use WASD / arrow keys.</small></div></div><button className="text-action" onClick={()=>setView('Office')}>Back to the office map →</button></div></div></div>}
      </section>
    </main>
    {toast&&<div className="toast">{toast}</div>}
  </div>;
}
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)} function line(ctx,x,y,a,b){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(a,b);ctx.stroke()} function label(ctx,t,x,y){ctx.fillStyle='#a38b6e';ctx.font='700 9px DM Sans';ctx.letterSpacing='1.2px';ctx.fillText(t,x,y)}
function chair(ctx,x,y){ctx.fillStyle='#fff9ed';ctx.strokeStyle='#dec9aa';ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fill();ctx.stroke()} function plant(ctx,x,y){ctx.fillStyle='#e4d6bb';ctx.beginPath();ctx.arc(x,y,14,0,Math.PI*2);ctx.fill();ctx.fillStyle='#78966c';for(let i=0;i<4;i++){ctx.beginPath();ctx.ellipse(x+Math.cos(i*1.6)*6,y+Math.sin(i*1.6)*6,4,8,i*1.4,0,Math.PI*2);ctx.fill()}}
function drawPerson(ctx,p,time,index){
  if(!p||p.x==null)return;
  const x=p.x,y=p.y,bob=Math.sin(time/450+index)*1.5;
  ctx.save();ctx.shadowColor='rgba(74,58,39,.16)';ctx.shadowBlur=12;ctx.shadowOffsetY=5;ctx.fillStyle='#fff9ef';ctx.beginPath();ctx.arc(x,y+bob,19,0,Math.PI*2);ctx.fill();ctx.shadowColor='transparent';ctx.beginPath();ctx.arc(x,y+bob,15,0,Math.PI*2);ctx.fillStyle=p.color||'#6f986e';ctx.fill();
  if(p.avatarUrl){
    let avatar=avatarImages.get(p.avatarUrl);
    if(!avatar){avatar=new Image();avatar.src=p.avatarUrl;avatarImages.set(p.avatarUrl,avatar);}
    if(avatar.complete&&avatar.naturalWidth){ctx.save();ctx.beginPath();ctx.arc(x,y+bob,15,0,Math.PI*2);ctx.clip();ctx.drawImage(avatar,x-15,y+bob-15,30,30);ctx.restore();}
    else drawInitials(ctx,p,x,y+bob);
  }else drawInitials(ctx,p,x,y+bob);
  ctx.restore();ctx.fillStyle='#4e5948';ctx.font='700 11px DM Sans';ctx.textAlign='center';const name=p.id===window.__meId?'You':p.name?.split(' ')[0]||'Guest';const tw=ctx.measureText(name).width;ctx.fillStyle='rgba(255,250,240,.97)';roundRect(ctx,x-tw/2-9,y+23,tw+18,23,9);ctx.fill();ctx.fillStyle='#635846';ctx.fillText(name,x,y+34);if(p.id===window.__meId){ctx.strokeStyle='#83a26f';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(x,y,22,0,Math.PI*2);ctx.stroke();}
}
function drawInitials(ctx,p,x,y){ctx.fillStyle='#fff';ctx.font='700 9px DM Sans';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText((p.name||'?').split(' ').map(n=>n[0]).join('').slice(0,2),x,y+1);}

createRoot(document.getElementById('root')).render(<App/>);
