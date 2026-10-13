import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { toast, Toaster } from 'sonner';
import useWebRTC from './hooks/useWebRTC';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './components/ui/dialog';
import './App.css';
import {
  ArrowUpRight, AudioLines, Check, Command, Copy, Eye, EyeOff, Headphones, LogOut, Mic,
  MicOff, Moon, Search,
  ShieldCheck, Sparkles, Sun, UserPlus, Users, Wifi,
} from 'lucide-react';
import OfficeCanvas from './components/OfficeCanvas';

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
  const [officeState, setOfficeState] = useState(() => ({
    officeId: 'main-office',
    name: 'The Commons',
    width: 1000,
    height: 700,
    obstacles: [],
    zones: [],
    users: [],
  }));
  const [peers, setPeers] = useState({});
  const [authError, setAuthError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [currentOfficeId] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('office') || 'main-office';
    }
    return 'main-office';
  });
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
  } = useWebRTC(socket, userId, token, currentOfficeId);
  const [search, setSearch] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [canvasFps, setCanvasFps] = useState(0);
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
    fetch(`${API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
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
  }, [token]);

  useEffect(() => {
    if (!token || authChecking) return undefined;
    const nextSocket = io(SOCKET_BASE_URL, { auth: { token } });
    nextSocket.on('connect', () => nextSocket.emit('office:join', { officeId: currentOfficeId }));
    nextSocket.on('office:state', setOfficeState);
    nextSocket.on('office:updated', (updated) => {
      setOfficeState((prev) => prev ? { ...prev, ...updated } : prev);
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
      const response = await fetch(`${API_BASE_URL}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
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

  const handleCopyMain = () => {
    const url = `${window.location.origin}/?office=${currentOfficeId}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    toast.success('Office link copied to clipboard!');
    setTimeout(() => setCopiedLink(false), 2000);
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
    updateSpatialAudio(myPos, curPeers);
  }, [updateSpatialAudio]);

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
    return <main className="loading-screen auth-verifying"><Brand /><div className="loading-indicator" /><span>Verifying your account…</span></main>;
  }

  if (!token) {
    const isRegister = authMode === 'register';
    const isAuthRoute = currentPath === '/login' || currentPath === '/register';
    return (
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
            <div className="auth-panel-label"><span className="auth-panel-mark" /><span>{isRegister ? 'CREATE AN ACCOUNT' : 'WELCOME BACK'}</span></div>
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
    );
  }

  const connected = Boolean(socket?.connected);
  const officeName = officeState?.name || 'The Commons';
  const waveScale = Math.max(0.55, Math.min(2.2, localVolume * 2.2));

  if (!officeState) {
    return <main className="loading-screen"><Brand /><div className="loading-indicator" /><span>Preparing your space…</span><button className="text-button" onClick={logout}>Sign out</button></main>;
  }

  return (
    <TooltipProvider>
      <main className={`app-shell ${isDarkMode ? 'dark-theme' : ''}`}>
      <header className="topbar">
        <div className="topbar-brand"><Brand /><span className="topbar-divider" /><div className="office-switcher" aria-label={`Current office: ${officeName}`}><span className="office-icon">C</span><span><strong>{officeName}</strong><small>Team office</small></span></div></div>
        <div className="topbar-center"><span className="connection-indicator" role="status"><span className={connected ? 'live-dot' : 'live-dot is-offline'} />{connected ? 'Connected' : 'Reconnecting'}</span><span className="topbar-separator" /><span className="privacy-label"><ShieldCheck size={14} /> Signed in</span></div>
        <div className="topbar-actions">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="icon-button theme-toggle-button"
                onClick={toggleTheme}
                aria-label="Toggle theme"
              >
                {isDarkMode ? <Sun size={17} /> : <Moon size={17} />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</TooltipContent>
          </Tooltip>
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

      <div className="workspace-layout">
        <section className="world-column">
          <div className="world-heading">
            <div className="world-heading-copy"><div className="eyebrow muted-eyebrow">{todayLabel} <span className="heading-dot">·</span> YOUR TEAM, IN REAL TIME</div><h1>{officeName}<span className="heading-period">.</span></h1><p>Move around the floor to find people and start a conversation.</p></div>
            <div className="world-heading-actions"><span className="people-count"><span className="heading-live-dot" /><strong>{people.length}</strong> {people.length === 1 ? 'person' : 'people'} here</span><div className="avatar-stack" aria-label={`${people.length} people in office`}>{people.slice(0, 4).map((person, i) => <span key={person.id} className={`mini-avatar mini-${i}`} style={{ background: person.self ? '#286b5e' : colors[i % colors.length] }}>{initials(person.name)}</span>)}{people.length > 4 && <span className="avatar-more">+{people.length - 4}</span>}</div></div>
          </div>

          <section className="office-card" aria-label="Live office map">
            <div className="map-topline"><div className="map-title"><span className="map-live-dot" /><span>LIVE OFFICE</span><span className="map-coordinates">/ FLOOR 01</span></div><div className="map-actions"><span className="map-legend"><i /> You <i className="legend-nearby" /> Nearby <i className="legend-wall" /> Wall</span></div></div>
            <div className="office-map-wrap">
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
            </div>
            <div className="map-bottomline"><span><Command size={13} /> Move with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys</span><button className="map-reset" aria-label="Focus office map" title="Focus office map" onClick={() => document.querySelector('.office-canvas')?.focus()}><span className="focus-ring" /> Focus map</button></div>
          </section>

          <div className="world-footnote"><Sparkles size={14} /><span>Sound changes with distance. Walls soften it; getting closer brings voices into focus.</span></div>
        </section>

        <aside className="people-sidebar">
          <div className="sidebar-heading"><div><div className="eyebrow muted-eyebrow">YOUR WORKSPACE</div><h2>In this office</h2></div></div>
          <div className="sidebar-summary"><div className="summary-icon"><Users size={16} /></div><div><strong>{people.length} {people.length === 1 ? 'person' : 'people'} around</strong><span>{people.length > 1 ? 'Your office is coming to life' : 'You’re the first one in'}</span></div></div>
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
            <div className="dock-context"><span className="dock-avatar">{initials(userName)}</span><span><strong>You’re in the office</strong><small>Walking around is always okay</small></span></div>
            <div className="dock-controls">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                className={`mic-button ${muted ? 'is-muted' : ''} ${isSpeaking ? 'is-speaking-btn' : ''}`}
                onClick={() => {
                  setMuted();
                  toast(muted ? 'Microphone unmuted' : 'Microphone muted', {
                    description: muted ? 'Teammates within hearing range can hear you.' : 'Your microphone is now muted.',
                  });
                }}
                aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                title="Toggle Microphone"
              >
                <span className="mic-icon-wrap">{muted ? <MicOff size={18} /> : <Mic size={18} />}</span>
                <span>{muted ? 'Mic off' : (isSpeaking ? 'Speaking' : 'Mic on')}</span>
              </motion.button>
            </div>
            <div className="dock-hint">
              <span className={`sound-wave ${isSpeaking ? 'is-active' : ''}`}>
                <i style={{ transform: isSpeaking ? `scaleY(${waveScale})` : undefined }} />
                <i style={{ transform: isSpeaking ? `scaleY(${waveScale})` : undefined }} />
                <i style={{ transform: isSpeaking ? `scaleY(${waveScale})` : undefined }} />
                <i style={{ transform: isSpeaking ? `scaleY(${waveScale})` : undefined }} />
                <i style={{ transform: isSpeaking ? `scaleY(${waveScale})` : undefined }} />
              </span>
              <span>{isSpeaking ? <b className="voice-speaking-label">Speaking…</b> : (muted ? <b>Microphone muted</b> : <>Nearby voice <b>ready</b></>)}</span>
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
              Share this office link with a teammate. They can sign in or create an account, then join you on the floor.
            </DialogDescription>
          </DialogHeader>

          <div className="invite-field-group">
            <label htmlFor="office-invite-link">Office link</label>
            <div className="invite-input-row">
              <input id="office-invite-link" readOnly value={`${window.location.origin}/?office=${currentOfficeId}`} />
              <button className="button button-primary" type="button" onClick={handleCopyMain}>
                {copiedLink ? <><Check size={14} style={{ marginRight: 4 }} /> Copied!</> : <><Copy size={14} style={{ marginRight: 4 }} /> Copy Link</>}
              </button>
            </div>
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

function LandingPage({ onNavigate }) {
  const reducedMotion = useReducedMotion();
  const [distance, setDistance] = useState(62);
  const nearby = distance <= 34;
  const teammateX = 316 + distance * 1.9;
  const authHref = (mode) => `/${mode}${window.location.search}`;
  const navigateToAuth = (mode) => (event) => {
    event.preventDefault();
    onNavigate(mode);
  };
  const motionEase = [0.16, 1, 0.3, 1];

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
            Create your office <ArrowUpRight size={16} />
          </a>
        </div>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <motion.div
          className="landing-hero-copy"
          initial={reducedMotion ? false : { opacity: 0, x: -22, filter: 'blur(5px)' }}
          animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
          transition={{ duration: reducedMotion ? 0 : 0.62, ease: motionEase }}
        >
          <h1 id="landing-title">Good work happens <em>within earshot.</em></h1>
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
