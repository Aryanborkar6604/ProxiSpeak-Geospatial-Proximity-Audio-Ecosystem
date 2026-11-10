# ProxiSpeak — System Architecture

**Status:** Draft v1.0 · **Companion to:** `prd.md`, `trd.md`, `design.md`, `security.md`, `rules.md`, `phases.md`

---

## 1. High-Level Architecture

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│          Browser A            │        │          Browser B            │
│  React + Canvas (2D office)   │        │  React + Canvas (2D office)   │
│  Web Audio API (gain/pan)     │        │  Web Audio API (gain/pan)     │
│  RTCPeerConnection            │◄──────►│  RTCPeerConnection            │
│  Socket.io client             │        │  Socket.io client             │
└──────────────┬────────────────┘        └──────────────┬────────────────┘
               │  WebSocket (presence, movement, signaling)
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Node.js / Express / Socket.io                     │
│  ┌───────────────┐  ┌───────────────────┐  ┌────────────────────┐    │
│  │ Signaling      │  │ Proximity Service  │  │ Office/Auth REST   │    │
│  │ (offer/answer/ │  │ ($near/$geoWithin, │  │ (layouts, obstacles│    │
│  │  ICE relay)    │  │  enter/exit-range) │  │  JWT auth)         │    │
│  └───────────────┘  └───────────────────┘  └────────────────────┘    │
└───────┬───────────────────────┬───────────────────────┬──────────────┘
        │                       │                        │
        ▼                       ▼                        ▼
