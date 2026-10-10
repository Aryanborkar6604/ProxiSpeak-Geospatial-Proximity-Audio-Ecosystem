# ProxiSpeak — Engineering Rules & Conventions

**Status:** Draft v1.0 · **Companion to:** `prd.md`, `trd.md`, `architecture.md`, `design.md`, `security.md`, `phases.md`

These are binding working rules for the ProxiSpeak internship build, not suggestions. They exist to keep a solo/small-team internship project shippable in four weeks without accumulating debt that blocks the Mid-Project or Final Review.

---

## 1. Project Structure Rules

- R-1: Keep the repository split exactly as defined in `architecture.md` — `client/` and `server/` as top-level siblings, never nested inside one another.
- R-2: No business logic in route handlers or socket event handlers beyond request parsing/validation — delegate to a `services/` module (`proximityService.js`, `signalingService.js`, etc.). Handlers stay thin.
- R-3: Shared constants (hearing radius, movement bounds, throttle intervals) live in one config module on each side (`server/src/config/constants.js`, `client/src/config/constants.js`) — never hardcoded inline in multiple places.
- R-4: Every new backend service file gets a corresponding unit test file before it is considered "done" for a weekly milestone — not after.

## 2. Backend (Node.js / Express / Socket.io) Rules

- R-5: All Socket.io event handlers must validate payload shape and ranges before acting — never trust `data.x`, `data.y`, or `data.userId` blindly (see `security.md` SEC-15/16).
- R-6: Never `await` inside a tight per-frame or per-socket loop without batching — proximity recomputation must run on a controlled interval (see `trd.md` §4), not be re-triggered synchronously on every single `player:move` event.
- R-7: MongoDB indexes (`2d` on `positions.location`) are created at application startup/deploy time, never implicitly relied upon via ad-hoc query-time index creation.
- R-8: All Socket.io emits that broadcast to "nearby users only" must use the diffed in-range set — a full-office broadcast of movement or proximity data is treated as a bug once Week 2 proximity logic lands, since it defeats the scaling model in `architecture.md` §4.
- R-9: Signaling relay handlers (`webrtc:offer/answer/ice-candidate`) must verify the sender/recipient pair is currently an authorized in-range pair before relaying (SEC-17) — this check is not optional "polish," it ships with Week 2.
- R-10: Environment-specific values (Mongo URI, Redis URL, TURN credentials) are read only from `process.env`, validated at startup (fail fast with a clear error if a required variable is missing) — never silently defaulted to a hardcoded production-like value.

## 3. Frontend (React / Canvas / WebRTC / Web Audio) Rules

- R-11: Canvas rendering logic stays outside React's render cycle — use a single `requestAnimationFrame` loop driven from a ref, not `setState` per frame. React manages UI chrome state; the canvas loop manages the simulation/draw state.
- R-12: Movement input is throttled before emission (`trd.md` §4) — raw per-keystroke or per-animation-frame socket emits are not acceptable past Week 1's prototype stage.
- R-13: Every `RTCPeerConnection` created must have a matching, explicit teardown path (`close()`, track `stop()`, listener removal) — no peer connection is allowed to be "forgotten" when a user exits range or leaves. Audit this specifically before the Mid-Project Review.
- R-14: Every Web Audio parameter change (`gain.value`, `pan.value`) must go through `setTargetAtTime` ramping — direct assignment (`gainNode.gain.value = x`) is disallowed outside of initial node creation, per `design.md` §2.4 and `trd.md` §6.
- R-15: One `AudioContext` per client session, created lazily on first qualifying user gesture (never at module load) to respect browser autoplay policy. Never instantiate a new `AudioContext` per peer.
- R-16: Audio graph nodes (`GainNode`, `StereoPannerNode`) are created once per peer connection and reused for the lifetime of that connection — never recreated on every position update.
- R-17: All Socket.io listeners registered inside a React component (`useEffect`) must be removed in the corresponding cleanup function — no leaked listeners across remounts (particularly relevant given hot-reloading during development).

## 4. Data & Query Rules

- R-18: Every MongoDB query against `positions` must include `officeId` in its filter — a query using only `$near`/`$geoWithin` without office scoping is treated as a bug (cross-office data leakage risk, see `security.md`).
- R-19: Do not run a MongoDB query per animation frame or per keystroke under any circumstance — proximity queries run on the server's controlled recompute interval only (`trd.md` §4).
- R-20: Office layout/obstacle writes always go through the validated admin REST endpoint — never a direct unvalidated Mongo write path from a client-facing socket event.
- R-21: If the Week 3 load test shows MongoDB latency exceeding the 20ms proximity target under 50 concurrent users, the team documents the finding and evaluates the in-memory/Redis-geo fallback noted in `trd.md` §2.3 — this is a planned decision point, not an emergency rewrite.

## 5. Git & Workflow Rules

- R-22: Branch per weekly milestone or feature (`week1-world-rendering`, `week2-webrtc-signaling`, etc.); no direct commits to `main` once Week 1 is merged.
- R-23: `.env`, `node_modules/`, and any credential files are in `.gitignore` from the very first commit — verified before the first push, not retrofitted later.
- R-24: Every PR/merge into `main` includes a one-line note in the commit message referencing which `phases.md` milestone or acceptance item it satisfies.
- R-25: No merge into `main` happens with a known regression against a previously-passed Mid-Project Review acceptance item, without an explicit note and plan to fix.

## 6. Performance Discipline

- R-26: Before adding any new Canvas visual effect (trails, glow, animated rings), profile frame rate with the current avatar count target (50) — if it drops below ~55 FPS, the effect is simplified or gated behind a density threshold (per `design.md` §3.4).
- R-27: Network payloads (movement events, proximity diffs) stay minimal — send deltas/IDs, not full user objects, on high-frequency events.
- R-28: Any new dependency added to `client/` is checked against bundle-size impact before merging — this is a Canvas/real-time app; bundle bloat directly hurts load-time-to-first-interaction.

## 7. Documentation Discipline

- R-29: Any deviation from `trd.md` or `architecture.md` discovered during implementation (e.g., switching positions storage from MongoDB to Redis) must be reflected back into those documents in the same week it's decided — docs describe the actual system, not the originally planned one.
- R-30: Each weekly milestone closes with the relevant checklist item in `phases.md` marked complete, with a one-line note on what was actually delivered vs. planned.

## 8. Definition of "Done" (applies to every feature, every week)

A feature is **not done** until:
1. It matches its corresponding requirement in `prd.md`/`trd.md`.
2. It respects the relevant rule(s) above (especially R-5/R-9/R-14/R-18 — the most commonly-violated ones in similar projects).
3. It has at least minimal test coverage per `trd.md` §10.
4. It doesn't regress the current frame-rate or proximity-latency targets.
5. Any related security requirement in `security.md` is satisfied, not deferred silently.
