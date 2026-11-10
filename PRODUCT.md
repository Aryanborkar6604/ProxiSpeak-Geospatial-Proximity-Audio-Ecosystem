# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Company teammates who want to work alongside one another in a shared virtual office. This audience is inferred from the user's description of ProxiSpeak as a company project and the app's existing team-workspace flows.

## Product Purpose

ProxiSpeak provides a real-time virtual office where teammates can see one another's positions and talk when nearby. Success means joining the shared office quickly and understanding who is around.

## Positioning

ProxiSpeak makes proximity the interaction model: teammates move around a shared floor and voice connections respond to distance and sound-blocking walls.

## Operating Context

Users access the office in a web browser, sign in to a workspace, view a live map, find teammates, move with keyboard or pointer, invite coworkers, and enable their microphone for nearby voice.

## Capabilities and Constraints

- The client is a React web application and the server uses Node.js, Socket.IO, MongoDB, and WebRTC, with optional LiveKit SFU support.
- The office map reports positions and spatial audio state; browser microphone access requires a secure context outside localhost.
- Registration and login use MongoDB accounts and bcrypt-hashed passwords. Email ownership verification is not currently implemented.
- The current office selection is URL-based. Company identity provider/SSO, workspace administration, and company-specific branding are not confirmed.

## Brand Commitments

The product name is ProxiSpeak. The product is a company project; the company name and any additional brand assets or visual requirements have not been supplied.

## Evidence on Hand

The repository contains a working office canvas, presence list, account screens, invite flow, and proximity voice implementation. No company logo, customer testimonials, or externally verified capacity evidence was provided.

## Product Principles

- Make joining teammates and their presence immediately understandable.
- Keep proximity-based movement and conversation central to the experience.
- Show honest connection, microphone, and account states.
- Keep private audio and account details under the user's control.
