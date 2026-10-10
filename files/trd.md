# ProxiSpeak — Technical Requirements Document (TRD)

**Status:** Draft v1.0 · **Companion to:** `prd.md`, `architecture.md`, `design.md`, `security.md`, `rules.md`, `phases.md`

---

## 1. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend framework | React 18 (Vite) | Functional components + hooks only |
| Rendering | HTML5 Canvas (2D context) | No DOM-per-avatar; single canvas render loop |
| Real-time transport (signaling/state) | Socket.io (client + server) | WebSocket primary, polling fallback |
| Audio transport | WebRTC (`RTCPeerConnection`, `getUserMedia`) | Mesh topology in v1 |
| Audio processing | Web Audio API (`GainNode`, `StereoPannerNode`) | Per-peer audio graph |
| Backend runtime | Node.js 20 LTS + Express | REST for auth/office config, Socket.io for real-time |
| Database | MongoDB 6+ (Atlas or self-hosted) | `2d` index for planar coordinates |
| Cross-instance coordination | Redis 7+ (Pub/Sub, `@socket.io/redis-adapter`) | Introduced in Week 3 |
| STUN/TURN | coturn or managed TURN provider | Required for NAT traversal in restrictive networks |
| Auth | JWT (company SSO integration where available) | Validated on both REST and Socket.io handshake |
| Deployment target | Containerized (Docker), horizontally scalable Node instances behind a load balancer | |

## 2. Data Model

### 2.1 `users` collection
```json
{
  "_id": "ObjectId",
  "userId": "string",
  "name": "string",
  "email": "string",
  "avatarColor": "string",
  "createdAt": "ISODate"
}
```

