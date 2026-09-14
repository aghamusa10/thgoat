import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SoundManager, soundManager } from '@/lib/audio/soundManager';

describe('SoundManager', () => {
  beforeEach(() => {
    soundManager.setMuted(false);
  });

  it('initializes with unmuted state by default', () => {
    const sm = new SoundManager();
    expect(sm.isSoundMuted()).toBe(false);
  });

  it('toggles muted state correctly', () => {
    const sm = new SoundManager();
    expect(sm.isSoundMuted()).toBe(false);

    const muted = sm.toggleMute();
    expect(muted).toBe(true);
    expect(sm.isSoundMuted()).toBe(true);

    const unmuted = sm.toggleMute();
    expect(unmuted).toBe(false);
    expect(sm.isSoundMuted()).toBe(false);
  });

  it('safely handles playTick across different timeLeft values without throwing', () => {
    const sm = new SoundManager();

    expect(() => sm.playTick(10)).not.toThrow();
    expect(() => sm.playTick(5)).not.toThrow();
    expect(() => sm.playTick(1)).not.toThrow();
  });

  it('does not play sounds when muted', () => {
    const sm = new SoundManager();
    sm.setMuted(true);

    const getAudioCtxSpy = vi.spyOn(sm, 'getAudioContext');
    sm.playTick(5);
    sm.playTimeUp();

    expect(getAudioCtxSpy).not.toHaveBeenCalled();
  });

  it('safely handles playTimeUp without throwing', () => {
    const sm = new SoundManager();
    expect(() => sm.playTimeUp()).not.toThrow();
  });
});
