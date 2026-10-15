/**
 * Procedural Audio Engine for Spine & Eye
 * Synthesizes pure harmonic chimes using the Web Audio API.
 * Eliminates external audio dependencies while delivering soothing, clinical-grade auditory cues.
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setMuted(muted) {
    this.muted = muted;
  }

  // Gentle Tibetan Singing Bowl / Mindfulness Bell
  playBreakChime() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const baseFreq = 528; // 528 Hz (Solfeggio harmonic tone)

    // Fundamental oscillator
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(baseFreq, now);

    // Overtones for warmth
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(baseFreq * 1.5, now); // Perfect fifth (792 Hz)

    const osc3 = this.ctx.createOscillator();
    const gain3 = this.ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(baseFreq * 2.76, now); // Upper harmonic sparkle

    // Master envelope
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.linearRampToValueAtTime(0.35, now + 0.05);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);

    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.linearRampToValueAtTime(0.18, now + 0.05);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 2.5);

    gain3.gain.setValueAtTime(0.001, now);
    gain3.gain.linearRampToValueAtTime(0.08, now + 0.03);
    gain3.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);

    osc1.connect(gain1);
    osc2.connect(gain2);
    osc3.connect(gain3);

    gain1.connect(this.ctx.destination);
    gain2.connect(this.ctx.destination);
    gain3.connect(this.ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc3.start(now);

    osc1.stop(now + 3.3);
    osc2.stop(now + 2.6);
    osc3.stop(now + 1.7);
  }

  // Soft Completion Chord (Major triad celebration)
  playCompletionChime() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    const notes = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5
    const now = this.ctx.currentTime;

    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const noteStart = now + idx * 0.12;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteStart);

      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.linearRampToValueAtTime(0.2, noteStart + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 1.8);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(noteStart);
      osc.stop(noteStart + 1.9);
    });
  }

  // Subtle tick / metronome for guided blinking and pacing
  playPacingTick() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.04);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.06);
  }
}

export const sound = new SoundEngine();
