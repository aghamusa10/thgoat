import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { InGameScreen } from '@/components/game/InGameScreen';
import { soundManager } from '@/lib/audio/soundManager';

describe('InGameScreen ticking sound countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    soundManager.setMuted(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('triggers soundManager.playTick on countdown seconds when timeLeft <= 10', () => {
    const playTickSpy = vi.spyOn(soundManager, 'playTick');
    const playTimeUpSpy = vi.spyOn(soundManager, 'playTimeUp');

    // 53s total duration for SUBMITTING, start with 44 seconds already elapsed => 9s remaining
    const phaseStartedAt = new Date(Date.now() - 44 * 1000).toISOString();

    render(
      <InGameScreen
        roomCode="TEST"
        phase="SUBMITTING"
        currentStageNumber={1}
        players={[]}
        me={null}
        isHost={true}
        phaseStartedAt={phaseStartedAt}
      >
        <div>Game Phase Content</div>
      </InGameScreen>
    );

    // Initial timeLeft should be 9
    expect(screen.getByText('9')).toBeDefined();

    // Advance by 1 second -> timeLeft 8
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(playTickSpy).toHaveBeenCalledWith(8);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(playTickSpy).toHaveBeenCalledWith(7);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(playTickSpy).toHaveBeenCalledWith(6);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(playTickSpy).toHaveBeenCalledWith(5);

    // Advance remaining 5 seconds step by step down to 0
    for (let i = 4; i >= 1; i--) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(playTickSpy).toHaveBeenCalledWith(i);
    }

    // Advance to 0
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(playTimeUpSpy).toHaveBeenCalled();
  });

  it('allows toggling mute via the sound control button', () => {
    render(
      <InGameScreen
        roomCode="TEST"
        phase="SUBMITTING"
        currentStageNumber={1}
        players={[]}
        me={null}
        isHost={true}
      >
        <div>Content</div>
      </InGameScreen>
    );

    const soundBtn = screen.getByTitle('Mute Game Sounds');
    expect(soundBtn).toBeDefined();

    // Click to mute
    fireEvent.click(soundBtn);
    expect(soundManager.isSoundMuted()).toBe(true);

    // Click to unmute
    const unmuteBtn = screen.getByTitle('Unmute Game Sounds');
    expect(unmuteBtn).toBeDefined();
    fireEvent.click(unmuteBtn);
    expect(soundManager.isSoundMuted()).toBe(false);
  });
});
