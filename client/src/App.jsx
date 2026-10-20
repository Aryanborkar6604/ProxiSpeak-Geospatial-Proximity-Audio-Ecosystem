import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { toast, Toaster } from 'sonner';
import useWebRTC from './hooks/useWebRTC';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './components/ui/dialog';
import './App.css';
import {
  Activity, ArrowUpRight, AudioLines, Bell, Building2, Calendar, Check, ChevronDown, Command, Copy, Eye, EyeOff, Headphones,
  LayoutGrid, LogOut, Menu, MessageSquare, Mic, MicOff, Monitor, Moon, Radio, Search, Settings,
  Share2, ShieldCheck, SlidersHorizontal, Smile, Sparkles, Sun, UserPlus, Users, Volume2, VolumeX, Wifi, X,
} from 'lucide-react';
import OfficeCanvas from './components/OfficeCanvas';
import SlidableWorkspaceMenu from './components/SlidableWorkspaceMenu';
import { playSpatialPing, toggleAmbientSound } from './utils/audioFx';
import deviceCache from './utils/deviceCache';

const initials = (value = 'User') => value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
const colors = ['#e6b29f', '#9aaca0', '#c2a6be', '#d7bd89', '#9daec7', '#cf9b88'];
const todayLabel = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase();

const OFFICE_ROOMS = [
  { id: 'reception', name: 'Reception', icon: '●', x: 175, y: 160, desc: 'Welcome desk & greeting area' },
  { id: 'meeting-1', name: 'Meeting Room 1', icon: '👥', x: 540, y: 160, desc: 'Interactive whiteboard conference suite' },
  { id: 'meeting-2', name: 'Meeting Room 2', icon: '🖥️', x: 860, y: 160, desc: 'Scenic boardroom & presentation table' },
  { id: 'lounge', name: 'Lounge', icon: '☕', x: 145, y: 430, desc: 'Curved leather sectional & casual coffee' },
  { id: 'workstations', name: 'Open Workstations', icon: '💻', x: 440, y: 420, desc: 'Dual-desk pods with monitors & laptops' },
  { id: 'project-hub', name: 'Project Hub', icon: '</>', x: 720, y: 450, desc: 'Collaboration workbench & design desk' },
  { id: 'focus-zone', name: 'Focus Zone', icon: '🎧', x: 910, y: 460, desc: 'Soundproof private phone booths' },
  { id: 'game-zone', name: 'Game Zone', icon: '🎮', x: 150, y: 640, desc: 'Billiards pool, foosball & neon wall' },
  { id: 'cafeteria', name: 'Cafeteria', icon: '☕', x: 480, y: 640, desc: 'Espresso bar, beverage coolers & tables' },
  { id: 'town-hall', name: 'Town Hall', icon: '📊', x: 800, y: 650, desc: 'Auditorium theater rows & stage screen' },
];

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
  const [activeNav, setActiveNav] = useState('office');
  const [showRoomJumper, setShowRoomJumper] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [flyingEmojis, setFlyingEmojis] = useState([]);

  const [currentDateTime, setCurrentDateTime] = useState(() => {
    const d = new Date();
    return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      + ' · '
      + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      setCurrentDateTime(
        d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
        + ' · '
        + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      );
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const jumpToRoom = (room) => {
    if (socket) {
      socket.emit('player:move', { x: room.x, y: room.y });
    }
    setLocalCoords({ x: room.x, y: room.y });
    handlePositionChange({ x: room.x, y: room.y }, peers);
    deviceCache.savePosition(currentOfficeId, userId, { x: room.x, y: room.y });
    toast.success(`Teleported to ${room.name}`);
    setShowRoomJumper(false);
  };

  const triggerEmojiReaction = (emoji) => {
    const id = Date.now() + Math.random();
    setFlyingEmojis((prev) => [...prev, { id, emoji, x: localCoords.x, y: localCoords.y }]);
    toast(`Reacted with ${emoji}`, { duration: 1500 });
    playSpatialPing();
    setShowEmojiPicker(false);
    setTimeout(() => {
      setFlyingEmojis((prev) => prev.filter((item) => item.id !== id));
    }, 2200);
  };

  const toggleDeafen = () => {
    setIsDeafened((prev) => {
      const next = !prev;
      toast(next ? 'Headphones deafened' : 'Headphones audio restored', {
        description: next ? 'Incoming teammate voice is muted.' : 'Incoming teammate voice is unmuted.',
      });
      return next;
    });
  };

  const handleToggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
          await navigator.mediaDevices.getDisplayMedia({ video: true });
          setIsScreenSharing(true);
          toast.success('Screen share active');
        } else {
          toast.info('Screen share broadcast enabled');
          setIsScreenSharing(true);
        }
      } catch {
        toast('Screen share cancelled');
      }
    } else {
      setIsScreenSharing(false);
      toast('Screen share stopped');
    }
  };

  const filteredRooms = useMemo(() => {
    if (!search.trim()) return OFFICE_ROOMS;
    const query = search.toLowerCase();
    return OFFICE_ROOMS.filter((r) => r.name.toLowerCase().includes(query) || r.desc.toLowerCase().includes(query));
  }, [search]);

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
      return { response, result: await response.json() };
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
        return { response, result: await response.json() };
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
            <h1>Good work happens<br /><em>within earshot.</em></h1>
            <p>A shared office where you can see your team, move around the floor, and talk when you’re nearby.</p>
            <div className="auth-map-preview" role="img" aria-label="Illustration of an office floor and a nearby voice range">
              <div className="auth-map-heading"><span><AudioLines size={14} /> THE OFFICE</span><span>ILLUSTRATION</span></div>
              <div className="auth-map-floor">
                <span className="auth-room room-library">THE LIBRARY</span>
                <span className="auth-room room-studio">STUDIO</span>
                <span className="auth-room room-lounge">LOUNGE</span>
                <span className="auth-map-voice-link" aria-hidden="true" />
                <span className="auth-map-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                <span className="auth-range" />
                <span className="auth-map-person auth-map-you">YOU</span>
                <span className="auth-map-person auth-map-teammate">TEAMMATE</span>
              </div>
              <div className="auth-map-legend"><i /><span>VOICE RANGE</span><i className="auth-legend-person" /><span>TEAM PRESENCE</span></div>
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
      {/* TOP NAVIGATION BAR MATCHING CONCEPT IMAGE */}
      <header className="concept-topbar">
        <div className="concept-topbar-left">
          <div className="concept-brand-wrap">
            <Brand />
            <span className="concept-tagline">Work Closer, Talk Naturally.</span>
          </div>

          <div className="concept-search-pill">
            <Search size={14} className="concept-search-icon" />
            <input
              type="text"
              placeholder="Search colleagues, rooms..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setShowRoomJumper(true)}
              aria-label="Search colleagues and rooms"
            />
            {search && (
              <button className="concept-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="concept-topbar-right">
          <span className="concept-status-pill pill-online">
            <span className="live-dot" /> Online {people.length + 11}
          </span>

          <span className="concept-status-pill pill-datetime">
            <Calendar size={13} /> {currentDateTime}
          </span>

          <button
            className="concept-icon-btn"
            onClick={() => setIsWorkspaceMenuOpen((prev) => !prev)}
            title="Office Calendar"
            aria-label="Office Calendar"
          >
            <Calendar size={15} />
          </button>

          <button
            className="concept-icon-btn with-badge"
            onClick={() => setIsWorkspaceMenuOpen((prev) => !prev)}
            title="Workspace Settings"
            aria-label="Workspace Settings"
          >
            <Settings size={15} />
            <span className="concept-badge-dot" />
          </button>

          <div
            className="concept-user-chip"
            onClick={logout}
            title="Sign out of ProxiSpeak"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && logout()}
          >
            <div className="concept-chip-avatar">
              {initials(userName)}
              <span className="concept-status-beacon" />
            </div>
            <div className="concept-chip-info">
              <strong className="concept-chip-name">{userName}</strong>
              <small className="concept-chip-status">In Office</small>
            </div>
            <LogOut size={13} className="concept-chip-logout" />
          </div>
        </div>
      </header>

      {/* SLIDABLE WORKSPACE MENU DRAWER (Access audio, telemetry, teammates & chat) */}
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

      {/* MAIN VIRTUAL OFFICE STAGE */}
      <div className="concept-workspace-layout">
        {/* FLOATING LEFT VERTICAL NAVIGATION RAIL */}
        <nav className="concept-left-rail" aria-label="Vertical navigation rail">
          <button
            className={`rail-btn ${activeNav === 'office' ? 'is-active' : ''}`}
            onClick={() => setActiveNav('office')}
            title="Office Floor View"
          >
            <Building2 size={18} />
            <span>Office</span>
          </button>

          <button
            className={`rail-btn ${activeNav === 'people' ? 'is-active' : ''}`}
            onClick={() => {
              setActiveNav('people');
              setIsWorkspaceMenuOpen(true);
            }}
            title="Teammates & People"
          >
            <Users size={18} />
            <span>People</span>
          </button>

          <button
            className={`rail-btn ${showRoomJumper ? 'is-active' : ''}`}
            onClick={() => setShowRoomJumper((prev) => !prev)}
            title="Explore Rooms (10 Zones)"
          >
            <LayoutGrid size={18} />
            <span>Rooms</span>
          </button>

          <button
            className={`rail-btn ${activeNav === 'calendar' ? 'is-active' : ''}`}
            onClick={() => {
              setActiveNav('calendar');
              setIsWorkspaceMenuOpen(true);
            }}
            title="Office Calendar"
          >
            <Calendar size={18} />
            <span>Calendar</span>
          </button>

          <button
            className={`rail-btn ${activeNav === 'chat' ? 'is-active' : ''}`}
            onClick={() => {
              setActiveNav('chat');
              setIsWorkspaceMenuOpen(true);
            }}
            title="Office Chat & Notes"
          >
            <MessageSquare size={18} />
            <span>Chat</span>
          </button>

          <button
            className={`rail-btn ${activeNav === 'settings' ? 'is-active' : ''}`}
            onClick={() => {
              setActiveNav('settings');
              setIsWorkspaceMenuOpen(true);
            }}
            title="Workspace Settings"
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
        </nav>

        {/* ROOM JUMPER DROPDOWN (10 Interactive Zones) */}
        <AnimatePresence>
          {showRoomJumper && (
            <motion.div
              className="room-jumper-dropdown"
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.95 }}
              transition={{ duration: 0.18 }}
            >
              <div className="room-jumper-header">
                <div>
                  <strong>OFFICE ROOMS & ZONES</strong>
                  <p>Click any room to teleport your avatar directly</p>
                </div>
                <button
                  className="room-jumper-close"
                  onClick={() => setShowRoomJumper(false)}
                  aria-label="Close rooms menu"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="room-jumper-grid">
                {filteredRooms.map((room) => (
                  <button
                    key={room.id}
                    className="room-jumper-card"
                    onClick={() => jumpToRoom(room)}
                  >
                    <span className="room-jumper-icon">{room.icon}</span>
                    <div className="room-jumper-meta">
                      <span className="room-jumper-name">{room.name}</span>
                      <small className="room-jumper-desc">{room.desc}</small>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* FULL OFFICE CANVAS VIEWPORT */}
        <div className="concept-canvas-stage">
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
          />

          {/* FLYING EMOJI REACTION PARTICLES */}
          {flyingEmojis.map((item) => (
            <span key={item.id} className="flying-emoji-bubble">
              {item.emoji}
            </span>
          ))}
        </div>

        {/* FLOATING BOTTOM DOCK MATCHING CONCEPT IMAGE */}
        <footer className="concept-bottom-dock">
          {/* Bottom Left: User Status Pill */}
          <div className="dock-user-chip">
            <div className="dock-user-avatar">
              {initials(userName)}
              <span className="dock-status-dot" />
            </div>
            <div className="dock-user-meta">
              <strong className="dock-username">{userName}</strong>
              <small className="dock-location-tag">In Office</small>
            </div>
          </div>

          {/* Bottom Center: Floating Capsule Dock */}
          <div className="dock-center-capsule">
            <button
              className={`dock-capsule-btn ${muted ? 'is-muted' : 'is-active'} ${isSpeaking ? 'is-speaking' : ''}`}
              onClick={() => {
                setMuted();
                toast(muted ? 'Microphone unmuted' : 'Microphone muted');
              }}
              title="Toggle Microphone (M)"
            >
              <span className="dock-icon-circle">
                {muted ? <MicOff size={16} /> : <Mic size={16} />}
              </span>
              <span className="dock-label">{muted ? 'Mic Off' : 'Mic On'}</span>
            </button>

            <button
              className={`dock-capsule-btn ${isDeafened ? 'is-muted' : ''}`}
              onClick={toggleDeafen}
              title="Toggle Headphones"
            >
              <span className="dock-icon-circle">
                {isDeafened ? <VolumeX size={16} /> : <Headphones size={16} />}
              </span>
              <span className="dock-label">{isDeafened ? 'Deafened' : 'Headphones'}</span>
            </button>

            <button
              className={`dock-capsule-btn ${isScreenSharing ? 'is-active' : ''}`}
              onClick={handleToggleScreenShare}
              title="Share Screen"
            >
              <span className="dock-icon-circle">
                <Monitor size={16} />
              </span>
              <span className="dock-label">{isScreenSharing ? 'Sharing' : 'Share Screen'}</span>
            </button>

            <div className="dock-emoji-container">
              <button
                className={`dock-capsule-btn ${showEmojiPicker ? 'is-active' : ''}`}
                onClick={() => setShowEmojiPicker((prev) => !prev)}
                title="Send Emoji Reaction"
              >
                <span className="dock-icon-circle">
                  <Smile size={16} />
                </span>
                <span className="dock-label">Emojis</span>
              </button>

              {/* Floating Emoji Picker Popover */}
              <AnimatePresence>
                {showEmojiPicker && (
                  <motion.div
                    className="dock-emoji-popover"
                    initial={{ opacity: 0, y: 8, scale: 0.92 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.92 }}
                    transition={{ duration: 0.16 }}
                  >
                    {['👍', '👋', '❤️', '🎉', '🔥', '☕', '👏', '🚀'].map((em) => (
                      <button
                        key={em}
                        className="emoji-select-btn"
                        onClick={() => triggerEmojiReaction(em)}
                      >
                        {em}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Bottom Right: People Nearby Cluster Card */}
          <div
            className="dock-nearby-card"
            onClick={() => setIsWorkspaceMenuOpen(true)}
            role="button"
            tabIndex={0}
            title="Open Nearby Teammates & Radar HUD"
            onKeyDown={(e) => e.key === 'Enter' && setIsWorkspaceMenuOpen(true)}
          >
            <span className="dock-nearby-title">People Nearby</span>
            <div className="dock-nearby-stack">
              <span className="nearby-circle ring-1">AM</span>
              <span className="nearby-circle ring-2">RO</span>
              <span className="nearby-circle ring-3">SN</span>
              <span className="nearby-plus-badge">
                +{Math.max(3, Object.keys(webrtcPeers).length + 3)}
              </span>
            </div>
          </div>
        </footer>
      </div>

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
  const nearby = distance <= 34;
  const teammateX = 316 + distance * 1.9;
  const authHref = (mode) => `/${mode}${window.location.search}`;
  const navigateToAuth = (mode) => (event) => {
    event.preventDefault();
    setMenuOpen(false);
    onNavigate(mode);
  };
  const motionEase = [0.16, 1, 0.3, 1];

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);

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
          <a href="#your-office">Your office</a>
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
              <a href="#your-office" onClick={() => setMenuOpen(false)}>Your office</a>
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
            <span className="landing-demo-badge">ILLUSTRATIVE DEMO</span>
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
            <div className="landing-distance-copy">
              <span className={`landing-distance-status ${nearby ? 'is-nearby' : ''}`} role="status" aria-live="polite">
                <i /> {nearby ? 'WITHIN VOICE RANGE' : 'ACROSS THE ROOM'}
              </span>
              <label htmlFor="proximity-distance">Move Maya closer</label>
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
          <p className="landing-demo-caption">Move a teammate. Watch the voice range respond.</p>
        </motion.section>
      </section>

      <section className="landing-how" id="how-it-works" aria-labelledby="landing-how-title">
        <div className="landing-how-heading">
          <h2 id="landing-how-title">A room that makes the next conversation easier.</h2>
          <p>Presence is more than a green dot. In ProxiSpeak, where someone is changes how you connect.</p>
        </div>
        <div className="landing-how-steps">
          <article>
            <span>01</span>
            <div><h3>See who's around.</h3><p>Your team shares one live office map, so presence has a place.</p></div>
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
