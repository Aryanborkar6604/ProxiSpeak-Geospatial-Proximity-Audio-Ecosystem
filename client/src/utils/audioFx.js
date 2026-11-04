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

/**
 * Plays an interactive Web Audio chime simulating distance and wall occlusion.
 * @param {number} distance - Distance value from 0 to 100
 */
export function playProximityPreview(distance = 18) {
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const isOccluded = distance > 80;
  const normalizedDist = Math.max(0, Math.min(100, distance));

  // Natural inverse-distance attenuation curve (gain 0 to 1)
  let gainLevel = Math.max(0, 1 - (normalizedDist / 85));
  if (isOccluded) {
    gainLevel = 0.09; // -24 dB muffled through drywall/glass
  }

  // Harmonic chord: A4 (440Hz), C#5 (554.37Hz), E5 (659.25Hz)
  const chordFrequencies = [440, 554.37, 659.25];

  chordFrequencies.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const noteGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + idx * 0.06);

    // Dynamic low-pass acoustic filtering:
    // Bright (6500 Hz) at close range, warm (2400 Hz) at medium, muffled (420 Hz) through walls
    filter.type = 'lowpass';
    const cutoff = isOccluded ? 420 : Math.max(700, 6800 - normalizedDist * 60);
    filter.frequency.setValueAtTime(cutoff, now);

    const noteStart = now + idx * 0.06;
    const peakGain = Math.max(0.003, gainLevel * 0.16);

    noteGain.gain.setValueAtTime(0.0001, noteStart);
    noteGain.gain.linearRampToValueAtTime(peakGain, noteStart + 0.02);
    noteGain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.42);

    osc.connect(filter);
    filter.connect(noteGain);

    if (panner) {
      // Pan to right ear (+0.3 to +0.8) matching Maya's location on the stage
      panner.pan.setValueAtTime(Math.min(0.85, 0.25 + (normalizedDist / 100) * 0.55), now);
      noteGain.connect(panner);
      panner.connect(ctx.destination);
    } else {
      noteGain.connect(ctx.destination);
    }

    osc.start(noteStart);
    osc.stop(noteStart + 0.48);
  });
}

/**
 * Plays a realistic wooden door knock sound effect (3 percussive taps).
 */
export function playDoorKnock() {
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const taps = [0, 0.11, 0.23];

  taps.forEach((delay) => {
    const tapTime = now + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, tapTime);
    osc.frequency.exponentialRampToValueAtTime(70, tapTime + 0.045);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, tapTime);

    gain.gain.setValueAtTime(0.001, tapTime);
    gain.gain.linearRampToValueAtTime(0.22, tapTime + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, tapTime + 0.055);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(tapTime);
    osc.stop(tapTime + 0.06);
  });
}


