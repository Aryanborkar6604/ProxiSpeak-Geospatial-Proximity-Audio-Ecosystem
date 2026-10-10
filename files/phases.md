# ProxiSpeak — Development Phases

**Status:** Draft v1.0 · **Companion to:** `prd.md`, `trd.md`, `architecture.md`, `design.md`, `security.md`, `rules.md`

This phase plan follows the official Infotact internship schedule exactly (Week 1 → Week 4 + two formal reviews), expanded into concrete, checkable deliverables and acceptance criteria so progress can be verified objectively at each checkpoint.

---

## Phase 0 — Setup (pre-Week 1, 1–2 days)

**Goal:** Environment ready, nothing feature-related yet.

- [ ] Node.js, npm, git, MongoDB (local or Atlas) installed/verified.
- [ ] Repo scaffolded per `architecture.md` folder structure (`client/`, `server/`).
- [ ] `.env` / `.gitignore` configured per `rules.md` R-23 and `security.md` SEC-22.
- [ ] Vite + React app boots; Express + Socket.io server boots; MongoDB connection verified.
- [ ] Read `prd.md`, `trd.md`, `architecture.md`, `design.md`, `security.md`, `rules.md` end to end.

---

## Phase 1 — Week 1: Signaling & Movement / World Rendering

**Spec reference:** *"Build WebSocket server to broadcast avatar X/Y coordinates. Setup basic MongoDB geospatial schemas."* / *"Build the React Canvas layer. Implement smooth keyboard/mouse avatar movement and coordinate broadcasting."*

### Backend tasks
- [ ] Express + Socket.io server with `office:join`, `player:move`, `player:moved` events.
- [ ] `positions` and `offices` MongoDB schemas created (per `trd.md` §2).
- [ ] Basic `2d` geospatial index created on `positions.location`.
- [ ] Server-side bound/shape validation on incoming positions (`rules.md` R-5, `security.md` SEC-15).

### Frontend tasks
- [ ] `OfficeCanvas` component rendering office floor + avatars (per `design.md` §3).
- [ ] Keyboard-driven (WASD/arrows) avatar movement with client-side prediction.
- [ ] Throttled `player:move` emission (~15 Hz).
- [ ] Remote avatar interpolation (no snapping) between server updates.

### Week 1 Deliverable / Acceptance
- [ ] Two browser windows joined to the same office show synchronized avatar movement.
- [ ] Moving one avatar updates the other window within a visually smooth, sub-second delay.
- [ ] Canvas sustains ~60 FPS with a small number of avatars on screen.
- [ ] No position update bypasses server-side validation (manual code review against `rules.md` R-5).

---

## Phase 2 — Week 2: Proximity Calculations / WebRTC Integration

**Spec reference:** *"Implement MongoDB $near queries to group users. Logic to only send WebRTC offer/answers to users within a 100-pixel radius."* / *"Implement standard WebRTC peer-to-peer audio connections using the browser's getUserMedia."*

### Backend tasks
- [ ] Proximity Service computing `$near` results on a controlled interval (`trd.md` §4).
- [ ] In-range set diffing with `peer:enter-range` / `peer:exit-range` events, scoped only to affected clients (`rules.md` R-8).
- [ ] Signaling relay (`webrtc:offer/answer/ice-candidate`) restricted to confirmed in-range pairs (`rules.md` R-9, `security.md` SEC-17).
- [ ] `officeId` scoping enforced on every geospatial query (`rules.md` R-18).

### Frontend tasks
- [ ] Microphone permission flow (`getUserMedia({ audio: true })`) with the `PermissionPanel` UI from `design.md` §5.
- [ ] `RTCPeerConnection` creation triggered by `enter-range`, torn down on `exit-range` with grace period.
- [ ] STUN configuration wired in; TURN config scaffolded (even if not load-tested yet).
- [ ] `NearbyPanel` UI showing currently in-range peers.

### Mid-Project Review (formal checkpoint)

**Spec reference:** *"Spatial Audit: Prove the backend accurately filters and clusters users based on geospatial coordinates under 20ms."* / *"Audio Check: Demonstrate two browsers successfully establishing a WebRTC audio connection via the signaling server."*

- [ ] **Spatial audit:** Scripted test measures proximity-query-to-event-emission latency under a representative simulated load; result documented (target p95 < 20ms per `prd.md` §9).
- [ ] **Audio check:** Live demo — two browsers, two microphones, avatars moved into range, audio connects via the signaling server, confirmed audible both directions.
- [ ] Demo includes at least one deliberate **exit-range** moment showing the connection correctly tears down/mutes.
- [ ] Any gap between planned and actual architecture (e.g., storage decisions) is logged per `rules.md` R-29.

---

## Phase 3 — Week 3: Mesh Scaling / Dynamic Attenuation

