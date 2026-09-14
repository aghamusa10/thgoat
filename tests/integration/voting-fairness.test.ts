import { describe, it, expect, beforeEach } from 'vitest';
import { GameService } from '@/lib/services/game-service';

describe('Voting Fairness & Self-Vote Prevention Integration', () => {
  beforeEach(() => {
    GameService._resetMemoryStore();
  });

  async function setupVotingStage() {
    const host = await GameService.createRoom('HostCat');
    const p2 = await GameService.joinRoom(host.room_code, 'PlayerTwo');
    const p3 = await GameService.joinRoom(host.room_code, 'PlayerThree');

    const started = await GameService.startGame(host.room_code, host.session_token);

    const hostState = await GameService.getRoomState(host.room_code, host.session_token);
    const p2State = await GameService.getRoomState(host.room_code, p2.session_token);
    const p3State = await GameService.getRoomState(host.room_code, p3.session_token);

    // Host submits both titles
    await GameService.submitTitle(host.room_code, host.session_token, started.stage_id, 'Host Title 1', hostState.my_prompts[0].matchup_id);
    await GameService.submitTitle(host.room_code, host.session_token, started.stage_id, 'Host Title 2', hostState.my_prompts[1].matchup_id);

    // P2 submits both titles
    await GameService.submitTitle(host.room_code, p2.session_token, started.stage_id, 'P2 Title 1', p2State.my_prompts[0].matchup_id);
    await GameService.submitTitle(host.room_code, p2.session_token, started.stage_id, 'P2 Title 2', p2State.my_prompts[1].matchup_id);

    // P3 submits both titles
    await GameService.submitTitle(host.room_code, p3.session_token, started.stage_id, 'P3 Title 1', p3State.my_prompts[0].matchup_id);
    await GameService.submitTitle(host.room_code, p3.session_token, started.stage_id, 'P3 Title 2', p3State.my_prompts[1].matchup_id);

    return { host, p2, p3, stage_id: started.stage_id, room_code: host.room_code };
  }

  it('correctly sets is_author and provides voting options only to non-authors', async () => {
    const { host, p2, p3, room_code } = await setupVotingStage();

    // Matchup 0 is between Host and P2
    const hostState = await GameService.getRoomState(room_code, host.session_token);
    expect(hostState.current_matchup?.is_author).toBe(true);
    expect(hostState.current_matchup?.voting_options).toHaveLength(2);

    const p2State = await GameService.getRoomState(room_code, p2.session_token);
    expect(p2State.current_matchup?.is_author).toBe(true);

    const p3State = await GameService.getRoomState(room_code, p3.session_token);
    expect(p3State.current_matchup?.is_author).toBe(false);
    expect(p3State.current_matchup?.voting_options).toHaveLength(2);
  });

  it('server strictly rejects malicious self-vote attempt from authors', async () => {
    const { host, p3, room_code, stage_id } = await setupVotingStage();

    const p3State = await GameService.getRoomState(room_code, p3.session_token);
    const targetSubmissionId = p3State.current_matchup!.voting_options[0].submission_id;

    // Host (who is an author of Matchup 0) attempts to vote
    await expect(
      GameService.submitVote(
        room_code,
        host.session_token,
        stage_id,
        targetSubmissionId
      )
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('SELF_VOTING_PROHIBITED'),
    });
  });

  it('allows valid peer votes and reveals matchup upon receiving all votes', async () => {
    const { host, p3, room_code, stage_id } = await setupVotingStage();

    const p3State = await GameService.getRoomState(room_code, p3.session_token);
    const matchupId = p3State.current_matchup!.matchup_id;
    const chosenSubmissionId = p3State.current_matchup!.voting_options[0].submission_id;

    // P3 casts vote
    const voteRes = await GameService.submitVote(
      room_code,
      p3.session_token,
      stage_id,
      chosenSubmissionId,
      matchupId
    );

    expect(voteRes.success).toBe(true);
    expect(voteRes.is_revealed).toBe(true);
    expect(voteRes.result).toBeDefined();

    const hostState = await GameService.getRoomState(room_code, host.session_token);
    expect(hostState.current_matchup?.is_revealed).toBe(true);
    expect(hostState.current_matchup?.result?.options).toHaveLength(2);
  });

  it('allows host to advance through all matchups to RESULTS', async () => {
    const { host, p2, p3, room_code, stage_id } = await setupVotingStage();

    // Matchup 0: P3 votes
    const p3State0 = await GameService.getRoomState(room_code, p3.session_token);
    await GameService.submitVote(
      room_code,
      p3.session_token,
      stage_id,
      p3State0.current_matchup!.voting_options[0].submission_id
    );

    // Host advances to Matchup 1
    const adv1 = await GameService.advanceMatchup(room_code, host.session_token);
    expect(adv1.phase).toBe('VOTING');
    expect(adv1.current_matchup_index).toBe(1);

    // Matchup 1: Host votes (since Matchup 1 is P2 vs P3)
    const hostState1 = await GameService.getRoomState(room_code, host.session_token);
    expect(hostState1.current_matchup?.is_author).toBe(false);
    await GameService.submitVote(
      room_code,
      host.session_token,
      stage_id,
      hostState1.current_matchup!.voting_options[0].submission_id
    );

    // Host advances to Matchup 2
    const adv2 = await GameService.advanceMatchup(room_code, host.session_token);
    expect(adv2.current_matchup_index).toBe(2);

    // Matchup 2: P2 votes (since Matchup 2 is P3 vs Host)
    const p2State2 = await GameService.getRoomState(room_code, p2.session_token);
    expect(p2State2.current_matchup?.is_author).toBe(false);
    await GameService.submitVote(
      room_code,
      p2.session_token,
      stage_id,
      p2State2.current_matchup!.voting_options[0].submission_id
    );

    // Host advances final matchup -> should transition to RESULTS
    const adv3 = await GameService.advanceMatchup(room_code, host.session_token);
    expect(adv3.phase).toBe('RESULTS');

    const finalState = await GameService.getRoomState(room_code, host.session_token);
    expect(finalState.phase).toBe('RESULTS');
    expect(finalState.stage_matchup_results).toHaveLength(3);
  });
});
