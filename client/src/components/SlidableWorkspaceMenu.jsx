import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Users, 
  MessageSquare, 
  Send, 
  ChevronRight, 
  ChevronLeft, 
  Search, 
  Volume2, 
  VolumeX, 
  Radio, 
  MapPin, 
  UserCheck, 
  Sparkles,
  Smile,
  X
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
}) {
  const [activeTab, setActiveTab] = useState('live'); // 'live' | 'chat'
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
      {/* Floating Toggle Pill when menu is closed */}
      <button 
        className={`slidable-menu-tab-btn ${isOpen ? 'is-active-tab' : ''}`}
        onClick={onToggle}
        title={isOpen ? 'Collapse Panel' : 'Open Workspace Hub'}
        aria-label="Toggle Slidable Workspace Panel"
      >
        <span className="live-pulse-dot" />
        <Users size={16} />
        <span className="tab-btn-text">Live ({people.length})</span>
        {unreadCount > 0 && <span className="tab-unread-badge">{unreadCount}</span>}
        {isOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>

      {/* Slidable Menu Drawer Panel */}
      <aside className={`slidable-workspace-drawer ${isOpen ? 'is-open' : 'is-closed'}`}>
        {/* Drawer Header */}
        <div className="drawer-header">
          <div className="drawer-title-wrap">
            <span className="live-pulse-ring" />
            <div>
              <h3>WORKSPACE HUB</h3>
              <p className="drawer-subtitle">{people.length} {people.length === 1 ? 'Coworker' : 'Coworkers'} Online Now</p>
            </div>
          </div>
          <button className="drawer-close-btn" onClick={onToggle} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="drawer-nav-tabs">
          <button 
            className={`drawer-tab ${activeTab === 'live' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('live')}
          >
            <Users size={15} />
            <span>Who is Live</span>
            <span className="drawer-count-badge">{people.length}</span>
          </button>

          <button 
            className={`drawer-tab ${activeTab === 'chat' ? 'is-active' : ''}`}
            onClick={() => {
              setActiveTab('chat');
              setUnreadCount(0);
            }}
          >
            <MessageSquare size={15} />
            <span>Chat</span>
            {unreadCount > 0 ? (
              <span className="drawer-unread-badge">{unreadCount}</span>
            ) : (
              <span className="drawer-count-badge">{chatMessages.length}</span>
            )}
          </button>
        </div>

        {/* TAB 1: WHO IS LIVE */}
        {activeTab === 'live' && (
          <div className="drawer-tab-content">
            <div className="drawer-search-wrap">
              <Search size={15} className="drawer-search-icon" />
              <input 
                type="text" 
                placeholder="Search live teammates..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="drawer-search-input"
              />
            </div>

            <div className="drawer-section-title">
              <span>ONLINE NOW ({visiblePeople.length})</span>
              <span className="live-stream-label">● REAL-TIME</span>
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
                  inRange = d <= 105;
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
                          <MessageSquare size={14} />
                          <span>Chat</span>
                        </button>
                        {pos && onJumpToUser && (
                          <button 
                            className="user-action-btn jump-btn"
                            title={`Jump to ${person.name}`}
                            onClick={() => onJumpToUser(person.id)}
                          >
                            <MapPin size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {visiblePeople.length === 0 && (
                <div className="drawer-empty-state">
                  <Users size={32} />
                  <p>No teammates matched your search.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: TO WHOM I WANT TO CHAT */}
        {activeTab === 'chat' && (
          <div className="drawer-tab-content chat-tab-content">
            {/* Recipient Channel Selector */}
            <div className="chat-channel-selector">
              <span className="channel-select-label">TO WHOM:</span>
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

            {/* Direct Message recipient prompt if in DM mode without a user */}
            {chatMode === 'dm' && !directUser && (
              <div className="chat-pick-user-banner">
                <Sparkles size={16} />
                <span>Select a live teammate from the <strong>Who is Live</strong> tab to begin a 1-on-1 private chat.</span>
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
                <Send size={16} />
              </button>
            </form>
          </div>
        )}
      </aside>
    </>
  );
}

