# ProxiSpeak — Product Requirements Document (PRD)

**Project:** ProxiSpeak — Geospatial Proximity Audio Ecosystem
**Owner:** Infotact Internship Team
**Status:** Draft v1.0
**Related docs:** `trd.md`, `architecture.md`, `design.md`, `security.md`, `rules.md`, `phases.md`

---

## 1. Problem Statement

Remote collaboration tools (Zoom, Google Meet, Teams) force users into rigid, single-channel "rooms" where only one person can speak at a time and every conversation requires a deliberate, formal action (sending a link, scheduling a call). They lack the spontaneous, spatial dynamics of a physical office — the ability to overhear a nearby conversation, drift toward it, and organically join without interrupting anyone.

ProxiSpeak solves this by giving remote teams a shared 2D virtual office where **physical proximity between avatars determines who can hear whom**, recreating the ambient, organic social dynamics of in-person collaboration.

## 2. Vision

> A virtual office where walking toward a colleague is the UI for starting a conversation.

ProxiSpeak is not a meeting tool. It is a persistent, always-on spatial presence layer that Infotact teams keep open throughout the workday, the way they would keep an office door open.

## 3. Goals & Non-Goals

### 3.1 Goals
- Let users move an avatar around a shared 2D office in real time.
- Automatically establish/tear down peer audio connections based on proximity.
- Make nearby voices louder and distant voices quieter/silent, with left-right stereo positioning matching relative avatar position.
- Support **50+ concurrent users** in one office space without degrading interaction quality for users who are near each other.
- Let an office admin persist office layouts, furniture, and sound-blocking obstacles.
- Provide a believable, low-friction "walk up and talk" experience — no clicking "join call."

### 3.2 Non-Goals (v1)
- Video avatars/webcam video (audio + 2D avatar only).
- Mobile native apps (web-first, responsive-friendly but not mobile-optimized in v1).
- Screen sharing, file transfer, or chat/text messaging (future phase).
- Full 3D rendering (Three.js) — v1 is strictly 2D top-down.
- Cross-office (multi-tenant) federation — v1 is single-organization, multiple offices.

## 4. Target Users

| Persona | Need |
|---|---|
| Infotact engineer (remote) | Wants to "sit near" teammates and overhear/join informal chats |
| Team lead | Wants a lightweight way to see who's around and available without pinging everyone |
| Intern / new hire | Wants a casual way to approach senior engineers without a formal meeting invite |
| Office admin / IT | Wants to configure office layout, desks, and meeting zones; monitor usage and load |

## 5. Core Use Case (as specified)

An Infotact team logs into ProxiSpeak and sees a 2D overhead map of a virtual office rendered in React Canvas. As a user moves their avatar closer to a group of colleagues, the WebRTC audio dynamically crossfades, becoming louder. The Node.js backend continuously calculates spatial distances between all avatars using MongoDB geospatial queries, orchestrating a seamless, organic audio experience for 50+ concurrent users in the same virtual space.

## 6. Key Modules (from spec)

1. **Geospatial Engine** (MongoDB `$near` & `$geoWithin`) — tracks real-time X/Y coordinates of all users and calculates physical proximity clusters.
2. **Signaling Server** (Node.js & Socket.io) — orchestrates WebRTC peer-to-peer connection handshakes based on who is within "earshot."
3. **Spatial Audio Mixer** (Web Audio API) — frontend module that dynamically adjusts gain (volume) and stereo panning of peer audio tracks based on relative avatar distance.
4. **2D Virtual World** (React & HTML5 Canvas) — high-performance rendering engine for the office map and real-time avatar movement.

## 7. Functional Requirements

### FR-1 — Authentication & Office Entry
- FR-1.1: User authenticates (SSO/email) and joins a specific office by ID.
- FR-1.2: On entry, user receives current office layout, obstacle geometry, and the list of currently online users with positions.
- FR-1.3: User is assigned a default spawn point (entry zone), not an arbitrary random location.

### FR-2 — Avatar Movement
- FR-2.1: User moves avatar via keyboard (WASD/arrow keys); mouse/click-to-move is a stretch goal.
- FR-2.2: Client renders movement locally at 60 FPS before server confirmation (client-side prediction).
- FR-2.3: Position updates are throttled before transmission (target: ~10–20 updates/sec, not per animation frame).
- FR-2.4: Server validates position bounds and collision against obstacles before broadcasting.

