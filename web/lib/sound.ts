// Tiny synthesized 8-bit-style sound effects via Web Audio API - no audio
// files needed. Fits the retro-game chrome; used sparingly (a soft tick on
// slider drag, a short chime on reaching a genuine milestone) so it adds
// charm without becoming noise.

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(freq: number, duration: number, delay = 0, volume = 0.05) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.value = volume;
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + delay);
  osc.stop(ctx.currentTime + delay + duration);
}

/** A soft tick, meant for slider drags and small UI interactions. */
export function playBlip() {
  playTone(440, 0.04, 0, 0.04);
}

/** A short ascending arpeggio, meant for genuine milestones (not spammed). */
export function playChime() {
  playTone(523.25, 0.08, 0, 0.05);
  playTone(659.25, 0.08, 0.08, 0.05);
  playTone(783.99, 0.16, 0.16, 0.05);
}