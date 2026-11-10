import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { toast, Toaster } from 'sonner';
import useWebRTC from './hooks/useWebRTC';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './components/ui/dialog';
import './App.css';
import {
  Activity, ArrowUpRight, AudioLines, Building2, Check, CheckCircle2, ChevronDown, Coffee, Command, Copy, Eye, EyeOff, Headphones, Layers, Lock, LogOut, Menu, Mic,
  MicOff, Moon, Play, Radio, Search,
  Share2, ShieldCheck, SlidersHorizontal, Sparkles, Sun, UserPlus, Users, Volume2, VolumeX, Wifi, X, XCircle, Zap,
} from 'lucide-react';
import OfficeCanvas from './components/OfficeCanvas';
import { isInsideManagerCabin } from './utils/officeBounds';
import SlidableWorkspaceMenu from './components/SlidableWorkspaceMenu';
import { playSpatialPing, toggleAmbientSound, playProximityPreview, playDoorKnock } from './utils/audioFx';
import deviceCache from './utils/deviceCache';

const initials = (value = 'User') => value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
const colors = ['#e6b29f', '#9aaca0', '#c2a6be', '#d7bd89', '#9daec7', '#cf9b88'];
const todayLabel = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase();

const getBackendBase = () => {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'http://localhost:4000';
};

const API_BASE_URL = import.meta.env.VITE_API_URL || `${getBackendBase()}/api`;
const SOCKET_BASE_URL = import.meta.env.VITE_SOCKET_URL || getBackendBase();

const isPrivateOrLoopbackHostname = (hostname) => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized === '::1'
    || (
      normalized.includes(':')
      && (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:'))
    )
  ) {
    return true;
  }

  const octets = normalized.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 169 && octets[1] === 254);
};

const getPublicAppOrigin = () => {
  if (typeof window === 'undefined') return '';

  const configuredOrigin = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
  try {
    const publicUrl = new URL(configuredOrigin || window.location.origin);
    if (
      !['https:', 'http:'].includes(publicUrl.protocol)
      || isPrivateOrLoopbackHostname(publicUrl.hostname)
    ) {
      return '';
    }
    return publicUrl.origin;
  } catch {
    return '';
  }
};

async function parseJsonResponse(response) {
  try {
    const text = await response.text();
    if (!text || !text.trim()) {
      return { ok: response.ok, data: { error: response.ok ? '' : 'Backend server did not respond. Please try again.' } };
    }
    return { ok: response.ok, data: JSON.parse(text) };
  } catch {
    return { ok: false, data: { error: 'Could not connect to authentication services. Please verify the server is running.' } };
  }
}

