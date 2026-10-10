# ProxiSpeak — Design System & Experience Guidelines

**Status:** Draft v1.0 · **Companion to:** `prd.md`, `trd.md`, `architecture.md`, `security.md`, `rules.md`, `phases.md`

---

## 1. Design Philosophy

ProxiSpeak should feel like a **calm, premium, physical space** — not a dashboard and not a video-game lobby. The product's entire value proposition is spatial and ambient, so the interface must stay quiet and get out of the way, letting the office map and the sense of presence carry the experience.

Three guiding principles:

1. **Spatial-first.** The canvas is the product. Chrome (panels, buttons, text) is minimal, translucent, and always secondary to the map.
2. **Calm realtime.** Motion, audio-state indicators, and presence changes should feel smooth and organic — never jittery, never alarming. No hard pops, no sudden snaps.
3. **Quiet premium.** Restrained color, soft elevation, generous whitespace, and a refined type system — closer to a well-designed productivity tool (Linear, Notion, Arc) than a generic chat app.

## 2. Design Tokens

### 2.1 Color System

A deliberately desaturated, low-contrast palette so avatars and audio-state colors (the only saturated elements) pop without competing with UI chrome.

```css
:root {
  /* Neutrals — the office "floor" */
  --ps-bg-canvas: #F4F3F1;       /* warm off-white office floor */
  --ps-bg-canvas-dark: #15161A;  /* dark-mode floor */
  --ps-surface: #FFFFFF;
  --ps-surface-dark: #1E2024;
  --ps-surface-translucent: rgba(255, 255, 255, 0.72);
  --ps-surface-translucent-dark: rgba(30, 32, 36, 0.72);
  --ps-border: #E3E1DC;
  --ps-border-dark: #2C2E33;

  /* Text */
  --ps-ink-900: #1B1C1E;
  --ps-ink-600: #55585E;
  --ps-ink-400: #8B8F96;
  --ps-ink-inverse: #F5F5F4;

  /* Brand accent — "Proximity Teal" */
  --ps-accent-500: #1FA896;
  --ps-accent-600: #16806F;
  --ps-accent-100: #E3F6F2;

  /* Presence / audio states */
  --ps-speaking: #2FD38B;    /* actively transmitting voice */
  --ps-nearby: #1FA896;      /* in hearing range, idle */
  --ps-muted: #B9BCC2;       /* muted */
  --ps-offline: #DADCE0;     /* offline avatar */
  --ps-alert: #E2574C;       /* connection issue */

  /* Obstacles / zones */
  --ps-wall: #3A3D42;
  --ps-zone-fill: rgba(31, 168, 150, 0.08);
  --ps-zone-border: rgba(31, 168, 150, 0.35);

  /* Elevation (soft, never harsh) */
  --ps-shadow-sm: 0 1px 2px rgba(20, 20, 22, 0.06);
  --ps-shadow-md: 0 4px 16px rgba(20, 20, 22, 0.08);
  --ps-shadow-lg: 0 12px 32px rgba(20, 20, 22, 0.12);
}
```

### 2.2 Typography

```css
:root {
  --ps-font-ui: "Inter", -apple-system, "Segoe UI", sans-serif;
  --ps-font-display: "Inter", -apple-system, sans-serif; /* weight 600+ for headers */

  --ps-text-xs: 12px;   /* avatar name labels */
  --ps-text-sm: 13px;   /* secondary UI text */
  --ps-text-base: 14px; /* default UI text */
  --ps-text-md: 16px;   /* panel headings */
  --ps-text-lg: 20px;   /* modals / onboarding */
  --ps-text-xl: 28px;   /* empty states, marketing moments */

  --ps-weight-regular: 400;
  --ps-weight-medium: 500;
  --ps-weight-semibold: 600;
}
```

- Avatar name labels: `--ps-text-xs`, medium weight, rendered with a subtle translucent pill background for legibility over any floor color.
- No more than two font weights visible on screen at once (regular + semibold) — avoids visual noise against the busy canvas.

### 2.3 Spacing & Radius