┌───────────────┐      ┌────────────────┐        ┌────────────────┐
│ Redis Pub/Sub  │      │   MongoDB       │        │  STUN / TURN    │
│ (multi-instance│      │ users/offices/  │        │  (NAT traversal)│
│  coordination) │      │ positions       │        └────────────────┘
└───────────────┘      └────────────────┘
```

Audio itself (the actual voice data) never touches the backend — it flows **peer-to-peer** between browsers via WebRTC once signaling completes. The backend's job is entirely coordination: who should talk to whom, and when to start/stop that connection.

## 2. Component Responsibilities

| Component | Responsibility | Does NOT do |
|---|---|---|
| React Canvas (2D Virtual World) | Render office, avatars, obstacles at 60 FPS; capture keyboard input; interpolate remote positions | Decide who can hear whom |
| Socket.io client | Emit throttled movement, receive presence/proximity/signaling events | Carry audio |
| Web Audio API module | Per-peer gain/pan processing of already-received WebRTC audio | Transport audio over the network |
| RTCPeerConnection (WebRTC) | Peer-to-peer audio transport once negotiated | Decide *when* to negotiate |
| Signaling Server (Socket.io, Node) | Relay offer/answer/ICE between eligible peers only | Process or store audio |
| Proximity Service (Node) | Query MongoDB geospatial index, diff proximity sets, emit enter/exit-range | Render anything |
| MongoDB | Persist users, offices, obstacles, zones; serve geospatial queries | Hold WebRTC media |
| Redis Pub/Sub | Fan events across multiple Node instances | Persist data long-term |
| STUN/TURN | NAT traversal / relay fallback for WebRTC | Signaling |

## 3. Core Data Flow — "Aryan walks toward Alex"

1. **Local render:** React Canvas updates Aryan's position immediately on keypress (client-side prediction).
2. **Throttled emit:** Client emits `player:move` at ~15 Hz.
3. **Validation & broadcast:** Server validates bounds/collision, updates `positions`, broadcasts `player:moved` to the office room.
4. **Proximity recompute:** Proximity Service runs `$near` against the `positions` 2d index on a ~10 Hz cycle, diffs against the previous in-range set per user.
5. **Range events:** On a set change, server emits `peer:enter-range` / `peer:exit-range` only to the affected clients.
6. **Signaling:** On `enter-range`, the initiating client creates an `RTCPeerConnection`, generates an offer, and the server relays offer → answer → ICE candidates between the two browsers only.
7. **Media flows P2P:** Once negotiated, audio streams directly between Aryan's and Alex's browsers.
8. **Spatial processing:** Each browser's Web Audio graph (`GainNode` + `StereoPannerNode`) continuously adjusts the incoming stream's volume/pan from locally-known relative positions — this requires no additional server round-trip.
9. **Exit:** When Alex moves out of range (past hysteresis buffer), server emits `exit-range`; clients fade gain to 0 and tear down the peer connection after a short grace period.

## 4. Scaling Model — WebRTC Mesh Limits

A full mesh among **N** users in simultaneous earshot creates up to `N(N-1)/2` direct connections. ProxiSpeak limits this by connecting each user **only to others within their own hearing radius**, not to the entire office — so the practical per-user connection count stays small (typically single digits) even when the office holds 50+ people, because most of them are far away on the map.

| Office size | Full-mesh (naïve) pairs | ProxiSpeak (proximity-capped) typical per-user connections |
|---|---|---|
| 10 | 45 | 2–4 |
| 25 | 300 | 3–6 |
| 50 | 1,225 | 3–8 (depends on clustering) |

**Escalation trigger:** If load testing shows any single user regularly exceeding ~10–12 simultaneous peer connections (e.g., a crowded "town hall" zone), the architecture calls for evaluating a **Selective Forwarding Unit (SFU)** such as mediasoup or LiveKit for that zone type, rather than scaling the mesh further. This is documented as a Phase 2 consideration, not a v1 requirement.

## 5. Horizontal Scaling (Multi-Instance Signaling)

- Multiple Node/Socket.io instances sit behind a load balancer.
- The `@socket.io/redis-adapter` (backed by Redis Pub/Sub) ensures a `player:moved` or `peer:enter-range` event emitted on Instance A reaches a client connected to Instance B.
- Office "rooms" (Socket.io rooms) remain the unit of broadcast scoping regardless of which instance a client is attached to.
- Redis does **not** store authoritative state — MongoDB remains the source of truth for office layout and (depending on Week 3 findings) possibly positions; Redis is purely a coordination/message bus.

## 6. Obstacle & Line-of-Sight Model (Week 4)

- Obstacles are line segments (`x1,y1 → x2,y2`) with an `attenuation` factor (0 = fully blocks, 1 = no effect).
- Proximity Service performs a segment-intersection check between the line connecting two avatars and each office obstacle.
- If intersected, the effective gain is multiplied by the obstacle's attenuation factor before being used client-side (passed along in the `enter-range`/position payload so the client's Web Audio graph can apply it).
- This keeps the "is there a wall" decision authoritative on the server, while the actual audio DSP stays client-side.

## 7. Failure Modes & Resilience

| Failure | Handling |
|---|---|
| Client network blip | Socket.io auto-reconnect; on reconnect, client re-requests `office:state` snapshot |
| WebRTC negotiation failure (no TURN) | Fallback to TURN relay; surfaced to user as degraded connection if relay also fails |
| MongoDB query latency spike | Proximity Service falls back to last-known-good in-range set for one cycle rather than blocking |
| Redis instance down | Socket.io instances continue serving clients already attached to them; cross-instance broadcast degrades until Redis recovers |
| Stale peer connection (user closed tab without clean disconnect) | Server-side presence TTL + Socket.io `disconnect` event cleans up `positions` and notifies peers |

## 8. Deployment Topology (target)

```
                 ┌────────────┐
                 │   Clients   │
                 └─────┬──────┘
                       │
                 ┌─────▼──────┐
                 │ Load Balancer│
                 └──┬───────┬──┘
           ┌─────────▼──┐ ┌─▼──────────┐
           │ Node Inst. A│ │ Node Inst. B│
           └──────┬──────┘ └──────┬─────┘
                   │  Redis Pub/Sub │
                   └───────┬────────┘
                           │
                 ┌─────────▼─────────┐
                 │   MongoDB Cluster  │
                 └────────────────────┘
```

## 9. Technology Decision Log

| Decision | Rationale | Revisit if... |
|---|---|---|
| `2d` index over `2dsphere` | Office coordinates are planar pixels, not geographic | Project ever maps offices to real-world geo data |
| Full-mesh WebRTC for v1 | Simpler to build/debug within a 4-week internship timeline; sufficient given proximity-capping | Per-user active connections regularly exceed ~10 |
| Socket.io over raw WebSocket | Built-in reconnection, rooms, and a Redis adapter out of the box | Never — scope fits Socket.io well |
| MongoDB for positions (initial) | Keeps a single datastore for v1; geospatial indexing is native | Week 3 load test shows MongoDB write/query latency becomes the bottleneck at 50 users |
