# ProxiSpeak

A single shared virtual office for the Infotact team. The React app draws an overhead office on an HTML Canvas, and Socket.io shares avatar movement in real time. Signed-in users within **70 pixels** negotiate WebRTC audio; the Web Audio API attenuates and pans the received audio according to avatar position.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`. MongoDB is optional for a local demo; without it, accounts and profiles are stored in the private `.data/accounts.json` file, while sessions and presence remain in memory. Passwords are stored as salted scrypt hashes, never as plaintext. Profile photos are resized before storage; phone numbers and dates of birth are returned only to the signed-in account, not shared with office peers.
3. Run `npm install`, then `npm run dev`.
4. Open `http://localhost:5173` in two browser profiles or windows, create/sign in to a different account in each, and allow microphone access.
5. Click **Enable sound** in both browsers, click **Say hello** to enable a microphone, and move the avatars within 70 pixels of each other.

Microphone access requires `localhost` or HTTPS. The sample map occupants are illustrative only and are not connected audio peers. The default STUN server is suitable for development, but restrictive networks may require TURN; set `VITE_ICE_SERVERS` in `.env` to a JSON array supplied by your ICE/TURN provider. Production TURN credentials should be short-lived. For a remotely hosted app, use HTTPS/WSS and restrict the allowed client origin.

## Security

Passwords are stored as salted scrypt hashes. Session cookies are HttpOnly and SameSite, sessions expire after 12 hours (7 days with **Remember me**), and login/registration attempts are rate limited per IP. Auth mutations and Socket.io handshakes reject foreign origins; responses include basic browser security headers; request body and Socket.io payload sizes are capped. Profile and office APIs require a valid session. In production, the server requires an HTTPS client origin and MongoDB, which avoids using the development JSON account store. Keep `.env` private and use HTTPS end to end. The current rate limiter and sessions are in-memory and per server process; a multi-instance deployment needs shared session storage and a distributed rate limiter.

## MongoDB

When configured, the server stores accounts and people in MongoDB and creates a GeoJSON `2dsphere` index. Live movement and earshot presence are coalesced and calculated from the connected-user map for responsive updates; positions are persisted at a lower rate. The authenticated `/api/office/nearby` diagnostic uses MongoDB `$near`, and `/api/office/cluster` uses `$geoWithin`/`$centerSphere`. Existing local-file accounts are copied into MongoDB when it connects. Office pixel coordinates are projected into a small GeoJSON range at approximately one meter per pixel. All participants share the `OFFICE_ID` configured in `.env`.

## Project layout

- `src/main.jsx` — Canvas office, movement, Socket.io client, WebRTC negotiation, and spatial audio.
- `src/styles.css` — office interface styling.
- `server/index.js` — Express auth and cluster endpoints, Socket.io signaling, and MongoDB proximity filtering.

The current audio topology is a peer-to-peer mesh intended for a small prototype. For 50+ concurrent users, move audio to an SFU such as LiveKit or mediasoup and use a Redis-backed Socket.io adapter across server instances.
