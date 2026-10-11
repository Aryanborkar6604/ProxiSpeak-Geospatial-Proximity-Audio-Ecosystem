import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import useWebRTC from './hooks/useWebRTC';
import './App.css';
import {
  ArrowUpRight, AudioLines, Check, ChevronDown, CircleHelp,
  Command, Copy, Headphones, LogOut, Mic, MicOff, Moon, MoreHorizontal, Search,
  Settings2, ShieldCheck, Sparkles, Sun, UserPlus, Users, Wifi, X,
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

const API_BASE_URL = `${getBackendBase()}/api`;
const SOCKET_BASE_URL = getBackendBase();

function App() {
  const [socket, setSocket] = useState(null);
  const [token, setToken] = useState(() => sessionStorage.getItem('token') || localStorage.getItem('token'));
  const [userId, setUserId] = useState(() => sessionStorage.getItem('userId') || localStorage.getItem('userId'));
  const [userName, setUserName] = useState(() => sessionStorage.getItem('userName') || localStorage.getItem('userName') || 'You');
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
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const {
    requestMic,
    micPermissionState,
    isMuted: muted,
    toggleMute: setMuted,
    nearbyPeers: webrtcPeers,
    updateSpatialAudio,
    isSpeaking,
    localVolume,
    speakingPeers,
    mutedPeers,
    peerAttenuations,
  } = useWebRTC(socket, userId);
  const [search, setSearch] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedLan, setCopiedLan] = useState(false);

  const [currentOfficeId] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('office') || 'main-office';
    }
    return 'main-office';
  });

  const toggleTheme = () => {
    setIsDarkMode((prev) => {
      const next = !prev;
      localStorage.setItem('theme', next ? 'dark' : 'light');
      return next;
    });
  };

  useEffect(() => {
    if (!token) return undefined;
    const nextSocket = io(SOCKET_BASE_URL, { auth: { token } });
    nextSocket.on('connect', () => nextSocket.emit('office:join', { officeId: currentOfficeId }));
    nextSocket.on('office:state', setOfficeState);
    nextSocket.on('office:updated', (updated) => {
      setOfficeState((prev) => prev ? { ...prev, ...updated } : prev);
    });
    nextSocket.on('connect_error', (error) => {
      if (error.message.includes('Authentication error')) {
        localStorage.removeItem('token');
        localStorage.removeItem('userId');
        localStorage.removeItem('userName');
        setToken(null);
        setUserId(null);
        setUserName('You');
      }
    });
    setSocket(nextSocket);
    return () => nextSocket.close();
  }, [token, currentOfficeId]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoginError('');
    setLoginBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), name: form.get('name') }),
      });
      const result = await response.json();
      if (!response.ok || !result.token) throw new Error(result.error || 'Could not sign in. Please try again.');
      sessionStorage.setItem('token', result.token);
      sessionStorage.setItem('userId', result.user.userId);
      sessionStorage.setItem('userName', result.user.name);
      localStorage.setItem('token', result.token);
      localStorage.setItem('userId', result.user.userId);
      localStorage.setItem('userName', result.user.name);
      setUserId(result.user.userId);
      setUserName(result.user.name);
      setToken(result.token);
    } catch (error) {
      setLoginError(error.message || 'Unable to reach ProxiSpeak. Check that the server is running.');
    } finally {
      setLoginBusy(false);
    }
  };

  const handleCopyMain = () => {
    const url = `${window.location.origin}/?office=${currentOfficeId}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyLan = () => {
    const url = `http://172.30.240.63:5173/?office=${currentOfficeId}`;
    navigator.clipboard.writeText(url);
    setCopiedLan(true);
    setTimeout(() => setCopiedLan(false), 2000);
  };

  const logout = () => {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('userId');
    sessionStorage.removeItem('userName');
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('userName');
    setToken(null);
    setUserId(null);
    setUserName('You');
    setOfficeState(null);
    setPeers({});
  };

  const handlePositionChange = useCallback((myPos, curPeers) => {
    updateSpatialAudio(myPos, curPeers);
  }, [updateSpatialAudio]);

  const people = useMemo(() => {
    const self = userId ? [{ id: userId, name: 'You', self: true, position: null }] : [];
    return [...self, ...Object.entries(peers).map(([id, position], index) => ({ id, name: `Teammate ${index + 1}`, position }))];
  }, [peers, userId]);
  const visiblePeople = people.filter((person) => person.name.toLowerCase().includes(search.toLowerCase()));

  if (!token) {
    return (
      <main className="login-shell">
        <div className="login-visual">
          <div className="login-topline"><Brand /><span className="login-note"><ShieldCheck size={15} /> Private by design</span></div>
          <div className="login-copy">
            <div className="eyebrow"><span className="live-dot" /> YOUR SPACE, TOGETHER</div>
            <h1>Work feels<br />better <em>closer.</em></h1>
            <p>A shared office for the moments that make work, work. Drop in, find your people, and let conversation happen naturally.</p>
            <div className="login-quote"><AudioLines size={19} /><span>Good ideas have a way of finding each other.</span></div>
          </div>
          <div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" />
          <div className="login-visual-footer"><span>PROXIMITY, MADE HUMAN</span><span>01 — 04</span></div>
        </div>
        <section className="login-panel">
          <div className="login-panel-inner">
            <span className="overline">WELCOME TO YOUR OFFICE</span>
            <h2>Come on in.</h2>
            <p className="login-subtitle">Sign in to join your team's shared space.</p>
            <form className="login-form" onSubmit={handleLogin}>
              <label htmlFor="name">Your name</label>
              <input id="name" name="name" autoComplete="name" placeholder="e.g. Alex Morgan" required />
              <label htmlFor="email">Work email</label>
              <input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
              {loginError && <p className="form-error" role="alert">{loginError}</p>}
              <button className="button button-primary login-submit" type="submit" disabled={loginBusy}>
                {loginBusy ? 'Opening your office…' : 'Enter your office'} <ArrowUpRight size={17} />
              </button>
            </form>
            <div className="login-privacy"><ShieldCheck size={15} /><span>Your conversations stay yours. Audio is never recorded.</span></div>
            <div className="login-bottom"><span>Need a hand?</span><button type="button" className="text-button"><CircleHelp size={15} /> Get help</button></div>
          </div>
        </section>
      </main>
    );
  }

  const connected = Boolean(socket?.connected);
  const officeName = officeState?.name || 'The Commons';
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? 'Good morning' : currentHour < 18 ? 'Good afternoon' : 'Good evening';

  if (!officeState) {
    return <main className="loading-screen"><Brand /><div className="loading-indicator" /><span>Preparing your space…</span><button className="text-button" onClick={logout}>Sign out</button></main>;
  }

  return (
    <main className={`app-shell ${isDarkMode ? 'dark-theme' : ''}`}>
      <header className="topbar">
        <div className="topbar-brand"><Brand /><span className="topbar-divider" /><button className="office-switcher"><span className="office-icon">C</span><span><strong>{officeName}</strong><small>Workspace</small></span><ChevronDown size={15} /></button></div>
        <div className="topbar-center"><span className="connection-indicator"><span className={connected ? 'live-dot' : 'live-dot is-offline'} />{connected ? 'All systems clear' : 'Reconnecting'}</span><span className="topbar-separator" /><span className="privacy-label"><ShieldCheck size={14} /> End-to-end private</span></div>
        <div className="topbar-actions">
          <button
            className="icon-button theme-toggle-button"
            onClick={toggleTheme}
            title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle theme"
          >
            {isDarkMode ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button className="button button-primary" style={{ height: 34, padding: '0 12px', borderRadius: 9, fontSize: 11, gap: 6 }} onClick={() => setShowInviteModal(true)}>
            <UserPlus size={14} /> <span>Invite</span>
          </button>
          <button className="icon-button help-button" aria-label="Help"><CircleHelp size={18} /></button>
          <button className="profile-button" onClick={logout} title="Sign out"><span className="profile-avatar">{initials(userName)}</span><span className="profile-name">{userName}</span><LogOut size={15} /></button>
        </div>
      </header>

      <div className="workspace-layout">
        <section className="world-column">
          <div className="world-heading">
            <div><div className="eyebrow muted-eyebrow">{todayLabel} <span className="heading-dot">·</span> YOUR TEAM, IN REAL TIME</div><h1>{greeting}<span className="heading-period">.</span></h1><p>Take a look around. Your people are just a little closer.</p></div>
            <div className="world-heading-actions"><div className="avatar-stack" aria-label={`${people.length} people in office`}>{people.slice(0, 4).map((person, i) => <span key={person.id} className={`mini-avatar mini-${i}`} style={{ background: person.self ? '#286b5e' : colors[i % colors.length] }}>{initials(person.name)}</span>)}{people.length > 4 && <span className="avatar-more">+{people.length - 4}</span>}</div><span className="people-count"><strong>{people.length}</strong> here now</span></div>
          </div>

          <section className="office-card" aria-label="Live office map">
            <div className="map-topline"><div className="map-title"><span className="map-live-dot" /><span>LIVE OFFICE</span><span className="map-coordinates">/ FLOOR 01</span></div><div className="map-actions"><span className="map-legend"><i /> You <i className="legend-nearby" /> Nearby <i className="legend-wall" /> Wall</span><button className="map-icon-button" aria-label="Map options"><MoreHorizontal size={19} /></button></div></div>
            <div className="office-map-wrap">
              <OfficeCanvas 
                socket={socket} 
                officeState={officeState} 
                localUserId={userId} 
                onPeersChange={setPeers} 
                onPositionChange={handlePositionChange}
                nearbyPeers={webrtcPeers}
                speakingPeers={speakingPeers}
                mutedPeers={mutedPeers}
                isSpeaking={isSpeaking}
                isMuted={muted}
                peerAttenuations={peerAttenuations}
                isDarkMode={isDarkMode}
              />
            </div>
            <div className="map-bottomline"><span><Command size={13} /> Move around with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys</span><button className="map-reset" onClick={() => document.querySelector('.office-canvas')?.focus()}><span className="focus-ring" /> Click map to focus</button></div>
          </section>

          <div className="world-footnote"><Sparkles size={14} /><span>Sound travels naturally: walls muffle sound, proximity brings clarity.</span><button className="text-button" type="button">How proximity works <ArrowUpRight size={13} /></button></div>
        </section>

        <aside className="people-sidebar">
          <div className="sidebar-heading"><div><div className="eyebrow muted-eyebrow">YOUR WORKSPACE</div><h2>The people</h2></div><button className="icon-button" aria-label="Workspace settings"><Settings2 size={18} /></button></div>
          <div className="sidebar-summary"><div className="summary-icon"><Users size={16} /></div><div><strong>{people.length} {people.length === 1 ? 'person' : 'people'} around</strong><span>{people.length > 1 ? 'Your office is coming to life' : 'You’re the first one in'}</span></div></div>
          <div className="people-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find someone…" aria-label="Find someone" /><kbd>/</kbd></div>
          <div className="people-section-label"><span>IN THE OFFICE</span><span>{people.length.toString().padStart(2, '0')}</span></div>
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
          <div className="quiet-card"><div className="quiet-card-icon"><Headphones size={17} /></div><div><strong>Spatial Audio Live</strong><p>Voices scale by distance. Approach peers to speak naturally.</p></div></div>
          <div className="sidebar-footer">
            <span><span className="live-dot" /> Your space is live</span>
            <button className="text-button" type="button" onClick={() => setShowInviteModal(true)}>
              Invite teammates <ArrowUpRight size={13} />
            </button>
          </div>
        </aside>
      </div>

      <div className="control-dock">
        {micPermissionState !== 'granted' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '0 16px' }}>
            {micPermissionState === 'insecure_context' ? (
              <span style={{ fontSize: 11, color: '#c45a4f' }}>
                <Mic size={16} style={{ verticalAlign: 'middle', marginRight: 6 }}/>
                Microphone requires secure origin (HTTPS/localhost). For Wi-Fi IP in Chrome, enable: <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>
              </span>
            ) : (
              <>
                <span><Mic size={18} style={{ verticalAlign: 'middle', marginRight: 8 }}/> ProxiSpeak needs microphone access for nearby audio</span>
                <button className="button button-primary" onClick={requestMic}>Enable Microphone</button>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="dock-context"><span className="dock-avatar">{initials(userName)}</span><span><strong>You’re in the office</strong><small>Walking around is always okay</small></span></div>
            <div className="dock-controls">
              <button
                className={`mic-button ${muted ? 'is-muted' : ''} ${isSpeaking ? 'is-speaking-btn' : ''}`}
                onClick={setMuted}
                aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                title="Toggle Microphone"
              >
                <span className="mic-icon-wrap">{muted ? <MicOff size={18} /> : <Mic size={18} />}</span>
                <span>{muted ? 'Mic off' : (isSpeaking ? 'Speaking' : 'Mic on')}</span>
              </button>
              <span className="dock-divider" />
              <button className="headphones-button" aria-label="Audio settings"><Headphones size={17} /><span>Audio</span><ChevronDown size={14} /></button>
            </div>
            <div className="dock-hint">
              <span className={`sound-wave ${isSpeaking ? 'is-active' : ''}`}>
                <i style={{ height: isSpeaking ? `${Math.max(6, Math.round(localVolume * 22))}px` : undefined }} />
                <i style={{ height: isSpeaking ? `${Math.max(9, Math.round(localVolume * 26))}px` : undefined }} />
                <i style={{ height: isSpeaking ? `${Math.max(12, Math.round(localVolume * 30))}px` : undefined }} />
                <i style={{ height: isSpeaking ? `${Math.max(9, Math.round(localVolume * 26))}px` : undefined }} />
                <i style={{ height: isSpeaking ? `${Math.max(6, Math.round(localVolume * 22))}px` : undefined }} />
              </span>
              <span>{isSpeaking ? <b style={{ color: '#2FD38B' }}>Speaking…</b> : (muted ? <b style={{ color: '#888' }}>Muted</b> : <>Ambient mode <b>Active</b></>)}</span>
            </div>
          </>
        )}
      </div>

      {showInviteModal && (
        <div className="invite-modal-overlay" onClick={() => setShowInviteModal(false)}>
          <div className="invite-modal" onClick={(e) => e.stopPropagation()}>
            <div className="invite-modal-header">
              <div>
                <span className="overline">INVITE TEAMMATES</span>
                <h2>Join your office space</h2>
              </div>
              <button className="icon-button" onClick={() => setShowInviteModal(false)} aria-label="Close modal">
                <X size={18} />
              </button>
            </div>

            <p className="invite-desc">
              Share an invite link with your friends. Once they open it and enable their microphone, you can walk close to each other on the map to speak in real-time!
            </p>

            <div className="invite-field-group">
              <label>Direct Invite Link</label>
              <div className="invite-input-row">
                <input readOnly value={`${window.location.origin}/?office=${currentOfficeId}`} />
                <button className="button button-primary" onClick={handleCopyMain}>
                  {copiedLink ? <><Check size={14} style={{ marginRight: 4 }} /> Copied!</> : <><Copy size={14} style={{ marginRight: 4 }} /> Copy Link</>}
                </button>
              </div>
            </div>

            <div className="invite-field-group" style={{ marginTop: '16px' }}>
              <label>Wi-Fi / Local Network Link (for friends on same Wi-Fi)</label>
              <div className="invite-input-row">
                <input readOnly value={`http://172.30.240.63:5173/?office=${currentOfficeId}`} />
                <button className="button button-secondary" onClick={handleCopyLan}>
                  {copiedLan ? <><Check size={14} style={{ marginRight: 4 }} /> Copied!</> : <><Copy size={14} style={{ marginRight: 4 }} /> Copy Wi-Fi Link</>}
                </button>
              </div>
              <small style={{ color: '#888', marginTop: '6px', display: 'block', fontSize: 10 }}>
                Give this link to anyone connected to the same Wi-Fi router.
              </small>
            </div>

            <div className="invite-steps">
              <h4>How proximity voice works:</h4>
              <ol>
                <li>Your friend opens the link in their browser and enters their name.</li>
                <li>They click <strong>Enable Microphone</strong> in the bottom bar.</li>
                <li>Walk your avatars close together on the office floor.</li>
                <li>High-quality peer-to-peer audio connects automatically!</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      <footer className="app-footer"><span>PROXISPEAK <i>·</i> A MORE HUMAN WAY TO WORK</span><span><Wifi size={13} /> Low latency <span className="footer-divider">/</span> Built for being together</span></footer>
    </main>
  );
}

function Brand() {
  return <div className="brand-mark"><span className="brand-glyph"><i /><i /><i /></span><span>proxi<span>speak</span></span></div>;
}

export default App;
