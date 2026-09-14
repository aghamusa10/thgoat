import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InGameScreen } from '@/components/game/InGameScreen';

describe('InGameScreen Timer Tests', () => {
  it('renders timer with full duration when phaseStartedAt is undefined', () => {
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
    expect(screen.getByText('53')).toBeDefined();
  });

  it('renders timer with full duration when phaseStartedAt is now', () => {
    render(
      <InGameScreen
        roomCode="TEST"
        phase="SUBMITTING"
        currentStageNumber={1}
        players={[]}
        me={null}
        isHost={true}
        phaseStartedAt={new Date().toISOString()}
      >
        <div>Content</div>
      </InGameScreen>
    );
    expect(screen.getByText('53')).toBeDefined();
  });

  it('renders 0 when phaseStartedAt is 2 minutes ago', () => {
    render(
      <InGameScreen
        roomCode="TEST"
        phase="SUBMITTING"
        currentStageNumber={1}
        players={[]}
        me={null}
        isHost={true}
        phaseStartedAt={new Date(Date.now() - 120000).toISOString()}
      >
        <div>Content</div>
      </InGameScreen>
    );
    expect(screen.getByText('0')).toBeDefined();
  });

  it('compensates for clock skew when serverTime is provided', () => {
    // Scenario: Client device clock is 5 minutes ahead of server clock
    // Server time is 10:00:00, round started at 10:00:00 (0 seconds elapsed on server)
    // Client Date.now() is 10:05:00 (+300,000ms ahead)
    const serverTimestamp = Date.now() - 300000;
    const serverTimeStr = new Date(serverTimestamp).toISOString();
    const phaseStartedAtStr = new Date(serverTimestamp).toISOString();

    render(
      <InGameScreen
        roomCode="TEST"
        phase="SUBMITTING"
        currentStageNumber={1}
        players={[]}
        me={null}
        isHost={true}
        phaseStartedAt={phaseStartedAtStr}
        serverTime={serverTimeStr}
      >
        <div>Content</div>
      </InGameScreen>
    );

    // Without clock skew correction, client would see 300s elapsed and display 0.
    // With clock skew correction, client calculates (currentServerTime - startedMs) = 0s elapsed, displaying 53s.
    expect(screen.getByText('53')).toBeDefined();
  });

  it('renders 30 seconds for unrevealed VOTING phase matchup', () => {
    render(
      <InGameScreen
        roomCode="TEST"
        phase="VOTING"
        currentStageNumber={1}
        players={[]}
        me={null}
        isHost={true}
        currentMatchup={{
          matchup_id: 'm1',
          prompt_text: 'Test Prompt',
          player1: { player_id: 'p1', nickname: 'Alice', mascot: 'chicken' },
          player2: { player_id: 'p2', nickname: 'Bob', mascot: 'dog' },
          answer1_text: 'Answer 1',
          answer2_text: 'Answer 2',
          is_revealed: false,
          total_votes: 0,
        }}
      >
        <div>Content</div>
      </InGameScreen>
    );

    expect(screen.getByText('30')).toBeDefined();
  });

  it('shows VOTES IN badge instead of timer when VOTING matchup is revealed', () => {
    const onTimeout = vi.fn();
    render(
      <InGameScreen
        roomCode="TEST"
        phase="VOTING"
        currentStageNumber={1}
        players={[]}
        me={null}
        isHost={true}
        onTimeout={onTimeout}
        currentMatchup={{
          matchup_id: 'm1',
          prompt_text: 'Test Prompt',
          player1: { player_id: 'p1', nickname: 'Alice', mascot: 'chicken' },
          player2: { player_id: 'p2', nickname: 'Bob', mascot: 'dog' },
          answer1_text: 'Answer 1',
          answer2_text: 'Answer 2',
          is_revealed: true,
          total_votes: 2,
        }}
      >
        <div>Content</div>
      </InGameScreen>
    );

    expect(screen.queryByText('SEC')).toBeNull();
    expect(screen.getByText('VOTES IN')).toBeDefined();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('shows ROUND OVER badge and does not trigger onTimeout in RESULTS phase', () => {
    const onTimeout = vi.fn();
    render(
      <InGameScreen
        roomCode="TEST"
        phase="RESULTS"
        currentStageNumber={1}
        players={[]}
        me={null}
        isHost={true}
        onTimeout={onTimeout}
      >
        <div>Content</div>
      </InGameScreen>
    );

    expect(screen.queryByText('SEC')).toBeNull();
    expect(screen.getByText('ROUND OVER')).toBeDefined();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('shows FINAL SCORES badge in FINISHED phase', () => {
    render(
      <InGameScreen
        roomCode="TEST"
        phase="FINISHED"
        currentStageNumber={3}
        players={[]}
        me={null}
        isHost={true}
      >
        <div>Content</div>
      </InGameScreen>
    );

    expect(screen.queryByText('SEC')).toBeNull();
    expect(screen.getByText('FINAL SCORES')).toBeDefined();
  });
});