function App() {
  const reducedMotion = useReducedMotion();
  const [socket, setSocket] = useState(null);
  const [token, setToken] = useState(() => sessionStorage.getItem('token'));
  const [userId, setUserId] = useState(() => sessionStorage.getItem('userId'));
  const [userName, setUserName] = useState(() => sessionStorage.getItem('userName') || 'You');
  const [currentPath, setCurrentPath] = useState(() => (
    typeof window !== 'undefined' ? window.location.pathname : '/'
  ));
  const [authMode, setAuthMode] = useState(() => (
    typeof window !== 'undefined' && window.location.pathname === '/register' ? 'register' : 'login'
  ));
  const [authChecking, setAuthChecking] = useState(() => Boolean(sessionStorage.getItem('token')));
  const [showPassword, setShowPassword] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => (typeof window !== 'undefined' ? localStorage.getItem('theme') === 'dark' : false));
  const [currentOfficeId] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('office') || 'main-office';
    }
    return 'main-office';
  });
  const [officeState, setOfficeState] = useState(() => {
    const cached = deviceCache.loadOffice(currentOfficeId);
    if (cached) return cached;
    return {
      officeId: currentOfficeId,
      name: currentOfficeId === 'main-office' ? 'The Commons' : `Office ${currentOfficeId}`,
      width: 1000,
      height: 700,
      obstacles: [],
      zones: [],
      users: [],
    };
  });
  const [peers, setPeers] = useState({});
  const [authError, setAuthError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [serverBusy, setServerBusy] = useState(false);
  const serverRequestCount = useRef(0);
  const serverBusyTimer = useRef(null);

  const runWithServerActivity = useCallback(async (request) => {
    serverRequestCount.current += 1;
    if (serverRequestCount.current === 1) {
      serverBusyTimer.current = window.setTimeout(() => setServerBusy(true), 450);
    }

    try {
      return await request();
    } finally {
      serverRequestCount.current = Math.max(0, serverRequestCount.current - 1);
      if (serverRequestCount.current === 0) {
        window.clearTimeout(serverBusyTimer.current);
        serverBusyTimer.current = null;
        setServerBusy(false);
      }
    }
  }, []);
  const {
    requestMic,
    micPermissionState,
    voiceConnectionState,
    voiceMode,
    isMuted: muted,
    toggleMute: setMuted,
    nearbyPeers: webrtcPeers,
    updateSpatialAudio,
    isSpeaking,
    localVolume,
    speakingPeers,
    mutedPeers,
    peerAttenuations,
  } = useWebRTC(socket, userId, token, currentOfficeId, runWithServerActivity, peers);


  const [search, setSearch] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const publicAppOrigin = getPublicAppOrigin();
  const inviteUrl = useMemo(() => {
    if (!publicAppOrigin) return '';
    const url = new URL('/', publicAppOrigin);
    url.searchParams.set('office', currentOfficeId);
    return url.toString();
  }, [currentOfficeId, publicAppOrigin]);
  const [canvasFps, setCanvasFps] = useState(0);
  const [isAmbienceOn, setIsAmbienceOn] = useState(false);
  const [localCoords, setLocalCoords] = useState(() => {
    const cachedPos = deviceCache.loadPosition(currentOfficeId, userId);
    return cachedPos ? { x: cachedPos.x, y: cachedPos.y } : { x: 175, y: 335 };
  });

  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [hasManagerPermission, setHasManagerPermission] = useState(false);
  const [incomingKnock, setIncomingKnock] = useState(null);
  const [isKnocking, setIsKnocking] = useState(false);
  const [managerBlockedInfo, setManagerBlockedInfo] = useState(null);

  useEffect(() => {
    document.body.classList.toggle('server-busy', serverBusy);
    return () => document.body.classList.remove('server-busy');
  }, [serverBusy]);
  const handleFrameRateChange = useCallback((fps) => {
    setCanvasFps((currentFps) => (currentFps === fps ? currentFps : fps));
  }, []);

  const navigateTo = (path, replace = false) => {
    const nextUrl = `${path}${window.location.search}`;
    if (replace) {
      window.history.replaceState({}, '', nextUrl);
    } else {
      window.history.pushState({}, '', nextUrl);
    }
    setCurrentPath(path);
    if (path === '/login' || path === '/register') {
      setAuthMode(path === '/register' ? 'register' : 'login');
    }
  };

  const changeAuthMode = (mode) => {
    setAuthError('');
    setShowPassword(false);
    navigateTo(mode === 'register' ? '/register' : '/login');
  };

  const toggleTheme = () => {
    setIsDarkMode((prev) => {
      const next = !prev;
      localStorage.setItem('theme', next ? 'dark' : 'light');
      return next;
    });
  };

  useEffect(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('userName');
  }, []);

  useEffect(() => {
    const handleHistoryChange = () => {
      const nextPath = window.location.pathname;
      setCurrentPath(nextPath);
      setAuthMode(nextPath === '/register' ? 'register' : 'login');
      setAuthError('');
      setShowPassword(false);
    };
    window.addEventListener('popstate', handleHistoryChange);
    return () => window.removeEventListener('popstate', handleHistoryChange);
  }, []);

  useEffect(() => {
    if (!token) {
      return undefined;
    }

    const controller = new AbortController();
    runWithServerActivity(async () => {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      const { data: result } = await parseJsonResponse(response);
      return { response, result };
    })
      .then(({ response, result }) => {
        if (!response.ok || !result.user) {
          throw new Error(result.error || 'Your session could not be verified. Please sign in again.');
        }
        sessionStorage.setItem('userId', result.user.userId);
        sessionStorage.setItem('userName', result.user.name);
        setUserId(result.user.userId);
        setUserName(result.user.name);
        setAuthError('');
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('userId');
        sessionStorage.removeItem('userName');
        setToken(null);
        setUserId(null);
        setUserName('You');
        setAuthError(error.message || 'Your session could not be verified. Please sign in again.');
        setCurrentPath('/login');
        window.history.replaceState({}, '', `/login${window.location.search}`);
      })
      .finally(() => {
        if (!controller.signal.aborted) setAuthChecking(false);
      });

    return () => controller.abort();
  }, [token, runWithServerActivity]);

  useEffect(() => {
    if (!token || authChecking) return undefined;
    const nextSocket = io(SOCKET_BASE_URL, { auth: { token } });
    nextSocket.on('connect', () => {
      const cachedPos = deviceCache.loadPosition(currentOfficeId, userId);
      nextSocket.emit('office:join', {
        officeId: currentOfficeId,
        preferredPosition: cachedPos ? { x: cachedPos.x, y: cachedPos.y } : localCoords,
      });
    });
    nextSocket.on('office:state', (state) => {
      setOfficeState(state);
      deviceCache.saveOffice(currentOfficeId, state);
      const me = state.users?.find((u) => u.userId === userId);
      if (me && me.location) {
        const myX = me.location[0];
        const myY = me.location[1];
        setLocalCoords({ x: myX, y: myY });
        deviceCache.savePosition(currentOfficeId, userId, { x: myX, y: myY });
      }
    });
    nextSocket.on('office:updated', (updated) => {
      setOfficeState((prev) => {
        const next = prev ? { ...prev, ...updated } : updated;
        deviceCache.saveOffice(currentOfficeId, next);
        return next;
      });
    });

    nextSocket.on('manager:knock_request', (data) => {
      const cached = deviceCache.loadPosition(currentOfficeId, userId);
      const curX = cached ? cached.x : localCoords.x;
      const curY = cached ? cached.y : localCoords.y;
      if (isInsideManagerCabin(curX, curY)) {
        playDoorKnock();
        setIncomingKnock({
          requesterId: data.requesterId,
          requesterName: data.requesterName || 'A teammate',
        });
        toast.info(`🚪 Knock Knock! ${data.requesterName || 'A teammate'} is requesting entry to the Manager Cabin.`);
      }
    });

    nextSocket.on('manager:entry_approved', (data) => {
      if (data.requesterId === userId) {
        setHasManagerPermission(true);
        setIsKnocking(false);
        setManagerBlockedInfo(null);
        playDoorKnock();
        toast.success(`✅ ${data.approvedBy || 'The occupants'} granted you permission to enter the Manager Cabin!`);
      }
    });

    nextSocket.on('manager:entry_denied', (data) => {
      if (data.requesterId === userId) {
        setIsKnocking(false);
        setManagerBlockedInfo(null);
        toast.error(`❌ Entry declined by ${data.deniedBy || 'the occupants'}. The cabin is in private session.`);
      }
    });

    nextSocket.on('manager:knock_sent', (data) => {
      setIsKnocking(true);
      toast.info(data.message || 'Knocked on the Manager Cabin door. Waiting for occupants...');
    });

    nextSocket.on('manager:entry_blocked', (data) => {
      playDoorKnock();
      setManagerBlockedInfo({ occupants: data.occupants || [] });
      toast.warning(data.message || 'Manager Cabin is occupied (2/2). Knock to request entry.');
    });

    nextSocket.on('auth:expired', () => {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('userId');
      sessionStorage.removeItem('userName');
      setToken(null);
      setUserId(null);
      setUserName('You');
      setAuthError('Your session expired. Sign in again to rejoin your office.');
      setAuthMode('login');
      setCurrentPath('/login');
      window.history.replaceState({}, '', `/login${window.location.search}`);
    });
    nextSocket.on('connect_error', (error) => {
      if (error.message.includes('Authentication error')) {
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('userId');
        sessionStorage.removeItem('userName');
        localStorage.removeItem('token');
        localStorage.removeItem('userId');
        localStorage.removeItem('userName');
        setToken(null);
        setUserId(null);
        setUserName('You');
        setAuthMode('login');
        setCurrentPath('/login');
        window.history.replaceState({}, '', `/login${window.location.search}`);
      }
    });
    setSocket(nextSocket);
    return () => nextSocket.close();
  }, [token, currentOfficeId, authChecking]);

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setAuthError('');
    setLoginBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const password = String(form.get('password') || '');
      if (authMode === 'register' && password !== form.get('confirmPassword')) {
        throw new Error('Your passwords do not match.');
      }
      const endpoint = authMode === 'register' ? 'register' : 'login';
      const payload = {
        email: form.get('email'),
        password,
      };
      if (authMode === 'register') payload.name = form.get('name');
      const { response, result } = await runWithServerActivity(async () => {
        const response = await fetch(`${API_BASE_URL}/auth/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const { data: result } = await parseJsonResponse(response);
        return { response, result };
      });
      if (!response.ok || !result.token) throw new Error(result.error || 'We could not sign you in. Please try again.');
      sessionStorage.setItem('token', result.token);
      sessionStorage.setItem('userId', result.user.userId);
      sessionStorage.setItem('userName', result.user.name);
      window.history.replaceState({}, '', `/${window.location.search}`);
      setCurrentPath('/');
      setAuthChecking(true);
      setUserId(result.user.userId);
      setUserName(result.user.name);
      setToken(result.token);
    } catch (error) {
      setAuthError(error.message || 'Unable to reach ProxiSpeak. Check that the server is running.');
    } finally {
      setLoginBusy(false);
    }
  };

  const handleCopyMain = async () => {
    if (!inviteUrl) {
      toast.error('Public invite link is not configured', {
        description: 'Set VITE_PUBLIC_APP_URL to your deployed website address.',
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      toast.success('Office link copied to clipboard!');
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast.error('Could not copy the office link', {
        description: 'Check your browser clipboard permissions and try again.',
      });
    }
  };

  const handleShareWhatsApp = () => {
    if (!inviteUrl) {
      toast.error('Public invite link is not configured', {
        description: 'Set VITE_PUBLIC_APP_URL to your deployed website address.',
      });
      return;
    }

    const message = `Join me in our ProxiSpeak office: ${inviteUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  };

  const logout = () => {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('userId');
    sessionStorage.removeItem('userName');
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('userName');
    setToken(null);
    setAuthError('');
    setAuthMode('login');
    navigateTo('/', true);
    setUserId(null);
    setUserName('You');
    setOfficeState(null);
    setPeers({});
    toast.info('Signed out of office.');
  };

  const handlePositionChange = useCallback((myPos, curPeers) => {
    setLocalCoords(myPos);
    deviceCache.savePosition(currentOfficeId, userId, myPos);
    updateSpatialAudio(myPos, curPeers, officeState?.hearingRadiusPx || 100);
  }, [currentOfficeId, userId, updateSpatialAudio, officeState?.hearingRadiusPx]);

  const handleKnockManagerDoor = useCallback(() => {
    if (!socket) return;
    playDoorKnock();
    setIsKnocking(true);
    socket.emit('manager:knock', { officeId: currentOfficeId });
  }, [socket, currentOfficeId]);

  const handleApproveKnock = useCallback(() => {
    if (!socket || !incomingKnock) return;
    socket.emit('manager:approve_entry', {
      officeId: currentOfficeId,
      requesterId: incomingKnock.requesterId,
    });
    toast.success(`Allowed ${incomingKnock.requesterName} into the Manager Cabin.`);
    setIncomingKnock(null);
  }, [socket, currentOfficeId, incomingKnock]);

  const handleDenyKnock = useCallback(() => {
    if (!socket || !incomingKnock) return;
    socket.emit('manager:deny_entry', {
      officeId: currentOfficeId,
      requesterId: incomingKnock.requesterId,
    });
    toast.info(`Declined entry for ${incomingKnock.requesterName}.`);
    setIncomingKnock(null);
  }, [socket, currentOfficeId, incomingKnock]);

  const handleBlockedManagerEntry = useCallback((occupants) => {
    playDoorKnock();
    setManagerBlockedInfo({ occupants: occupants || [] });
    toast.warning('🚪 Manager Cabin is occupied (2/2). You need permission from inside to enter.', {
      action: {
        label: '🚪 Knock',
        onClick: handleKnockManagerDoor,
      },
    });
  }, [handleKnockManagerDoor]);

  const wasInsideManagerRef = useRef(false);
  useEffect(() => {
    const isInside = isInsideManagerCabin(localCoords.x, localCoords.y);
    if (isInside) {
      wasInsideManagerRef.current = true;
    } else if (wasInsideManagerRef.current && !isInside) {
      wasInsideManagerRef.current = false;
      if (hasManagerPermission) {
        setHasManagerPermission(false);
        toast.info('You left the Manager Cabin. Re-entry requires approval if full.');
      }
    }
  }, [localCoords, hasManagerPermission]);

  useEffect(() => {
    const handleKeyDownKnock = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'k' || e.key === 'K') {
        if (managerBlockedInfo && !hasManagerPermission && !isKnocking) {
          e.preventDefault();
          handleKnockManagerDoor();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDownKnock);
    return () => window.removeEventListener('keydown', handleKeyDownKnock);
  }, [managerBlockedInfo, hasManagerPermission, isKnocking, handleKnockManagerDoor]);

  const closestPeerInfo = useMemo(() => {
    const peerEntries = Object.entries(peers);
    if (peerEntries.length === 0) return null;
    let minPeer = null;
    let minDist = Infinity;
    const radius = officeState?.hearingRadiusPx || 100;

    peerEntries.forEach(([id, pos]) => {
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
        const dx = pos.x - localCoords.x;
        const dy = pos.y - localCoords.y;
        const d = Math.hypot(dx, dy);
        if (d < minDist) {
          minDist = d;
          const att = peerAttenuations[id] ?? 1.0;
          const inRange = d <= radius;
          const norm = d / radius;
          const baseVolume = inRange ? Math.max(0.18, 1 - Math.pow(norm, 1.3)) : 0;
          minPeer = {
            id,
            name: pos.name || `Teammate`,
            dist: Math.round(d),
            dx,
            dy,
            att,
            inRange,
            volumePct: Math.round(baseVolume * att * 100),
          };
        }
      }
    });
    return minPeer;
  }, [peers, localCoords, peerAttenuations, officeState?.hearingRadiusPx]);


  const handleTestPing = () => {
    playSpatialPing();
    toast.success('3D Spatial Acoustic Ping Emitted', {
      description: 'Audio panned dynamically across left & right ear channels.',
    });
  };

  const handleToggleAmbience = () => {
    const active = toggleAmbientSound('drone');
    setIsAmbienceOn(active);
    if (active) {
      toast.success('Spatial Focus Ambience Activated', {
        description: 'Binaural focus drone playing softly in background.',
      });
    } else {
      toast.info('Spatial Ambience Deactivated');
    }
  };

  const people = useMemo(() => {
    const self = userId ? [{ id: userId, name: userName || 'You', self: true, position: null }] : [];
    return [
      ...self,
      ...Object.entries(peers).map(([id, position]) => ({
        id,
        name: position.name || `Guest ${id.slice(-4)}`,
        position,
      })),
    ];
  }, [peers, userId, userName]);
  const visiblePeople = people.filter((person) => person.name.toLowerCase().includes(search.toLowerCase()));

  if (token && authChecking) {
    return <main className="loading-screen auth-verifying"><ServerBusyIndicator active={serverBusy} /><Brand /><div className="loading-indicator" /><span>Verifying your account…</span></main>;
  }

  if (!token) {
    const isRegister = authMode === 'register';
    const isAuthRoute = currentPath === '/login' || currentPath === '/register';
    return (
      <>
      <ServerBusyIndicator active={serverBusy} />
      <AnimatePresence mode="wait" initial={false}>
      {isAuthRoute ? (
      <motion.main
        key="authentication"
        className="login-shell"
        initial={reducedMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
        transition={{ duration: reducedMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="login-visual">
          <div className="login-topline">
            <a className="landing-brand-link" href="/" aria-label="ProxiSpeak home"><Brand /></a>
            <span className="login-note"><ShieldCheck size={15} /> Your shared office</span>
          </div>
          <motion.div
            className="login-copy"
            initial={reducedMotion ? false : { opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.52, delay: reducedMotion ? 0 : 0.1, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="login-badge-pill">
              <Sparkles size={12} className="login-badge-sparkle" />
              <span>OFFICE ACCESS TERMINAL · LEVEL 01</span>
            </div>
            <h1>Good work happens<br /><em>within earshot.</em></h1>
            <p>A shared virtual office where presence has physical meaning. Walk up to teammates and talk seamlessly.</p>
            <div className="auth-map-preview" role="img" aria-label="Illustration of an office floor and a nearby voice range">
              <div className="auth-map-heading">
                <span><AudioLines size={14} /> LIVE SPATIAL RADAR</span>
                <span className="auth-security-tag"><ShieldCheck size={11} /> E2EE P2P MESH</span>
              </div>
              <div className="auth-map-floor">
                <span className="auth-room room-library">RECEPTION</span>
                <span className="auth-room room-studio">MEETING ROOM</span>
                <span className="auth-room room-lounge">WORKSTATIONS</span>
                <span className="auth-map-voice-link" aria-hidden="true" />
                <span className="auth-map-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                <span className="auth-range" />
                <span className="auth-map-person auth-map-you">YOU</span>
                <span className="auth-map-person auth-map-teammate">TEAMMATE</span>
              </div>
              <div className="auth-telemetry-strip">
                <div className="telemetry-chip">
                  <span className="telemetry-label">VOICE RANGE</span>
                  <span className="telemetry-val">100px (6.0m)</span>
                </div>
                <div className="telemetry-chip">
                  <span className="telemetry-label">SIGNAL</span>
                  <span className="telemetry-val text-lavender">P2P ENCRYPTED</span>
                </div>
                <div className="telemetry-chip">
                  <span className="telemetry-label">WALL DAMPING</span>
                  <span className="telemetry-val">-18 dB</span>
                </div>
              </div>
            </div>
          </motion.div>
          <div className="login-visual-footer"><span>PROXIMITY, MADE HUMAN</span><span>PROXISPEAK</span></div>
        </div>
        <section className="login-panel">
          <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={isRegister ? 'register' : 'login'}
            className="login-panel-inner"
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -5 }}
            transition={{ duration: reducedMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
            aria-labelledby="auth-title"
          >
            <div className="auth-terminal-header">
              <span className="terminal-chip" />
              <span className="terminal-badge">OFFICE KEYCARD PASS</span>
              <div className="terminal-soundwave" aria-hidden="true">
                <span /><span /><span /><span /><span />
              </div>
            </div>
            <h2 id="auth-title">{isRegister ? 'Join your team.' : 'Sign in to your office.'}</h2>
            <p className="login-subtitle">
              {isRegister ? 'Set up your account to step into the office.' : 'Sign in to join your team’s shared space.'}
            </p>
            <form className="login-form" onSubmit={handleAuthSubmit}>
              {isRegister && (
                <>
                  <label htmlFor="name">Your name</label>
                  <input
                    id="name"
                    name="name"
                    autoComplete="name"
                    placeholder="e.g. Alex Morgan"
                    minLength={2}
                    maxLength={80}
                    required
                  />
                </>
              )}
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="name@company.com"
                maxLength={254}
                required
              />
              <label htmlFor="password">Password</label>
              <div className="password-input-wrap">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  placeholder={isRegister ? 'At least 8 characters' : 'Enter your password'}
                  minLength={8}
                  maxLength={72}
                  required
                />
                <button
                  className="password-visibility"
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {isRegister && (
                <>
                  <label htmlFor="confirmPassword">Confirm password</label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Enter your password again"
                    minLength={8}
                    maxLength={72}
                    required
                  />
                  <p className="password-guidance">Use at least 8 characters. Your password is stored as a secure hash.</p>
                </>
              )}
              {authError && <p className="form-error" role="alert">{authError}</p>}
              <button className="button button-primary login-submit" type="submit" disabled={loginBusy}>
                {loginBusy
                  ? (isRegister ? 'Creating your account…' : 'Signing you in…')
                  : (isRegister ? 'Create account' : 'Sign in')}
                <ArrowUpRight size={17} />
              </button>
            </form>
            <div className="login-privacy"><ShieldCheck size={15} /><span>Audio is live only when you choose to join.</span></div>
            <div className="login-bottom">
              <span>{isRegister ? 'Already have an account?' : 'New to ProxiSpeak?'}</span>
              <a
                className="text-button"
                href={`${isRegister ? '/login' : '/register'}${window.location.search}`}
                onClick={(event) => {
                  event.preventDefault();
                  changeAuthMode(isRegister ? 'login' : 'register');
                }}
              >
                {isRegister ? 'Sign in' : 'Create an account'}
              </a>
            </div>
          </motion.div>
          </AnimatePresence>
        </section>
      </motion.main>
      ) : (
        <LandingPage key="landing" onNavigate={changeAuthMode} />
      )}
      </AnimatePresence>
      </>
    );
  }

  const connected = Boolean(socket?.connected);
  const officeName = officeState?.name || 'The Commons';
  const waveScale = Math.max(0.55, Math.min(2.2, localVolume * 2.2));

  if (!officeState) {
    return <main className="loading-screen"><ServerBusyIndicator active={serverBusy} /><Brand /><div className="loading-indicator" /><span>Preparing your space…</span><button className="text-button" onClick={logout}>Sign out</button></main>;
  }

  return (
    <TooltipProvider>
      <main className={`app-shell ${isDarkMode ? 'dark-theme' : ''}`}>
      <ServerBusyIndicator active={serverBusy} />
      <header className="topbar">
        <div className="topbar-brand">
          <Brand />
          <span className="topbar-divider" />
          <div className="office-switcher" aria-label={`Current office: ${officeName}`}>
            <span className="office-icon">C</span>
            <span><strong>{officeName}</strong><small>Team office</small></span>
          </div>
        </div>
        <div className="topbar-center">
          <span className="connection-indicator" role="status">
            <span className={connected ? 'live-dot' : 'live-dot is-offline'} />
            {connected ? 'Connected' : 'Reconnecting'}
          </span>
          <span className="topbar-separator" />
          <span className="privacy-label"><ShieldCheck size={14} /> Signed in</span>
        </div>
        <div className="topbar-actions">
          {/* THE CONSOLIDATED SLIDABLE MENU TRIGGER BUTTON */}
          <button
            className={`sliderable-menu-trigger-btn ${isWorkspaceMenuOpen ? 'is-active' : ''}`}
            onClick={() => setIsWorkspaceMenuOpen((prev) => !prev)}
            aria-label="Toggle Slidable Workspace Menu"
            title="Open Slidable Workspace Menu: Audio, Teammates & Chat"
          >
            <SlidersHorizontal size={14} className="trigger-icon" />
            <span className="trigger-label">Workspace Menu</span>
            <span className="trigger-badge">{people.length}</span>
          </button>

          <button className="button button-primary invite-button" onClick={() => setShowInviteModal(true)}>
            <UserPlus size={14} /> <span>Invite</span>
          </button>

          <Tooltip>
            <TooltipTrigger asChild>
              <button className="profile-button" onClick={logout} aria-label={`Sign out ${userName}`}>
                <span className="profile-avatar">{initials(userName)}</span>
                <span className="profile-name">{userName}</span>
                <LogOut size={15} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Sign out</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <SlidableWorkspaceMenu
        isOpen={isWorkspaceMenuOpen}
        onToggle={() => setIsWorkspaceMenuOpen((prev) => !prev)}
        people={people}
        peers={peers}
        localCoords={localCoords}
        userId={userId}
        userName={userName}
        socket={socket}
        webrtcPeers={webrtcPeers}
        speakingPeers={speakingPeers}
        mutedPeers={mutedPeers}
        peerAttenuations={peerAttenuations}
        onJumpToUser={(targetId) => {
          const targetPeer = peers[targetId];
          if (targetPeer && socket) {
            toast.info(`Teleporting near ${targetPeer.name || 'teammate'}`);
            const nx = Math.max(50, Math.min(950, targetPeer.x + 35));
            const ny = Math.max(50, Math.min(650, targetPeer.y));
            socket.emit('player:move', { x: nx, y: ny });
            handlePositionChange({ x: nx, y: ny }, peers);
          }
        }}
        officeName={officeName}
        todayLabel={todayLabel}
        isAmbienceOn={isAmbienceOn}
        onToggleAmbience={handleToggleAmbience}
        onTestPing={handleTestPing}
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
        onInvite={() => setShowInviteModal(true)}
        onLogout={logout}
        closestPeerInfo={closestPeerInfo}
        micPermissionState={micPermissionState}
      />

      <div className="workspace-layout">
        <section className="world-column">
          <div className="world-heading-compact">
            <div className="heading-compact-left">
              <span className="heading-compact-title">{officeName}</span>
              <span className="heading-compact-floor">MAIN FLOOR</span>
              <span className="heading-compact-dot">·</span>
              <span className="heading-compact-hint">Move with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys to talk within 100px</span>
            </div>
            <div className="heading-compact-right">
              <span className="people-count">
                <span className="heading-live-dot" />
                <strong>{people.length}</strong> {people.length === 1 ? 'person' : 'people'} here
              </span>
              <div className="avatar-stack" aria-label={`${people.length} people in office`}>
                {people.slice(0, 4).map((person, i) => (
                  <span key={person.id} className={`mini-avatar mini-${i}`} style={{ background: person.self ? '#286b5e' : colors[i % colors.length] }}>
                    {initials(person.name)}
                  </span>
                ))}
                {people.length > 4 && <span className="avatar-more">+{people.length - 4}</span>}
              </div>
            </div>
          </div>

          <section className="office-card" aria-label="Live office map">
            <div className="map-topline">
              <div className="map-title">
                <span className="map-live-dot" />
                <span>LIVE OFFICE</span>
                <span className="map-coordinates">/ FLOOR 01</span>
              </div>
              <div className="map-actions">
                <div className="map-room-pills">
                  <button
                    type="button"
                    className="room-pill-btn"
                    onClick={() => {
                      const pos = { x: 500, y: 145 };
                      if (socket) socket.emit('player:move', pos);
                      handlePositionChange(pos, peers);
                      toast.info('Teleported to Meeting Room');
                    }}
                    title="Jump to Meeting Room"
                  >
                    👥 Meeting
                  </button>
                  <button
                    type="button"
                    className="room-pill-btn"
                    onClick={() => {
                      const pos = { x: 835, y: 145 };
                      const isCurrentlyInManager = isInsideManagerCabin(localCoords.x, localCoords.y);
                      if (!isCurrentlyInManager) {
                        let peersInManagerCount = 0;
                        const occupants = [];
                        Object.values(peers).forEach((p) => {
                          if (p && isInsideManagerCabin(p.x, p.y)) {
                            peersInManagerCount += 1;
                            occupants.push(p.name || 'Teammate');
                          }
                        });
                        if (peersInManagerCount >= 2 && !hasManagerPermission) {
                          handleBlockedManagerEntry(occupants);
                          return;
                        }
                      }
                      if (socket) socket.emit('player:move', pos);
                      handlePositionChange(pos, peers);
                      toast.info('Teleported to Manager Cabin');
                    }}
                    title="Jump to Manager Cabin"
                  >
                    💼 Manager
                  </button>
                  <button
                    type="button"
                    className="room-pill-btn"
                    onClick={() => {
                      const pos = { x: 500, y: 475 };
                      if (socket) socket.emit('player:move', pos);
                      handlePositionChange(pos, peers);
                      toast.info('Teleported to Workstations');
                    }}
                    title="Jump to Open Workstations"
                  >
                    💻 Workstations
                  </button>
                  <button
                    type="button"
                    className="room-pill-btn"
                    onClick={() => {
                      const pos = { x: 160, y: 555 };
                      if (socket) socket.emit('player:move', pos);
                      handlePositionChange(pos, peers);
                      toast.info('Teleported to HR Cabin');
                    }}
                    title="Jump to HR Cabin"
                  >
                    📋 HR Cabin
                  </button>
                </div>
                <span className="map-legend">
                  <i /> You <i className="legend-nearby" /> Nearby <i className="legend-wall" /> Wall
                </span>
              </div>
            </div>
            <div className="office-map-wrap">
              {/* Manager Cabin Incoming Knock Permission Dialog (for avatars inside) */}
              <AnimatePresence>
                {incomingKnock && (
                  <motion.div
                    className="manager-knock-banner"
                    initial={{ opacity: 0, y: -16, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -16, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="knock-banner-badge">
                      <span className="knock-icon-pulse">🚪</span>
                      <div className="knock-banner-text">
                        <strong>Knock Knock! Request to Enter</strong>
                        <p><span>{incomingKnock.requesterName}</span> is outside the Manager Cabin and asks permission to enter.</p>
                      </div>
                    </div>
                    <div className="knock-banner-actions">
                      <button type="button" className="btn-knock-allow" onClick={handleApproveKnock}>
                        <Check size={14} /> Allow Entry
                      </button>
                      <button type="button" className="btn-knock-deny" onClick={handleDenyKnock}>
                        <X size={14} /> Decline
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Manager Cabin Blocked Entry Dialog (for avatars outside) */}
              <AnimatePresence>
                {managerBlockedInfo && !hasManagerPermission && (
                  <motion.div
                    className="manager-blocked-banner"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 16 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="blocked-banner-info">
                      <Lock size={16} className="text-amber" />
                      <div>
                        <strong>Manager Cabin is at Capacity (2/2)</strong>
                        <p>Occupied by {managerBlockedInfo.occupants?.length > 0 ? managerBlockedInfo.occupants.join(' & ') : '2 teammates'}. Permission is required to enter.</p>
                      </div>
                    </div>
                    <div className="blocked-banner-actions">
                      <button
                        type="button"
                        className="btn-knock-request"
                        disabled={isKnocking}
                        onClick={handleKnockManagerDoor}
                      >
                        {isKnocking ? 'Waiting for response…' : '🚪 Knock to Request Entry'}
                      </button>
                      <button
                        type="button"
                        className="btn-knock-dismiss"
                        onClick={() => setManagerBlockedInfo(null)}
                        title="Dismiss"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {hasManagerPermission && (
                <div className="manager-permission-badge">
                  <span className="permission-indicator-dot" />
                  <span>MANAGER CABIN: ACCESS GRANTED</span>
                </div>
              )}

              <OfficeCanvas 
                socket={socket}
                officeState={officeState}
                localUserId={userId}
                onPeersChange={setPeers}
                onPositionChange={handlePositionChange}
                onFrameRateChange={handleFrameRateChange}
                nearbyPeers={webrtcPeers}
                speakingPeers={speakingPeers}
                mutedPeers={mutedPeers}
                isSpeaking={isSpeaking}
                isMuted={muted}
                peerAttenuations={peerAttenuations}
                isDarkMode={isDarkMode}
                hasManagerPermission={hasManagerPermission}
                onBlockedManagerEntry={handleBlockedManagerEntry}
              />
            </div>
            <div className="map-bottomline">
              <div className="map-bottom-info">
                <span><Command size={13} /> Move with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys</span>
                <span className="map-voice-indicator"><i className="pulse-beacon" /> 100px voice horizon active</span>
              </div>
              <button className="map-reset" aria-label="Focus office map" title="Focus office map" onClick={() => document.querySelector('.office-canvas')?.focus()}>
                <span className="focus-ring" /> Focus map
              </button>
            </div>
          </section>

          <div className="world-footnote"><Sparkles size={14} /><span>Sound changes with distance. Walls soften it; getting closer brings voices into focus.</span></div>
        </section>

        <aside className="people-sidebar">
          <div className="sidebar-heading"><div><div className="eyebrow muted-eyebrow">YOUR WORKSPACE</div><h2>In this office</h2></div></div>
          <div className="sidebar-summary"><div className="summary-icon"><Users size={16} /></div><div><strong>{people.length} {people.length === 1 ? 'person' : 'people'} around</strong><span>{people.length > 1 ? 'Your office is coming to life' : 'You’re the first one in'}</span></div></div>

          {/* Futuristic Live Spatial Radar Telemetry */}
          <div className="radar-hud-card">
            <div className="radar-hud-topline">
              <span className="radar-live-beacon" />
              <strong>SPATIAL AUDIO RADAR</strong>
              <span className="radar-status-badge">15Hz MESH</span>
            </div>
            {closestPeerInfo ? (
              <div className="radar-telemetry-body">
                <div className="radar-metric-row">
                  <span className="radar-metric-label">Nearest Teammate</span>
                  <strong className="radar-peer-name">{closestPeerInfo.name}</strong>
                </div>
                <div className="radar-metric-row">
                  <span className="radar-metric-label">Proximity Distance</span>
                  <span className={closestPeerInfo.inRange ? 'radar-tag-in-range' : 'radar-tag-out'}>
                    {closestPeerInfo.dist} px {closestPeerInfo.inRange ? '• IN RANGE' : '• DISTANT'}
                  </span>
                </div>
                <div className="radar-metric-row">
                  <span className="radar-metric-label">Acoustic Gain</span>
                  <span className="radar-gain-val">
                    {closestPeerInfo.volumePct}% {closestPeerInfo.att < 0.9 ? '(WALL ATTENUATED)' : '(CLEAR LOS)'}
                  </span>
                </div>
                <div className="radar-metric-row">
                  <span className="radar-metric-label">Binaural Stereo Pan</span>
                  <span className="radar-pan-val">
                    {closestPeerInfo.dx < -10 ? `◀ Left ${Math.abs(Math.round(closestPeerInfo.dx / 105 * 100))}%` : closestPeerInfo.dx > 10 ? `Right ${Math.round(closestPeerInfo.dx / 105 * 100)}% ▶` : 'Center 0°'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="radar-idle-note">
                <Activity size={14} className="radar-idle-icon text-cyan-400" />
                <span>Move near teammates to view real-time decibels, stereo pan, and acoustic wall muffling.</span>
              </div>
            )}
          </div>

          <label className="people-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a teammate" aria-label="Find a teammate" /></label>
          <div className="people-section-label"><span>TEAMMATES</span><span>{people.length.toString().padStart(2, '0')}</span></div>
          <div className="people-list">
            {visiblePeople.map((person) => {
              const getSidebarColor = (id) => {
                if (person.self) return '#286b5e';
                let hash = 0;
                for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
                return colors[Math.abs(hash) % colors.length];
              };
              const isPersonSpeaking = person.self ? isSpeaking : Boolean(speakingPeers[person.id]);
              const isPersonNearby = person.self ? false : Boolean(webrtcPeers[person.id]);
              const isPersonMuted = person.self ? muted : Boolean(mutedPeers[person.id]);
              const peerAtt = person.self ? 1.0 : (peerAttenuations[person.id] ?? 1.0);
              const isMuffled = peerAtt < 0.9;

              let statusText = 'HERE';
              let statusColor = undefined;
              if (isPersonSpeaking) {
                statusText = isMuffled ? 'TALKING (WALL)' : 'TALKING';
                statusColor = isMuffled ? '#7A8C82' : '#2FD38B';
              } else if (person.self) {
                statusText = 'YOU';
              } else if (isPersonNearby) {
                statusText = isMuffled ? 'NEARBY (WALL)' : 'NEARBY';
                statusColor = isMuffled ? '#7A808A' : '#1FA896';
              } else if (isPersonMuted) {
                statusText = 'MUTED';
                statusColor = '#8B8F96';
              }

              return (
                <div className={`person-row ${isPersonSpeaking ? 'is-speaking-row' : ''}`} key={person.id}>
                  <div className="person-avatar-wrap">
                    <span className="person-avatar" style={{ background: getSidebarColor(person.id) }}>
                      {person.self ? initials(userName) : initials(person.name)}
                    </span>
                    <i className={
                      isPersonSpeaking
                        ? "presence-dot is-speaking"
                        : (person.self || isPersonNearby ? (isMuffled ? "presence-dot is-muffled" : "presence-dot is-nearby") : (isPersonMuted ? "presence-dot is-muted" : "presence-dot"))
                    } />
                  </div>
                  <div className="person-info">
                    <strong>{person.self ? userName : person.name}</strong>
                    <span>
                      {isPersonSpeaking ? (isMuffled ? 'Speaking behind wall' : 'Speaking right now') : (person.self ? (muted ? 'Muted' : 'Ready') : (isPersonNearby ? (isMuffled ? 'Muffled by wall' : 'Nearby') : (isPersonMuted ? 'Muted' : 'At their desk')))}
                    </span>
                  </div>
                  <span
                    className="person-status"
                    style={{
                      color: statusColor,
                      fontWeight: isPersonSpeaking ? 600 : undefined,
                    }}
                  >
                    {statusText}
                  </span>
                </div>
              );
            })}
            {visiblePeople.length === 0 && <div className="empty-search">No one by that name yet.</div>}
          </div>
          <div className="sidebar-spacer" />
          <div className="quiet-card"><div className="quiet-card-icon"><Headphones size={17} /></div><div><strong>{micPermissionState === 'granted' ? 'Microphone ready' : 'Microphone off'}</strong><p>{micPermissionState === 'granted' ? 'Nearby voice responds to distance and walls.' : 'Allow microphone access to join nearby conversations.'}</p></div></div>
          <div className="sidebar-footer">
            <span><span className="live-dot" /> Your space is live</span>
            <button className="text-button" type="button" onClick={() => setShowInviteModal(true)}>
              Invite teammates <ArrowUpRight size={13} />
            </button>
          </div>
        </aside>
      </div>

      <motion.div
        className="control-dock"
        initial={{ y: 28, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 350, damping: 26 }}
      >
        {micPermissionState !== 'granted' ? (
          <div className={`mic-access-banner ${micPermissionState === 'insecure_context' ? 'is-insecure' : ''}`} role="status">
            <span className="mic-access-icon"><Mic size={17} /></span>
            <span className="mic-access-copy">
              <strong>{micPermissionState === 'insecure_context' ? 'A secure connection is needed' : 'Microphone access is off'}</strong>
              <small>{micPermissionState === 'insecure_context' ? 'Open ProxiSpeak over HTTPS or localhost to use voice.' : 'Allow access to talk with teammates nearby.'}</small>
            </span>
            {micPermissionState !== 'insecure_context' && <button className="button button-primary mic-access-button" onClick={requestMic}>Enable microphone</button>}
          </div>
        ) : (
          <>
            <div className="dock-context"><span className="dock-avatar">{initials(userName)}</span><span><strong>Spatial Audio Mesh</strong><small>3D Panning Active</small></span></div>
            <div className="dock-controls">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                className={`mic-button ${muted ? 'is-muted' : ''} ${isSpeaking ? 'is-speaking-btn' : ''}`}
                onClick={() => {
                  setMuted();
                  toast(muted ? 'Microphone unmuted' : 'Microphone muted', {
                    description: muted ? 'Teammates within range can hear you.' : 'Your audio is now muted.',
                  });
                }}
                aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                title="Toggle Microphone (M)"
              >
                <span className="mic-icon-wrap">{muted ? <MicOff size={18} /> : <Mic size={18} />}</span>
                <span>{muted ? 'Mic off' : (isSpeaking ? 'Broadcasting' : 'Mic on')}</span>
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="button button-secondary dock-ping-btn"
                onClick={handleTestPing}
                title="Test 3D Spatial Audio Ping"
                style={{ height: 38, padding: '0 10px', borderRadius: 10, fontSize: 10, gap: 5 }}
              >
                <Radio size={14} className="text-emerald-400" />
                <span>Ping</span>
              </motion.button>
            </div>
            <div className="dock-hint">
              <span className={`sound-wave ${isSpeaking ? 'is-active' : ''}`}>
                <i style={{ transform: isSpeaking ? `scaleY(${Math.max(0.5, waveScale * 0.9)})` : undefined }} />
                <i style={{ transform: isSpeaking ? `scaleY(${Math.max(0.7, waveScale * 1.4)})` : undefined }} />
                <i style={{ transform: isSpeaking ? `scaleY(${Math.max(0.9, waveScale * 1.9)})` : undefined }} />
                <i style={{ transform: isSpeaking ? `scaleY(${Math.max(1.1, waveScale * 2.3)})` : undefined }} />
                <i style={{ transform: isSpeaking ? `scaleY(${Math.max(1.0, waveScale * 2.0)})` : undefined }} />
                <i style={{ transform: isSpeaking ? `scaleY(${Math.max(0.8, waveScale * 1.5)})` : undefined }} />
                <i style={{ transform: isSpeaking ? `scaleY(${Math.max(0.6, waveScale * 1.1)})` : undefined }} />
                <i style={{ transform: isSpeaking ? `scaleY(${Math.max(0.5, waveScale * 0.8)})` : undefined }} />
              </span>
              <span>{isSpeaking ? <b className="voice-speaking-label">Speaking live…</b> : (muted ? <b>Microphone muted</b> : <>Voice horizon <b>active</b></>)}</span>
            </div>
          </>
        )}
      </motion.div>

      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <span className="overline">INVITE TEAMMATES</span>
            <DialogTitle>Bring your team in</DialogTitle>
            <DialogDescription>
              Share this link on WhatsApp. It opens ProxiSpeak’s landing page, where your teammate can sign in or create an account and join your office.
            </DialogDescription>
          </DialogHeader>

          <div className="invite-field-group">
            <label htmlFor="office-invite-link">Office link</label>
            <div className="invite-input-row">
              <input id="office-invite-link" readOnly value={inviteUrl || 'Public website URL is not configured'} />
              <button className="button button-primary" type="button" onClick={handleCopyMain} disabled={!inviteUrl}>
                {copiedLink ? <><Check size={14} style={{ marginRight: 4 }} /> Copied!</> : <><Copy size={14} style={{ marginRight: 4 }} /> Copy Link</>}
              </button>
            </div>
            {!inviteUrl && <p className="invite-url-help" role="status">Set VITE_PUBLIC_APP_URL to your deployed website URL before sharing invites.</p>}
            <button className="button invite-share-button" type="button" onClick={handleShareWhatsApp} disabled={!inviteUrl}>
              <Share2 size={15} /> Share on WhatsApp
            </button>
          </div>

          <div className="invite-steps">
            <h4>Once they’re in</h4>
            <ol>
              <li>They sign in or create their account.</li>
              <li>They allow microphone access over a secure connection.</li>
              <li>Move close together on the floor to talk.</li>
            </ol>
          </div>
        </DialogContent>
      </Dialog>

      <footer className="app-footer"><span>PROXISPEAK <i>·</i> A MORE HUMAN WAY TO WORK</span><span><Wifi size={13} /> {voiceMode === 'livekit' ? `SFU ${voiceConnectionState}` : 'Peer audio'} <span className="footer-divider">/</span>{canvasFps || '—'} FPS <span className="footer-divider">/</span> Built for being together</span></footer>
      <Toaster position="bottom-right" richColors theme={isDarkMode ? 'dark' : 'light'} />
    </main>
  </TooltipProvider>
  );
}

function ServerBusyIndicator({ active }) {
  if (!active) return null;

  return (
    <div className="server-request-indicator" role="status" aria-live="polite">
      <span className="server-request-spinner" aria-hidden="true" />
      <span>Waiting for the server response…</span>
    </div>
  );
}

function LandingPage({ onNavigate }) {
  const reducedMotion = useReducedMotion();
  const [distance, setDistance] = useState(62);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [activePod, setActivePod] = useState('bullpen');
  const [openFaq, setOpenFaq] = useState(0);

  const nearby = distance <= 34;
  const teammateX = 316 + distance * 1.9;
  const authHref = (mode) => `/${mode}${window.location.search}`;
  const navigateToAuth = (mode) => (event) => {
    event.preventDefault();
    setMenuOpen(false);
    onNavigate(mode);
  };
  const motionEase = [0.16, 1, 0.3, 1];

  const handleTriggerAudio = (dist = distance) => {
    setIsPlayingAudio(true);
    playProximityPreview(dist);
    window.setTimeout(() => setIsPlayingAudio(false), 550);
  };

  const handleSelectPreset = (dist) => {
    setDistance(dist);
    handleTriggerAudio(dist);
  };

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);

  const OFFICE_PODS = [
    {
      id: 'bullpen',
      title: 'Open Engineering Pod',
      tag: 'PROXIMITY SYNC',
      icon: Layers,
      headline: 'Pair programming and instant unblocks without sending calendar invites.',
      description: 'Dynamic Euclidean distance falloff within 6 meters. Avatars sitting in adjacent desks hear crisp, natural stereo conversation, while team members at adjacent pods hear silence.',
      specs: [
        { label: 'ACOUSTIC ISOLATION', value: 'Dynamic Falloff' },
        { label: 'LATENCY PROFILE', value: '< 18ms WebRTC' },
        { label: 'IDEAL WORKFLOW', value: 'Triage & Pairing' },
      ],
      schematic: 'bullpen',
    },
    {
      id: 'cabin',
      title: 'Private Executive Cabin',
      tag: 'HIGH ISOLATION',
      icon: Lock,
      headline: 'Acoustic glass walls for confidential 1:1s, reviews, and deep focus.',
      description: 'Stepping through the cabin portal engages line-of-sight raycast occlusion (-18dB attenuation with 420Hz low-pass frequency cutting). Private discussions stay strictly inside the cabin.',
      specs: [
        { label: 'ACOUSTIC ISOLATION', value: '-18 dB Low-Pass' },
        { label: 'PRIVACY LEVEL', value: 'Enclosed Room' },
        { label: 'IDEAL WORKFLOW', value: '1:1s & HR Syncs' },
      ],
      schematic: 'cabin',
    },
    {
      id: 'lounge',
      title: 'The Breakroom Lounge',
      tag: 'SOCIAL AMBIENCE',
      icon: Coffee,
      headline: 'Spontaneous coffee chats and natural watercooler encounters.',
      description: 'Reclaim serendipity in remote work. Grab a virtual seat while stepping away from deep work to share informal banter without disturbing focused builders in other zones.',
      specs: [
        { label: 'ACOUSTIC ISOLATION', value: 'Ambient Murmur' },
        { label: 'CAPACITY', value: '12+ Teammates' },
        { label: 'IDEAL WORKFLOW', value: 'Casual Breaks' },
      ],
      schematic: 'lounge',
    },
    {
      id: 'studio',
      title: 'Design Review Studio',
      tag: 'BROADCAST PODIUM',
      icon: Building2,
      headline: 'Full-stage Figma reviews, architecture demos, and all-hands.',
      description: 'Equipped with a broadcast podium for screen sharing and high-definition binaural audio. Present architecture blueprints to the entire office with zero streaming lag.',
      specs: [
        { label: 'ACOUSTIC ISOLATION', value: 'Stage Projection' },
        { label: 'DISPLAY MODE', value: '60fps Screen Share' },
        { label: 'IDEAL WORKFLOW', value: 'Sprint Demos' },
      ],
      schematic: 'studio',
    },
  ];

  const COMPARISONS = [
    {
      feature: 'Starting a Conversation',
      traditional: 'Schedule 30-min block, generate calendar invite, wait for link.',
      proxispeak: 'Just walk your avatar over and start speaking naturally.',
    },
    {
      feature: 'Concurrent Discussions',
      traditional: 'Impossible. 1 speaker dominates while 12 people sit on mute.',
      proxispeak: 'Multiple pods converse simultaneously without cross-talk.',
    },
    {
      feature: 'Leaving a Conversation',
      traditional: 'Awkward interruptions: "Sorry everyone, I need to jump off, bye!"',
      proxispeak: 'Walk away organically. Voice volume gently fades out.',
    },
    {
      feature: 'Audio Routing & Privacy',
      traditional: 'Routed through cloud servers with corporate meeting logs.',
      proxispeak: 'Direct encrypted P2P WebRTC mesh. Zero recordings or logs.',
    },
    {
      feature: 'Acoustic Directionality',
      traditional: 'Monophonic flat sound with zero distance or position cues.',
      proxispeak: '360° HRTF stereo panning and raycast wall occlusion.',
    },
  ];

  const FAQ_ITEMS = [
    {
      q: 'How does ProxiSpeak calculate audio distance attenuation?',
      a: 'ProxiSpeak models acoustic falloff using an inverse Euclidean distance algorithm. When your avatar is within the 100px voice radius (approx. 6m), the Web Audio StereoPannerNode computes dynamic left/right ear panning in real time (60 FPS) based on relative avatar coordinates.',
    },
    {
      q: 'Is voice, video, or screen-share data recorded on your servers?',
      a: 'Never. ProxiSpeak leverages peer-to-peer WebRTC mesh data and audio channels secured with DTLS-SRTP AES-256 encryption. Voice packets stream directly browser-to-browser; no audio data is ever written to disk or recorded.',
    },
    {
      q: 'How do walls and enclosed cabins block sound?',
      a: 'The physics engine performs 2D line-segment ray intersection against all obstacle wall segments. If a wall interrupts the direct vector between two avatars, a dynamic Biquad low-pass filter (420 Hz cutoff) attenuates high frequencies and dampens volume by -18 dB.',
    },
    {
      q: 'Do team members need to install a desktop app or plugin?',
      a: 'No downloads required. ProxiSpeak runs 100% inside modern web browsers (Chrome, Edge, Safari, Firefox) utilizing standard HTML5 Canvas, WebRTC, and the Web Audio API.',
    },
    {
      q: 'Can teammates still have quiet focus time without being interrupted?',
      a: 'Absolutely. You can toggle your microphone mute anytime with a single key (`M`), step into an acoustic focus cabin, or toggle "Do Not Disturb" focus mode to visually signal deep heads-down work.',
    },
  ];

  return (
    <motion.main
      className="landing-shell"
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reducedMotion ? undefined : { opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.3 }}
    >
      <header className="landing-nav">
        <a className="landing-brand-link" href="/" aria-label="ProxiSpeak home"><Brand /></a>
        <nav className="landing-nav-links" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#engine-showcase-title">Architecture</a>
          <a href="#office-pods">Office Pods</a>
          <a href="#comparison">Compare</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="landing-nav-actions">
          <a className="landing-signin" href={authHref('login')} onClick={navigateToAuth('login')}>Sign in</a>
          <a className="button button-primary landing-nav-cta" href={authHref('register')} onClick={navigateToAuth('register')}>
            <span className="landing-nav-cta-label"><span className="landing-nav-cta-full">Create your office</span><span className="landing-nav-cta-compact">Create office</span></span>
            <ArrowUpRight size={16} />
          </a>
        </div>
        <button
          className="landing-menu-toggle"
          type="button"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={menuOpen}
          aria-controls="landing-mobile-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <AnimatePresence>
          {menuOpen && (
            <motion.nav
              id="landing-mobile-menu"
              className="landing-mobile-menu"
              aria-label="Mobile navigation"
              initial={reducedMotion ? false : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -5 }}
              transition={{ duration: reducedMotion ? 0 : 0.18, ease: motionEase }}
            >
              <a href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a>
              <a href="#engine-showcase-title" onClick={() => setMenuOpen(false)}>Architecture</a>
              <a href="#office-pods" onClick={() => setMenuOpen(false)}>Office Pods</a>
              <a href="#comparison" onClick={() => setMenuOpen(false)}>Compare</a>
              <a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a>
              <a href={authHref('login')} onClick={navigateToAuth('login')}>Sign in</a>
              <a className="button button-primary landing-mobile-cta" href={authHref('register')} onClick={navigateToAuth('register')}>
                Create your office <ArrowUpRight size={16} />
              </a>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <motion.div
          className="landing-hero-copy"
          initial={reducedMotion ? false : { opacity: 0, x: -22, filter: 'blur(5px)' }}
          animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
          transition={{ duration: reducedMotion ? 0 : 0.62, ease: motionEase }}
        >
          <div className="landing-badge-pill">
            <Sparkles size={13} className="landing-badge-sparkle" />
            <span>NEXT-GEN SPATIAL WORKSPACE</span>
          </div>
          <h1 id="landing-title">
            <span className="landing-title-lead">Good work happens</span>
            <motion.span
              className="landing-title-echo"
              initial={reducedMotion ? false : { clipPath: 'inset(0 100% 0 0)' }}
              animate={{ clipPath: 'inset(0 0% 0 0)' }}
              transition={{ duration: reducedMotion ? 0 : 0.72, delay: reducedMotion ? 0 : 0.16, ease: motionEase }}
            >
              within earshot.
            </motion.span>
          </h1>
          <p>Skip the meeting link for the little things. See your team, walk over, and talk when it makes sense.</p>
          <div className="landing-stat-strip">
            <span className="landing-stat-item"><i className="stat-dot dot-lavender" /> 2D Spatial Audio</span>
            <span className="landing-stat-item"><i className="stat-dot dot-platinum" /> Zero Meeting Links</span>
            <span className="landing-stat-item"><i className="stat-dot dot-mocha" /> Dynamic Acoustic Walls</span>
          </div>
          <div className="landing-hero-actions">
            <a className="button button-primary landing-primary-button" href={authHref('register')} onClick={navigateToAuth('register')}>
              Step into your office <ArrowUpRight size={17} />
            </a>
            <a className="landing-secondary-action" href={authHref('login')} onClick={navigateToAuth('login')}>
              I already have an account
            </a>
          </div>
          <p className="landing-trust-note"><ShieldCheck size={15} /> Your microphone stays off until you choose to turn it on.</p>
        </motion.div>

        <motion.section
          className="landing-demo"
          aria-label="Interactive demonstration of proximity-based voice"
          initial={reducedMotion ? false : { opacity: 0, y: 20, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: reducedMotion ? 0 : 0.7, delay: reducedMotion ? 0 : 0.08, ease: motionEase }}
        >
          <div className="landing-demo-header">
            <span><AudioLines size={16} /> THE COMMONS <i /> FLOOR 01</span>
            <span className="landing-demo-badge">INTERACTIVE ACOUSTIC RADAR</span>
          </div>
          <div className="landing-map">
            <svg viewBox="0 0 760 450" role="img" aria-label={`Illustrative shared office. Maya is ${nearby ? 'within' : 'outside'} voice range. This is sample data, not a live team.`}>
              <defs>
                <pattern id="landing-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                  <path d="M32 0H0V32" fill="none" stroke="currentColor" strokeOpacity=".09" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="760" height="450" fill="url(#landing-grid)" />
              <rect className="landing-zone landing-zone-library" x="45" y="48" width="220" height="164" rx="16" />
              <rect className="landing-zone landing-zone-studio" x="316" y="42" width="370" height="221" rx="16" />
              <rect className="landing-zone landing-zone-lounge" x="500" y="301" width="190" height="105" rx="16" />
              <text className="landing-zone-label" x="65" y="75">THE LIBRARY</text>
              <text className="landing-zone-label" x="340" y="70">STUDIO</text>
              <text className="landing-zone-label" x="520" y="329">LOUNGE</text>
              <g className="landing-map-furniture">
                <rect x="76" y="103" width="126" height="31" rx="9" />
                <rect x="340" y="99" width="124" height="32" rx="9" />
                <rect x="497" y="99" width="124" height="32" rx="9" />
                <rect x="340" y="166" width="124" height="32" rx="9" />
                <rect x="497" y="166" width="124" height="32" rx="9" />
                <rect x="530" y="352" width="116" height="30" rx="15" />
              </g>
              <circle className="landing-proximity-ring" cx="258" cy="277" r="126" />
              <motion.line
                className={`landing-voice-link ${nearby ? 'is-nearby' : ''}`}
                x1="258"
                y1="277"
                x2={teammateX}
                y2="277"
                initial={false}
                animate={{ opacity: nearby ? 0.85 : 0.26 }}
                transition={{ duration: reducedMotion ? 0 : 0.35, ease: motionEase }}
              />
              <g className="landing-avatar landing-avatar-you" transform="translate(258 277)">
                <circle className="landing-avatar-halo" r="22" />
                <circle className="landing-avatar-core" r="17" />
                <text y="4">YOU</text>
                <text className="landing-avatar-name" y="47">YOUR SPACE</text>
              </g>
              <g transform="translate(316 277)">
                <motion.g
                  className={`landing-avatar landing-avatar-teammate ${nearby ? 'is-nearby' : ''}`}
                  initial={false}
                  animate={{ x: distance * 1.9 }}
                  transition={{ duration: reducedMotion ? 0 : 0.52, ease: motionEase }}
                >
                  <circle className="landing-avatar-halo" r="22" />
                  <circle className="landing-avatar-core" r="17" />
                  <text y="4">M</text>
                  <text className="landing-avatar-name" y={nearby ? 63 : 47}>MAYA · SAMPLE</text>
                </motion.g>
              </g>
              {nearby && (
                <g transform={`translate(${(258 + teammateX) / 2} 277)`}>
                  <motion.g
                    className="landing-audio-pulse"
                    initial={reducedMotion ? false : { opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: reducedMotion ? 0 : 0.28, ease: motionEase }}
                  >
                    <path d="M-7 -8Q1 0 -7 8M0 -13Q13 0 0 13M7 -18Q25 0 7 18" />
                  </motion.g>
                </g>
              )}
            </svg>
          </div>
          <div className="landing-demo-controls">
            <div className="landing-demo-presets">
              <span className="demo-preset-label">RADAR PRESETS:</span>
              <button type="button" className={`demo-preset-btn ${distance <= 25 ? 'active' : ''}`} onClick={() => handleSelectPreset(18)}>
                🎙️ Huddle (1.8m)
              </button>
              <button type="button" className={`demo-preset-btn ${distance > 25 && distance <= 50 ? 'active' : ''}`} onClick={() => handleSelectPreset(34)}>
                🤝 Desk Neighbor (3.4m)
              </button>
              <button type="button" className={`demo-preset-btn ${distance > 50 && distance <= 80 ? 'active' : ''}`} onClick={() => handleSelectPreset(65)}>
                ☕ Across Pod (7.8m)
              </button>
              <button type="button" className={`demo-preset-btn ${distance > 80 ? 'active' : ''}`} onClick={() => handleSelectPreset(92)}>
                🚪 Hallway (-24dB)
              </button>
              <button
                type="button"
                className={`demo-audio-trigger-btn ${isPlayingAudio ? 'is-playing' : ''}`}
                onClick={() => handleTriggerAudio(distance)}
                title="Click to hear how WebAudio attenuates volume and pans across ears at this distance"
              >
                <Play size={12} fill={isPlayingAudio ? '#1a1210' : 'currentColor'} />
                <span>{isPlayingAudio ? 'Emitting Ping…' : 'Hear Spatial Audio Ping'}</span>
              </button>
            </div>
            <div className="demo-telemetry-hud">
              <div className="telemetry-hud-item">
                <span className="hud-label">DISTANCE</span>
                <span className="hud-val">{(distance * 0.12).toFixed(1)} m</span>
              </div>
              <div className="telemetry-hud-item">
                <span className="hud-label">VOLUME LEVEL</span>
                <span className={`hud-val ${nearby ? 'text-lavender' : ''}`}>
                  {nearby ? '100% (0 dB Natural)' : distance > 70 ? '0% (-∞ dB Muffled)' : '25% (-12 dB Murmur)'}
                </span>
              </div>
              <div className="telemetry-hud-item">
                <span className="hud-label">SPATIAL EQUALIZER</span>
                <div className="hud-equalizer" aria-hidden="true">
                  <span className={nearby || isPlayingAudio ? 'bar-active' : ''} />
                  <span className={nearby || isPlayingAudio ? 'bar-active' : ''} />
                  <span className={nearby || isPlayingAudio ? 'bar-active' : ''} />
                  <span className={nearby || isPlayingAudio ? 'bar-active' : ''} />
                  <span className={nearby || isPlayingAudio ? 'bar-active' : ''} />
                </div>
              </div>
            </div>
            <div className="landing-distance-copy">
              <span className={`landing-distance-status ${nearby ? 'is-nearby' : ''}`} role="status" aria-live="polite">
                <i /> {nearby ? 'WITHIN VOICE RANGE · STEREO AUDIO ACTIVE' : 'ACROSS THE ROOM · AUDIBILITY MUTED'}
              </span>
              <label htmlFor="proximity-distance">Drag or scrub distance to listener</label>
            </div>
            <input
              id="proximity-distance"
              aria-label="Move Maya closer or farther away"
              type="range"
              min="0"
              max="100"
              value={distance}
              aria-valuetext={nearby ? 'Within voice range' : 'Across the room'}
              onChange={(event) => setDistance(Number(event.target.value))}
            />
            <span className="landing-range-label">FAR</span>
          </div>
          <p className="landing-demo-caption">Interactive distance attenuation engine. Click presets or &quot;Hear Spatial Audio Ping&quot; to test binaural WebAudio falloff.</p>
        </motion.section>
      </section>

      {/* Marquee Telemetry Strip */}
      <div className="landing-marquee-strip" aria-label="ProxiSpeak technical telemetry">
        <div className="marquee-content">
          <span className="marquee-item"><Zap size={13} className="text-lavender" /> SUB-20MS PROXIMITY TICKS</span>
          <span className="marquee-sep">✦</span>
          <span className="marquee-item"><ShieldCheck size={13} className="text-lavender" /> 100% P2P WEBRTC MESH</span>
          <span className="marquee-sep">✦</span>
          <span className="marquee-item"><Headphones size={13} className="text-lavender" /> 360° BINAURAL HRTF EQUALIZATION</span>
          <span className="marquee-sep">✦</span>
          <span className="marquee-item"><Lock size={13} className="text-lavender" /> ZERO CLOUD AUDIO RECORDING</span>
          <span className="marquee-sep">✦</span>
          <span className="marquee-item"><Layers size={13} className="text-lavender" /> 2D RAYCAST WALL OCCLUSION (-18dB)</span>
          <span className="marquee-sep">✦</span>
          <span className="marquee-item"><Activity size={13} className="text-lavender" /> 60 FPS HARDWARE ACCELERATED CANVAS</span>
          <span className="marquee-sep">✦</span>
        </div>
      </div>

      {/* Acoustic Physics Architecture Showcase */}
      <section className="landing-engine-showcase" aria-labelledby="engine-showcase-title">
        <div className="engine-showcase-header">
          <div className="engine-pill"><Sparkles size={13} /> <span>ACOUSTIC PHYSICS ARCHITECTURE</span></div>
          <h2 id="engine-showcase-title">Engineered for spontaneous human conversation.</h2>
          <p>Built on WebRTC peer-to-peer data channels and continuous 2D Euclidean coordinate raycasting.</p>
        </div>
        <div className="engine-cards-grid">
          <div className="engine-card">
            <div className="engine-card-icon"><Headphones size={22} /></div>
            <h3>360° Binaural Spatialization</h3>
            <p>Audio is dynamically calculated at 60 FPS based on relative coordinate vectors between avatars for natural distance attenuation.</p>
            <span className="engine-card-tag">CONTINUOUS STEREO PAN</span>
          </div>
          <div className="engine-card">
            <div className="engine-card-icon"><ShieldCheck size={22} /></div>
            <h3>Acoustic Wall Occlusion</h3>
            <p>Partitions, manager glass, and boardroom doors attenuate sound volume by 75% to 85% with line-segment ray intersection.</p>
            <span className="engine-card-tag">-18 dB DAMPING</span>
          </div>
          <div className="engine-card">
            <div className="engine-card-icon"><Radio size={22} /></div>
            <h3>Peer-to-Peer Mesh Privacy</h3>
            <p>Voice data streams directly between team members over encrypted DTLS-SRTP UDP channels without cloud recording.</p>
            <span className="engine-card-tag">AES-256 ENCRYPTION</span>
          </div>
          <div className="engine-card">
            <div className="engine-card-icon"><Activity size={22} /></div>
            <h3>Sub-20ms Proximity Ticks</h3>
            <p>In-memory spatial indexing recomputes listener boundaries at 20 Hz with zero database contention or network lag.</p>
            <span className="engine-card-tag">&lt; 20ms LATENCY</span>
          </div>
        </div>
      </section>

      {/* Interactive Office Pods Showcase */}
      <section className="landing-pods-section" id="office-pods" aria-labelledby="pods-title">
        <div className="pods-header">
          <div className="engine-pill"><Layers size={13} /> <span>INTERACTIVE POD BLUEPRINTS</span></div>
          <h2 id="pods-title">A floor layout designed for real work modes.</h2>
          <p>Explore how different acoustic zones protect deep focus while keeping spontaneous team connections effortless.</p>
          <div className="pods-tabs-nav" role="tablist">
            {OFFICE_PODS.map((pod) => {
              const IconComp = pod.icon;
              return (
                <button
                  key={pod.id}
                  type="button"
                  role="tab"
                  aria-selected={activePod === pod.id}
                  className={`pod-tab-btn ${activePod === pod.id ? 'active' : ''}`}
                  onClick={() => setActivePod(pod.id)}
                >
                  <IconComp size={15} />
                  <span>{pod.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {(() => {
          const currentPod = OFFICE_PODS.find((p) => p.id === activePod) || OFFICE_PODS[0];
          const IconComp = currentPod.icon;
          return (
            <div className="pod-spotlight-card">
              <div className="pod-spotlight-info">
                <div className="pod-tag-badge">
                  <IconComp size={14} />
                  <span>{currentPod.tag}</span>
                </div>
                <h3>{currentPod.headline}</h3>
                <p>{currentPod.description}</p>
                <div className="pod-specs-grid">
                  {currentPod.specs.map((spec, i) => (
                    <div key={i} className="pod-spec-item">
                      <span className="spec-label">{spec.label}</span>
                      <span className="spec-value">{spec.value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pod-spotlight-visual">
                <div className="pod-schematic-box">
                  <div className="schematic-radar-center">
                    <div className="schematic-pulse-ring ring-1" />
                    <div className="schematic-pulse-ring ring-2" />
                    <div className="schematic-avatar-icon">
                      <IconComp size={24} />
                    </div>
                  </div>
                  <div className="schematic-boundary-tag">ZONE: {currentPod.title.toUpperCase()}</div>
                  <div className="schematic-telemetry-pill">
                    <span className="pill-dot" /> LIVE ACOUSTIC PROFILE
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </section>

      {/* Comparison: ProxiSpeak vs Legacy Calls */}
      <section className="landing-comparison-section" id="comparison" aria-labelledby="compare-title">
        <div className="comparison-header">
          <div className="engine-pill"><CheckCircle2 size={13} /> <span>THE PROXISPEAK ADVANTAGE</span></div>
          <h2 id="compare-title">Why teams abandon scheduled video fatigue.</h2>
          <p>Traditional video conferencing treats conversation like a formal event. ProxiSpeak makes it natural.</p>
        </div>
        <div className="comparison-table-wrapper">
          <table className="comparison-table">
            <thead>
              <tr>
                <th className="th-feature">TEAM EXPERIENCE</th>
                <th className="th-legacy">
                  <div className="th-header-cell text-muted">
                    <XCircle size={16} className="text-red" />
                    <span>LEGACY VIDEO MEETINGS (ZOOM / MEET)</span>
                  </div>
                </th>
                <th className="th-proxi">
                  <div className="th-header-cell text-lavender">
                    <CheckCircle2 size={16} className="text-lavender" />
                    <span>PROXISPEAK SPATIAL WORKSPACE</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISONS.map((row, idx) => (
                <tr key={idx}>
                  <td className="td-feature">{row.feature}</td>
                  <td className="td-legacy">
                    <div className="table-cell-content">
                      <XCircle size={15} className="cell-icon icon-cross" />
                      <span>{row.traditional}</span>
                    </div>
                  </td>
                  <td className="td-proxi">
                    <div className="table-cell-content">
                      <CheckCircle2 size={15} className="cell-icon icon-check" />
                      <span>{row.proxispeak}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* How it Works Section */}
      <section className="landing-how" id="how-it-works" aria-labelledby="landing-how-title">
        <div className="landing-how-heading">
          <h2 id="landing-how-title">A room that makes the next conversation easier.</h2>
          <p>Presence is more than a green dot. In ProxiSpeak, where someone is changes how you connect.</p>
        </div>
        <div className="landing-how-steps">
          <article>
            <span>01</span>
            <div><h3>See who&apos;s around.</h3><p>Your team shares one live office map, so presence has a place.</p></div>
            <Users size={20} aria-hidden="true" />
          </article>
          <article>
            <span>02</span>
            <div><h3>Move closer.</h3><p>Walk with your keyboard or move across the floor with a pointer.</p></div>
            <Command size={20} aria-hidden="true" />
          </article>
          <article>
            <span>03</span>
            <div><h3>Talk when it fits.</h3><p>Nearby voice follows distance. Your microphone stays in your control.</p></div>
            <AudioLines size={20} aria-hidden="true" />
          </article>
        </div>
      </section>

      {/* Technical FAQ Accordion */}
      <section className="landing-faq-section" id="faq" aria-labelledby="faq-title">
        <div className="faq-header">
          <div className="engine-pill"><Sparkles size={13} /> <span>ARCHITECTURE &amp; PRIVACY</span></div>
          <h2 id="faq-title">Frequently asked technical questions.</h2>
          <p>Everything you need to know about the WebRTC mesh, spatial audio physics, and workspace security.</p>
        </div>
        <div className="faq-accordion-container">
          {FAQ_ITEMS.map((item, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div key={idx} className={`faq-card ${isOpen ? 'open' : ''}`}>
                <button
                  type="button"
                  className="faq-question-btn"
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                  aria-expanded={isOpen}
                >
                  <span className="faq-q-text">{item.q}</span>
                  <ChevronDown size={18} className={`faq-chevron ${isOpen ? 'rotated' : ''}`} />
                </button>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      className="faq-answer-pane"
                      initial={reducedMotion ? false : { opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={reducedMotion ? undefined : { opacity: 0, height: 0 }}
                      transition={{ duration: 0.22, ease: motionEase }}
                    >
                      <p>{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </section>

      {/* Close Call to Action */}
      <section className="landing-close" id="your-office" aria-labelledby="landing-close-title">
        <div>
          <h2 id="landing-close-title">Make room for the conversations in between.</h2>
          <p>Start with an account. Your team can meet you on the floor.</p>
        </div>
        <a className="button landing-close-button" href={authHref('register')} onClick={navigateToAuth('register')}>
          Create your account <ArrowUpRight size={17} />
        </a>
      </section>

      <footer className="landing-footer">
        <a className="landing-brand-link" href="/" aria-label="ProxiSpeak home"><Brand /></a>
        <span>Proximity, made human.</span>
        <a href={authHref('login')} onClick={navigateToAuth('login')}>Sign in</a>
        <span className="landing-demo-footnote">Map illustration uses sample data; no team members are shown here.</span>
      </footer>
    </motion.main>
  );
}

function Brand() {
  return <div className="brand-mark"><span className="brand-glyph"><i /><i /><i /></span><span>proxi<span>speak</span></span></div>;
}

export default App;