**Spec reference:** *"Optimize the WebRTC mesh network. Implement Redis Pub/Sub to allow scaling the Socket.io server across multiple Node instances."* / *"Hook WebRTC audio tracks into the Web Audio API. Write algorithms to calculate volume drop-off based on pixel distance."*

### Backend tasks
- [ ] Redis Pub/Sub + `@socket.io/redis-adapter` wired across at least two local Node instances.
- [ ] Cross-instance event propagation verified (client on Instance A sees movement from client on Instance B).
- [ ] Mesh-size telemetry: log/alert when any user's active peer-connection count approaches the cap defined in `architecture.md` §4.
- [ ] Decision checkpoint: if Week 2's audit showed MongoDB proximity latency issues, implement and benchmark the fallback path noted in `trd.md` §2.3.

### Frontend tasks
- [ ] Per-peer Web Audio graph: `GainNode` wired to each remote stream, gain computed via the attenuation function in `trd.md` §6.
- [ ] All gain changes ramped via `setTargetAtTime` (`rules.md` R-14) — verified by manual listening test for zipper noise.
- [ ] Audio graph nodes created once per connection and reused (`rules.md` R-16).
- [ ] Load-test harness run against a simulated multi-user scenario; frame rate and audio behavior checked under load.

### Week 3 Deliverable / Acceptance
- [ ] Moving an avatar closer/farther produces a clearly audible, smooth volume change with no clicks/pops.
- [ ] Two Socket.io server instances, coordinated via Redis, correctly relay movement and proximity events to clients on either instance.
- [ ] Documented measurement of per-user peer-connection counts under a simulated 20–30 user scenario.

---

## Phase 4 — Week 4: Room Persistence / Refine & Polish

**Spec reference:** *"Save office layouts and furniture obstacles (which block sound) into MongoDB."* / *"Add 3D audio panning (stereo separation). Ensure Canvas animations render at a steady 60 FPS."*

### Backend tasks
- [ ] `offices` collection stores layout, furniture, and obstacle geometry (`trd.md` §2.2); admin REST endpoint to persist edits (`rules.md` R-20).
- [ ] Obstacle line-of-sight intersection check implemented in the Proximity Service (`architecture.md` §6).
- [ ] Attenuation factor from obstacles included in the proximity/enter-range payload sent to clients.

### Frontend tasks
- [ ] `StereoPannerNode` wired per peer; pan computed from relative X position (`trd.md` §6).
- [ ] Obstacle-aware visual treatment on presence rings (`design.md` §8).
- [ ] Final Canvas performance pass: confirm steady 60 FPS with 50 rendered avatars (`rules.md` R-26).
- [ ] Mic button, Nearby panel, connection health indicator, dark mode — all states implemented per `design.md`.
- [ ] Mute/unmute always overrides proximity-based auto-connect (`security.md` SEC-11) — explicitly tested.

### Final Project Review (formal checkpoint)

**Spec reference:** *"A highly scalable, stateful geospatial server managing complex P2P routing logic."* / *"An immersive, physics-aware communication platform demonstrating advanced browser audio manipulation."*

- [ ] **Demo 1 — Movement:** two+ sessions stay synchronized.
- [ ] **Demo 2 — Proximity:** server's nearby-user list updates correctly as avatars move, shown live (e.g., via a debug overlay or server logs).
- [ ] **Demo 3 — Audio:** live two-way voice confirmed between multiple pairs simultaneously.
- [ ] **Demo 4 — Spatial effect:** audible volume + stereo panning change smoothly as avatars move closer/farther and left/right.
- [ ] **Demo 5 — Performance:** scripted load test report covering proximity query latency, Socket.io update throughput, and WebRTC connection establishment time, run against a simulated multi-user load approaching the 50-user target.
- [ ] **Obstacle demo:** two avatars on opposite sides of a wall show measurably attenuated/blocked audio versus the same distance with no wall.
- [ ] Full `security.md` §9 checklist reviewed and signed off.
- [ ] README finalized with setup instructions, architecture summary, and known limitations.

---

## Phase Summary Table

| Phase | Weeks | Primary Deliverable | Formal Checkpoint |
|---|---|---|---|
| 0 — Setup | Pre-W1 | Working dev environment | — |
| 1 — World & Movement | Week 1 | Synchronized 2D office | — |
| 2 — Proximity & Signaling | Week 2 | $near proximity + 2-user WebRTC audio | **Mid-Project Review** |
| 3 — Spatial Audio & Scaling | Week 3 | Gain/pan attenuation + Redis multi-instance | — |
| 4 — Persistence & Polish | Week 4 | Obstacles, panning, 60 FPS, persisted layouts | **Final Project Review** |

## Post-v1 Backlog (not part of the 4-week plan, for future reference)
- SFU evaluation (mediasoup/LiveKit) if mesh limits are regularly hit in production usage.
- Text chat / screen sharing.
- Admin analytics dashboard (aggregated, privacy-respecting per `security.md` SEC-20).
- Mobile-responsive / native app exploration.
