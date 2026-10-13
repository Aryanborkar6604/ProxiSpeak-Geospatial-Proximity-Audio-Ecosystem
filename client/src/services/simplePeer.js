import SimplePeer from 'simple-peer';

/**
 * SimplePeer wrapper for ProxiSpeak peer-to-peer audio mesh
 * Compatible with standard WebRTC RTCPeerConnection signaling.
 */
export class ProxiPeer {
  constructor({ initiator, stream, socket, peerId }) {
    this.peerId = peerId;
    this.socket = socket;
    this.peer = new SimplePeer({
      initiator: Boolean(initiator),
      stream: stream || null,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
        ],
      },
    });

    this.peer.on('signal', (signalData) => {
      if (signalData.type === 'offer') {
        this.socket.emit('webrtc:offer', { toUserId: this.peerId, offer: signalData });
      } else if (signalData.type === 'answer') {
        this.socket.emit('webrtc:answer', { toUserId: this.peerId, answer: signalData });
      } else if (signalData.candidate) {
        this.socket.emit('webrtc:ice-candidate', { toUserId: this.peerId, candidate: signalData.candidate });
      }
    });

    this.peer.on('error', (err) => {
      console.warn(`[SimplePeer] Error with peer ${this.peerId}:`, err);
    });
  }

  signal(data) {
    if (this.peer && !this.peer.destroyed) {
      this.peer.signal(data);
    }
  }

  destroy() {
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
    }
  }
}

export default ProxiPeer;

