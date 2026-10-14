---
version: 1
slug: "client-src-app-jsx"
primary_target: "client/src/App.jsx"
related_targets: ["client/src/App.css","client/index.html"]
---

# ProxiSpeak public entry

## Surface and visitor mode
The public `/` route is a Persuade surface: visitors should understand proximity-based office voice and choose to register or sign in. `/login` and `/register` are adjacent account-entry surfaces and keep the same identity.

## Audience and outcome
Remote and hybrid teams who want lightweight, spontaneous conversation without creating a meeting for every exchange. The page makes the shared virtual office and distance-based voice legible, then gives visitors a direct path into the existing account flow.

## Visual direction
Extend ProxiSpeak's Acoustic Cartography system rather than introducing a new brand: pine-green identity, mineral map surfaces, fine office-plan linework, restrained signal-lime range marks, and warm voice accents. A deep botanical backdrop and restrained, translucent glass layers carry across the landing and account routes; the auth form sits in a readable frosted panel beside the illustrative office. The landing hero pairs a clear product promise with an interactive illustrative floor map; later sections explain the three-step interaction and repeat the account action without generic feature-card scaffolding. Keep map geometry and text opaque enough to scan through glass effects.

## Product truth and behavior
The map and teammate are sample data, never represented as an active team. The range slider moves the illustrative teammate and changes the voice-range state. State explicitly that the microphone stays off until the user chooses to turn it on. Keep MongoDB-backed authentication and existing validation behavior unchanged. Preserve office invitation query parameters between landing, registration, and sign-in routes.

## Motion and responsive behavior
The authored moment is the promise resolving into the spatial voice demo: reveal the headline's proximity phrase, breathe the range boundary, and move sound bars along the voice path. The illustrated auth office carries that language into a compact moving voice signal; the real login/register controls enter in a brief stagger to make the form transition feel intentional, not delayed. No autoplay audio. Honor reduced-motion preferences and reduced-transparency preferences where supported. Keep the landing map, navigation, calls to action, and authentication forms usable on touch and keyboard layouts from narrow mobile widths through desktop.
