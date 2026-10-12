# ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem
ProxiSpeak is a real-time virtual office collaboration platform that leverages React, Node.js, Socket.io, MongoDB geospatial queries, WebRTC, and the Web Audio API to deliver proximity-based voice communication, spatial audio, and seamless interactions among users in a shared virtual workspace.

The server uses MongoDB's office-scoped 2D geospatial index with `$geoWithin` to hydrate office occupants and `$near` to locate nearby persisted positions on join. The live 10 Hz proximity loop uses an in-memory spatial grid to avoid issuing a database query for every peer on every tick. `/api/telemetry/mesh` reports rolling proximity recompute p95/max timings against the 20 ms target, and the office footer reports measured canvas FPS.

The automated spatial benchmark checks 50 simulated users and verifies spatial results against exact distance calculations. This is not a 50-browser end-to-end load test. Voice still uses a peer-to-peer mesh; dense groups can exceed practical browser connection limits, so production rooms intended for 50 concurrent talkers need an SFU (for example LiveKit, mediasoup, or a managed equivalent) and a real network load test.

## Local development

1. Copy `server/.env.example` to `server/.env`, set a strong `JWT_SECRET`, and provide a reachable `MONGODB_URI`. MongoDB is required for account registration, password login, and authenticated sessions; office movement can still use its in-memory fallback if MongoDB disconnects.
2. Install dependencies in `server` and `client` with `npm install`.
3. Start the backend with `npm run dev` from `server`, then start the frontend with `npm run dev` from `client`.
4. The office footer reports the canvas frame rate after its first sample. Check `/api/telemetry/mesh` while multiple test users are connected for server-side proximity timings.

## Deploy a public API and web app on Render

1. Push this repository to GitHub and create a MongoDB Atlas database. In Atlas, create a dedicated database user and allow Render's outbound connections in Network Access (for a first deployment, Atlas documents the `0.0.0.0/0` option; use a strong database password and restrict it where your plan supports stable outbound IPs).
2. In Render, choose **New → Blueprint**, connect the GitHub repository, and let Render read the root `render.yaml`. It builds the React client and Node.js server into one service, so the site, REST API, and Socket.IO use one HTTPS origin.
3. When prompted for `MONGODB_URI`, enter the Atlas connection string for the app database. Render generates `JWT_SECRET` for the service. Do not add secrets to Git or Vite client variables.
4. Wait for the Render health check at `/api/health` to pass. The public app is at `https://<your-render-service>.onrender.com`; the API base is `https://<your-render-service>.onrender.com/api`.
5. Use those public API URLs in Postman:
   - `POST https://<your-render-service>.onrender.com/api/auth/register` with JSON `{"name":"Alex Morgan","email":"alex@example.com","password":"YourPassword123"}`.
   - `POST https://<your-render-service>.onrender.com/api/auth/login` with JSON `{"email":"alex@example.com","password":"YourPassword123"}`.
   - `GET https://<your-render-service>.onrender.com/api/auth/me` with `Authorization: Bearer <token>`.

The blueprint starts with Render's free web-service plan; free services may sleep while idle and can take time to wake. Upgrade the service plan for an always-on production deployment. MongoDB Atlas billing and network access are managed separately from Render.

## Accounts and authentication

Create an account in the registration form with a name, email, and password of at least 8 characters. Passwords are salted and hashed with bcrypt before they are stored in MongoDB; the plaintext password is never stored. Sign-in checks the password against that hash and issues an 8-hour JWT. The browser keeps the token in `sessionStorage` only, verifies the session against MongoDB on startup, and sends it on authenticated API and Socket.IO connections. Protected API requests and new socket connections reject expired tokens, unavailable/deleted accounts, and MongoDB outages; the live socket disconnects when its token expires. Users sign in again in a new browser session.

Former name-and-email-only records can be upgraded to password accounts when someone registers with the same email. Email ownership is not independently verified; add an email verification provider before using registration for sensitive or public deployments. Set `JWT_SECRET` to a random value at least 32 characters long in production.

## Reliable WebRTC connectivity

The app uses peer-to-peer audio by default. TURN can help peers connect across restrictive networks. For groups with many concurrent talkers, configure LiveKit to route audio through an SFU instead of creating a direct mesh:

- `LIVEKIT_URL`: your LiveKit Cloud or self-hosted WebSocket URL.
- `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`: server-side credentials used only to mint short-lived tokens.
- `LIVEKIT_TOKEN_TTL_SECONDS`: participant token lifetime (60–3600 seconds; defaults to 600).

Set all three values to enable the SFU path. The server issues room-scoped participant tokens at authenticated `GET /api/rtc/livekit-token?officeId=...`. The client joins one room per office, publishes its microphone, and subscribes only to nearby participants, retaining spatial audio. LiveKit must be publicly reachable over secure WebSocket for deployment. Without these settings, the existing peer-to-peer flow remains active.

For TURN in peer-to-peer mode, configure a coturn-compatible TURN REST service in `server/.env`:

- `TURN_URLS`: comma-separated `turn:`/`turns:` endpoints supplied by your TURN service.
- `TURN_SHARED_SECRET`: the server-side shared secret configured for TURN REST authentication (for coturn, `use-auth-secret` and `static-auth-secret`).
- `TURN_CREDENTIAL_TTL_SECONDS`: lifetime of generated credentials (60–86400 seconds; defaults to 3600).

The backend returns short-lived HMAC-SHA1 TURN credentials from authenticated `GET /api/rtc/config` requests. The shared secret must remain server-side; never use `VITE_` variables for it. Leave both TURN settings unset to use STUN-only mode. Microphone access on non-local devices also requires HTTPS.
