import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase/server';
import { generateRoomCode } from '@/lib/game/room-code';
import { MIN_PLAYERS, MAX_PLAYERS, validatePhaseTransition, TOTAL_STAGES } from '@/lib/game/state-machine';
import { calculateMatchupResult, calculateStageResults, computeLeaderboard, SubmissionWithAuthor } from '@/lib/game/scoring';
import { CURATED_PICTURES, selectPicturesForStage } from '@/lib/game/pictures';
import { generateStageMatchups } from '@/lib/game/pairing';
import { emitRoomEvent } from '@/lib/game/events';
import {
  GamePhase,
  RoomState,
  Player,
  Room,
  Stage,
  StageMatchup,
  Submission,
  Vote,
  StageResultItem,
  MatchupResult,
  PlayerPromptInfo,
  CurrentMatchupInfo,
  VotingOption,
} from '@/types/game';

// Check if live Supabase instance is configured with valid non-mock credentials
function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  if (
    url.includes('mock.supabase.co') ||
    url.includes('placeholder.supabase.co') ||
    key.includes('mock') ||
    key.includes('placeholder')
  ) {
    return false;
  }
  return true;
}

interface GameMemoryStore {
  rooms: Map<string, Room>;
  players: Map<string, Player[]>;
  stages: Map<string, Stage[]>;
  matchups: Map<string, StageMatchup[]>;
  pictures: typeof CURATED_PICTURES;
  submissions: Map<string, Submission[]>;
  votes: Map<string, Vote[]>;
  matchupScores: Map<string, MatchupResult[]>;
  stageScores: Map<string, StageResultItem[]>;
}

// In-memory cache/mock store for unit tests and local mock development (persisted on globalThis for Next.js)
const memoryStore: GameMemoryStore =
  (globalThis as any).__throatgoat_memory_store || {
    rooms: new Map<string, Room>(),
    players: new Map<string, Player[]>(),
    stages: new Map<string, Stage[]>(),
    matchups: new Map<string, StageMatchup[]>(), // key: stageId
    pictures: CURATED_PICTURES,
    submissions: new Map<string, Submission[]>(), // key: stageId
    votes: new Map<string, Vote[]>(), // key: stageId
    matchupScores: new Map<string, MatchupResult[]>(), // key: stageId
    stageScores: new Map<string, StageResultItem[]>(),
  };
(globalThis as any).__throatgoat_memory_store = memoryStore;

export class GameService {
  /**
   * Resets in-memory store (for testing purposes).
   */
  static _resetMemoryStore() {
    memoryStore.rooms.clear();
    memoryStore.players.clear();
    memoryStore.stages.clear();
    memoryStore.matchups.clear();
    memoryStore.submissions.clear();
    memoryStore.votes.clear();
    memoryStore.matchupScores.clear();
    memoryStore.stageScores.clear();
    memoryStore.pictures = CURATED_PICTURES;
  }

