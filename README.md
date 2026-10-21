# ProxiSpeak

A single shared virtual office for the Infotact team. The React app draws an overhead office on an HTML Canvas, and Socket.io shares avatar movement in real time. Signed-in users within **70 pixels** negotiate WebRTC audio; the Web Audio API attenuates and pans the received audio according to avatar position.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`. MongoDB is optional for a local demo; without it, accounts, profiles, sessions, and presence are held in memory and are lost when the server restarts. Profile photos are resized before storage; phone numbers and dates of birth are returned only to the signed-in account, not shared with office peers.
3. Run `npm install`, then `npm run dev`.
4. Open `http://localhost:5173` in two browser profiles or windows, create/sign in to a different account in each, and allow microphone access.
5. Click **Enable sound** in both browsers, click **Say hello** to enable a microphone, and move the avatars within 70 pixels of each other.

Microphone access requires `localhost` or HTTPS. The sample map occupants are illustrative only and are not connected audio peers. The default STUN server is suitable for development, but restrictive networks may require TURN; set `VITE_ICE_SERVERS` in `.env` to a JSON array supplied by your ICE/TURN provider. Production TURN credentials should be short-lived. For a remotely hosted app, use HTTPS/WSS and restrict the allowed client origin.

## MongoDB

When configured, the server stores accounts and people, creates a GeoJSON `2dsphere` index, uses `$near` to filter earshot membership, and uses `$geoWithin`/`$centerSphere` for the cluster endpoint. Office pixel coordinates are projected into a small GeoJSON range at approximately one meter per pixel. All participants share the `OFFICE_ID` configured in `.env`.

## Project layout

- `src/main.jsx` — Canvas office, movement, Socket.io client, WebRTC negotiation, and spatial audio.
- `src/styles.css` — office interface styling.
- `server/index.js` — Express auth and cluster endpoints, Socket.io signaling, and MongoDB proximity filtering.

The current audio topology is a peer-to-peer mesh intended for a small prototype. For 50+ concurrent users, move audio to an SFU such as LiveKit or mediasoup and use a Redis-backed Socket.io adapter across server instances.
