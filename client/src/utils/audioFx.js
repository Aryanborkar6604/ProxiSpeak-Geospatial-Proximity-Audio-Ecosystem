/**
 * Zero-dependency Web Audio sound effects for ProxiSpeak spatial audio testing
 * and ambient sound synthesis.
 */

let audioCtx = null;
function getCtx() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Plays a binaural 3D spatial acoustic radar ping that pans across ears.
 */
export function playSpatialPing() {
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(1760, now + 0.12);
  osc.frequency.exponentialRampToValueAtTime(440, now + 0.35);

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.22, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

  if (panner) {
    panner.pan.setValueAtTime(-0.9, now);
    panner.pan.linearRampToValueAtTime(0.9, now + 0.4);
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(ctx.destination);
  } else {
    osc.connect(gain);
    gain.connect(ctx.destination);
  }

  osc.start(now);
  osc.stop(now + 0.5);
}

// Ambient Noise Generator (Focus Drone / Pink Noise)
let ambientNode = null;
let ambientGain = null;

export function toggleAmbientSound(mode = 'drone') {
  const ctx = getCtx();
  if (!ctx) return false;

  if (ambientNode) {
    ambientNode.stop();
    ambientNode.disconnect();
    ambientNode = null;
    return false;
  }

  const bufferSize = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  // Pink noise / soothing low frequency drone
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    data[i] = (b0 + b1 + b2) * 0.08;
  }

  ambientNode = ctx.createBufferSource();
  ambientNode.buffer = buffer;
  ambientNode.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = mode === 'drone' ? 320 : 680;

  ambientGain = ctx.createGain();
  ambientGain.gain.setValueAtTime(0.001, ctx.currentTime);
  ambientGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 1.5);

  ambientNode.connect(filter);
  filter.connect(ambientGain);
  ambientGain.connect(ctx.destination);

  ambientNode.start();
  return true;
}