  /**
   * Creates a new game room and designates the creator as host.
   */
  static async createRoom(nickname: string) {
    const roomId = randomUUID();
    const playerId = randomUUID();
    const sessionToken = randomUUID();
    const roomCode = generateRoomCode();

    const newRoom: Room = {
      id: roomId,
      room_code: roomCode,
      host_player_id: playerId,
      phase: 'LOBBY',
      current_stage_number: 1,
      current_matchup_index: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const hostPlayer: Player = {
      id: playerId,
      room_id: roomId,
      nickname,
      session_token: sessionToken,
      is_host: true,
      score: 0,
      is_connected: true,
      joined_at: new Date().toISOString(),
    };

    if (isSupabaseConfigured()) {
      try {
        const { error: roomErr } = await supabaseServer.from('rooms').insert({
          id: roomId,
          room_code: roomCode,
          phase: 'LOBBY',
          current_stage_number: 1,
        });
        if (roomErr) throw roomErr;

        const { error: playerErr } = await supabaseServer.from('players').insert({
          id: playerId,
          room_id: roomId,
          nickname,
          session_token: sessionToken,
          is_host: true,
          score: 0,
          is_connected: true,
        });
        if (playerErr) throw playerErr;

        await supabaseServer.from('rooms').update({ host_player_id: playerId }).eq('id', roomId);
      } catch (err: any) {
        console.error('Supabase createRoom failed, falling back to memory store:', err?.message || err);
      }
    }

    // Keep memoryStore updated for fast lookup & fallback
    memoryStore.rooms.set(roomCode, newRoom);
    memoryStore.players.set(roomCode, [hostPlayer]);

    return {
      room_id: roomId,
      room_code: roomCode,
      player_id: playerId,
      session_token: sessionToken,
      phase: newRoom.phase,
    };
  }

  /**
   * Joins an existing game room.
   */
  static async joinRoom(roomCode: string, nickname: string) {
    const code = roomCode.toUpperCase();

    if (isSupabaseConfigured()) {
      try {
        const { data: room, error: roomErr } = await supabaseServer
          .from('rooms')
          .select('*')
          .eq('room_code', code)
          .maybeSingle();

        if (roomErr || !room) {
          throw { status: 404, message: 'Room not found. Check your room code!' };
        }

        if (room.phase !== 'LOBBY') {
          throw { status: 409, message: 'Game is already in progress. Cannot join now.' };
        }

        const { data: currentPlayers } = await supabaseServer
          .from('players')
          .select('*')
          .eq('room_id', room.id)
          .eq('is_connected', true);

        if ((currentPlayers?.length || 0) >= MAX_PLAYERS) {
          throw { status: 409, message: `Room is at maximum capacity (${MAX_PLAYERS} players).` };
        }

        const playerId = randomUUID();
        const sessionToken = randomUUID();

        const { error: playerErr } = await supabaseServer.from('players').insert({
          id: playerId,
          room_id: room.id,
          nickname,
          session_token: sessionToken,
          is_host: false,
          score: 0,
          is_connected: true,
        });

        if (playerErr) throw playerErr;

        const newPlayer: Player = {
          id: playerId,
          room_id: room.id,
          nickname,
          session_token: sessionToken,
          is_host: false,
          score: 0,
          is_connected: true,
          joined_at: new Date().toISOString(),
        };

        const currentMemPlayers = memoryStore.players.get(code) || [];
        currentMemPlayers.push(newPlayer);
        memoryStore.players.set(code, currentMemPlayers);

        emitRoomEvent(code, {
          type: 'player_joined',
          payload: {
            id: playerId,
            nickname,
            is_host: false,
            score: 0,
            is_connected: true,
          },
        });

        return {
          room_id: room.id,
          room_code: room.room_code,
          player_id: playerId,
          session_token: sessionToken,
          phase: room.phase,
        };
      } catch (err: any) {
        if (err?.status) throw err;
        console.error('Supabase joinRoom error:', err?.message || err);
      }
    }

    // In-memory fallback
    const room = memoryStore.rooms.get(code);
    if (!room) {
      throw { status: 404, message: 'Room not found. Check your room code!' };
    }

    if (room.phase !== 'LOBBY') {
      throw { status: 409, message: 'Game is already in progress. Cannot join now.' };
    }

    const currentPlayers = memoryStore.players.get(code) || [];
    if (currentPlayers.length >= MAX_PLAYERS) {
      throw { status: 409, message: `Room is at maximum capacity (${MAX_PLAYERS} players).` };
    }

    const playerId = randomUUID();
    const sessionToken = randomUUID();

    const newPlayer: Player = {
      id: playerId,
      room_id: room.id,
      nickname,
      session_token: sessionToken,
      is_host: false,
      score: 0,
      is_connected: true,
      joined_at: new Date().toISOString(),
    };

    currentPlayers.push(newPlayer);
    memoryStore.players.set(code, currentPlayers);

    emitRoomEvent(code, {
      type: 'player_joined',
      payload: {
        id: playerId,
        nickname,
        is_host: false,
        score: 0,
        is_connected: true,
      },
    });

    return {
      room_id: room.id,
      room_code: room.room_code,
      player_id: playerId,
      session_token: sessionToken,
      phase: room.phase,
    };
  }

  /**
   * Host starts the game from Lobby.
   * Creates Stage 1 and generates paired 1v1 picture matchups.
   */
  static async startGame(roomCode: string, sessionToken: string) {
    const code = roomCode.toUpperCase();

    // In-memory fallback / standard flow
    const room = memoryStore.rooms.get(code);
    if (!room) {
      throw { status: 404, message: 'Room not found' };
    }

    const players = memoryStore.players.get(code) || [];
    const caller = players.find((p) => p.session_token === sessionToken);

    if (!caller || !caller.is_host) {
      throw { status: 403, message: 'Only the host can start the game' };
    }

    const activePlayers = players.filter((p) => p.is_connected);
    const validation = validatePhaseTransition(room.phase, 'SUBMITTING', {
      playerCount: activePlayers.length,
    });

    if (!validation.isValid) {
      throw { status: 400, message: validation.error || 'Cannot start game' };
    }

    const stageId = randomUUID();
    const selectedPics = selectPicturesForStage(1, activePlayers.length);
    const stageMatchups = generateStageMatchups(stageId, activePlayers, selectedPics);

    const stage1: Stage = {
      id: stageId,
      game_id: randomUUID(),
      room_id: room.id,
      stage_number: 1,
      picture_id: selectedPics[0]?.id,
      phase: 'SUBMITTING',
      current_matchup_index: 0,
      started_at: new Date().toISOString(),
      completed_at: null,
    };

    room.phase = 'SUBMITTING';
    room.current_stage_number = 1;
    room.current_matchup_index = 0;
    room.updated_at = new Date().toISOString();

    memoryStore.stages.set(code, [stage1]);
    memoryStore.matchups.set(stageId, stageMatchups);
    memoryStore.submissions.set(stageId, []);
    memoryStore.votes.set(stageId, []);
    memoryStore.matchupScores.set(stageId, []);

    emitRoomEvent(code, {
      type: 'room_phase_changed',
      payload: { phase: room.phase, current_stage_number: 1 },
    });

    return {
      phase: room.phase,
      stage_number: 1,
      stage_id: stageId,
      total_matchups: stageMatchups.length,
      picture_url: selectedPics[0]?.image_url,
      picture_description: selectedPics[0]?.description,
    };
  }

  /**
   * Submits a title for an assigned matchup picture during SUBMITTING phase.
   * Each player has 2 assigned matchups.
   */
  static async submitTitle(
    roomCode: string,
    sessionToken: string,
    stageId: string,
    title: string,
    matchupId?: string
  ) {
    const code = roomCode.toUpperCase();
    const room = memoryStore.rooms.get(code);
    if (!room) {
      throw { status: 404, message: 'Room not found' };
    }

    if (room.phase !== 'SUBMITTING') {
      throw { status: 409, message: 'Room is not in SUBMITTING phase' };
    }

    const players = memoryStore.players.get(code) || [];
    const caller = players.find((p) => p.session_token === sessionToken);

    if (!caller) {
      throw { status: 401, message: 'Invalid session token' };
    }

    const stageMatchups = memoryStore.matchups.get(stageId) || [];
    const stageSubmissions = memoryStore.submissions.get(stageId) || [];

    // Find the target matchup
    let targetMatchup: StageMatchup | undefined;

    if (matchupId) {
      targetMatchup = stageMatchups.find((m) => m.id === matchupId);
      if (!targetMatchup) {
        throw { status: 400, message: 'Invalid matchup ID for this stage' };
      }
      // Check caller is assigned to this matchup
      if (targetMatchup.player1_id !== caller.id && targetMatchup.player2_id !== caller.id) {
        throw { status: 403, message: 'You are not assigned to title this picture' };
      }
      // Check if already submitted for this specific matchup
      const alreadySubmitted = stageSubmissions.some(
        (s) => s.matchup_id === targetMatchup!.id && s.player_id === caller.id
      );
      if (alreadySubmitted) {
        throw { status: 400, message: 'You have already submitted a title for this picture' };
      }
    } else {
      // Find the first unsubmitted matchup assigned to this player
      const assignedMatchups = stageMatchups.filter(
        (m) => m.player1_id === caller.id || m.player2_id === caller.id
      );
      targetMatchup = assignedMatchups.find(
        (m) => !stageSubmissions.some((s) => s.matchup_id === m.id && s.player_id === caller.id)
      );

      if (!targetMatchup) {
        throw { status: 400, message: 'You have already submitted all your titles for this stage' };
      }
    }

    const newSubmission: Submission = {
      id: randomUUID(),
      stage_id: stageId,
      matchup_id: targetMatchup.id,
      player_id: caller.id,
      title: title ? title.trim() : '',
      created_at: new Date().toISOString(),
    };

    stageSubmissions.push(newSubmission);
    memoryStore.submissions.set(stageId, stageSubmissions);

    const activePlayers = players.filter((p) => p.is_connected);
    // Each active player is expected to submit 2 titles (or total required submissions across matchups)
    let totalExpectedSubmissions = 0;
    stageMatchups.forEach((m) => {
      if (activePlayers.some((p) => p.id === m.player1_id)) totalExpectedSubmissions += 1;
      if (m.player1_id !== m.player2_id && activePlayers.some((p) => p.id === m.player2_id)) {
        totalExpectedSubmissions += 1;
      }
    });

    const allSubmitted = stageSubmissions.length >= totalExpectedSubmissions && totalExpectedSubmissions > 0;

    if (allSubmitted) {
      room.phase = 'VOTING';
      room.current_matchup_index = 0;
      room.updated_at = new Date().toISOString();

      const stages = memoryStore.stages.get(code) || [];
      const currentStage = stages.find((s) => s.id === stageId);
      if (currentStage) {
        currentStage.phase = 'VOTING';
        currentStage.current_matchup_index = 0;
      }

      emitRoomEvent(code, {
        type: 'room_phase_changed',
        payload: { phase: 'VOTING', current_stage_number: room.current_stage_number },
      });
    } else {
      emitRoomEvent(code, {
        type: 'submission_received',
        payload: {
          player_id: caller.id,
          total_submitted: stageSubmissions.length,
          total_required: totalExpectedSubmissions,
        },
      });
    }

    return {
      success: true,
      matchup_id: targetMatchup.id,
      total_submitted: stageSubmissions.length,
      total_required: totalExpectedSubmissions,
      phase: room.phase,
    };
  }

  /**
   * Casts a vote for a title in the active 1v1 matchup.
   * Strictly enforces self-vote prevention (authors of the matchup cannot vote on their own matchup).
   */
  static async submitVote(
    roomCode: string,
    sessionToken: string,
    stageId: string,
    submissionId: string,
    matchupId?: string
  ) {
    const code = roomCode.toUpperCase();
    const room = memoryStore.rooms.get(code);
    if (!room) {
      throw { status: 404, message: 'Room not found' };
    }

    if (room.phase !== 'VOTING') {
      throw { status: 409, message: 'Room is not in VOTING phase' };
    }

    const players = memoryStore.players.get(code) || [];
    const caller = players.find((p) => p.session_token === sessionToken);

    if (!caller) {
      throw { status: 401, message: 'Invalid session token' };
    }

    const stageMatchups = memoryStore.matchups.get(stageId) || [];
    const stageSubmissions = memoryStore.submissions.get(stageId) || [];
    const stageVotes = memoryStore.votes.get(stageId) || [];

    // Identify the active matchup
    let targetMatchup: StageMatchup | undefined;
    if (matchupId) {
      targetMatchup = stageMatchups.find((m) => m.id === matchupId);
    } else {
      targetMatchup = stageMatchups[room.current_matchup_index] || stageMatchups[0];
    }

    if (!targetMatchup) {
      throw { status: 400, message: 'Matchup not found' };
    }

    // Find the target submission
    const targetSubmission = stageSubmissions.find((s) => s.id === submissionId);
    if (!targetSubmission || targetSubmission.matchup_id !== targetMatchup.id) {
      throw { status: 400, message: 'Submission not found in this matchup' };
    }

    // Strict Anti-Self-Voting Rule (Principle VIII)
    if (
      targetSubmission.player_id === caller.id ||
      targetMatchup.player1_id === caller.id ||
      targetMatchup.player2_id === caller.id
    ) {
      throw { status: 400, message: 'SELF_VOTING_PROHIBITED: You cannot vote for your own title or matchup!' };
    }

    // Check if voter already voted in this matchup
    const existingVote = stageVotes.find(
      (v) => v.matchup_id === targetMatchup!.id && v.voter_player_id === caller.id
    );
    if (existingVote) {
      throw { status: 400, message: 'You have already voted in this matchup' };
    }

    const newVote: Vote = {
      id: randomUUID(),
      stage_id: stageId,
      matchup_id: targetMatchup.id,
      voter_player_id: caller.id,
      submission_id: submissionId,
      created_at: new Date().toISOString(),
    };

    stageVotes.push(newVote);
    memoryStore.votes.set(stageId, stageVotes);

    // Check eligible voters for this matchup
    const activePlayers = players.filter((p) => p.is_connected);
    const eligibleVoters = activePlayers.filter(
      (p) => p.id !== targetMatchup!.player1_id && p.id !== targetMatchup!.player2_id
    );

    const matchupVotes = stageVotes.filter((v) => v.matchup_id === targetMatchup!.id);
    const allVoted = matchupVotes.length >= eligibleVoters.length;

    let matchupResult: MatchupResult | null = null;

    if (allVoted) {
      targetMatchup.is_revealed = true;
      room.updated_at = new Date().toISOString();

      const { result, playerScoreDeltas } = calculateMatchupResult(
        targetMatchup,
        stageSubmissions,
        stageVotes,
        players
      );

      matchupResult = result;

      // Update player scores
      players.forEach((p) => {
        if (playerScoreDeltas[p.id]) {
          p.score += playerScoreDeltas[p.id];
        }
      });

      const existingScores = memoryStore.matchupScores.get(stageId) || [];
      const updatedScores = existingScores.filter((r) => r.matchup_id !== targetMatchup!.id);
      updatedScores.push(result);
      memoryStore.matchupScores.set(stageId, updatedScores);

      emitRoomEvent(code, {
        type: 'matchup_revealed',
        payload: { matchup_id: targetMatchup.id, result },
      });
    } else {
      emitRoomEvent(code, {
        type: 'vote_received',
        payload: {
          matchup_id: targetMatchup.id,
          total_voted: matchupVotes.length,
          total_required: eligibleVoters.length,
        },
      });
    }

    return {
      success: true,
      matchup_id: targetMatchup.id,
      total_voted: matchupVotes.length,
      total_required: eligibleVoters.length,
      is_revealed: targetMatchup.is_revealed,
      result: matchupResult,
      phase: room.phase,
    };
  }

  /**
   * Host advances to the next matchup, or transitions to RESULTS once all matchups in the stage are finished.
   */
  static async advanceMatchup(roomCode: string, sessionToken: string) {
    const code = roomCode.toUpperCase();
    const room = memoryStore.rooms.get(code);
    if (!room) {
      throw { status: 404, message: 'Room not found' };
    }

    if (room.phase !== 'VOTING') {
      throw { status: 409, message: 'Room is not in VOTING phase' };
    }

    const players = memoryStore.players.get(code) || [];
    const caller = players.find((p) => p.session_token === sessionToken);

    if (!caller || !caller.is_host) {
      throw { status: 403, message: 'Only the host can advance matchups' };
    }

    const stages = memoryStore.stages.get(code) || [];
    const currentStage = stages.find((s) => s.stage_number === room.current_stage_number);
    if (!currentStage) {
      throw { status: 404, message: 'Current stage not found' };
    }

    const stageMatchups = memoryStore.matchups.get(currentStage.id) || [];
    const activeMatchup = stageMatchups[room.current_matchup_index];

    // If current matchup has not been revealed yet, reveal it first
    if (activeMatchup && !activeMatchup.is_revealed) {
      activeMatchup.is_revealed = true;

      const stageSubmissions = memoryStore.submissions.get(currentStage.id) || [];
      const stageVotes = memoryStore.votes.get(currentStage.id) || [];

      const { result, playerScoreDeltas } = calculateMatchupResult(
        activeMatchup,
        stageSubmissions,
        stageVotes,
        players
      );

      // Update player scores
      players.forEach((p) => {
        if (playerScoreDeltas[p.id]) {
          p.score += playerScoreDeltas[p.id];
        }
      });

      const existingScores = memoryStore.matchupScores.get(currentStage.id) || [];
      const updatedScores = existingScores.filter((r) => r.matchup_id !== activeMatchup.id);
      updatedScores.push(result);
      memoryStore.matchupScores.set(currentStage.id, updatedScores);

      emitRoomEvent(code, {
        type: 'matchup_revealed',
        payload: { matchup_id: activeMatchup.id, result },
      });

      return {
        phase: 'VOTING' as GamePhase,
        current_matchup_index: room.current_matchup_index,
        total_matchups: stageMatchups.length,
        is_revealed: true,
        result,
      };
    }

    const nextMatchupIndex = room.current_matchup_index + 1;

    if (nextMatchupIndex < stageMatchups.length) {
      room.current_matchup_index = nextMatchupIndex;
      currentStage.current_matchup_index = nextMatchupIndex;
      room.updated_at = new Date().toISOString();

      emitRoomEvent(code, {
        type: 'matchup_advanced',
        payload: {
          current_matchup_index: nextMatchupIndex,
          total_matchups: stageMatchups.length,
        },
      });

      return {
        phase: 'VOTING' as GamePhase,
        current_matchup_index: nextMatchupIndex,
        total_matchups: stageMatchups.length,
      };
    } else {
      // All matchups in this stage are done -> Transition to RESULTS
      room.phase = 'RESULTS';
      room.updated_at = new Date().toISOString();
      currentStage.phase = 'RESULTS';
      currentStage.completed_at = new Date().toISOString();

      emitRoomEvent(code, {
        type: 'room_phase_changed',
        payload: { phase: 'RESULTS', current_stage_number: room.current_stage_number },
      });

      return {
        phase: 'RESULTS' as GamePhase,
        current_stage_number: room.current_stage_number,
      };
    }
  }

  /**
   * Handles timeout when round/stage timer elapses.
   * In SUBMITTING: Fills any missing prompt submissions with "" (blank) and transitions to VOTING.
   * In VOTING: If current matchup is not revealed yet, reveals the matchup results with existing votes.
   */
  static async handleTimeout(
    roomCode: string,
    sessionToken: string,
    expectedPhase?: GamePhase,
    matchupId?: string
  ) {
    const code = roomCode.toUpperCase();
    const room = memoryStore.rooms.get(code);
    if (!room) {
      throw { status: 404, message: 'Room not found' };
    }

    const players = memoryStore.players.get(code) || [];
    const caller = players.find((p) => p.session_token === sessionToken);
    if (!caller) {
      throw { status: 401, message: 'Invalid session token' };
    }

    if (expectedPhase && room.phase !== expectedPhase) {
      return { phase: room.phase, already_advanced: true };
    }

    const stages = memoryStore.stages.get(code) || [];
    const currentStage = stages.find((s) => s.stage_number === room.current_stage_number);
    if (!currentStage) {
      throw { status: 404, message: 'Current stage not found' };
    }

    if (room.phase === 'SUBMITTING') {
      const stageMatchups = memoryStore.matchups.get(currentStage.id) || [];
      const stageSubmissions = memoryStore.submissions.get(currentStage.id) || [];

      // Ensure every matchup has submissions from both assigned players.
      // Anyone who didn't submit receives a blank submission ("").
      for (const m of stageMatchups) {
        const sub1 = stageSubmissions.find(
          (s) => s.matchup_id === m.id && s.player_id === m.player1_id
        );
        if (!sub1) {
          stageSubmissions.push({
            id: randomUUID(),
            stage_id: currentStage.id,
            matchup_id: m.id,
            player_id: m.player1_id,
            title: '',
            created_at: new Date().toISOString(),
          });
        }

        if (m.player1_id !== m.player2_id) {
          const sub2 = stageSubmissions.find(
            (s) => s.matchup_id === m.id && s.player_id === m.player2_id
          );
          if (!sub2) {
            stageSubmissions.push({
              id: randomUUID(),
              stage_id: currentStage.id,
              matchup_id: m.id,
              player_id: m.player2_id,
              title: '',
              created_at: new Date().toISOString(),
            });
          }
        } else {
          // If 1-player testing mode
          const subs = stageSubmissions.filter((s) => s.matchup_id === m.id);
          if (subs.length < 2) {
            stageSubmissions.push({
              id: randomUUID(),
              stage_id: currentStage.id,
              matchup_id: m.id,
              player_id: m.player1_id,
              title: '',
              created_at: new Date().toISOString(),
            });
          }
        }
      }

      memoryStore.submissions.set(currentStage.id, stageSubmissions);

      // Stop SUBMITTING phase and start VOTING phase!
      room.phase = 'VOTING';
      room.current_matchup_index = 0;
      room.updated_at = new Date().toISOString();
      currentStage.phase = 'VOTING';
      currentStage.current_matchup_index = 0;

      emitRoomEvent(code, {
        type: 'room_phase_changed',
        payload: { phase: 'VOTING', current_stage_number: room.current_stage_number },
      });

      return {
        phase: 'VOTING' as GamePhase,
        current_stage_number: room.current_stage_number,
      };
    }

    if (room.phase === 'VOTING') {
      const stageMatchups = memoryStore.matchups.get(currentStage.id) || [];
      const activeMatchupIndex = room.current_matchup_index;
      const activeMatchup = stageMatchups[activeMatchupIndex];

      if (activeMatchup && !activeMatchup.is_revealed) {
        if (matchupId && activeMatchup.id !== matchupId) {
          return { phase: room.phase, already_advanced: true };
        }

        activeMatchup.is_revealed = true;
        room.updated_at = new Date().toISOString();
        const stageSubmissions = memoryStore.submissions.get(currentStage.id) || [];
        const stageVotes = memoryStore.votes.get(currentStage.id) || [];

        const { result, playerScoreDeltas } = calculateMatchupResult(
          activeMatchup,
          stageSubmissions,
          stageVotes,
          players
        );

        players.forEach((p) => {
          if (playerScoreDeltas[p.id]) {
            p.score += playerScoreDeltas[p.id];
          }
        });

        const existingScores = memoryStore.matchupScores.get(currentStage.id) || [];
        const updatedScores = existingScores.filter((r) => r.matchup_id !== activeMatchup.id);
        updatedScores.push(result);
        memoryStore.matchupScores.set(currentStage.id, updatedScores);

        emitRoomEvent(code, {
          type: 'matchup_revealed',
          payload: { matchup_id: activeMatchup.id, result },
        });

        return {
          phase: 'VOTING' as GamePhase,
          current_matchup_index: activeMatchupIndex,
          total_matchups: stageMatchups.length,
          is_revealed: true,
          result,
        };
      }
    }

    return { phase: room.phase };
  }

  /**
   * Advances from RESULTS to Stage 2 SUBMITTING or to FINISHED (Final Leaderboard).
   */
  static async advanceStage(roomCode: string, sessionToken: string) {
    const code = roomCode.toUpperCase();
    const room = memoryStore.rooms.get(code);
    if (!room) {
      throw { status: 404, message: 'Room not found' };
    }

    if (room.phase !== 'RESULTS') {
      throw { status: 409, message: 'Room is not in RESULTS phase' };
    }

    const players = memoryStore.players.get(code) || [];
    const caller = players.find((p) => p.session_token === sessionToken);

    if (!caller || !caller.is_host) {
      throw { status: 403, message: 'Only the host can advance stages' };
    }

    if (room.current_stage_number < TOTAL_STAGES) {
      const nextStageNumber = room.current_stage_number + 1;
      const stageId = randomUUID();

      const activePlayers = players.filter((p) => p.is_connected);
      const selectedPics = selectPicturesForStage(nextStageNumber, activePlayers.length);
      const stageMatchups = generateStageMatchups(stageId, activePlayers, selectedPics);

      const stage2: Stage = {
        id: stageId,
        game_id: randomUUID(),
        room_id: room.id,
        stage_number: nextStageNumber,
        picture_id: selectedPics[0]?.id,
        phase: 'SUBMITTING',
        current_matchup_index: 0,
        started_at: new Date().toISOString(),
        completed_at: null,
      };

      const stages = memoryStore.stages.get(code) || [];
      stages.push(stage2);
      memoryStore.stages.set(code, stages);

      memoryStore.matchups.set(stageId, stageMatchups);
      memoryStore.submissions.set(stageId, []);
      memoryStore.votes.set(stageId, []);
      memoryStore.matchupScores.set(stageId, []);

      room.current_stage_number = nextStageNumber;
      room.current_matchup_index = 0;
      room.phase = 'SUBMITTING';
      room.updated_at = new Date().toISOString();

      emitRoomEvent(code, {
        type: 'room_phase_changed',
        payload: { phase: room.phase, current_stage_number: nextStageNumber },
      });

      return {
        phase: room.phase,
        stage_number: nextStageNumber,
        stage_id: stageId,
        total_matchups: stageMatchups.length,
      };
    } else {
      room.phase = 'FINISHED';
      room.updated_at = new Date().toISOString();

      const leaderboard = computeLeaderboard(players);

      emitRoomEvent(code, {
        type: 'game_finished',
        payload: { final_leaderboard: leaderboard },
      });

      return {
        phase: 'FINISHED' as GamePhase,
        final_leaderboard: leaderboard,
      };
    }
  }

  /**
   * Resets game back to LOBBY for a rematch with the same players.
   */
  static async resetGame(roomCode: string, sessionToken: string) {
    const code = roomCode.toUpperCase();
    const room = memoryStore.rooms.get(code);
    if (!room) {
      throw { status: 404, message: 'Room not found' };
    }

    const players = memoryStore.players.get(code) || [];
    const caller = players.find((p) => p.session_token === sessionToken);

    if (!caller || !caller.is_host) {
      throw { status: 403, message: 'Only the host can reset the game' };
    }

    players.forEach((p) => {
      p.score = 0;
    });

    room.phase = 'LOBBY';
    room.current_stage_number = 1;
    room.current_matchup_index = 0;
    room.updated_at = new Date().toISOString();

    memoryStore.stages.set(code, []);
    memoryStore.matchups.clear();
    memoryStore.submissions.clear();
    memoryStore.votes.clear();
    memoryStore.matchupScores.clear();
    memoryStore.stageScores.clear();

    emitRoomEvent(code, {
      type: 'room_phase_changed',
      payload: { phase: 'LOBBY', current_stage_number: 1 },
    });

    return {
      phase: 'LOBBY' as GamePhase,
      current_stage_number: 1,
    };
  }

  /**
   * Handles player leaving and host reassignment.
   */
  static async leaveRoom(roomCode: string, sessionToken: string) {
    const code = roomCode.toUpperCase();
    const room = memoryStore.rooms.get(code);
    if (!room) {
      throw { status: 404, message: 'Room not found' };
    }

    let players = memoryStore.players.get(code) || [];
    const leavingPlayer = players.find((p) => p.session_token === sessionToken);

    if (!leavingPlayer) {
      return { success: true };
    }

    players = players.filter((p) => p.id !== leavingPlayer.id);
    memoryStore.players.set(code, players);

    if (leavingPlayer.is_host && players.length > 0) {
      players[0].is_host = true;
      room.host_player_id = players[0].id;
    }

    emitRoomEvent(code, {
      type: 'player_left',
      payload: { player_id: leavingPlayer.id, new_host_id: room.host_player_id },
    });

    return {
      success: true,
      remaining_players: players.length,
      new_host_id: room.host_player_id,
    };
  }

  /**
   * Retrieves full authoritative room state for a player (hydration/reconnect).
   */
  static async getRoomState(roomCode: string, sessionToken: string): Promise<RoomState> {
    const code = roomCode.toUpperCase();
    const room = memoryStore.rooms.get(code);
    if (!room) {
      throw { status: 404, message: 'Room not found' };
    }

    const players = memoryStore.players.get(code) || [];
    const me = players.find((p) => p.session_token === sessionToken);

    if (!me) {
      throw { status: 401, message: 'Invalid session token for this room' };
    }

    const stages = memoryStore.stages.get(code) || [];
    const currentStage = stages.find((s) => s.stage_number === room.current_stage_number);
    const stageId = currentStage?.id || '';

    const stageMatchups = currentStage ? memoryStore.matchups.get(stageId) || [] : [];
    const stageSubmissions = currentStage ? memoryStore.submissions.get(stageId) || [] : [];
    const stageVotes = currentStage ? memoryStore.votes.get(stageId) || [] : [];
    const stageMatchupScores = currentStage ? memoryStore.matchupScores.get(stageId) || [] : [];

    // Assigned prompts for current player (Step 1 and Step 2)
    const myAssignedMatchups = stageMatchups.filter(
      (m) => m.player1_id === me.id || m.player2_id === me.id
    );

    const myPrompts: PlayerPromptInfo[] = myAssignedMatchups.map((m, index) => {
      const sub = stageSubmissions.find((s) => s.matchup_id === m.id && s.player_id === me.id);
      return {
        matchup_id: m.id,
        prompt_index: index + 1,
        picture_id: m.picture.id,
        picture_url: m.picture.image_url,
        picture_description: m.picture.description,
        task_prompt: 'Give this tattoo your funniest title.',
        has_submitted: !!sub,
        submitted_title: sub?.title,
      };
    });

    const submittedCount = myPrompts.filter((p) => p.has_submitted).length;
    const hasSubmittedAll = myPrompts.length > 0 && submittedCount >= myPrompts.length;

    // Current active matchup for VOTING phase
    let currentMatchupInfo: CurrentMatchupInfo | null = null;
    let votingOptions: VotingOption[] = [];
    let activeMatchup: StageMatchup | undefined;

    if (currentStage && stageMatchups.length > 0) {
      const activeMatchupIndex = Math.min(room.current_matchup_index, stageMatchups.length - 1);
      activeMatchup = stageMatchups[activeMatchupIndex];

      if (activeMatchup) {
        const isAuthor = activeMatchup.player1_id === me.id || activeMatchup.player2_id === me.id;
        const matchupSubs = stageSubmissions.filter((s) => s.matchup_id === activeMatchup!.id);
        const matchupVotes = stageVotes.filter((v) => v.matchup_id === activeMatchup!.id);
        const myVote = matchupVotes.find((v) => v.voter_player_id === me.id);

        const activePlayers = players.filter((p) => p.is_connected);
        const eligibleVoters = activePlayers.filter(
          (p) => p.id !== activeMatchup!.player1_id && p.id !== activeMatchup!.player2_id
        );

        // Provide voting options to all players including authors so titles are visible to everyone
        votingOptions = matchupSubs.map((s) => ({
          submission_id: s.id,
          title: s.title,
          is_mine: s.player_id === me.id,
        }));

        const currentMatchupId = activeMatchup.id;
        const matchupResult = stageMatchupScores.find((r) => r.matchup_id === currentMatchupId) || null;

        currentMatchupInfo = {
          matchup_id: activeMatchup.id,
          order_index: activeMatchup.order_index,
          total_matchups: stageMatchups.length,
          picture_url: activeMatchup.picture.image_url,
          picture_description: activeMatchup.picture.description,
          task_prompt: 'Give this tattoo your funniest title.',
          is_author: isAuthor,
          is_revealed: activeMatchup.is_revealed,
          voting_options: votingOptions,
          has_voted: !!myVote,
          my_vote_submission_id: myVote?.submission_id,
          total_voted: matchupVotes.length,
          total_eligible_voters: eligibleVoters.length,
          result: matchupResult,
        };
      }
    }

    // Flattened stage results for summary
    const stageResults: StageResultItem[] = [];
    stageMatchupScores.forEach((mScore) => {
      mScore.options.forEach((opt) => {
        stageResults.push({
          submission_id: opt.submission_id,
          title: opt.title,
          author_nickname: opt.author_nickname,
          votes_received: opt.votes_received,
          is_winner: opt.is_winner,
          points_awarded: opt.points_awarded,
        });
      });
    });
    stageResults.sort((a, b) => b.votes_received - a.votes_received);

    const finalLeaderboard = computeLeaderboard(players);

    return {
      room_id: room.id,
      room_code: room.room_code,
      phase: room.phase,
      current_stage_number: room.current_stage_number,
      current_matchup_index: room.current_matchup_index,
      total_matchups: stageMatchups.length,
      host_player_id: room.host_player_id,
      players: players.map((p) => {
        const pAssigned = stageMatchups.filter(
          (m) => m.player1_id === p.id || m.player2_id === p.id
        );
        const pSubs = stageSubmissions.filter((s) => s.player_id === p.id);
        const pHasSubmitted = pAssigned.length > 0 ? pSubs.length >= pAssigned.length : false;
        const pHasVoted = currentMatchupInfo
          ? stageVotes.some(
              (v) => v.matchup_id === currentMatchupInfo.matchup_id && v.voter_player_id === p.id
            )
          : false;
        const pIsAuthor = activeMatchup
          ? activeMatchup.player1_id === p.id || activeMatchup.player2_id === p.id
          : false;

        return {
          id: p.id,
          nickname: p.nickname,
          is_host: p.is_host,
          score: p.score,
          is_connected: p.is_connected,
          has_submitted: pHasSubmitted,
          has_voted: pHasVoted,
          is_author_in_matchup: pIsAuthor,
        };
      }),
      me: {
        id: me.id,
        nickname: me.nickname,
        is_host: me.is_host,
        score: me.score,
        has_submitted_all: hasSubmittedAll,
        submitted_count: submittedCount,
        total_prompts_required: myPrompts.length || 2,
        has_submitted: hasSubmittedAll,
        has_voted: currentMatchupInfo ? currentMatchupInfo.has_voted : false,
      },
      my_prompts: myPrompts,
      current_stage: currentStage
        ? {
            stage_id: currentStage.id,
            stage_number: currentStage.stage_number,
            picture_url: currentMatchupInfo?.picture_url || myPrompts[0]?.picture_url || CURATED_PICTURES[0].image_url,
            picture_description: currentMatchupInfo?.picture_description || myPrompts[0]?.picture_description || null,
            task_prompt: 'Give this tattoo your funniest title.',
          }
        : null,
      current_matchup: currentMatchupInfo,
      voting_options: votingOptions,
      stage_matchup_results: stageMatchupScores,
      stage_results: stageResults,
      final_leaderboard: finalLeaderboard,
      phase_started_at: room.updated_at,
      server_time: new Date().toISOString(),
    };
  }

  /**
   * Admin: Force start the game under any conditions.
   */
  static async forceStartGame(roomCode: string, password: string) {
    if (password !== 'Passw0rd_is_zer0') {
      throw { status: 401, message: 'Invalid admin password' };
    }

    const code = roomCode.toUpperCase();
    const room = memoryStore.rooms.get(code);
    if (!room) {
      throw { status: 404, message: 'Room not found' };
    }

    const players = memoryStore.players.get(code) || [];
    const stageId = randomUUID();
    const activePlayers = players.length > 0 ? players : [
      {
        id: randomUUID(),
        room_id: room.id,
        nickname: 'AdminHost',
        session_token: randomUUID(),
        is_host: true,
        score: 0,
        is_connected: true,
        joined_at: new Date().toISOString(),
      },
    ];

    const selectedPics = selectPicturesForStage(1, Math.max(activePlayers.length, 2));
    const stageMatchups = generateStageMatchups(stageId, activePlayers, selectedPics);

    const stage1: Stage = {
      id: stageId,
      game_id: randomUUID(),
      room_id: room.id,
      stage_number: 1,
      picture_id: selectedPics[0]?.id,
      phase: 'SUBMITTING',
      current_matchup_index: 0,
      started_at: new Date().toISOString(),
      completed_at: null,
    };

    room.phase = 'SUBMITTING';
    room.current_stage_number = 1;
    room.current_matchup_index = 0;
    room.updated_at = new Date().toISOString();

    memoryStore.stages.set(code, [stage1]);
    memoryStore.matchups.set(stageId, stageMatchups);
    memoryStore.submissions.set(stageId, []);
    memoryStore.votes.set(stageId, []);
    memoryStore.matchupScores.set(stageId, []);

    emitRoomEvent(code, {
      type: 'room_phase_changed',
      payload: { phase: room.phase, current_stage_number: 1 },
    });

    return {
      phase: room.phase,
      stage_number: 1,
      stage_id: stageId,
      total_matchups: stageMatchups.length,
      picture_url: selectedPics[0]?.image_url,
      picture_description: selectedPics[0]?.description,
    };
  }

  /**
   * Admin: Restart lobby to a clean slate.
   */
  static async forceResetLobby(roomCode: string, password: string) {
    if (password !== 'Passw0rd_is_zer0') {
      throw { status: 401, message: 'Invalid admin password' };
    }

    const code = roomCode.toUpperCase();
    const room = memoryStore.rooms.get(code);
    if (!room) {
      throw { status: 404, message: 'Room not found' };
    }

    const players = memoryStore.players.get(code) || [];
    players.forEach((p) => {
      p.score = 0;
    });

    room.phase = 'LOBBY';
    room.current_stage_number = 1;
    room.current_matchup_index = 0;
    room.updated_at = new Date().toISOString();

    memoryStore.stages.set(code, []);
    memoryStore.matchups.clear();
    memoryStore.submissions.clear();
    memoryStore.votes.clear();
    memoryStore.matchupScores.clear();
    memoryStore.stageScores.clear();

    emitRoomEvent(code, {
      type: 'room_phase_changed',
      payload: { phase: 'LOBBY', current_stage_number: 1 },
    });

    return {
      phase: 'LOBBY' as GamePhase,
      current_stage_number: 1,
    };
  }

  /**
   * Admin: Force advance room to the next state or phase.
   */
  static async forceAdvance(roomCode: string, password: string) {
    if (password !== 'Passw0rd_is_zer0') {
      throw { status: 401, message: 'Invalid admin password' };
    }

    const code = roomCode.toUpperCase();
    const room = memoryStore.rooms.get(code);
    if (!room) {
      throw { status: 404, message: 'Room not found' };
    }

    const stages = memoryStore.stages.get(code) || [];
    const currentStage = stages.find((s) => s.stage_number === room.current_stage_number);
    const stageMatchups = currentStage ? memoryStore.matchups.get(currentStage.id) || [] : [];

    if (room.phase === 'LOBBY') {
      return await this.forceStartGame(code, password);
    } else if (room.phase === 'SUBMITTING') {
      if (currentStage) {
        const stageSubmissions = memoryStore.submissions.get(currentStage.id) || [];
        for (const m of stageMatchups) {
          const sub1 = stageSubmissions.find(
            (s) => s.matchup_id === m.id && s.player_id === m.player1_id
          );
          if (!sub1) {
            stageSubmissions.push({
              id: randomUUID(),
              stage_id: currentStage.id,
              matchup_id: m.id,
              player_id: m.player1_id,
              title: '',
              created_at: new Date().toISOString(),
            });
          }
          if (m.player1_id !== m.player2_id) {
            const sub2 = stageSubmissions.find(
              (s) => s.matchup_id === m.id && s.player_id === m.player2_id
            );
            if (!sub2) {
              stageSubmissions.push({
                id: randomUUID(),
                stage_id: currentStage.id,
                matchup_id: m.id,
                player_id: m.player2_id,
                title: '',
                created_at: new Date().toISOString(),
              });
            }
          }
        }
        memoryStore.submissions.set(currentStage.id, stageSubmissions);
      }
      room.phase = 'VOTING';
      room.current_matchup_index = 0;
      if (currentStage) {
        currentStage.phase = 'VOTING';
        currentStage.current_matchup_index = 0;
      }
      room.updated_at = new Date().toISOString();
      emitRoomEvent(code, {
        type: 'room_phase_changed',
        payload: { phase: 'VOTING', current_stage_number: room.current_stage_number },
      });
      return { phase: 'VOTING' as GamePhase, current_stage_number: room.current_stage_number };
    } else if (room.phase === 'VOTING') {
      const activeMatchupIndex = room.current_matchup_index;
      const activeMatchup = stageMatchups[activeMatchupIndex];
      if (activeMatchup && !activeMatchup.is_revealed) {
        activeMatchup.is_revealed = true;
        emitRoomEvent(code, {
          type: 'room_phase_changed',
          payload: { phase: 'VOTING', current_stage_number: room.current_stage_number },
        });
        return { phase: 'VOTING' as GamePhase, current_stage_number: room.current_stage_number, is_revealed: true };
      } else if (activeMatchupIndex + 1 < stageMatchups.length) {
        room.current_matchup_index = activeMatchupIndex + 1;
        room.updated_at = new Date().toISOString();
        emitRoomEvent(code, {
          type: 'matchup_advanced',
          payload: { current_matchup_index: room.current_matchup_index, total_matchups: stageMatchups.length },
        });
        return { phase: 'VOTING' as GamePhase, current_matchup_index: room.current_matchup_index };
      } else {
        room.phase = 'RESULTS';
        room.updated_at = new Date().toISOString();
        if (currentStage) {
          currentStage.phase = 'RESULTS';
          currentStage.completed_at = new Date().toISOString();
        }
        emitRoomEvent(code, {
          type: 'room_phase_changed',
          payload: { phase: 'RESULTS', current_stage_number: room.current_stage_number },
        });
        return { phase: 'RESULTS' as GamePhase, current_stage_number: room.current_stage_number };
      }
    } else if (room.phase === 'RESULTS') {
      const players = memoryStore.players.get(code) || [];
      const host = players.find((p) => p.is_host) || players[0];
      if (host) {
        return await this.advanceStage(code, host.session_token);
      }
      room.phase = 'FINISHED';
      room.updated_at = new Date().toISOString();
      emitRoomEvent(code, {
        type: 'room_phase_changed',
        payload: { phase: 'FINISHED', current_stage_number: room.current_stage_number },
      });
      return { phase: 'FINISHED' as GamePhase };
    } else {
      return await this.forceResetLobby(code, password);
    }
  }

  /**
   * Admin: Force advance room to a specific phase.
   */
  static async forceAdvancePhase(roomCode: string, targetPhase: GamePhase, password: string) {
    if (password !== 'Passw0rd_is_zer0') {
      throw { status: 401, message: 'Invalid admin password' };
    }

    const code = roomCode.toUpperCase();
    const room = memoryStore.rooms.get(code);
    if (!room) {
      throw { status: 404, message: 'Room not found' };
    }

    room.phase = targetPhase;
    room.updated_at = new Date().toISOString();

    emitRoomEvent(code, {
      type: 'room_phase_changed',
      payload: { phase: room.phase, current_stage_number: room.current_stage_number },
    });

    return {
      phase: room.phase,
      current_stage_number: room.current_stage_number,
    };
  }
}

