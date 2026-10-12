---
name: ProxiSpeak
description: A shared virtual office where proximity makes conversation feel natural.
colors:
  brand: "#286b5e"
  brand-hover: "#20594e"
  brand-soft: "#e9f2ea"
  signal: "#b7db6d"
  voice: "#c06443"
  danger: "#a4443b"
  page: "#f2f4f0"
  surface: "#ffffff"
  surface-soft: "#f7f8f5"
  ink: "#202923"
  muted: "#738077"
  line: "#e3e8e1"
  map-ground: "#eef1eb"
typography:
  display:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(43px, 5.1vw, 70px)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.055em"
  headline:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(31px, 3vw, 45px)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-1.8px"
  title:
    fontFamily: "Manrope, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.1em"
  button:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1
rounded:
  map: "14px"
  dock: "15px"
  button: "10px"
  input: "9px"
  small: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "#ffffff"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "0 15px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.brand-hover}"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.input}"
    padding: "0 13px"
    height: "47px"
  office-map:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.map}"
    padding: "10px"
  microphone-control:
    backgroundColor: "{colors.brand-soft}"
    textColor: "{colors.brand}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "0 14px"
    height: "43px"
---

# Design System: ProxiSpeak

## Overview

**Creative North Star: "Acoustic Cartography"**

ProxiSpeak makes shared presence legible as a place. The floor plan is the primary work surface; the teammate rail and microphone state support it without competing for attention. Pine-green identity, mineral map tones, fine measured linework, signal-lime range marks, and warm voice accents translate distance into a calm, readable interface.

The workspace favors practical density and direct manipulation: teammates can scan the room, search the roster, move around the floor, and reach the microphone control without leaving the map. Sign-in and registration carry the same identity through a dark, illustrative office panel beside a quiet, high-contrast form. The workspace supports both light and dark themes.

**Key Characteristics:**
- Map-first, spatial, and immediately legible.
- Restrained surfaces with precise green, lime, and warm voice-state signals.
- Functional controls remain discoverable across pointer, keyboard, and touch layouts.

## Colors

The palette pairs softened mineral neutrals with a deep botanical green; brighter accents are reserved for range, voice, and state.

### Primary
- **Pine Green**: The principal action and identity color, used for primary buttons, live indicators, and map presence.
- **Deep Pine**: The primary hover state; use it to reinforce interaction rather than introduce a second accent.
- **Pale Sage**: A quiet green surface for selected, microphone-ready, and supporting status treatments.

### Secondary
- **Signal Lime**: The range and proximity signal. Keep it distinct from voice-state colors.
- **Warm Terracotta**: Nearby and speaking accents; it communicates audio activity without taking over the map.
- **Soft Brick**: Error and danger feedback, not a decorative accent.

### Neutral
- **Mineral Page**: The light workspace background.
- **Clean Surface**: Forms, map cards, and raised controls.
- **Soft Surface**: Secondary containers and quiet controls.
- **Pine Ink**: Primary text on light surfaces.
- **Muted Sage**: Supporting copy, labels, and secondary status.
- **Fine Divider**: Low-contrast borders that separate regions without boxing them in.
- **Map Ground**: The canvas surround and the base tone for the floor plan.

**The Semantic Signal Rule.** Green identifies presence and primary action; lime identifies range; terracotta identifies proximity or voice. Do not interchange these meanings.

## Typography

**Display Font:** Manrope (with sans-serif fallback)  
**Body Font:** DM Sans (with sans-serif fallback)  
**Label/Mono Font:** DM Sans; no separate mono face is used.

**Character:** Manrope gives the room name and auth headline a compact, confident silhouette. DM Sans keeps controls, labels, and supporting copy quiet and easy to scan.

### Hierarchy
- **Display** (700, responsive 43–70px, 1.02 line-height): The sign-in and registration statement.
- **Headline** (700, responsive 31–45px, 1.08 line-height): The live workspace heading.
- **Title** (700, 22px, 1.2 line-height): Sidebar and dialog headings.
- **Body** (400, 13px, 1.55 line-height): Supporting instructions and workspace copy.
- **Label** (700, 10px, 0.1em tracking, uppercase where used): Map metadata, status labels, and compact section markers.

**The Two-Family Rule.** Use Manrope for display and title roles; keep operational copy and controls in DM Sans.

## Layout

The workspace uses a wide, centered container capped at 1660px. On wide screens the floor map occupies the main column while the roster, search, and microphone status sit in a 260–292px utility rail. The map has a 420–590px desktop canvas height; its legend and movement hints stay attached to the surface. A compact microphone dock remains within reach at the bottom of the viewport.

