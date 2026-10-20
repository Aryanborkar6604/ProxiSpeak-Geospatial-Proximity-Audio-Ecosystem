import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Users, 
  MessageSquare, 
  Send, 
  Search, 
  Radio, 
  MapPin, 
  UserCheck, 
  Sparkles, 
  X,
  SlidersHorizontal,
  Sun,
  Moon,
  UserPlus,
  LogOut,
  Activity,
  Headphones,
  VolumeX,
  ShieldCheck,
  Compass
} from 'lucide-react';

export default function SlidableWorkspaceMenu({
  isOpen,
  onToggle,
  people = [],
  peers = {},
  localCoords = { x: 175, y: 335 },
  userId,
  userName = 'You',
  socket,
  webrtcPeers = {},
  speakingPeers = {},
  mutedPeers = {},
  peerAttenuations = {},
  onJumpToUser,
  officeName = 'The Commons',
  todayLabel = '',
  isAmbienceOn = false,
  onToggleAmbience,
  onTestPing,
  isDarkMode = true,
  onToggleTheme,
  onInvite,
  onLogout,
  closestPeerInfo,
  micPermissionState = 'prompt',
}) {
  const [activeTab, setActiveTab] = useState('live'); // 'live' | 'chat' | 'tools'
  const [search, setSearch] = useState('');
  const [chatMode, setChatMode] = useState('office'); // 'office' | 'dm'
  const [directUser, setDirectUser] = useState(null); // { id, name }
  const [chatMessages, setChatMessages] = useState([
    {
      id: 'welcome_1',
      senderId: 'system',
      senderName: 'ProxiSpeak System',
      text: 'Welcome to the office! Messages sent in #office are visible to everyone currently connected.',
      timestamp: new Date().toISOString(),
      mode: 'office',
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef(null);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onToggle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onToggle]);

  // Auto-scroll chat to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages, activeTab]);

  // Listen for real-time incoming chat messages from server socket
  useEffect(() => {
    if (!socket) return;

    const handleChatMessage = (msg) => {
      setChatMessages((prev) => [...prev.slice(-199), msg]);
      if (!isOpen || activeTab !== 'chat') {
        setUnreadCount((c) => c + 1);
      }
    };

    socket.on('chat:message', handleChatMessage);
    return () => {
      socket.off('chat:message', handleChatMessage);
    };
  }, [socket, isOpen, activeTab]);

  // Clear unread count when switching to chat tab while open
  useEffect(() => {
    if (isOpen && activeTab === 'chat') {
      setUnreadCount(0);
    }
  }, [isOpen, activeTab]);

  // Filter live people by search
  const visiblePeople = useMemo(() => {
    return people.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  }, [people, search]);

  // Filter messages for current mode (office vs direct user)
  const currentMessages = useMemo(() => {
    if (chatMode === 'office') {
      return chatMessages.filter((m) => m.mode === 'office');
    }
    if (chatMode === 'dm' && directUser) {
      return chatMessages.filter(
        (m) =>
          m.mode === 'dm' &&
          ((m.senderId === userId && m.targetUserId === directUser.id) ||
           (m.senderId === directUser.id && m.targetUserId === userId))
      );
    }
    return [];
  }, [chatMessages, chatMode, directUser, userId]);

  const handleSendMessage = (e) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || !socket) return;

    const payload = {
      text,
      mode: chatMode,
      targetUserId: chatMode === 'dm' ? directUser?.id : null,
      targetUserName: chatMode === 'dm' ? directUser?.name : null,
    };

    socket.emit('chat:send', payload);
    setInputText('');
  };

  const startDirectChat = (person) => {
    if (person.self) return;
    setDirectUser({ id: person.id, name: person.name });
    setChatMode('dm');
    setActiveTab('chat');
  };

  return (
    <>
      {/* Backdrop overlay for smooth dismissal when clicking outside */}
      <div 
        className={`slidable-backdrop ${isOpen ? 'is-visible' : ''}`}
        onClick={onToggle}
        aria-hidden="true"
      />

      {/* Slidable Menu Drawer Panel */}
      <aside 
        className={`slidable-workspace-drawer ${isOpen ? 'is-open' : 'is-closed'}`}
        aria-label="Workspace Menu"
      >
        {/* Drawer Header */}
        <div className="drawer-header">
          <div className="drawer-title-wrap">
            <span className="live-pulse-ring" />
            <div>
              <h3>WORKSPACE MENU</h3>
              <p className="drawer-subtitle">{officeName} {todayLabel ? `• ${todayLabel}` : ''}</p>
            </div>
          </div>
          <button 
            className="drawer-close-btn" 
            onClick={onToggle} 
            aria-label="Close workspace menu"
            title="Close menu (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Quick Tools Strip (Consolidated from topbar) */}
        <div className="drawer-quick-tools-strip">
          <button 
            className="drawer-quick-tool-btn" 
            onClick={onTestPing}
            title="Test 3D Binaural Spatial Audio Ping"
          >
            <Radio size={14} className="tool-icon-signal" />
            <span>3D Ping</span>
          </button>

          <button 
            className={`drawer-quick-tool-btn ${isAmbienceOn ? 'is-tool-active' : ''}`} 
            onClick={onToggleAmbience}
            title="Toggle Spatial Ambience Drone"
          >
            <Sparkles size={14} className={isAmbienceOn ? 'tool-icon-signal' : 'tool-icon-muted'} />
            <span>{isAmbienceOn ? 'Ambience: On' : 'Ambience'}</span>
          </button>

          <button 
            className="drawer-quick-tool-btn" 
            onClick={onToggleTheme}
            title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {isDarkMode ? <Sun size={14} className="tool-icon-voice" /> : <Moon size={14} className="tool-icon-brand" />}
            <span>{isDarkMode ? 'Light' : 'Dark'}</span>
          </button>

          <button 
            className="drawer-quick-tool-btn" 
            onClick={onInvite}
            title="Invite teammates to this office"
          >
            <UserPlus size={14} className="tool-icon-brand" />
            <span>Invite</span>
          </button>
        </div>

        {/* Segmented Nav Tabs */}
        <div className="drawer-nav-tabs">
          <button 
            className={`drawer-tab ${activeTab === 'live' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('live')}
          >
            <Users size={14} />
            <span>Teammates</span>
            <span className="drawer-count-badge">{people.length}</span>
          </button>

          <button 
            className={`drawer-tab ${activeTab === 'chat' ? 'is-active' : ''}`}
            onClick={() => {
              setActiveTab('chat');
              setUnreadCount(0);
            }}
          >
            <MessageSquare size={14} />
            <span>Chat</span>
            {unreadCount > 0 ? (
              <span className="drawer-unread-badge">{unreadCount}</span>
            ) : (
              <span className="drawer-count-badge">{chatMessages.length}</span>
            )}
          </button>

          <button 
            className={`drawer-tab ${activeTab === 'tools' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('tools')}
          >
            <SlidersHorizontal size={14} />
            <span>Audio & HUD</span>
          </button>
        </div>

        {/* TAB 1: WHO IS LIVE & TELEMETRY */}
        {activeTab === 'live' && (
          <div className="drawer-tab-content">
            <div className="drawer-search-wrap">
              <Search size={15} className="drawer-search-icon" />
              <input 
                type="text" 
                placeholder="Search teammates in office..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="drawer-search-input"
              />
            </div>

            {/* Compact Radar Telemetry Peek */}
            {closestPeerInfo && (
              <div className="drawer-telemetry-card">
                <div className="telemetry-top">
                  <span className="telemetry-beacon" />
                  <strong>NEAREST: {closestPeerInfo.name}</strong>
                  <span className={closestPeerInfo.inRange ? 'tag-in-range' : 'tag-distant'}>
                    {closestPeerInfo.inRange ? 'IN RANGE (100px)' : 'OUT OF RANGE'}
                  </span>
                </div>
                <div className="telemetry-details">
                  <span>Distance: <b>{closestPeerInfo.dist}px</b></span>
                  <span>Gain: <b>{closestPeerInfo.volumePct}%</b></span>
                  <span>Pan: <b>{closestPeerInfo.dx < -10 ? `Left` : closestPeerInfo.dx > 10 ? `Right` : 'Center'}</b></span>
                </div>
              </div>
            )}

            <div className="drawer-section-title">
              <span>ONLINE NOW ({visiblePeople.length})</span>
              <span className="live-stream-label">● 100PX AUDIO RANGE</span>
            </div>

            <div className="live-people-list">
              {visiblePeople.map((person) => {
                const isSpeaking = person.self ? false : Boolean(speakingPeers[person.id]);
                const isNearby = person.self ? false : Boolean(webrtcPeers[person.id]);
                const isMuted = person.self ? false : Boolean(mutedPeers[person.id]);
                const pos = person.self ? localCoords : peers[person.id];
                
                // Distance in pixels
                let distText = 'Desk';
                let inRange = false;
                if (!person.self && pos) {
                  const d = Math.round(Math.hypot(pos.x - localCoords.x, pos.y - localCoords.y));
                  inRange = d <= 100;
                  distText = `${d}px ${inRange ? '• IN RANGE 🔊' : '• Distant'}`;
                }

                return (
                  <div key={person.id} className={`live-user-card ${isSpeaking ? 'is-speaking-card' : ''}`}>
                    <div className="live-user-avatar-wrap">
                      <div className="live-avatar">
                        {person.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span className={`live-status-dot ${isSpeaking ? 'is-speaking' : (person.self ? 'is-self' : (inRange ? 'is-in-range' : 'is-online'))}`} />
                    </div>

                    <div className="live-user-details">
                      <div className="live-user-top">
                        <strong className="live-user-name">
                          {person.name} {person.self && <span className="self-tag">(You)</span>}
                        </strong>
                        <span className="live-dist-badge">{distText}</span>
                      </div>
                      <div className="live-user-sub">
                        {isSpeaking ? (
                          <span className="live-speaking-indicator">
                            <Radio size={12} className="animate-pulse" /> Speaking live
                          </span>
                        ) : isMuted ? (
                          <span className="live-muted-indicator"><VolumeX size={12} /> Mic Muted</span>
                        ) : (
                          <span className="live-listening-indicator"><UserCheck size={12} /> Active in room</span>
                        )}
                      </div>
                    </div>

                    {!person.self && (
                      <div className="live-user-actions">
                        <button 
                          className="user-action-btn chat-btn"
                          title={`Chat with ${person.name}`}
                          onClick={() => startDirectChat(person)}
                        >
                          <MessageSquare size={13} />
                          <span>Chat</span>
                        </button>
                        {pos && onJumpToUser && (
                          <button 
                            className="user-action-btn jump-btn"
                            title={`Jump near ${person.name}`}
                            onClick={() => onJumpToUser(person.id)}
                          >
                            <MapPin size={13} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {visiblePeople.length === 0 && (
                <div className="drawer-empty-state">
                  <Users size={30} />
                  <p>No teammates matched your search.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: LIVE CHAT */}
        {activeTab === 'chat' && (
          <div className="drawer-tab-content chat-tab-content">
            {/* Recipient Channel Selector */}
            <div className="chat-channel-selector">
              <span className="channel-select-label">TO:</span>
              <div className="channel-pills">
                <button 
                  className={`channel-pill ${chatMode === 'office' ? 'is-active' : ''}`}
                  onClick={() => setChatMode('office')}
                >
                  <span>🏢 #Office (All)</span>
                </button>

                {directUser && (
                  <button 
                    className={`channel-pill ${chatMode === 'dm' ? 'is-active' : ''}`}
                    onClick={() => setChatMode('dm')}
                  >
                    <span>💬 @{directUser.name}</span>
                    <span 
                      className="pill-close-x" 
                      onClick={(e) => {
                        e.stopPropagation();
                        setDirectUser(null);
                        setChatMode('office');
                      }}
                    >
                      ×
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Direct Message recipient prompt */}
            {chatMode === 'dm' && !directUser && (
              <div className="chat-pick-user-banner">
                <Sparkles size={15} />
                <span>Select a teammate from the <strong>Teammates</strong> tab to start a direct message.</span>
              </div>
            )}

            {/* Messages Scroll Area */}
            <div className="chat-messages-container">
              {currentMessages.map((msg) => {
                const isMyMessage = msg.senderId === userId;
                const isSystem = msg.senderId === 'system';
                const timeString = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                if (isSystem) {
                  return (
                    <div key={msg.id} className="chat-system-msg">
                      <span>{msg.text}</span>
                    </div>
                  );
                }

                return (
                  <div key={msg.id} className={`chat-bubble-row ${isMyMessage ? 'is-me' : 'is-them'}`}>
                    {!isMyMessage && (
                      <div className="chat-bubble-avatar">
                        {msg.senderName.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="chat-bubble-body">
                      <div className="chat-bubble-header">
                        <strong className="chat-sender-name">{msg.senderName}</strong>
                        <span className="chat-time">{timeString}</span>
                      </div>
                      <div className="chat-text-content">{msg.text}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Input Bar */}
            <form onSubmit={handleSendMessage} className="chat-input-form">
              <input 
                type="text" 
                placeholder={chatMode === 'office' ? "Message #office (All)..." : `Direct message @${directUser?.name || 'teammate'}...`}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="chat-text-input"
                maxLength={400}
              />
              <button 
                type="submit" 
                className="chat-send-btn" 
                disabled={!inputText.trim()}
                aria-label="Send message"
              >
                <Send size={15} />
              </button>
            </form>
          </div>
        )}

        {/* TAB 3: AUDIO CONTROLS & HUD SETTINGS */}
        {activeTab === 'tools' && (
          <div className="drawer-tab-content tools-tab-content">
            <div className="tools-section">
              <h4>SPATIAL AUDIO ENGINE</h4>
              <p className="tools-help">Audio automatically activates within 100px. Walls dampen sound.</p>

              <div className="tools-card">
                <div className="tools-card-row">
                  <div>
                    <strong>Binaural 3D Ping</strong>
                    <p>Emit a left-to-right acoustic pulse to verify ear channels.</p>
                  </div>
                  <button className="button button-secondary text-xs" onClick={onTestPing}>
                    <Radio size={14} className="tool-icon-signal" />
                    <span>Test Ping</span>
                  </button>
                </div>

                <div className="tools-divider" />

                <div className="tools-card-row">
                  <div>
                    <strong>Spatial Ambience Drone</strong>
                    <p>Subtle generative white/green audio drone for deep focus.</p>
                  </div>
                  <button 
                    className={`button text-xs ${isAmbienceOn ? 'button-primary' : 'button-secondary'}`}
                    onClick={onToggleAmbience}
                  >
                    <Sparkles size={14} />
                    <span>{isAmbienceOn ? 'Turn Off' : 'Turn On'}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="tools-section">
              <h4>PREFERENCES & SESSION</h4>
              <div className="tools-card">
                <div className="tools-card-row">
                  <div>
                    <strong>Interface Theme</strong>
                    <p>{isDarkMode ? 'Dark theme active' : 'Light theme active'}</p>
                  </div>
                  <button className="button button-secondary text-xs" onClick={onToggleTheme}>
                    {isDarkMode ? <Sun size={14} className="tool-icon-voice" /> : <Moon size={14} className="tool-icon-brand" />}
                    <span>Switch to {isDarkMode ? 'Light' : 'Dark'}</span>
                  </button>
                </div>

                <div className="tools-divider" />

                <div className="tools-card-row">
                  <div>
                    <strong>Microphone Security</strong>
                    <p>{micPermissionState === 'granted' ? 'Access granted • Hardware active' : 'Microphone muted/off'}</p>
                  </div>
                  <span className="privacy-badge">
                    <ShieldCheck size={14} /> DTLS-SRTP P2P
                  </span>
                </div>

                <div className="tools-divider" />

                <div className="tools-card-row">
                  <div>
                    <strong>Signed in as</strong>
                    <p>{userName}</p>
                  </div>
                  <button className="button button-secondary text-xs logout-btn-subtle" onClick={onLogout}>
                    <LogOut size={14} />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Drawer Footer with Status */}
        <div className="drawer-footer">
          <span className="footer-status">
            <span className="live-dot" /> Live Office Connected
          </span>
          <button className="footer-invite-btn" onClick={onInvite}>
            <UserPlus size={13} />
            <span>Invite Link</span>
          </button>
        </div>
      </aside>
    </>
  );
}
