# ProxiSpeak

A single shared virtual office for the Infotact team. The React app draws one overhead office on an HTML Canvas; users move continuously with held WASD/arrow keys or walk smoothly toward a clicked destination. Socket.io broadcasts rounded coordinates at up to 20 updates per second while moving, plus the final position when movement stops. The server sends peer presence only within a 170-pixel earshot radius. When users enable their microphones, the browser negotiates WebRTC audio with nearby users and uses the Web Audio API for distance attenuation and left/right stereo panning.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`. MongoDB is optional for a local demo; leave `MONGODB_URI` unset to use in-memory presence, or set it to a MongoDB connection string.
3. Run `npm install`, then `npm run dev`.
4. Open `http://localhost:5173` in two browser windows to try live movement and peer audio. Allow microphone access in both windows and move within earshot.

Microphone access requires `localhost` or HTTPS. The first five colored colleagues are illustrative map occupants so the office does not look empty in a single-user demo; they are not connected audio peers. Only connected browsers establish WebRTC sessions. For a remotely hosted app, configure HTTPS/WSS, TURN servers, and restrict the allowed client origin before inviting a team.

## MongoDB

The server creates `people.location` as a GeoJSON `Point` and creates a `2dsphere` index. Office pixel coordinates are projected into a small valid GeoJSON range at approximately one meter per pixel. Earshot membership uses `$near`; the cluster endpoint (`/api/office/cluster?userId=...`) uses `$geoWithin`/`$centerSphere`. All participants share the `OFFICE_ID` configured in `.env`.

## Project layout

- `src/main.jsx` — Canvas office, movement controls, Socket.io client, WebRTC setup, spatial gain and pan.
- `src/styles.css` — office interface styling.
- `server/index.js` — Express health/cluster endpoints, Socket.io signaling, MongoDB geospatial persistence and proximity filtering.

The current signaling topology is a peer-to-peer mesh, suited to a small team prototype. A 50+ person production office should move audio to an SFU (such as LiveKit/mediasoup) and use Redis-backed Socket.io adapters across server instances; a full mesh is not efficient at that scale.
