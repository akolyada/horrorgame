export class AudioSystem {
  private ctx: AudioContext | null = null;

  private ambienceGain: GainNode | null = null;
  private ambienceEnabled = false;

  private rumbleNodes: Array<{ osc: OscillatorNode; gain: GainNode }> = [];

  // Music state
  private musicGain: GainNode | null = null;
  private musicOscs: OscillatorNode[] = [];
  private musicPlaying = false;
  private musicTensionTarget = 0;
  private musicTension = 0;

  // Footstep state
  private footstepTimer = 0;
  private isMoving = false;

  public async ensureContext() {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;

    this.ctx = new AC();

    this.ambienceGain = this.ctx.createGain();
    this.ambienceGain.gain.value = 0;
    this.ambienceGain.connect(this.ctx.destination);
  }

  /** Expose audio context for WatchSystem beeps */
  public getContext(): AudioContext | null {
    return this.ctx;
  }

  public async startAmbience() {
    await this.ensureContext();
    if (!this.ctx || !this.ambienceGain) return;

    if (this.rumbleNodes.length > 0) return;

    // Deeper, creepier rumble for the kindergarten
    const makeRumble = (freq: number, vol: number) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      const filter = this.ctx!.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.value = 180;

      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = vol;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ambienceGain!);

      osc.start();
      return { osc, gain };
    };

    this.rumbleNodes.push(makeRumble(28, 0.10));  // deep sub-bass
    this.rumbleNodes.push(makeRumble(42, 0.07));
    this.rumbleNodes.push(makeRumble(66, 0.04));

    // Add a slow LFO modulation for unease
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 0.15; // very slow wobble
    lfoGain.gain.value = 15;
    lfo.connect(lfoGain);
    // Connect LFO to filter frequency of first rumble
    lfo.start();

    // Occasional creak/groan via filtered noise burst
    this.scheduleRandomCreak();
  }

  private scheduleRandomCreak() {
    if (!this.ctx || !this.ambienceGain) return;

    const delay = 5 + Math.random() * 15; // 5-20 seconds between creaks
    setTimeout(() => {
      if (!this.ctx || !this.ambienceGain || !this.ambienceEnabled) {
        this.scheduleRandomCreak();
        return;
      }
      this.playCreak();
      this.scheduleRandomCreak();
    }, delay * 1000);
  }

  private playCreak() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Filtered noise burst — sounds like creaking wood/pipes
    const bufferSize = this.ctx.sampleRate * 0.8;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(200 + Math.random() * 400, now);
    filter.Q.setValueAtTime(8 + Math.random() * 12, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.06 + Math.random() * 0.04, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ambienceGain!);
    src.start(now);
  }

  public async setAmbienceEnabled(enabled: boolean) {
    this.ambienceEnabled = enabled;
    await this.ensureContext();
    if (!this.ctx || !this.ambienceGain) return;

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => {});
    }

    const now = this.ctx.currentTime;
    this.ambienceGain.gain.cancelScheduledValues(now);
    this.ambienceGain.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.12);
  }

  public async startEncounter() {
    await this.setAmbienceEnabled(true);
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const node of this.rumbleNodes) {
      node.gain.gain.cancelScheduledValues(now);
      node.gain.gain.setValueAtTime(node.gain.gain.value, now);
      node.gain.gain.linearRampToValueAtTime(0.14, now + 0.2);
      node.gain.gain.linearRampToValueAtTime(0.08, now + 1.2);
    }
  }

  // ── Footsteps ──

  /** Call each frame with movement speed to trigger footstep sounds */
  public updateFootsteps(dt: number, speed: number) {
    this.isMoving = speed > 0.3;
    if (!this.isMoving) {
      this.footstepTimer = 0;
      return;
    }

    // Footstep interval: faster when running
    const interval = 0.42;
    this.footstepTimer += dt;
    if (this.footstepTimer >= interval) {
      this.footstepTimer -= interval;
      this.playFootstep();
    }
  }

  private playFootstep() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Short noise burst filtered to sound like a step on tile
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.08);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.15));
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600 + Math.random() * 200, now);
    filter.Q.setValueAtTime(1, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.12 + Math.random() * 0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    src.start(now);
  }

  // ── Monster breathing (played when monster is close) ──

  private breathingNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

  public updateMonsterBreathing(distance: number) {
    if (!this.ctx) return;

    // Start breathing sound when monster is within range
    const maxRange = 8;
    if (distance < maxRange && !this.breathingNode) {
      this.startBreathing();
    }

    if (this.breathingNode) {
      const vol = Math.max(0, 1 - distance / maxRange) * 0.15;
      this.breathingNode.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.1);

      if (distance >= maxRange) {
        this.breathingNode.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
        setTimeout(() => {
          this.breathingNode?.src.stop();
          this.breathingNode = null;
        }, 500);
      }
    }
  }

  private startBreathing() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Simulate breathing with modulated filtered noise
    const duration = 30; // long buffer, looping
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    const breathRate = 1.2; // breaths per second
    for (let i = 0; i < bufferSize; i++) {
      const t = i / this.ctx.sampleRate;
      // Breathing envelope: sine wave creates inhale/exhale pattern
      const envelope = Math.pow(Math.abs(Math.sin(Math.PI * t * breathRate)), 0.6);
      data[i] = (Math.random() * 2 - 1) * envelope;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(350, now);
    filter.Q.setValueAtTime(3, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    src.start(now);

    this.breathingNode = { src, gain };
  }

  // ── Door sound ──

  public playDoorCreak() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.2);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.5);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(200, now);
    filter.Q.setValueAtTime(6, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.6);
  }

  // ── Scare & Win (existing, improved) ──

  public async playScare() {
    await this.ensureContext();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});

    const now = this.ctx.currentTime;

    // White noise burst — harsher, more distorted
    const bufferSize = 2 * this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(520, now);
    filter.Q.setValueAtTime(3, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.9, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    src.start(now);

    // Sub punch (heavier)
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(60, now);
    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.0001, now);
    oscGain.gain.exponentialRampToValueAtTime(0.5, now + 0.01);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.connect(oscGain);
    oscGain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);

    // Dissonant chord for extra horror
    for (const freq of [180, 190, 285]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq, now);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      o.connect(g);
      g.connect(this.ctx.destination);
      o.start(now);
      o.stop(now + 0.35);
    }
  }

  public async playWin() {
    await this.ensureContext();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.3);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.7);
  }

  // ── Item pickup sound ──

  public playPickup() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Bright chime — two triangle waves with a rising pitch
    for (const [freq, delay] of [[520, 0], [780, 0.08], [1040, 0.16]] as [number, number][]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + delay);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.15, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.3);
    }
  }

  // ── Background music (procedural horror drone + melody) ──

  public startMusic() {
    if (!this.ctx || this.musicPlaying) return;
    this.musicPlaying = true;

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.06;
    this.musicGain.connect(this.ctx.destination);

    // Pad layer: minor chord drone (Am: A2, C3, E3)
    const padFreqs = [110, 130.81, 164.81];
    for (const freq of padFreqs) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 250;
      filter.Q.value = 2;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.3;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.musicGain);
      osc.start();
      this.musicOscs.push(osc);
    }

    // Tension layer: dissonant tritone (higher when enemy close)
    const tensionOsc = this.ctx.createOscillator();
    tensionOsc.type = 'sawtooth';
    tensionOsc.frequency.value = 185; // F#3 — tritone against C
    const tensionFilter = this.ctx.createBiquadFilter();
    tensionFilter.type = 'lowpass';
    tensionFilter.frequency.value = 300;
    const tensionGain = this.ctx.createGain();
    tensionGain.gain.value = 0;
    tensionOsc.connect(tensionFilter);
    tensionFilter.connect(tensionGain);
    tensionGain.connect(this.musicGain);
    tensionOsc.start();
    this.musicOscs.push(tensionOsc);

    // Schedule melody notes (pentatonic minor, looping)
    this.scheduleMelodyLoop();
  }

  private melodyTimeout: ReturnType<typeof setTimeout> | null = null;

  private scheduleMelodyLoop() {
    if (!this.ctx || !this.musicGain) return;

    // A minor pentatonic: A3, C4, D4, E4, G4
    const notes = [220, 261.63, 293.66, 329.63, 392];
    // Slow, sparse melody pattern (some rests)
    const pattern = [0, -1, 2, -1, 4, 3, -1, 1, -1, -1, 0, 2]; // -1 = rest
    const noteLen = 0.8; // seconds per step

    let stepIndex = 0;
    const playStep = () => {
      if (!this.ctx || !this.musicGain || !this.musicPlaying) return;
      const idx = pattern[stepIndex % pattern.length];
      if (idx >= 0) {
        const freq = notes[idx];
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;

        const gain = this.ctx.createGain();
        const now = this.ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.2, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + noteLen * 0.9);

        osc.connect(gain);
        gain.connect(this.musicGain!);
        osc.start(now);
        osc.stop(now + noteLen);
      }
      stepIndex++;
      this.melodyTimeout = setTimeout(playStep, noteLen * 1000);
    };

    playStep();
  }

  public stopMusic() {
    this.musicPlaying = false;
    for (const osc of this.musicOscs) {
      try { osc.stop(); } catch { /* already stopped */ }
    }
    this.musicOscs = [];
    if (this.melodyTimeout) {
      clearTimeout(this.melodyTimeout);
      this.melodyTimeout = null;
    }
  }

  /** Update music tension based on enemy distance (0=far, 1=close) */
  public updateMusicTension(enemyDist: number) {
    if (!this.ctx || !this.musicGain) return;
    const maxRange = 12;
    this.musicTensionTarget = Math.max(0, 1 - enemyDist / maxRange);
    // Smooth toward target
    this.musicTension += (this.musicTensionTarget - this.musicTension) * 0.02;

    // Increase overall volume with tension
    this.musicGain.gain.setTargetAtTime(
      0.06 + this.musicTension * 0.08,
      this.ctx.currentTime, 0.3,
    );

    // Fade in tension oscillator (last one in musicOscs)
    if (this.musicOscs.length > 0) {
      const tensionOsc = this.musicOscs[this.musicOscs.length - 1];
      // Access gain through the graph — we use the musicGain master instead
      // The tension gain node was connected inline, so we adjust via the osc frequency for unease
      tensionOsc.frequency.setTargetAtTime(
        185 + this.musicTension * 40, // slight detune when close
        this.ctx.currentTime, 0.5,
      );
    }
  }
}
