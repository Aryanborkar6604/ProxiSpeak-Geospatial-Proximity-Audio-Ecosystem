# ProxiSpeak — Security & Privacy Requirements

**Status:** Draft v1.0 · **Companion to:** `prd.md`, `trd.md`, `architecture.md`, `design.md`, `rules.md`, `phases.md`

---

## 1. Threat Model Summary

ProxiSpeak handles three categories of sensitive data/behavior that require explicit protection:

1. **Live microphone audio** of employees (highly sensitive).
2. **Real-time location data** (avatar position) — low sensitivity individually, but reveals behavioral patterns (who talks to whom, how often) in aggregate.
3. **Real-time signaling channel** (Socket.io) that, if abused, could be used to eavesdrop on or impersonate connections between other users.

Primary attacker profiles to defend against:
- A malicious or compromised client in the same office trying to eavesdrop on connections not meant for them.
- A malicious client trying to impersonate another user's position or identity.
- An external party attempting to join an office without authorization.
- Accidental data leakage (audio or position data persisted or logged when it shouldn't be).

## 2. Authentication & Authorization

### 2.1 Requirements
- SEC-1: Every REST and Socket.io connection must be authenticated via a signed JWT issued at login; the JWT is validated on the Socket.io handshake (`io.use(...)` middleware), not just on REST calls.
- SEC-2: `officeId` membership is verified server-side before a client is allowed to `join` the corresponding Socket.io room. A client must never be trusted to self-report which office it belongs to.
- SEC-3: `userId` is always derived server-side from the authenticated session — never trusted from client-submitted payloads (e.g., a `player:move` event must use the `userId` bound to the socket, not a field in the payload).
- SEC-4: JWTs are short-lived (recommend ≤ 1 hour) with refresh handled through the existing company SSO flow where available.
- SEC-5: Admin-only actions (office layout edits, obstacle configuration) require a distinct authorization check beyond general office membership.

### 2.2 Anti-pattern to explicitly avoid
```js
// NEVER trust client-supplied identity in event payloads
socket.on("player:move", (data) => {
  // ❌ data.userId is attacker-controlled — do not use it
  broadcastPosition(data.userId, data.x, data.y);
});

// ✅ Correct: identity comes from the authenticated socket, not the payload
socket.on("player:move", (data) => {
  const userId = socket.data.userId; // set during auth middleware
  broadcastPosition(userId, data.x, data.y);
});
```

## 3. Microphone & Audio Privacy

- SEC-6: Microphone access is requested only after explicit user action (never auto-requested on page load), and the UI must always show a persistent, unambiguous mic status indicator (see `design.md` §4.2).
- SEC-7: ProxiSpeak **does not record, store, or transcribe** audio by default. This must be stated plainly in the product UI, not buried in a policy document.
- SEC-8: Audio is transported **peer-to-peer via WebRTC**; the backend never receives, proxies, or has access to raw audio streams. This is an architectural guarantee (see `architecture.md` §1), not just a policy statement — the signaling server only ever sees SDP/ICE metadata, never media payloads.
- SEC-9: When a TURN relay is used (restrictive networks), the relay forwards encrypted media (DTLS-SRTP) without decrypting or inspecting it; TURN server operators must not have access to decrypted audio.
- SEC-10: Microphone tracks are explicitly stopped (`track.stop()`) when a user mutes, leaves an office, or closes the tab — not just disconnected from the peer connection — to ensure the OS-level mic indicator reflects reality.
- SEC-11: A user's own mute state is always authoritative and overrides proximity-based auto-connection — being near someone never forces a muted user's mic to activate.

## 4. Transport Security

- SEC-12: All traffic (REST, Socket.io/WebSocket, and the signaling-relayed SDP/ICE data) travels over TLS (`https://` / `wss://`) in every environment beyond local development. Browser `getUserMedia` requires a secure context, so this is also a functional requirement.
- SEC-13: WebRTC media itself is encrypted end-to-end via DTLS-SRTP by the browser's WebRTC implementation — no additional application-layer audio encryption is required, but this guarantee must not be weakened (e.g., no custom unencrypted media relay).
- SEC-14: CORS on the Express/Socket.io server is restricted to the known `CLIENT_URL`(s); wildcard origins are prohibited outside local development.

## 5. Input Validation & Abuse Prevention

- SEC-15: All position updates (`player:move`) are validated server-side against office boundaries (`0 ≤ x ≤ width`, `0 ≤ y ≤ height`) and rejected/clamped if out of range — a malicious client must not be able to claim an impossible position to force unwanted proximity connections.
- SEC-16: Movement rate is enforced server-side (not just client-throttled) — the server rejects or drops updates exceeding a reasonable rate per socket to prevent a malicious client from flooding the proximity engine or signaling relay.
- SEC-17: Signaling relay events (`webrtc:offer`/`answer`/`ice-candidate`) are only forwarded between two users the server has independently confirmed are currently in each other's proximity set — a client cannot direct signaling traffic at an arbitrary `userId` it is not authorized to connect to.
- SEC-18: Office layout/obstacle edit endpoints validate and sanitize all geometry input (bounds, coordinate types) before persisting to MongoDB.

## 6. Data Minimization & Retention

- SEC-19: The `positions` collection is treated as ephemeral/operational data, not an audit log — no long-term retention of historical movement trails beyond what's needed for session recovery (recommend TTL index or periodic purge for stale/offline entries).
- SEC-20: No analytics event should capture "who was near whom and for how long" at an individually identifiable level without a clear, disclosed purpose and data-retention policy; if usage analytics are added later, default to aggregated/anonymized metrics.
- SEC-21: Logs must never include raw audio, SDP bodies with embedded media fingerprints beyond what's operationally necessary for debugging, or JWTs/secrets.

## 7. Infrastructure & Secrets

- SEC-22: All secrets (`JWT_SECRET`, `MONGODB_URI`, `TURN_USERNAME`/`TURN_CREDENTIAL`, `REDIS_URL`) are supplied via environment variables / a secrets manager — never committed to source control (`.env` must be in `.gitignore` from Day 1).
- SEC-23: TURN credentials should be short-lived/time-limited where the TURN provider supports it (e.g., coturn's `turn REST API` credential mechanism) rather than static shared secrets.
- SEC-24: MongoDB connections use least-privilege database users (separate roles for the application vs. any admin/reporting access).
- SEC-25: Redis instance is not exposed publicly; access restricted to the application's VPC/network segment.

## 8. Dependency & Platform Hygiene

- SEC-26: Run `npm audit` (or equivalent) as part of CI for both `client/` and `server/`; high/critical vulnerabilities block merge.
- SEC-27: Pin dependency versions for WebRTC-adjacent and auth-related packages; review changelogs before upgrading signaling or crypto-adjacent libraries.
- SEC-28: Rate-limit the REST API (`/api/auth/login` especially) to mitigate brute-force attempts.

## 9. Security Acceptance Checklist (pre-Final Review)

- [ ] JWT validated on every Socket.io connection, not just REST.
- [ ] `userId` never trusted from client payloads anywhere in the codebase.
- [ ] Office membership verified server-side before room join.
- [ ] Movement bounds and rate enforced server-side.
- [ ] Signaling relay restricted to confirmed in-proximity pairs only.
- [ ] No backend code path touches raw WebRTC media.
- [ ] Mic indicator accurately reflects actual hardware mic state at all times.
- [ ] All traffic runs over TLS/WSS outside local dev.
- [ ] Secrets confirmed absent from git history (`git log -p` spot check + secret scanner).
- [ ] `npm audit` clean of high/critical issues at time of Final Review.

## 10. Explicitly Out of Scope for v1 (document, don't silently skip)
- End-to-end audit logging/compliance recording of conversations (not a goal of this product).
- Enterprise data-loss-prevention (DLP) integration.
- Formal penetration test / third-party security audit (recommended before any production rollout beyond the Infotact pilot team).
