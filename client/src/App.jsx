
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const SERVER_URL = "http://localhost:3001";
const AUDIO_RANGE = 300;
const TOKEN_KEY = "proxispeak_token";

// ---------------- AUTHENTICATION SCREEN ----------------

function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint =
        mode === "register" ? "/api/auth/register" : "/api/auth/login";

      const response = await fetch(`${SERVER_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "register"
            ? { name: name.trim(), email: email.trim(), password }
            : { email: email.trim(), password }
        ),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || data.error || "Authentication failed."
        );
      }

      if (!data.token || !data.user) {
        throw new Error(
          "The server response must contain both token and user."
        );
      }

      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message || "Could not connect to the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo">🎧</div>
        <h1>ProxiSpeak</h1>
        <p className="auth-subtitle">
          Your virtual office, closer together.
        </p>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "auth-active" : ""}
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            Login
          </button>

          <button
            type="button"
            className={mode === "register" ? "auth-active" : ""}
            onClick={() => {
              setMode("register");
              setError("");
            }}
          >
            Create Account
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "register" && (
            <label>
              Full name
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Enter your name"
                autoComplete="name"
                maxLength={80}
                required
              />
            </label>
          )}

          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              maxLength={254}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              minLength={8}
              required
            />
          </label>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <button
            className="auth-submit"
            type="submit"
            disabled={loading}
          >
            {loading
              ? "Please wait..."
              : mode === "register"
                ? "Create Account"
                : "Login"}
          </button>
        </form>

        <p className="auth-switch">
          {mode === "login"
            ? "New to ProxiSpeak?"
            : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
            }}
          >
            {mode === "login" ? "Sign up" : "Login"}
          </button>
        </p>
      </section>
    </main>
  );
}


// ---------------- PROFESSIONAL LANDING PAGE ----------------

function LandingPage({ onEnter, onLogin }) {
  return (
    <main className="landing-page">
      <nav className="landing-nav">
        <a
          className="landing-brand"
          href="#home"
          onClick={(event) => event.preventDefault()}
        >
          <span className="landing-logo">🎧</span>
          <span>ProxiSpeak</span>
        </a>

        <div className="landing-nav-links">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <button type="button" className="landing-login" onClick={onLogin}>
            Log in
          </button>
          <button type="button" className="landing-nav-cta" onClick={onEnter}>
            Enter workspace ↗
          </button>
        </div>
      </nav>

      <section className="landing-hero" id="home">
        <div className="landing-copy">
          <span className="landing-eyebrow">
            ✦ GEOSPATIAL VIRTUAL WORKPLACE
          </span>
          <h1>
            Work Together.
            <br />
            <span>Feel Closer.</span>
          </h1>
          <p>
            Experience a smarter virtual workspace where conversations follow
            proximity and collaboration feels natural.
          </p>

          <div className="landing-actions">
            <button type="button" className="landing-primary" onClick={onEnter}>
              Enter Your Workspace <span>→</span>
            </button>
            <a className="landing-secondary" href="#features">
              Explore Features
            </a>
          </div>

          <div className="landing-benefits">
            <span>✓ Real-time spatial audio</span>
            <span>✓ Live team presence</span>
            <span>✓ Browser-based workspace</span>
          </div>
        </div>

        <div className="landing-preview">
          <div className="preview-topbar">
            <div>
              <span className="preview-dot" />
              <strong>ProxiSpeak Office</strong>
            </div>
            <span className="preview-live">● LIVE WORKSPACE PREVIEW</span>
          </div>

          <div className="preview-office">
            <div className="preview-zone preview-meeting">
              <span>COLLABORATE</span>
              <strong>Meeting Room</strong>
              <div className="preview-table" />
            </div>
            <div className="preview-zone preview-work">
              <span>FOCUS TIME</span>
              <strong>Work Zone</strong>
              <div className="preview-desk" />
            </div>
            <div className="preview-zone preview-lounge">
              <span>TAKE A BREAK</span>
              <strong>Lounge ☕</strong>
            </div>
            <div className="preview-person preview-person-one">
              <span>👩🏻‍💻</span>
              <small>You</small>
            </div>
            <div className="preview-person preview-person-two">
              <span>👨🏽‍💻</span>
              <small>Teammate</small>
            </div>
            <div className="preview-person preview-person-three">
              <span>👩🏾‍💻</span>
              <small>Designer</small>
            </div>
          </div>

          <div className="preview-footer">
            <span>◉ Spatial audio experience</span>
            <span>Designed for remote teams</span>
          </div>
        </div>
      </section>

      <section className="landing-features" id="features">
        <div className="features-heading" id="how-it-works">
          <span className="landing-eyebrow">A BETTER WAY TO COLLABORATE</span>
          <h2>Built for high-trust collaboration</h2>
          <p>
            Everything your team needs to work together naturally, wherever
            they are.
          </p>
        </div>

        <div className="feature-grid">
          <article className="feature-card">
            <span className="feature-icon">◉</span>
            <h3>Spatial Proximity Audio</h3>
            <p>
              Move closer to teammates to hear them clearly. Move away when
              you need space.
            </p>
          </article>
          <article className="feature-card">
            <span className="feature-icon">⌘</span>
            <h3>Live Team Presence</h3>
            <p>
              See teammates move around the shared virtual office in real time.
            </p>
          </article>
          <article className="feature-card">
            <span className="feature-icon">♧</span>
            <h3>Flexible Work Zones</h3>
            <p>
              Create a natural workflow for meetings, focused work, and
              informal conversations.
            </p>
          </article>
        </div>
      </section>

      <footer className="landing-footer">
        <span>🎧 ProxiSpeak</span>
        <span>Bringing remote teams closer, one conversation at a time.</span>
      </footer>
    </main>
  );
}

// ---------------- MAIN PROXISPEAK DASHBOARD ----------------

function ProxiSpeakDashboard({ user, token, onLogout }) {
  const socketRef = useRef(null);
  const officeRef = useRef(null);
  const micStreamRef = useRef(null);
  const peersRef = useRef({});
  const audioElementsRef = useRef({});
  const remoteUsersRef = useRef({});
  const pendingCandidatesRef = useRef({});
  const positionRef = useRef({ x: 150, y: 150 });
  const remoteAudioMutedRef = useRef(false);

  const [position, setPosition] = useState({ x: 150, y: 150 });
  const [remoteUsers, setRemoteUsers] = useState({});
  const [connected, setConnected] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [remoteAudioMuted, setRemoteAudioMuted] = useState(false);
  const [micError, setMicError] = useState("");
  const [audioStatus, setAudioStatus] = useState("Audio not connected");

  const updateRemoteUsers = useCallback((users) => {
    remoteUsersRef.current = users;
    setRemoteUsers(users);
  }, []);

  const getDistance = useCallback((remoteUser) => {
    return Math.hypot(
      remoteUser.x - positionRef.current.x,
      remoteUser.y - positionRef.current.y
    );
  }, []);

  const updateAudioVolumes = useCallback(() => {
    Object.entries(audioElementsRef.current).forEach(([id, audio]) => {
      const remoteUser = remoteUsersRef.current[id];

      if (!remoteUser) {
        audio.volume = 0;
        return;
      }

      const distance = getDistance(remoteUser);
      audio.muted = remoteAudioMutedRef.current;
      audio.volume = remoteAudioMutedRef.current
        ? 0
        : Math.max(0, Math.min(1, 1 - distance / AUDIO_RANGE));
    });
  }, [getDistance]);

  const toggleRemoteAudio = () => {
    const nextMuted = !remoteAudioMutedRef.current;
    remoteAudioMutedRef.current = nextMuted;
    setRemoteAudioMuted(nextMuted);
    updateAudioVolumes();

    if (!nextMuted) {
      Object.values(audioElementsRef.current).forEach((audio) => {
        audio.muted = false;
        audio.play().catch((error) => {
          console.warn("Could not resume remote audio:", error);
          setAudioStatus("Click the page to allow remote audio playback");
        });
      });
    }
  };

  const closePeer = useCallback((userId) => {
    const peer = peersRef.current[userId];

    if (peer) {
      peer.ontrack = null;
      peer.onicecandidate = null;
      peer.onconnectionstatechange = null;
      peer.oniceconnectionstatechange = null;
      peer.close();
      delete peersRef.current[userId];
    }

    delete pendingCandidatesRef.current[userId];

    const audio = audioElementsRef.current[userId];

    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      delete audioElementsRef.current[userId];
    }
  }, []);

  const createPeer = useCallback((userId) => {
    if (peersRef.current[userId]) {
      return peersRef.current[userId];
    }

    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    peersRef.current[userId] = peer;
    pendingCandidatesRef.current[userId] = [];

    const transceiver = peer.addTransceiver("audio", {
      direction: "sendrecv",
    });

    const localTrack = micStreamRef.current?.getAudioTracks()[0];

    if (localTrack) {
      transceiver.sender.replaceTrack(localTrack).catch((error) => {
        console.error("Could not attach microphone:", error);
      });
    }

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit("webrtc-ice-candidate", {
          targetId: userId,
          candidate: event.candidate,
        });
      }
    };

    peer.ontrack = async (event) => {
      let audio = audioElementsRef.current[userId];

      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.playsInline = true;
        audio.controls = false;
        audio.style.display = "none";
        document.body.appendChild(audio);
        audioElementsRef.current[userId] = audio;
      }

      audio.srcObject =
        event.streams?.[0] || new MediaStream([event.track]);

      audio.muted = remoteAudioMutedRef.current;
      updateAudioVolumes();

      try {
        await audio.play();
        setAudioStatus("Voice connection active");
      } catch (error) {
        console.error("Audio playback failed:", error);
        setAudioStatus("Audio received. Click the page to allow playback.");
      }
    };

    peer.onconnectionstatechange = () => {
      console.log(`Peer ${userId} connection state:`, peer.connectionState);

      if (peer.connectionState === "connected") {
        setAudioStatus("Connected; waiting for remote sound");
      } else if (peer.connectionState === "failed") {
        setAudioStatus("Audio connection failed");
      } else if (peer.connectionState === "disconnected") {
        setAudioStatus("Audio temporarily disconnected");
      }
    };

    peer.oniceconnectionstatechange = () => {
      console.log(`Peer ${userId} ICE state:`, peer.iceConnectionState);
    };

    return peer;
  }, [updateAudioVolumes]);

  const flushPendingCandidates = useCallback(async (userId, peer) => {
    const candidates = pendingCandidatesRef.current[userId] || [];
    pendingCandidatesRef.current[userId] = [];

    for (const candidate of candidates) {
      try {
        await peer.addIceCandidate(candidate);
      } catch (error) {
        console.error("Could not add ICE candidate:", error);
      }
    }
  }, []);

  const makeOffer = useCallback(async (userId) => {
    const peer = createPeer(userId);

    try {
      if (peer.signalingState !== "stable") return;

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      socketRef.current?.emit("webrtc-offer", {
        targetId: userId,
        offer: peer.localDescription,
      });
    } catch (error) {
      console.error("Could not create audio offer:", error);
    }
  }, [createPeer]);

  const handleOffer = useCallback(async ({ fromId, offer }) => {
    const peer = createPeer(fromId);

    try {
      if (peer.signalingState !== "stable") {
        await peer.setLocalDescription({ type: "rollback" });
      }

      await peer.setRemoteDescription(offer);
      await flushPendingCandidates(fromId, peer);

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      socketRef.current?.emit("webrtc-answer", {
        targetId: fromId,
        answer: peer.localDescription,
      });
    } catch (error) {
      console.error("Could not answer audio offer:", error);
      setAudioStatus("Could not establish audio connection");
    }
  }, [createPeer, flushPendingCandidates]);

  const handleAnswer = useCallback(async ({ fromId, answer }) => {
    const peer = peersRef.current[fromId];

    if (!peer || peer.signalingState !== "have-local-offer") return;

    try {
      await peer.setRemoteDescription(answer);
      await flushPendingCandidates(fromId, peer);
    } catch (error) {
      console.error("Could not set audio answer:", error);
    }
  }, [flushPendingCandidates]);

  const handleIceCandidate = useCallback(async ({ fromId, candidate }) => {
    const peer = peersRef.current[fromId];

    if (!peer || !peer.remoteDescription) {
      pendingCandidatesRef.current[fromId] ||= [];
      pendingCandidatesRef.current[fromId].push(candidate);
      return;
    }

    try {
      await peer.addIceCandidate(candidate);
    } catch (error) {
      console.error("Could not add ICE candidate:", error);
    }
  }, []);

  // Socket.IO connects only after login and sends the JWT.
  useEffect(() => {
    const socket = io(SERVER_URL, {
      auth: { token },
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      console.log("Socket connected:", socket.id);
    });

    socket.on("connect_error", (error) => {
      setConnected(false);
      setAudioStatus(`Connection error: ${error.message}`);
    });

    socket.on("disconnect", () => {
      setConnected(false);
      setAudioStatus("Server disconnected");
    });

    socket.on("current-users", (users) => {
      const others = { ...users };
      delete others[socket.id];

      updateRemoteUsers(others);

      Object.keys(others).forEach((id) => {
        if (socket.id.localeCompare(id) < 0) makeOffer(id);
      });
    });

    socket.on("user-joined", (remoteUser) => {
      updateRemoteUsers({
        ...remoteUsersRef.current,
        [remoteUser.id]: remoteUser,
      });

      if (socket.id.localeCompare(remoteUser.id) < 0) {
        makeOffer(remoteUser.id);
      }
    });

    socket.on("user-moved", (remoteUser) => {
      if (remoteUser.id !== socket.id) {
        updateRemoteUsers({
          ...remoteUsersRef.current,
          [remoteUser.id]: remoteUser,
        });
      }
    });

    socket.on("user-left", (id) => {
      closePeer(id);
      const updated = { ...remoteUsersRef.current };
      delete updated[id];
      updateRemoteUsers(updated);
    });

    socket.on("webrtc-offer", handleOffer);
    socket.on("webrtc-answer", handleAnswer);
    socket.on("webrtc-ice-candidate", handleIceCandidate);

    return () => {
      socket.disconnect();

      Object.keys(peersRef.current).forEach(closePeer);

      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
      socketRef.current = null;
    };
  }, [
    token,
    closePeer,
    handleAnswer,
    handleIceCandidate,
    handleOffer,
    makeOffer,
    updateRemoteUsers,
  ]);

  useEffect(() => {
    updateAudioVolumes();
  }, [position, remoteUsers, updateAudioVolumes]);

  async function enableMicrophone() {
    try {
      setMicError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Microphone access is unavailable. Open the app on localhost in Chrome."
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      micStreamRef.current = stream;
      const track = stream.getAudioTracks()[0];

      for (const userId of Object.keys(remoteUsersRef.current)) {
        const peer = createPeer(userId);
        const transceiver = peer.getTransceivers().find(
          (item) => item.receiver.track.kind === "audio"
        );

        if (transceiver) await transceiver.sender.replaceTrack(track);
      }

      setMicEnabled(true);
      setAudioStatus(
        Object.keys(remoteUsersRef.current).length
          ? "Microphone on; waiting for remote audio"
          : "Microphone on; waiting for another user"
      );
    } catch (error) {
      console.error("Microphone error:", error);

      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
      setMicEnabled(false);

      let message = "Could not access the microphone. Please try again.";

      if (
        error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError"
      ) {
        message =
          "Microphone permission denied. Allow microphone access in Chrome site settings.";
      } else if (
        error.name === "NotFoundError" ||
        error.name === "DevicesNotFoundError"
      ) {
        message = "No microphone found. Connect a microphone and try again.";
      } else if (
        error.name === "NotReadableError" ||
        error.name === "TrackStartError"
      ) {
        message =
          "The microphone may be in use by another application. Close it and try again.";
      } else if (error.message) {
        message = `Microphone error: ${error.message}`;
      }

      setMicError(message);
      setAudioStatus("Microphone unavailable");
    }
  }

  function disableMicrophone() {
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;

    Object.values(peersRef.current).forEach((peer) => {
      const transceiver = peer.getTransceivers().find(
        (item) => item.receiver.track.kind === "audio"
      );

      if (transceiver) {
        transceiver.sender.replaceTrack(null).catch((error) => {
          console.error("Could not detach microphone:", error);
        });
      }
    });

    setMicEnabled(false);
    setAudioStatus("Microphone off");
  }

  function moveAvatarBy(direction) {
    const step = 15;
    let { x, y } = positionRef.current;

    if (direction === "up") y -= step;
    else if (direction === "down") y += step;
    else if (direction === "left") x -= step;
    else if (direction === "right") x += step;
    else return;

    const office = officeRef.current;
    const maxX = office ? Math.max(20, office.clientWidth - 60) : 700;
    const maxY = office ? Math.max(20, office.clientHeight - 70) : 350;

    const next = {
      x: Math.max(10, Math.min(maxX, x)),
      y: Math.max(10, Math.min(maxY, y)),
    };

    positionRef.current = next;
    setPosition(next);
    socketRef.current?.emit("move", next);
  }

  function moveAvatar(event) {
    const key = event.key.toLowerCase();
    const directions = {
      arrowup: "up",
      w: "up",
      arrowdown: "down",
      s: "down",
      arrowleft: "left",
      a: "left",
      arrowright: "right",
      d: "right",
    };

    if (!directions[key]) return;
    event.preventDefault();
    moveAvatarBy(directions[key]);
  }

  function resetAvatarPosition() {
    const startingPosition = { x: 150, y: 150 };
    positionRef.current = startingPosition;
    setPosition(startingPosition);
    socketRef.current?.emit("move", startingPosition);
  }

  const remoteUserList = Object.values(remoteUsers);
  const distances = remoteUserList.map(getDistance);
  const distance = distances.length ? Math.round(Math.min(...distances)) : null;

  const nearestUser = remoteUserList.reduce((nearest, remoteUser) => {
    if (!nearest || getDistance(remoteUser) < getDistance(nearest)) {
      return remoteUser;
    }
    return nearest;
  }, null);

  const nearestUserDirection = !nearestUser
    ? "No other users"
    : Math.abs(nearestUser.x - position.x) >
        Math.abs(nearestUser.y - position.y)
      ? nearestUser.x < position.x ? "Left" : "Right"
      : nearestUser.y < position.y ? "Above" : "Below";

  const usersInAudioRange = remoteUserList.filter(
    (remoteUser) => getDistance(remoteUser) < AUDIO_RANGE
  ).length;

  const volumeLevel = distance === null
    ? 0
    : Math.max(0, Math.min(100, Math.round((1 - distance / AUDIO_RANGE) * 100)));

  const proximityStatus = distance === null
    ? "No users nearby"
    : distance >= AUDIO_RANGE
      ? "Out of audio range"
      : distance < 100
        ? "Nearby"
        : "Medium distance";

  return (
    <main className="app" tabIndex={0} onKeyDown={moveAvatar}>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">🎧</div>
          <div>
            <h1>ProxiSpeak</h1>
            <span>Geospatial proximity audio ecosystem</span>
          </div>
        </div>
        <div className="topbar-right">
          <div className={`connection-pill ${connected ? "is-online" : "is-offline"}`}>
            <span className="status-dot" /> {connected ? "Live connection" : "Reconnecting"}
          </div>
          <div className="profile-area">
            <span>👤 {user?.name || user?.email || "User"}</span>
            <button type="button" onClick={onLogout}>Log out</button>
          </div>
        </div>
      </header>

      <aside className="control-panel">
        <div className="panel-heading">
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h2>Welcome to your virtual office</h2>
          <p>Move around and talk naturally with people nearby.</p>
        </div>

        <div className="quick-stats">
          <div className="quick-stat"><span className="stat-icon">♙</span><div><strong>{remoteUserList.length + 1}</strong><small>People online</small></div></div>
          <div className="quick-stat"><span className="stat-icon cyan">◉</span><div><strong>{usersInAudioRange}</strong><small>In voice range</small></div></div>
        </div>

        <div className="panel-section">
          <div className="section-title">CONNECTION</div>
          <div className="info-row"><span>Socket status</span><strong className={connected ? "good-text" : "bad-text"}>{connected ? "Connected" : "Disconnected"}</strong></div>
          <div className="info-row"><span>Microphone</span><strong className={micEnabled ? "good-text" : "bad-text"}>{micEnabled ? "Enabled" : "Disabled"}</strong></div>
          <div className="info-row"><span>Audio</span><strong>{remoteAudioMuted ? "Muted" : "On"}</strong></div>
        </div>

        <div className="panel-section proximity-card">
          <div className="section-title">PROXIMITY AUDIO</div>
          <div className="proximity-value">{volumeLevel}<span>%</span></div>
          <div className="proximity-track"><div className="proximity-fill" style={{ width: `${volumeLevel}%` }} /></div>
          <div className="info-row"><span>Nearest person</span><strong>{distance === null ? "—" : `${distance} units`}</strong></div>
          <div className="info-row"><span>Direction</span><strong>{nearestUserDirection}</strong></div>
          <div className="proximity-status"><span className="status-dot" />{proximityStatus}</div>
        </div>

        <div className="panel-section controls-section">
          <div className="section-title">YOUR CONTROLS</div>
          <button className={`primary-control ${micEnabled ? "control-enabled" : ""}`} onClick={micEnabled ? disableMicrophone : enableMicrophone}>
            <span>{micEnabled ? "🎙️" : "🎤"}</span>{micEnabled ? "Turn microphone off" : "Enable microphone"}
          </button>
          <button className="secondary-control" onClick={toggleRemoteAudio}>
            <span>{remoteAudioMuted ? "🔊" : "🔕"}</span>{remoteAudioMuted ? "Unmute nearby voices" : "Mute nearby voices"}
          </button>
          <div className="movement-pad" aria-label="Avatar movement controls">
            <span />
            <button type="button" onClick={() => moveAvatarBy("up")} aria-label="Move up">↑</button><span />
            <button type="button" onClick={() => moveAvatarBy("left")} aria-label="Move left">←</button>
            <button type="button" onClick={() => moveAvatarBy("down")} aria-label="Move down">↓</button>
            <button type="button" onClick={() => moveAvatarBy("right")} aria-label="Move right">→</button>
          </div>
          <button className="text-control" onClick={resetAvatarPosition}>↺ Reset my position</button>
          {micError && <p className="mic-error" role="alert">{micError}</p>}
          <p className="audio-note">Use arrow keys or W A S D to move around your office.</p>
        </div>
      </aside>

      <section className="office-shell">
        <div className="office-toolbar">
          <div><span className="live-indicator" /> <strong>Virtual office</strong><span className="toolbar-muted"> · Shared workspace</span></div>
          <div className="toolbar-legend"><span><i className="legend-you" /> You</span><span><i className="legend-other" /> Teammates</span></div>
        </div>
        <div className="office" ref={officeRef}>
          <div className="office-wall wall-top" /><div className="office-wall wall-bottom" />
          <div className="zone zone-lounge"><span className="zone-kicker">RELAX & RECHARGE</span><strong>☕ Lounge</strong><div className="lounge-furniture"><i /><i /><i /></div><span className="plant plant-a">✿</span><span className="plant plant-b">✿</span></div>
          <div className="zone zone-meeting"><span className="zone-kicker">COLLABORATE</span><strong>▰ Meeting room</strong><div className="meeting-table"><i /><i /><i /><i /><i /><i /></div></div>
          <div className="zone zone-work"><span className="zone-kicker">GET THINGS DONE</span><strong>⌘ Work zone</strong><div className="work-desks"><i /><i /><i /><i /></div><span className="plant plant-c">✿</span></div>
          <div className="zone zone-break"><span className="zone-kicker">TAKE A BREATHER</span><strong>☕ Break area</strong><div className="break-seats"><i /><i /></div><span className="plant plant-d">✿</span></div>
          <div className="zone zone-focus"><span className="zone-kicker">DEEP WORK</span><strong>◉ Focus zone</strong><div className="focus-desk"><i /></div><span className="plant plant-e">✿</span></div>
          <div className="walkway walkway-one" /><div className="walkway walkway-two" />
          {remoteUserList.map((remoteUser) => (
            <div key={remoteUser.id} className="avatar remote-avatar" style={{ left: remoteUser.x, top: remoteUser.y }} title={remoteUser.name || "Teammate"}>
              <div className="avatar-face">🧑‍💻</div><span>{remoteUser.name || `Guest ${remoteUser.id.slice(0, 4)}`}</span>
            </div>
          ))}
          <div className="avatar my-avatar" style={{ left: position.x, top: position.y }} title="Your avatar">
            <div className="avatar-face">🧑‍💻</div><span>You</span>
          </div>
          <div className="map-caption"><span className="status-dot" /> Live spatial audio · Move closer to talk</div>
        </div>
      </section>

      <aside className="right-rail">
        <section className="rail-card nearby-card">
          <div className="rail-heading"><div><span className="eyebrow">LIVE CONNECTIONS</span><h2>Nearby people</h2></div><span className="count-badge">{remoteUserList.length}</span></div>
          <div className="nearby-summary"><span className="status-dot" /> {usersInAudioRange} of {remoteUserList.length} in voice range</div>
          <div className="people-list">
            {remoteUserList.length === 0 ? (
              <div className="empty-people"><div className="empty-people-icon">♧</div><strong>Waiting for teammates</strong><p>Open ProxiSpeak in another tab or ask a teammate to join.</p></div>
            ) : remoteUserList.map((remoteUser) => {
              const userDistance = Math.round(getDistance(remoteUser));
              const isNearby = userDistance < AUDIO_RANGE;
              return <div className="person-row" key={`person-${remoteUser.id}`}><div className="person-avatar">{(remoteUser.name || "T").charAt(0).toUpperCase()}</div><div className="person-details"><strong>{remoteUser.name || `Guest ${remoteUser.id.slice(0, 4)}`}</strong><span>{isNearby ? "In voice range" : "Outside voice range"}</span></div><div className={`person-signal ${isNearby ? "signal-near" : "signal-far"}`} title={`${userDistance} units away`}>{isNearby ? "●" : "○"}</div></div>;
            })}
          </div>
        </section>
        <section className="rail-card status-card">
          <span className="eyebrow">SYSTEM HEALTH</span><h2>Connection status</h2>
          <div className="system-row"><span className="system-icon">⌘</span><div><strong>Socket.IO</strong><small>Real-time presence</small></div><span className={`health-dot ${connected ? "healthy" : "unhealthy"}`} /></div>
          <div className="system-row"><span className="system-icon">🎙</span><div><strong>Microphone</strong><small>{micEnabled ? "Ready to transmit" : "Permission not active"}</small></div><span className={`health-dot ${micEnabled ? "healthy" : "idle"}`} /></div>
          <div className="system-row"><span className="system-icon">◉</span><div><strong>Spatial audio</strong><small>{remoteAudioMuted ? "Nearby audio muted" : audioStatus}</small></div><span className={`health-dot ${micEnabled && !remoteAudioMuted ? "healthy" : "idle"}`} /></div>
        </section>
        <div className="rail-tip"><span>✦</span><p><strong>Pro tip</strong> Put on headphones for the best spatial audio experience.</p></div>
      </aside>

      <footer className="app-footer"><span>🎧 ProxiSpeak</span><span>Move with <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or arrow keys</span><span>Spatial audio workspace</span></footer>
    </main>
  );
}

// ---------------- APP SESSION / LOGIN STATE ----------------

export default function App() {
  const [session, setSession] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const token = localStorage.getItem(TOKEN_KEY);

      if (!token) {
        setCheckingSession(false);
        return;
      }

      try {
        const response = await fetch(`${SERVER_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || data.error || "Session expired.");
        }

        if (!data.user) {
          throw new Error("The server did not return the user profile.");
        }

        if (!cancelled) setSession({ token, user: data.user });
      } catch (error) {
        localStorage.removeItem(TOKEN_KEY);

        if (!cancelled) {
          setSessionError(error.message || "Could not restore your session.");
        }
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleLogin(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    setSessionError("");
    setSession({ token, user });
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    setSession(null);
  }

  if (checkingSession) {
    return <main className="auth-page"><p>Checking your session...</p></main>;
  }

  if (!session) {
    if (!showAuth && !sessionError) {
      return (
        <LandingPage
          onEnter={() => setShowAuth(true)}
          onLogin={() => setShowAuth(true)}
        />
      );
    }

    return (
      <>
        {sessionError && (
          <p className="auth-session-error" role="status">{sessionError}</p>
        )}
        <AuthScreen onLogin={handleLogin} />
      </>
    );
  }

  return (
    <ProxiSpeakDashboard
      key={session.token}
      user={session.user}
      token={session.token}
      onLogout={handleLogout}
    />
  );
}
