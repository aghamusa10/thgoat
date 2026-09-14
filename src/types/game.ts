export type GamePhase = 'LOBBY' | 'SUBMITTING' | 'VOTING' | 'RESULTS' | 'FINISHED';
export type StagePhase = 'SUBMITTING' | 'VOTING' | 'RESULTS';
export type GameStatus = 'IN_PROGRESS' | 'COMPLETED';

export interface Picture {
  id: string;
  image_url: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Room {
  id: string;
  room_code: string;
  host_player_id: string | null;
  phase: GamePhase;
  current_stage_number: number;
  current_matchup_index: number;
  created_at: string;
  updated_at: string;
}

export interface Player {
  id: string;
  room_id: string;
  nickname: string;
  session_token: string;
  is_host: boolean;
  score: number;
  is_connected: boolean;
  joined_at: string;
}

export interface GameSession {
  id: string;
  room_id: string;
  total_stages: number;
  status: GameStatus;
  created_at: string;
  completed_at: string | null;
}

export interface StageMatchup {
  id: string;
  stage_id: string;
  order_index: number;
  picture_id: string;
  picture: Picture;
  player1_id: string;
  player2_id: string;
  is_revealed: boolean;
  created_at: string;
}

export interface Stage {
  id: string;
  game_id: string;
  room_id: string;
  stage_number: number;
  picture_id?: string;
  phase: StagePhase;
  current_matchup_index: number;
  started_at: string;
  completed_at: string | null;
}

export interface Submission {
  id: string;
  stage_id: string;
  matchup_id: string;
  player_id: string;
  title: string;
  created_at: string;
}

export interface Vote {
  id: string;
  stage_id: string;
  matchup_id: string;
  voter_player_id: string;
  submission_id: string;
  created_at: string;
}

export interface StageScore {
  id: string;
  stage_id: string;
  player_id: string;
  submission_id: string;
  votes_received: number;
  is_winner: boolean;
  points_awarded: number;
  created_at: string;
}

export interface PlayerSummary {
  id: string;
  nickname: string;
  is_host: boolean;
  score: number;
  is_connected: boolean;
  has_submitted?: boolean;
  has_voted?: boolean;
  is_author_in_matchup?: boolean;
}

export interface CurrentPlayer {
  id: string;
  nickname: string;
  is_host: boolean;
  score: number;
  has_submitted_all: boolean;
  submitted_count: number;
  total_prompts_required: number;
  has_submitted: boolean;
  has_voted: boolean;
}

export interface ActiveStageInfo {
  stage_id: string;
  stage_number: number;
  picture_url: string;
  picture_description: string | null;
  task_prompt: string;
}

export interface PlayerPromptInfo {
  matchup_id: string;
  prompt_index: number; // 1 or 2
  picture_id: string;
  picture_url: string;
  picture_description: string | null;
  task_prompt: string;
  has_submitted: boolean;
  submitted_title?: string;
}

export interface VotingOption {
  submission_id: string;
  title: string;
  is_mine?: boolean;
}

export interface MatchupResultOption {
  submission_id: string;
  title: string;
  author_id: string;
  author_nickname: string;
  votes_received: number;
  is_winner: boolean;
  points_awarded: number;
}

export interface MatchupResult {
  matchup_id: string;
  order_index: number;
  picture_url: string;
  picture_description: string | null;
  options: MatchupResultOption[];
  is_tie: boolean;
  is_sweep: boolean;
  total_votes: number;
}

export interface CurrentMatchupInfo {
  matchup_id: string;
  order_index: number;
  total_matchups: number;
  picture_url: string;
  picture_description: string | null;
  task_prompt: string;
  is_author: boolean;
  is_revealed: boolean;
  voting_options: VotingOption[];
  has_voted: boolean;
  my_vote_submission_id?: string;
  total_voted: number;
  total_eligible_voters: number;
  result?: MatchupResult | null;
}

export interface StageResultItem {
  submission_id: string;
  title: string;
  author_nickname: string;
  votes_received: number;
  is_winner: boolean;
  points_awarded: number;
}

export interface LeaderboardEntry {
  rank: number;
  player_id: string;
  nickname: string;
  total_score: number;
  is_champion: boolean;
}

export interface RoomState {
  room_id: string;
  room_code: string;
  phase: GamePhase;
  current_stage_number: number;
  current_matchup_index: number;
  total_matchups: number;
  host_player_id: string | null;
  players: PlayerSummary[];
  me: CurrentPlayer | null;
  my_prompts: PlayerPromptInfo[];
  current_stage: ActiveStageInfo | null;
  current_matchup: CurrentMatchupInfo | null;
  voting_options: VotingOption[];
  stage_matchup_results: MatchupResult[];
  stage_results: StageResultItem[];
  final_leaderboard: LeaderboardEntry[];
  phase_started_at?: string;
  server_time?: string;
}

export type RealtimeEventPayload =
  | { type: 'room_phase_changed'; payload: { phase: GamePhase; current_stage_number: number; current_matchup_index?: number } }
  | { type: 'player_joined'; payload: PlayerSummary }
  | { type: 'player_left'; payload: { player_id: string; new_host_id: string | null } }
  | { type: 'submission_received'; payload: { player_id: string; total_submitted: number; total_required: number } }
  | { type: 'matchup_advanced'; payload: { current_matchup_index: number; total_matchups: number } }
  | { type: 'vote_received'; payload: { matchup_id: string; total_voted: number; total_required: number } }
  | { type: 'matchup_revealed'; payload: { matchup_id: string; result: MatchupResult } }
  | { type: 'results_revealed'; payload: { stage_matchup_results: MatchupResult[]; updated_scores: { player_id: string; score: number }[] } }
  | { type: 'game_finished'; payload: { final_leaderboard: LeaderboardEntry[] } };
