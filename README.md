# ProxiSpeak — Geospatial Proximity Audio Ecosystem

## About the Project

ProxiSpeak is a virtual office application that enables users to communicate through real-time audio based on their proximity to other users in a shared virtual workspace.

## Features

- Real-time user connections using Socket.IO.
- WebRTC-based audio communication.
- Proximity-based audio volume adjustment.
- Virtual office with desks, a lounge, and user avatars.
- Avatar movement using keyboard controls.
- Microphone controls and connection status.
- Multiple users in a shared workspace.

## Technologies Used

- React
- Vite
- JavaScript
- Node.js
- Express.js
- Socket.IO
- WebRTC
- CSS

## Getting Started

### Prerequisites

Install Node.js and npm before running the project.

### Start the Backend

Open a terminal in the project root and run:

```bash
npm install
node server/server.js
```

If the root folder does not contain a `package.json`, follow the setup instructions in the existing project or install the backend dependencies before starting the server.

### Start the Frontend

Open a second terminal and run:

```bash
cd client
npm install
npm run dev
```

Open the local URL shown by Vite in your browser.

## How to Use

1. Start the backend and frontend.
2. Open the application in multiple browser tabs.
3. Allow microphone access and enable the microphone.
4. Use the arrow keys or W, A, S, D to move your avatar.
5. Move closer to other users to experience proximity-based audio.

Use headphones to reduce audio feedback.

## Project Goal

The goal of ProxiSpeak is to create a virtual office where audio communication responds to the distance between users.

## Internship Project

Developed as part of the Web Development internship project assigned by Infotact Solutions.