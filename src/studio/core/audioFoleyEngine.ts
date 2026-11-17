/**
 * Zero-dependency Web Audio API procedural foley synthesizer for tactile card audio.
 * Generates non-repetitive paper riffles, felt slides, capture snaps, build taps, and wooden chimes.
 */

export interface AudioEngineState {
  muted: boolean;
  volume: number;
  unlocked: boolean;
}

export class AudioFoleyEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private volume = 0.72;

  public unlock(): void {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this.createPinkNoiseBuffer(this.ctx);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    }
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.masterGain && this.ctx && !this.muted) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  public getState(): AudioEngineState {
    return {
      muted: this.muted,
      volume: this.volume,
      unlocked: this.ctx !== null && this.ctx.state === 'running',
    };
  }

  private createPinkNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 1.2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return buffer;
  }

  private jitter(base: number, pct = 0.08): number {
    return base * (1 + (Math.random() * 2 - 1) * pct);
  }

  private ensureReady(): { ctx: AudioContext; out: GainNode; noise: AudioBuffer } | null {
    if (this.muted) return null;
    if (!this.ctx) {
      this.unlock();
    }
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return null;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return { ctx: this.ctx, out: this.masterGain, noise: this.noiseBuffer };
  }

  /**
   * Rapid burst of band-pass filtered noise clicks mimicking flexing paper edges during riffle shuffle.
   */
  public playRiffleShuffle(): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out, noise } = ready;
    const now = ctx.currentTime;

    const clicks = 18;
    for (let i = 0; i < clicks; i++) {
      const offset = i * 0.024 + (Math.random() * 0.008 - 0.004);
      const t = now + Math.max(0, offset);

      const src = ctx.createBufferSource();
      src.buffer = noise;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(this.jitter(1750 + i * 35, 0.12), t);
      filter.Q.setValueAtTime(3.2, t);

      const gain = ctx.createGain();
      const peak = 0.22 + (i / clicks) * 0.12;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      src.start(t, Math.random() * 0.4, 0.035);
    }

    // Soft strip/bridge finish thud
    const bridgeTime = now + clicks * 0.024 + 0.09;
    const thudOsc = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thudOsc.type = 'triangle';
    thudOsc.frequency.setValueAtTime(this.jitter(110), bridgeTime);
    thudOsc.frequency.exponentialRampToValueAtTime(48, bridgeTime + 0.09);
    thudGain.gain.setValueAtTime(0.16, bridgeTime);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, bridgeTime + 0.1);
    thudOsc.connect(thudGain);
    thudGain.connect(out);
    thudOsc.start(bridgeTime);
    thudOsc.stop(bridgeTime + 0.11);
  }

  /**
   * Soft low-pass pink noise sweep simulating cardstock gliding across woven felt.
   */
  public playCardSlide(): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out, noise } = ready;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = this.jitter(1.0, 0.08);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(this.jitter(440), t);
    filter.frequency.exponentialRampToValueAtTime(this.jitter(1150), t + 0.08);
    filter.frequency.exponentialRampToValueAtTime(380, t + 0.15);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.24, t + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.155);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    src.start(t, Math.random() * 0.6, 0.17);
  }

  /**
   * Crisp transient snap + low-end felt thud when slapping down a capture.
   */
  public playCardSnap(intensity = 1): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out, noise } = ready;
    const t = ctx.currentTime;
    const amp = Math.max(0.5, Math.min(1.4, intensity));

    // Crisp cardstock transient
    const src = ctx.createBufferSource();
    src.buffer = noise;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(this.jitter(2950, 0.1), t);
    bp.Q.setValueAtTime(2.0, t);

    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(0.45 * amp, t);
    snapGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.042);

    src.connect(bp);
    bp.connect(snapGain);
    snapGain.connect(out);
    src.start(t, Math.random() * 0.3, 0.05);

    // Warm table felt thud
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(this.jitter(132), t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.085);

    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.28 * amp, t);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.095);

    osc.connect(thudGain);
    thudGain.connect(out);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /**
   * Subtle double-tap paper click when layering cards into a build (+ brass lock click if cemented).
   */
  public playBuildTap(isCemented = false): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out, noise } = ready;
    const now = ctx.currentTime;

    for (let tap = 0; tap < 2; tap++) {
      const t = now + tap * 0.065;
      const src = ctx.createBufferSource();
      src.buffer = noise;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(this.jitter(tap === 0 ? 1900 : 2400), t);
      filter.Q.setValueAtTime(3.0, t);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.28, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.032);

      src.connect(filter);
      filter.connect(g);
      g.connect(out);
      src.start(t, Math.random() * 0.5, 0.04);
    }

    if (isCemented) {
      const lockTime = now + 0.13;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(this.jitter(620, 0.04), lockTime);
      osc.frequency.exponentialRampToValueAtTime(410, lockTime + 0.12);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18, lockTime);
      g.gain.exponentialRampToValueAtTime(0.0001, lockTime + 0.14);
      osc.connect(g);
      g.connect(out);
      osc.start(lockTime);
      osc.stop(lockTime + 0.15);
    }
  }

  /**
   * Warm wooden/acoustic harmonic tone on turn transition.
   */
  public playTurnChime(): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(this.jitter(440, 0.03), t);

    const overtone = ctx.createOscillator();
    overtone.type = 'triangle';
    overtone.frequency.setValueAtTime(this.jitter(880, 0.03), t);

    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.0001, t);
    g1.gain.linearRampToValueAtTime(0.09, t + 0.01);
    g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.linearRampToValueAtTime(0.025, t + 0.008);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);

    osc.connect(g1);
    g1.connect(out);
    overtone.connect(g2);
    g2.connect(out);

    osc.start(t);
    overtone.start(t);
    osc.stop(t + 0.24);
    overtone.stop(t + 0.12);
  }

  public playSweepFanfare(): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.07;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(this.jitter(freq, 0.02), t);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);

      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + 0.34);
    });
  }

  public playScoreTick(stepIndex = 0): void {
    const ready = this.ensureReady();
    if (!ready) return;
    const { ctx, out } = ready;
    const t = ctx.currentTime;
    const scale = [392, 440, 493.88, 523.25, 587.33, 659.25];
    const freq = scale[stepIndex % scale.length];

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(this.jitter(freq, 0.02), t);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);

    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + 0.27);
  }
}

export const sharedAudioEngine = new AudioFoleyEngine();