### FR-3 — Presence & Proximity
- FR-3.1: Server computes, for every user, the set of other users within a configurable **hearing radius** (default 100px) using MongoDB geospatial queries.
- FR-3.2: Proximity set changes trigger `peer:enter-range` / `peer:exit-range` events to affected clients only.
- FR-3.3: Hysteresis/grace period prevents rapid connect/disconnect flapping at the radius boundary.

### FR-4 — Audio Connectivity (WebRTC)
- FR-4.1: When two users enter each other's hearing range, the signaling server coordinates an offer/answer/ICE exchange between their browsers.
- FR-4.2: When users exit range (beyond a grace period), the peer connection is torn down or muted.
- FR-4.3: STUN is used by default; TURN relay is available for restrictive networks.
- FR-4.4: A user can mute/unmute their own microphone at any time, independent of proximity state.

### FR-5 — Spatial Audio
- FR-5.1: Each connected peer's audio stream has an independent gain (volume) node, scaled by distance using an attenuation curve.
- FR-5.2: Each peer's audio is stereo-panned left/right based on their position relative to the local user.
- FR-5.3: Volume and pan changes are smoothed (no abrupt jumps) as avatars move.
- FR-5.4: Audio beyond the hearing radius is fully attenuated (silent), and the underlying peer connection is eligible for teardown.

### FR-6 — Obstacles & Room Persistence
- FR-6.1: Office admins can define walls/obstacles that block or attenuate sound between avatars on opposite sides.
- FR-6.2: Office layouts (dimensions, desks, walls, meeting zones) are persisted in MongoDB and reloaded on every session.
- FR-6.3: Proximity/audio logic accounts for line-of-sight against obstacle geometry (Week 4 scope).

### FR-7 — Scaling
- FR-7.1: System supports 50+ concurrent users in a single office without exceeding the mesh-size limits defined in `architecture.md`.
- FR-7.2: Socket.io server can run across multiple Node instances coordinated via Redis Pub/Sub.

### FR-8 — Presence UI
- FR-8.1: UI shows a list of users currently "in earshot" with live status (speaking/muted).
- FR-8.2: UI shows microphone permission state and connection health indicators.

## 8. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Proximity computation (query + cluster) under **20ms** per update cycle, measured under the Mid-Project Review load test |
| Scalability | 50+ concurrent users per office; horizontal scaling of signaling servers via Redis |
| Latency | Audio connection establishment target < 3s under normal network conditions |
| Reliability | Reconnect gracefully after network blips without requiring a full page reload |
| Frame rate | Canvas rendering sustains ~60 FPS with 50 avatars on screen |
| Availability | Office state (layout/obstacles) durable across server restarts |
| Privacy | Microphone only active with explicit permission; audio never recorded/stored by default |
| Accessibility | Keyboard-only movement fully supported; mic status always visually indicated |

## 9. Success Metrics

- Proximity query latency: **p95 < 20ms** at 50 concurrent users.
- WebRTC connection success rate: **> 95%** on standard corporate networks (with TURN fallback).
- Canvas frame rate: **≥ 55 FPS** sustained with 50 avatars rendered.
- Audio transition smoothness: no audible "pop" on gain/pan changes (verified via manual QA + envelope inspection).
- Weekly active usage by at least one pilot Infotact team by end of Week 4.

## 10. Milestones (summary — see `phases.md` for full detail)

| Milestone | Week | Deliverable |
|---|---|---|
| World & Movement | 1 | Synchronized 2D office with live avatar movement |
| Proximity & Signaling | 2 | MongoDB `$near` proximity + WebRTC audio between 2 users |
| Mid-Project Review | — | Spatial audit (<20ms) + 2-browser audio demo |
| Spatial Audio & Scaling | 3 | Distance-based gain/pan + Redis-backed multi-instance signaling |
| Persistence & Polish | 4 | Obstacle-aware audio, persisted layouts, 60 FPS polish |
| Final Review | — | Full scalable demo for 50+ simulated users |

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Full-mesh WebRTC doesn't scale past ~15–20 active connections per user | High | Cap active connections to nearby peers only; evaluate SFU (mediasoup/LiveKit) if mesh limits are hit |
| MongoDB query load at 50+ users moving 10–20x/sec | Medium | Throttle updates, index properly, consider in-memory proximity for hot path |
| TURN-less networks blocking P2P audio | Medium | Provide TURN relay fallback |
| Audio "zipper noise" from unsmoothed gain changes | Low | Use `setTargetAtTime` ramping, documented in `design.md` |

## 12. Out of Scope for v1 (Future Considerations)
- SFU-based media routing for very large offices (200+ users).
- Screen sharing and text chat.
- 3D rendering / VR support.
- Mobile native clients.
