/**
 * Sound Manager for procedural audio synthesis and audio asset playback.
 * Provides clock ticks and time-up cues for game rounds and stages.
 */

const TICK_SOUND_URL = '/sounds/1%20second%20tick%20(1).mp3';

export class SoundManager {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private tickAudioBuffer: AudioBuffer | null = null;
  private isLoadingBuffer: boolean = false;

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
      this.preloadTickAudio().catch(() => {});
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
    this.preloadTickAudio().catch(() => {});
  }

  public async preloadTickAudio(): Promise<void> {
    if (
      typeof window === 'undefined' ||
      typeof window.fetch !== 'function' ||
      this.tickAudioBuffer ||
      this.isLoadingBuffer
    ) {
      return;
    }

    const ctx = this.getAudioContext();
    if (!ctx) return;

    this.isLoadingBuffer = true;
    try {
      const soundUrl = window.location?.origin
        ? `${window.location.origin}${TICK_SOUND_URL}`
        : TICK_SOUND_URL;
      const res = await fetch(soundUrl);
      if (!res.ok) return;

      const arrayBuffer = await res.arrayBuffer();
      const decodedBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
        const promise = ctx.decodeAudioData(arrayBuffer, resolve, reject);
        if (promise && typeof promise.then === 'function') {
          promise.then(resolve, reject);
        }
      });
      this.tickAudioBuffer = decodedBuffer;
    } catch {
      // Preload fallback handled at runtime
    } finally {
      this.isLoadingBuffer = false;
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
   * Play the clock tick sound using the user's 1 second tick audio asset.
   * @param timeLeft Seconds remaining on the clock.
   */
  public playTick(timeLeft: number) {
    if (this.isMuted) return;

    const ctx = this.getAudioContext();
    const isUrgent = timeLeft <= 5;
    const isTock = timeLeft % 2 === 1;
    // Apply subtle rhythmic variation between odd/even seconds and urgency
    const playbackRate = isUrgent ? 1.15 : isTock ? 0.96 : 1.0;

    if (ctx && this.tickAudioBuffer) {
      try {
        const source = ctx.createBufferSource();
        source.buffer = this.tickAudioBuffer;
        source.playbackRate.setValueAtTime(playbackRate, ctx.currentTime);

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(isUrgent ? 0.9 : 0.75, ctx.currentTime);

        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        source.start(0);
        return;
      } catch {
        // Fall back to HTML Audio if Web Audio node playback fails
      }
    }

    if (!this.tickAudioBuffer && !this.isLoadingBuffer) {
      this.preloadTickAudio().catch(() => {});
    }

    this.playAudioFallback(TICK_SOUND_URL, playbackRate);
  }

  /**
   * Sound when time is up (removed).
   */
  public playTimeUp() {
    // Intentionally left blank: time is up sound removed
  }

  private playAudioFallback(src: string, playbackRate: number = 1.0) {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
    if (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.includes('jsdom')) return;
    try {
      const audio = new Audio(src);
      audio.volume = 0.75;
      audio.playbackRate = playbackRate;
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