```css
:root {
  --ps-space-1: 4px;
  --ps-space-2: 8px;
  --ps-space-3: 12px;
  --ps-space-4: 16px;
  --ps-space-6: 24px;
  --ps-space-8: 32px;

  --ps-radius-sm: 6px;
  --ps-radius-md: 10px;
  --ps-radius-lg: 16px;
  --ps-radius-pill: 999px;
}
```

### 2.4 Motion

Motion is the single most important design element in ProxiSpeak after the canvas itself, because it is what makes proximity *feel* organic rather than mechanical.

| Token | Value | Use |
|---|---|---|
| `--ps-ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | Panel open/close, hover states |
| `--ps-ease-organic` | `cubic-bezier(0.22, 1, 0.36, 1)` | Avatar interpolation, proximity ring pulsing |
| `--ps-duration-fast` | `120ms` | Button/hover feedback |
| `--ps-duration-base` | `220ms` | Panel transitions |
| `--ps-duration-audio` | `180ms` (Web Audio `setTargetAtTime` time-constant ≈ 0.05s) | Gain/pan ramps — never instant |

**Rule:** No UI state (mute icon, connection ring, panel) may change in a single frame. Every state transition gets at least a 120ms eased transition. This is what separates "premium" from "functional."

## 3. The Canvas — Visual Language

### 3.1 Office Floor
- Rendered as a soft, warm neutral (`--ps-bg-canvas`) with a very subtle grid or floor-texture at low opacity (≤4%) to give depth without looking like graph paper.
- Furniture/desks rendered as soft rounded rectangles with a 1px border and a faint drop shadow — never harsh black outlines.

### 3.2 Avatars
- Circular avatar (36px diameter at 100% zoom), initials or a user photo, with a **2px presence ring** whose color maps to audio state:
  - `--ps-speaking` (animated, gentle pulse, 1.5s loop) when actively transmitting above a volume threshold.
  - `--ps-nearby` (static) when connected but silent.
  - `--ps-muted` (static, slightly desaturated) when the user has muted themselves.
  - `--ps-offline` for avatars that have disconnected but not yet been removed (fades out over 2s).
- **Hearing radius visualization:** when the local user is selected/focused, render a very faint (`--ps-zone-fill`-style, ≤10% opacity) circle at the hearing radius around their own avatar only — never around other users' avatars, to avoid clutter. This radius ring should pulse subtly outward (not inward) to reinforce the "your voice reaches this far" mental model.
- Name label: small translucent pill directly beneath the avatar, auto-hides when zoomed out below a density threshold to reduce clutter in crowded zones.

### 3.3 Obstacles & Zones
- Walls: solid `--ps-wall` colored segments with slightly rounded caps, 4px thick.
- Meeting zones: dashed border (`--ps-zone-border`) with a translucent fill (`--ps-zone-fill`) and a small label chip in the top-left corner of the zone.

### 3.4 Movement Feel
- Client-side prediction renders the local avatar instantly on keypress; remote avatars interpolate smoothly between the last two known positions (never snap) using `--ps-ease-organic`.
- Subtle motion trail (3–4 fading dots) only on the local avatar while moving, to reinforce direction — disabled automatically above 20 on-screen avatars to protect frame rate.

## 4. UI Chrome (Panels & Controls)

Chrome sits in translucent, frosted panels that float above the canvas — never a hard-edged sidebar that competes with the map for attention.

```css
.ps-panel {
  background: var(--ps-surface-translucent);
  backdrop-filter: blur(16px);
  border: 1px solid var(--ps-border);
  border-radius: var(--ps-radius-lg);
  box-shadow: var(--ps-shadow-md);
}
```

### 4.1 Layout
- **Top-left:** office name + current zone indicator, minimal, no border.
- **Bottom-center:** primary mic control — a single large circular button, the only high-emphasis control on screen. States: active (teal), muted (grey with slash icon), requesting-permission (pulsing).
- **Right edge, collapsible:** "Nearby" panel — avatars currently in earshot, with live speaking indicators. Collapses to a small pill showing just a count when not in use.
- **Top-right:** connection health indicator (small dot: green/amber/red) — only becomes visually prominent when degraded, otherwise nearly invisible. This follows a "quiet by default, loud only when something needs attention" rule.

### 4.2 Microphone Button (primary control)
- 56px circular button, centered at the bottom of the viewport, always reachable.
- Default state: soft `--ps-accent-500` fill with a mic icon.
- Pressed/held states use `--ps-duration-fast` scale (0.96) for tactile feedback.
- A thin animated ring around the button reflects the user's own live input level (their own voice), giving instant confidence that their mic is working — this is the single most important trust-building element in the whole UI.

## 5. States & Empty States

- **Mic permission not yet granted:** full-canvas remains visible (not blocked by a modal) with a single translucent panel bottom-center explaining why the permission is needed, phrased plainly ("ProxiSpeak needs your microphone to let nearby colleagues hear you — nothing is recorded").
- **No one nearby:** Nearby panel shows a quiet, friendly empty state ("No one's close enough to hear yet — walk toward a colleague") rather than a blank list.
- **Connection degraded:** a single, calm inline banner — never a modal, never a red full-screen takeover — with a one-line explanation and a retry action.
- **Office empty (first user):** map renders normally; no "waiting for others" spinner, since the environment itself is the whole experience.

## 6. Dark Mode

Dark mode is a first-class target, not an inverted afterthought, because many engineers will keep ProxiSpeak open all day alongside dark-themed editors.

- Floor: `--ps-bg-canvas-dark`, panels: `--ps-surface-translucent-dark`.
- Avatar presence ring colors stay identical across themes (state colors must remain consistent and accessible in both modes).
- Obstacle/wall color shifts to a lighter neutral (`#C8CBD1` at reduced opacity) to remain visible against the dark floor.

