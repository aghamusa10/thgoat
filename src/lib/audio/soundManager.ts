/**
 * Sound Manager for procedural audio synthesis via Web Audio API.
 * Provides clock ticks and time-up cues for game rounds and stages.
 */

export class SoundManager {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('tg_sound_muted');
        if (saved !== null) {
          this.isMuted = saved === 'true';
        }
      } catch {
        // Ignore localStorage restrictions
      }
      this.initUserGestureUnlock();
    }
  }

  private initUserGestureUnlock() {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      this.unlockAudio();
    };

    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true, passive: true });
    window.addEventListener('touchstart', unlock, { capture: true, passive: true });
  }

  public getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (!this.ctx) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      if (AudioContextClass) {
        try {
          this.ctx = new AudioContextClass();
        } catch (e) {
          console.warn('AudioContext initialization failed:', e);
        }
      }
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    return this.ctx;
  }

  public unlockAudio() {
    const ctx = this.getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  public isSoundMuted(): boolean {
    return this.isMuted;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('tg_sound_muted', String(muted));
      } catch {
        // Ignore
      }
    }
    if (!muted) {
      this.unlockAudio();
      this.playTick(10);
    }
  }

  public toggleMute(): boolean {
    const newMuted = !this.isMuted;
    this.setMuted(newMuted);
    return newMuted;
  }

  /**
   * Play a clock tick sound.
   * @param timeLeft Seconds remaining on the clock.
   */
  public playTick(timeLeft: number) {
    if (this.isMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) {
      this.playAudioFallback(
        timeLeft <= 5
          ? '/sounds/tick-urgent.wav'
          : timeLeft % 2 === 1
          ? '/sounds/tock.wav'
          : '/sounds/tick.wav'
      );
      return;
    }

    try {
      const now = ctx.currentTime;
      const isUrgent = timeLeft <= 5;
      const isTock = timeLeft % 2 === 1;

      // 1. Transient click (filtered noise burst for clock mechanical escapement tick)
      const bufferSize = Math.floor(ctx.sampleRate * 0.02); // 20ms
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
      }

      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(isUrgent ? 3400 : isTock ? 2300 : 2800, now);
      noiseFilter.Q.setValueAtTime(3.5, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(isUrgent ? 0.35 : 0.22, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(ctx.destination);

      // 2. Resonant body ping (woodblock / mechanical gear pop)
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();

      const startFreq = isUrgent
        ? isTock
          ? 1250
          : 1500
        : isTock
        ? 850
        : 1050;

      osc.type = isUrgent ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(100, startFreq * 0.3), now + 0.035);

      oscGain.gain.setValueAtTime(isUrgent ? 0.35 : 0.22, now);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

      osc.connect(oscGain);
      oscGain.connect(ctx.destination);

      noiseSource.start(now);
      osc.start(now);
      osc.stop(now + 0.045);
    } catch {
      this.playAudioFallback(timeLeft <= 5 ? '/sounds/tick-urgent.wav' : '/sounds/tick.wav');
    }
  }

  /**
   * Play buzzer / chime sound when time is up.
   */
  public playTimeUp() {
    if (this.isMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) {
      this.playAudioFallback('/sounds/timeup.wav');
      return;
    }

    try {
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, now);
      filter.frequency.exponentialRampToValueAtTime(400, now + 0.5);

      osc1.type = 'sawtooth';
      osc2.type = 'triangle';

      osc1.frequency.setValueAtTime(320, now);
      osc1.frequency.setValueAtTime(220, now + 0.2);

      osc2.frequency.setValueAtTime(480, now);
      osc2.frequency.setValueAtTime(330, now + 0.2);

      gain.gain.setValueAtTime(0.28, now);
      gain.gain.setValueAtTime(0.28, now + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.55);
      osc2.stop(now + 0.55);
    } catch {
      this.playAudioFallback('/sounds/timeup.wav');
    }
  }

  private playAudioFallback(src: string) {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
    if (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.includes('jsdom')) return;
    try {
      const audio = new Audio(src);
      audio.volume = 0.5;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    } catch {
      // Audio element playback failed or blocked
    }
  }
}

export const soundManager = new SoundManager();