### 2.2 `offices` collection
```json
{
  "officeId": "string",
  "name": "string",
  "width": 1000,
  "height": 700,
  "hearingRadiusPx": 100,
  "obstacles": [
    { "type": "wall", "x1": 200, "y1": 100, "x2": 200, "y2": 300, "attenuation": 0.9 }
  ],
  "zones": [
    { "name": "Meeting Room A", "shape": "rect", "x": 50, "y": 50, "w": 150, "h": 100 }
  ],
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

### 2.3 `positions` collection (ephemeral/hot-path)
```json
{
  "userId": "string",
  "officeId": "string",
  "location": [100, 100],
  "isOnline": true,
  "isMuted": false,
  "updatedAt": "ISODate"
}
```
Index: `db.positions.createIndex({ location: "2d" })`
Compound filter fields (`officeId`, `isOnline`) should be included in every query predicate alongside `$near`/`$geoWithin`.

> Positions are high-churn. Depending on load testing results in Week 3, this collection may be backed by an in-memory store (Node process memory or Redis geospatial commands) instead of MongoDB on the hot path, with periodic snapshot writes to MongoDB for reconnect recovery. This decision is finalized after the Mid-Project Review performance audit.

### 2.4 `sessions` collection (optional)
```json
{
  "sessionId": "string",
  "userId": "string",
  "officeId": "string",
  "socketId": "string",
  "connectedAt": "ISODate"
}
```

## 3. API Surface

### 3.1 REST (Express)
| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | Authenticate user, issue JWT |
| `GET` | `/api/offices/:officeId` | Fetch office layout/obstacles/zones |
| `POST` | `/api/offices/:officeId/layout` | Admin: update office layout (persisted to MongoDB) |
| `GET` | `/api/offices/:officeId/users` | Snapshot of online users (fallback for reconnect) |
| `GET` | `/api/health` | Liveness/readiness probe |

### 3.2 Socket.io Events

**Client → Server**
| Event | Payload | Purpose |
|---|---|---|
| `office:join` | `{ officeId }` | Join an office room, receive initial state |
| `player:move` | `{ x, y }` | Report new avatar position (throttled) |
| `player:mute` | `{ isMuted }` | Update mute status |
| `webrtc:offer` | `{ toUserId, sdp }` | Relay SDP offer |
| `webrtc:answer` | `{ toUserId, sdp }` | Relay SDP answer |
| `webrtc:ice-candidate` | `{ toUserId, candidate }` | Relay ICE candidate |

**Server → Client**
| Event | Payload | Purpose |
|---|---|---|
| `office:state` | `{ users[], obstacles[], zones[] }` | Initial snapshot on join |
| `player:moved` | `{ userId, x, y }` | Broadcast a peer's movement |
| `player:joined` / `player:left` | `{ userId, ... }` | Presence changes |
| `peer:enter-range` | `{ userId }` | Signals client to begin WebRTC negotiation |
| `peer:exit-range` | `{ userId }` | Signals client to tear down/mute connection |
| `webrtc:offer` / `webrtc:answer` / `webrtc:ice-candidate` | relayed | Forwarded signaling payloads |

## 4. Proximity Engine — Technical Spec

- Movement updates throttled client-side to **~15 Hz** max emission rate.
- Server-side proximity recompute runs on a controlled interval (target **~10 Hz**) rather than per-event, using the latest known position per user.
- Query pattern (illustrative, `2d` index):
```js
db.positions.find({
  officeId,
  userId: { $ne: currentUserId },
  isOnline: true,
  location: { $near: [x, y], $maxDistance: radius }
});
```
- `$geoWithin` with `$center` is used for zone-membership checks (e.g., "is this avatar inside Meeting Room A").
- Proximity diffing: server maintains the previous "in-range set" per user and emits `enter-range`/`exit-range` only on set changes — never a full resend.
- Boundary hysteresis: apply a small buffer (e.g., exit only confirmed after distance > radius + 15px for 2 consecutive cycles) to prevent flapping.

## 5. WebRTC — Technical Spec

- Topology: **full mesh** in v1, capped per-user active connections to the current in-range set only (not global).
- ICE servers: STUN by default; TURN configured via environment variables and enabled per-deployment.
- Connection lifecycle: created on `enter-range`, renegotiation avoided for already-connected peers, torn down (or gain set to 0 + connection held briefly) on `exit-range` after grace period.
- Audio-only constraints: `{ audio: true, video: false }`.
- Mesh ceiling: architecture document defines the practical cap (see `architecture.md` §4) and the SFU evaluation trigger.

## 6. Web Audio API — Technical Spec

Per-peer audio graph:
```
RemoteStream → MediaStreamAudioSourceNode → GainNode → StereoPannerNode → AudioContext.destination
```
- Gain function (v1 baseline): `V(d) = max(0, 1 - d / radius)` — linear falloff, replaceable with a smoother curve (e.g., inverse-square clamp) post-MVP.
- Pan function: `P(Δx) = clamp(Δx / radius, -1, 1)`.
- All parameter changes applied via `AudioParam.setTargetAtTime(value, currentTime, 0.05)` — never direct assignment — to avoid zipper noise.
- One `AudioContext` per client, created/resumed on first user gesture (browser autoplay policy compliance).
- Audio graph nodes are created once per peer connection and reused; disposed on teardown.

## 7. Canvas Rendering — Technical Spec

- Single `<canvas>` element, device-pixel-ratio aware.
- Render loop via `requestAnimationFrame`; game-state update decoupled from network update rate.
- Avatars, obstacles, and zones drawn from local state; remote positions interpolated between the last two known server updates to smooth perceived motion (client-side interpolation/lerp).
- Target: 60 FPS with 50 rendered avatars; profiled via Chrome DevTools Performance panel as part of Week 4 acceptance.

## 8. Scaling — Technical Spec

- Socket.io horizontal scaling via `@socket.io/redis-adapter`, backed by Redis Pub/Sub.
- Sticky sessions (or Socket.io's built-in connection state recovery) required at the load balancer if using HTTP long-polling fallback.
- Redis is for **event coordination across instances**, not a replacement for MongoDB's persistent storage.
- Load test target: 50 concurrent simulated clients per office, validated with a scripted load-test harness (e.g., `socket.io-client` driven load script) before Final Review.

## 9. Environment Configuration

```
MONGODB_URI=
MONGODB_DB=proxispeak
REDIS_URL=
JWT_SECRET=
STUN_SERVER_URL=
TURN_SERVER_URL=
TURN_USERNAME=
TURN_CREDENTIAL=
CLIENT_URL=
PORT=4000
```

## 10. Testing Requirements

| Layer | Approach |
|---|---|
| Unit | Proximity math (distance/gain/pan functions), obstacle intersection logic |
| Integration | Socket.io event flow (join → move → enter-range → signaling) via test harness |
| E2E | Two-browser Playwright/Cypress scenario: movement sync, audio connect/disconnect |
| Load | Scripted N-client simulation for proximity query latency and Socket.io throughput |
| Manual QA | Audio smoothness, stereo correctness, obstacle attenuation perception |

## 11. Acceptance Criteria Mapping

See `phases.md` for the week-by-week deliverable breakdown and the Mid-Project/Final Review acceptance checklists derived directly from this TRD.