At 1120px the layout tightens; below 820px the rail moves beneath the map; below 560px the top bar, heading, map legend, controls, and dock compress for touch-sized viewports. Authentication uses a split editorial layout on larger screens and stacks the illustrated office above the form on small screens. Preserve vertical scrolling for long forms; do not force mobile content into a fixed-height panel.

Use a measured 4/8/12/16/24/32px spacing rhythm. Keep the map expansive, group related controls tightly, and give the roster enough separation to scan names and presence states.

## Elevation & Depth

Depth is restrained and structural: subtle borders and tonal surfaces establish the workspace hierarchy, while soft shadows lift the map card, microphone dock, and authentication illustration. Avoid shadows as decoration on every list row or small control.

### Shadow Vocabulary
- **Workspace surface** (`0 18px 45px rgba(26, 40, 31, .07), 0 2px 7px rgba(26, 40, 31, .04)`): The office map card.
- **Voice dock** (`0 18px 46px rgba(25, 37, 29, .14), 0 2px 7px rgba(25, 37, 29, .06)`): The fixed microphone control.
- **Auth illustration** (`0 12px 30px rgba(7, 24, 16, .18)`): The inset floor-plan preview.

**The Few-Lifted-Surfaces Rule.** Keep the roster and map interior quiet; reserve the clearest elevation for the main map, the active voice dock, and the auth illustration.

## Shapes

Use gently rounded, functional geometry: 14px map cards, 10px primary controls, 9px fields, and compact 8px map surfaces. Circular geometry is meaningful for avatars, live indicators, and proximity range; it is not a substitute for status labels. Borders are fine and low contrast, with stronger dividers reserved for separating major workspace regions.

## Components

### Buttons
- **Character:** Confident, compact, and action-labeled.
- **Primary:** Deep green fill with white text in the light workspace; use the theme-aware primary treatment in dark mode. Standard buttons are at least 40px high, with 10px corners and 15px horizontal padding.
- **Hover / Focus:** Deepen the green on hover; preserve the visible 2px keyboard outline with a 3px offset. Pressed buttons shift subtly; disabled or busy buttons remain visibly unavailable.
- **Quiet controls:** Icon and text buttons use transparent or soft-surface treatments until hover; retain a clear label or accessible name.

### Cards / Containers
- **Corner Style:** The map card uses 14px corners; smaller supporting panels use 9–10px.
- **Background:** White or soft neutral in light theme; dark forest surfaces in workspace dark theme.
- **Shadow Strategy:** Follow Elevation & Depth; do not add a separate shadow to each roster row.
- **Border:** One quiet divider around the map and subtle section rules in the rail.
- **Internal Padding:** Keep the map canvas inset by 10px; use compact 10–16px padding for supporting surfaces.

### Inputs / Fields
- **Style:** Clear labels above white fields, a quiet neutral border, and 9px corners. Auth fields are 47px high with 13px horizontal padding.
- **Focus:** Shift the border toward green and show a soft green focus halo; keyboard focus remains clearly outlined.
- **Error / Disabled:** Keep errors adjacent to the relevant form with corrective language; busy submit actions communicate that they are waiting.

### Navigation
- **Style:** A 72px white workspace bar separates product identity, office context, connection state, theme, invitation, and profile actions with fine dividers and deliberate spacing.
- **Mobile:** Retain the brand, theme, invitation, and avatar actions; hide secondary labels rather than allowing the bar to overflow.

### Office Map
The signature surface combines a subdued survey grid, softly tinted work zones, legible furniture, and avatars positioned in a shared plan. The proximity radius and nearby/speaking colors express audio distance; movement remains available through keyboard and pointer. Keep the map itself visually quieter than the people and their current states.

### Presence Row
Pair a compact avatar with a readable name and a text status. Use the small overlaid dot to reinforce ready, nearby, speaking, muted, or muffled states—not as the only way to communicate them.

### Microphone Control
Keep permission and mute state explicit in the bottom dock or adjacent status panel. The permission prompt names the browser action and offers an enable control; speaking activity uses a restrained warm signal.

## Do's and Don'ts

### Do:
- **Do** make the floor map the dominant workspace surface and keep the roster as its supporting rail.
- **Do** use semantic colors consistently: green for identity/presence, lime for range, and terracotta for nearby voice.
- **Do** provide text alongside microphone, connection, and presence indicators.
- **Do** keep forms scrollable and map interactions usable on touch screens.
- **Do** preserve a visible keyboard focus indicator and the reduced-motion treatment.

### Don't:
- **Don't** replace the spatial office with a generic stack of dashboard cards.
- **Don't** suggest the sign-in illustration is live team data; it is labeled as an illustration.
- **Don't** use color alone to describe microphone permission, voice, connection, or account state.
- **Don't** let fixed controls cover the map, roster, or a form action on small screens.
