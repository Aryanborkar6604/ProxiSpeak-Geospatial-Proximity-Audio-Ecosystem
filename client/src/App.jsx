
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const SERVER_URL = "http://localhost:3001";
const AUDIO_RANGE = 300;

export default function App() {
  const socketRef = useRef(null);
  const micStreamRef = useRef(null);
  const peersRef = useRef({});
  const audioElementsRef = useRef({});
  const remoteUsersRef = useRef({});
  const pendingCandidatesRef = useRef({});
  const positionRef = useRef({ x: 150, y: 150 });

  const [position, setPosition] = useState({ x: 150, y: 150 });
  const [remoteUsers, setRemoteUsers] = useState({});
  const [connected, setConnected] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micError, setMicError] = useState("");
  const [audioStatus, setAudioStatus] = useState("Audio not connected");

  const updateRemoteUsers = useCallback((users) => {
    remoteUsersRef.current = users;
    setRemoteUsers(users);
  }, []);

  const getDistance = useCallback((user) => {
    return Math.hypot(
      user.x - positionRef.current.x,
      user.y - positionRef.current.y
    );
  }, []);

  const updateAudioVolumes = useCallback(() => {
    Object.entries(audioElementsRef.current).forEach(([id, audio]) => {
      const user = remoteUsersRef.current[id];

      if (!user) {
        audio.volume = 0;
        return;
      }

      const distance = getDistance(user);
      audio.volume = Math.max(
        0,
        Math.min(1, 1 - distance / AUDIO_RANGE)
      );
    });
  }, [getDistance]);

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
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
      ]
    });

    peersRef.current[userId] = peer;
    pendingCandidatesRef.current[userId] = [];

    const transceiver = peer.addTransceiver("audio", {
      direction: "sendrecv"
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
          candidate: event.candidate
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

      const stream =
        event.streams?.[0] || new MediaStream([event.track]);

      audio.srcObject = stream;
      audio.muted = false;

      updateAudioVolumes();

      try {
        await audio.play();
        setAudioStatus("Voice connection active");
      } catch (error) {
        console.error("Audio playback failed:", error);
        setAudioStatus(
          "Audio received. Click the page to allow playback."
        );
      }
    };

    peer.onconnectionstatechange = () => {
      console.log(
        `Peer ${userId} connection state:`,
        peer.connectionState
      );

      if (peer.connectionState === "connected") {
        setAudioStatus("Connected; waiting for remote sound");
      } else if (peer.connectionState === "failed") {
        setAudioStatus("Audio connection failed");
      } else if (peer.connectionState === "disconnected") {
        setAudioStatus("Audio temporarily disconnected");
      }
    };

    peer.oniceconnectionstatechange = () => {
      console.log(
        `Peer ${userId} ICE state:`,
        peer.iceConnectionState
      );
    };

    return peer;
  }, [updateAudioVolumes]);

  const flushPendingCandidates = useCallback(
    async (userId, peer) => {
      const candidates = pendingCandidatesRef.current[userId] || [];
      pendingCandidatesRef.current[userId] = [];

      for (const candidate of candidates) {
        try {
          await peer.addIceCandidate(candidate);
        } catch (error) {
          console.error("Could not add ICE candidate:", error);
        }
      }
    },
    []
  );

  const makeOffer = useCallback(async (userId) => {
    const peer = createPeer(userId);

    try {
      if (peer.signalingState !== "stable") return;

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      socketRef.current?.emit("webrtc-offer", {
        targetId: userId,
        offer: peer.localDescription
      });
    } catch (error) {
      console.error("Could not create audio offer:", error);
    }
  }, [createPeer]);

  const handleOffer = useCallback(
    async ({ fromId, offer }) => {
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
          answer: peer.localDescription
        });
      } catch (error) {
        console.error("Could not answer audio offer:", error);
        setAudioStatus("Could not establish audio connection");
      }
    },
    [createPeer, flushPendingCandidates]
  );

  const handleAnswer = useCallback(
    async ({ fromId, answer }) => {
      const peer = peersRef.current[fromId];

      if (!peer || peer.signalingState !== "have-local-offer") {
        return;
      }

      try {
        await peer.setRemoteDescription(answer);
        await flushPendingCandidates(fromId, peer);
      } catch (error) {
        console.error("Could not set audio answer:", error);
      }
    },
    [flushPendingCandidates]
  );

  const handleIceCandidate = useCallback(
    async ({ fromId, candidate }) => {
      const peer = peersRef.current[fromId];

      // Candidates can arrive before the offer creates the peer connection.
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
    },
    []
  );

  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      console.log("Socket connected:", socket.id);
    });

    socket.on("disconnect", () => {
      setConnected(false);
      setAudioStatus("Server disconnected");
    });

    socket.on("current-users", (users) => {
      const others = { ...users };
      delete others[socket.id];

      updateRemoteUsers(others);

      // A consistent ID rule makes only one side start each connection.
      Object.keys(others).forEach((id) => {
        if (socket.id.localeCompare(id) < 0) {
          makeOffer(id);
        }
      });
    });

    socket.on("user-joined", (user) => {
      updateRemoteUsers({
        ...remoteUsersRef.current,
        [user.id]: user
      });

      // Existing and newly joined clients use the same initiator rule.
      if (socket.id.localeCompare(user.id) < 0) {
        makeOffer(user.id);
      }
    });

    socket.on("user-moved", (user) => {
      if (user.id !== socket.id) {
        updateRemoteUsers({
          ...remoteUsersRef.current,
          [user.id]: user
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

      Object.keys(peersRef.current).forEach((id) => {
        closePeer(id);
      });

      micStreamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });

      micStreamRef.current = null;
      socketRef.current = null;
    };
  }, [
    closePeer,
    handleAnswer,
    handleIceCandidate,
    handleOffer,
    makeOffer,
    updateRemoteUsers
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
          noiseSuppression: true
        }
      });

      micStreamRef.current = stream;
      const track = stream.getAudioTracks()[0];

      for (const userId of Object.keys(remoteUsersRef.current)) {
        const peer = createPeer(userId);

        const transceiver = peer.getTransceivers().find(
          (item) => item.receiver.track.kind === "audio"
        );

        if (transceiver) {
          await transceiver.sender.replaceTrack(track);
        }
      }

      setMicEnabled(true);

      setAudioStatus(
        Object.keys(remoteUsersRef.current).length
          ? "Microphone on; waiting for remote audio"
          : "Microphone on; waiting for another user"
      );
    } catch (error) {
      console.error("Microphone error:", error);

      micStreamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });

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
      } else if (error.name === "OverconstrainedError") {
        message =
          "The microphone does not support the requested audio settings.";
      } else if (error.name === "SecurityError") {
        message =
          "Microphone access is blocked by browser security settings.";
      } else if (error.message) {
        message = `Microphone error: ${error.message}`;
      }

      setMicError(message);
      setAudioStatus("Microphone unavailable");
    }
  }

  function disableMicrophone() {
    micStreamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

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

  function moveAvatar(event) {
    const key = event.key.toLowerCase();
    const step = 15;
    let { x, y } = positionRef.current;

    if (key === "arrowup" || key === "w") y -= step;
    else if (key === "arrowdown" || key === "s") y += step;
    else if (key === "arrowleft" || key === "a") x -= step;
    else if (key === "arrowright" || key === "d") x += step;
    else return;

    event.preventDefault();

    const next = {
      x: Math.max(20, Math.min(700, x)),
      y: Math.max(20, Math.min(350, y))
    };

    positionRef.current = next;
    setPosition(next);

    socketRef.current?.emit("move", next);
  }

  const distances = Object.values(remoteUsers).map(getDistance);
  const distance = distances.length
    ? Math.round(Math.min(...distances))
    : null;

  const volumeLevel = distance === null
    ? 0
    : Math.max(
        0,
        Math.min(
          100,
          Math.round((1 - distance / AUDIO_RANGE) * 100)
        )
      );

  const proximityStatus =
    distance === null
      ? "No users nearby"
      : distance >= AUDIO_RANGE
        ? "Out of audio range"
        : distance < 100
          ? "Nearby"
          : "Medium distance";

  return (
    <main
      className="app"
      tabIndex={0}
      onKeyDown={moveAvatar}
    >
      <header className="topbar">
        <h1>🎧 ProxiSpeak</h1>
        <span>Geospatial Proximity Audio Ecosystem</span>
      </header>

      <section className="welcome">
        <h2>Welcome to your virtual office</h2>
        <p>Move your avatar and connect with people nearby.</p>

        <p>
          Connection:{" "}
          <strong>
            {connected ? "Connected" : "Connecting..."}
          </strong>
          {" · "}
          Other users: {Object.keys(remoteUsers).length}
        </p>

        <p>
          Nearest user distance:{" "}
          {distance === null ? "No other users" : `${distance} units`}
        </p>

        <p>Proximity volume: {volumeLevel}%</p>
        <p>
          Proximity status: <strong>{proximityStatus}</strong>
        </p>

        <div
          style={{
            width: "200px",
            height: "12px",
            background: "#ddd",
            borderRadius: "8px",
            overflow: "hidden",
            margin: "8px auto"
          }}
          aria-label={`Proximity volume ${volumeLevel}%`}
        >
          <div
            style={{
              width: `${volumeLevel}%`,
              height: "100%",
              background: "#28a745",
              transition: "width 0.2s"
            }}
          />
        </div>

        <button
          onClick={
            micEnabled ? disableMicrophone : enableMicrophone
          }
        >
          {micEnabled
            ? "🔇 Disable Microphone"
            : "🎤 Enable Microphone"}
        </button>

        <p>
          Microphone: {micEnabled ? "Enabled" : "Disabled"}
        </p>

        <p>Audio status: {audioStatus}</p>

        {micError && (
          <p role="alert" style={{ color: "red" }}>
            {micError}
          </p>
        )}
      </section>

      <section className="office">
        <div className="desk desk-one">💻 Desk 1</div>
        <div className="desk desk-two">💻 Desk 2</div>
        <div className="desk desk-three">🪴 Lounge</div>

        {Object.values(remoteUsers).map((user) => (
          <div
            key={user.id}
            className="avatar remote-avatar"
            style={{
              left: user.x,
              top: user.y
            }}
          >
            🧑‍💻
            <span>Guest {user.id.slice(0, 4)}</span>
          </div>
        ))}

        <div
          className="avatar"
          style={{
            left: position.x,
            top: position.y
          }}
        >
          🧑‍💻
          <span>You</span>
        </div>
      </section>

      <footer>
        Use arrow keys or W, A, S, D to move.
        Open this site in two browser tabs to test.
        Use headphones to avoid audio feedback.
      </footer>
    </main>
  );
}