## 7. Accessibility

- All state communicated by color (speaking/muted/offline) is paired with an icon or shape difference — never color alone.
- Keyboard movement (WASD/arrows) is the primary interaction model and must always remain fully functional without a mouse.
- Focus states on all interactive chrome elements use a visible 2px `--ps-accent-500` outline.
- Minimum contrast ratio of 4.5:1 for all text against its panel background in both light and dark themes.
- Mic button, connection indicator, and nearby panel are all reachable and operable via keyboard tab order, independent of canvas focus.

## 8. Audio-to-Visual Consistency Principle

Every parameter that drives the Web Audio graph (gain, pan) has a **visually consistent counterpart** on screen, so the audio behavior never feels arbitrary:

| Audio parameter | Visual counterpart |
|---|---|
| Gain (volume) rising as distance shrinks | Presence ring brightens / speaking pulse becomes more pronounced |
| Stereo pan left/right | Avatar's on-screen position relative to the local user's avatar (inherently left/right already) |
| Full attenuation at radius edge | Presence ring fades to `--ps-offline` style and the peer visually "fades" at the edge of the hearing-radius ring |
| Obstacle attenuation | A subtle muffled/desaturated tint applied to a peer's presence ring when a wall sits between avatars |

This mapping is what makes the spatial audio *legible* — users should always be able to look at the screen and predict what they're about to hear, before they hear it.

## 9. Component Inventory (for implementation)

- `OfficeCanvas` — the render surface.
- `AvatarSprite` — individual avatar draw + interpolation logic.
- `PresenceRing` — animated ring overlay tied to audio state.
- `HearingRadiusRing` — local-user-only radius visualization.
- `MicButton` — primary control with live input-level ring.
- `NearbyPanel` — collapsible list of in-range peers.
- `ConnectionHealthDot` — top-right status indicator.
- `ZoneLabel` — floating label chip for meeting zones.
- `PermissionPanel` — bottom-center translucent explainer for mic permission.
- `ToastBanner` — calm, non-blocking inline notifications (reconnect, degraded connection).

## 10. Non-Negotiables (Design QA Checklist)

- [ ] No instant (non-eased) state transitions anywhere in the chrome.
- [ ] No audio gain/pan change is applied without ramping (`setTargetAtTime`).
- [ ] Canvas remains visually dominant — chrome never exceeds ~20% of viewport at rest.
- [ ] Every color-coded state has a non-color differentiator.
- [ ] Dark mode tested with the exact same component set as light mode (no dark-mode-only shortcuts).
- [ ] 60 FPS maintained with 50 avatars before any new visual effect (trails, pulses) ships.
