import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import useWebRTC from './hooks/useWebRTC';
import './App.css';
import {
  ArrowUpRight, AudioLines, ChevronDown, CircleHelp,
  Command, Headphones, LogOut, Mic, MicOff, MoreHorizontal, Search,
  Settings2, ShieldCheck, Sparkles, Users, Wifi,
} from 'lucide-react';
import OfficeCanvas from './components/OfficeCanvas';

const initials = (value = 'User') => value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
const colors = ['#e6b29f', '#9aaca0', '#c2a6be', '#d7bd89', '#9daec7', '#cf9b88'];
const todayLabel = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase();

function App() {
  const [socket, setSocket] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [userId, setUserId] = useState(() => localStorage.getItem('userId'));
  const [userName, setUserName] = useState(() => localStorage.getItem('userName') || 'You');
  const [officeState, setOfficeState] = useState(null);
  const [peers, setPeers] = useState({});
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const { requestMic, micPermissionState, isMuted: muted, toggleMute: setMuted, nearbyPeers: webrtcPeers } = useWebRTC(socket, userId);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!token) return undefined;
    const nextSocket = io(import.meta.env.VITE_SOCKET_URL, { auth: { token } });
    nextSocket.on('connect', () => nextSocket.emit('office:join', { officeId: 'main-office' }));
    nextSocket.on('office:state', setOfficeState);
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
  }, [token]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoginError('');
    setLoginBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), name: form.get('name') }),
      });
      const result = await response.json();
      if (!response.ok || !result.token) throw new Error(result.error || 'Could not sign in. Please try again.');
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

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('userName');
    setToken(null);
    setUserId(null);
    setUserName('You');
    setOfficeState(null);
    setPeers({});
  };

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
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-brand"><Brand /><span className="topbar-divider" /><button className="office-switcher"><span className="office-icon">C</span><span><strong>{officeName}</strong><small>Workspace</small></span><ChevronDown size={15} /></button></div>
        <div className="topbar-center"><span className="connection-indicator"><span className={connected ? 'live-dot' : 'live-dot is-offline'} />{connected ? 'All systems clear' : 'Reconnecting'}</span><span className="topbar-separator" /><span className="privacy-label"><ShieldCheck size={14} /> End-to-end private</span></div>
        <div className="topbar-actions"><button className="icon-button help-button" aria-label="Help"><CircleHelp size={18} /></button><button className="profile-button" onClick={logout} title="Sign out"><span className="profile-avatar">{initials(userName)}</span><span className="profile-name">{userName}</span><LogOut size={15} /></button></div>
      </header>

      <div className="workspace-layout">
        <section className="world-column">
          <div className="world-heading">
            <div><div className="eyebrow muted-eyebrow">{todayLabel} <span className="heading-dot">·</span> YOUR TEAM, IN REAL TIME</div><h1>{greeting}<span className="heading-period">.</span></h1><p>Take a look around. Your people are just a little closer.</p></div>
            <div className="world-heading-actions"><div className="avatar-stack" aria-label={`${people.length} people in office`}>{people.slice(0, 4).map((person, i) => <span key={person.id} className={`mini-avatar mini-${i}`} style={{ background: person.self ? '#286b5e' : colors[i % colors.length] }}>{initials(person.name)}</span>)}{people.length > 4 && <span className="avatar-more">+{people.length - 4}</span>}</div><span className="people-count"><strong>{people.length}</strong> here now</span></div>
          </div>

          <section className="office-card" aria-label="Live office map">
            <div className="map-topline"><div className="map-title"><span className="map-live-dot" /><span>LIVE OFFICE</span><span className="map-coordinates">/ FLOOR 01</span></div><div className="map-actions"><span className="map-legend"><i /> You <i className="legend-nearby" /> Nearby</span><button className="map-icon-button" aria-label="Map options"><MoreHorizontal size={19} /></button></div></div>
            <div className="office-map-wrap"><OfficeCanvas socket={socket} officeState={officeState} localUserId={userId} onPeersChange={setPeers} /></div>
            <div className="map-bottomline"><span><Command size={13} /> Move around with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys</span><button className="map-reset" onClick={() => document.querySelector('.office-canvas')?.focus()}><span className="focus-ring" /> Click map to focus</button></div>
          </section>

          <div className="world-footnote"><Sparkles size={14} /><span>Conversations happen when you’re close. Wander over to say hello.</span><button className="text-button" type="button">How proximity works <ArrowUpRight size={13} /></button></div>
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
              return (
                <div className="person-row" key={person.id}>
                  <div className="person-avatar-wrap">
                    <span className="person-avatar" style={{ background: getSidebarColor(person.id) }}>
                      {person.self ? initials(userName) : initials(person.name)}
                    </span>
                    <i className={person.self || webrtcPeers[person.id] ? "presence-dot is-nearby" : "presence-dot"} />
                  </div>
                  <div className="person-info">
                    <strong>{person.self ? userName : person.name}</strong>
                    <span>{person.self ? 'Finding your place' : (webrtcPeers[person.id] ? 'Nearby' : 'At their desk')}</span>
                  </div>
                  <span className="person-status" style={{ color: webrtcPeers[person.id] ? '#1FA896' : undefined }}>
                    {person.self ? 'YOU' : (webrtcPeers[person.id] ? 'NEARBY' : 'HERE')}
                  </span>
                </div>
              );
            })}
            {visiblePeople.length === 0 && <div className="empty-search">No one by that name yet.</div>}
          </div>
          <div className="sidebar-spacer" />
          <div className="quiet-card"><div className="quiet-card-icon"><Headphones size={17} /></div><div><strong>A little room to breathe</strong><p>Voice is in preview. Proximity audio will be available here soon.</p></div></div>
          <div className="sidebar-footer"><span><span className="live-dot" /> Your space is live</span><button className="text-button" type="button">Invite teammates <ArrowUpRight size={13} /></button></div>
        </aside>
      </div>

      <div className="control-dock">
        {micPermissionState !== 'granted' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '0 16px' }}>
            <span><Mic size={18} style={{ verticalAlign: 'middle', marginRight: 8 }}/> ProxiSpeak needs microphone access for nearby audio</span>
            <button className="button button-primary" onClick={requestMic}>Enable Microphone</button>
          </div>
        ) : (
          <>
            <div className="dock-context"><span className="dock-avatar">{initials(userName)}</span><span><strong>You’re in the office</strong><small>Walking around is always okay</small></span></div>
            <div className="dock-controls">
              <button className={`mic-button ${muted ? 'is-muted' : ''}`} onClick={setMuted} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} title="Toggle Microphone">
                <span className="mic-icon-wrap">{muted ? <MicOff size={18} /> : <Mic size={18} />}</span>
                <span>{muted ? 'Mic off' : 'Mic on'}</span>
              </button>
              <span className="dock-divider" />
              <button className="headphones-button" aria-label="Audio settings"><Headphones size={17} /><span>Audio</span><ChevronDown size={14} /></button>
            </div>
            <div className="dock-hint"><span className="sound-wave"><i /><i /><i /><i /><i /></span><span>Ambient mode <b>Active</b></span></div>
          </>
        )}
      </div>
      <footer className="app-footer"><span>PROXISPEAK <i>·</i> A MORE HUMAN WAY TO WORK</span><span><Wifi size={13} /> Low latency <span className="footer-divider">/</span> Built for being together</span></footer>
    </main>
  );
}

function Brand() {
  return <div className="brand-mark"><span className="brand-glyph"><i /><i /><i /></span><span>proxi<span>speak</span></span></div>;
}

export default App;
