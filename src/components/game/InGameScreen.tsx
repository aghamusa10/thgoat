'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { GamePhase, PlayerSummary, CurrentPlayer, CurrentMatchupInfo } from '@/types/game';
import { GameMascot, getMascotForPlayer } from './GameMascot';
import { Check, X, Shield, Crown, Sparkles, Users } from 'lucide-react';

interface GameTimerContextType {
  timeLeft: number;
  isTimeUp: boolean;
}

export const GameTimerContext = React.createContext<GameTimerContextType>({
  timeLeft: 53,
  isTimeUp: false,
});

export const useGameTimer = () => React.useContext(GameTimerContext);

interface InGameScreenProps {
  roomCode: string;
  phase: GamePhase;
  currentStageNumber: number;
  players: PlayerSummary[];
  me: CurrentPlayer | null;
  isHost: boolean;
  currentMatchup?: CurrentMatchupInfo | null;
  phaseStartedAt?: string;
  onTimeout?: () => void;
  onOpenAdmin?: () => void;
  children: React.ReactNode;
}

export function InGameScreen({
  roomCode,
  phase,
  currentStageNumber,
  players,
  me,
  isHost,
  currentMatchup,
  phaseStartedAt,
  onTimeout,
  onOpenAdmin,
  children,
}: InGameScreenProps) {
  const ROUND_DURATION_SUBMITTING = 53;
  const ROUND_DURATION_VOTING = 30;

  const getTargetDuration = () => {
    if (phase === 'SUBMITTING') return ROUND_DURATION_SUBMITTING;
    if (phase === 'VOTING' && !currentMatchup?.is_revealed) return ROUND_DURATION_VOTING;
    return 0;
  };

  const getInitialTimeLeft = () => {
    const duration = getTargetDuration();
    if (!phaseStartedAt || duration === 0) return duration;
    const elapsed = Math.floor((Date.now() - new Date(phaseStartedAt).getTime()) / 1000);
    return Math.max(0, duration - Math.max(0, elapsed));
  };

  // Timer countdown state
  const [timeLeft, setTimeLeft] = useState<number>(() => getInitialTimeLeft());
  const [isRoomInfoOpen, setIsRoomInfoOpen] = useState(false);
  const [mobileRosterOpen, setMobileRosterOpen] = useState(false);
  const hasTimedOutRef = React.useRef(false);

  // Select round image based on current stage number (defaulting to round1 for 1, round2 for 2, round3 for 3)
  const roundImgSrc =
    currentStageNumber === 2
      ? '/round2.png'
      : currentStageNumber >= 3
      ? '/round3.png'
      : '/round1.png';

  // Sync / reset timer on matchup, phase, stage or phaseStartedAt change
  useEffect(() => {
    hasTimedOutRef.current = false;
    const initial = getInitialTimeLeft();
    setTimeLeft(initial);
  }, [currentMatchup?.matchup_id, phase, currentStageNumber, phaseStartedAt]);

  // Tick down timer every second
  useEffect(() => {
    if (currentMatchup?.is_revealed || phase === 'RESULTS' || phase === 'FINISHED') {
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [currentMatchup?.is_revealed, phase]);

  // Fire onTimeout callback when timeLeft reaches 0
  useEffect(() => {
    if (timeLeft === 0 && !hasTimedOutRef.current) {
      if (phase === 'SUBMITTING' || (phase === 'VOTING' && !currentMatchup?.is_revealed)) {
        hasTimedOutRef.current = true;
        onTimeout?.();
      }
    }
  }, [timeLeft, phase, currentMatchup?.is_revealed, onTimeout]);

  // Check if a player has completed their action in current phase
  const isPlayerActionDone = (player: PlayerSummary) => {
    if (phase === 'VOTING') {
      if (player.is_author_in_matchup) return true; // Author is spectating
      return !!player.has_voted;
    }
    if (phase === 'SUBMITTING') {
      return !!player.has_submitted;
    }
    return true;
  };

  return (
    <div className="relative w-full min-h-screen overflow-x-hidden bg-[#160624] text-white flex flex-col justify-between selection:bg-rose-500 selection:text-white">
      {/* Atmosphere Vignette Gradient */}
      <div className="fixed inset-0 pointer-events-none z-0 bg-[radial-gradient(circle_at_50%_45%,_rgba(65,16,84,0.45)_0%,_rgba(27,8,38,0.85)_60%,_rgba(10,2,15,0.98)_100%)]" />

      {/* Decorative ambient background lighting */}
      <div className="fixed top-[-15%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-purple-900/20 blur-[130px] pointer-events-none" />
      <div className="fixed bottom-[-15%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-rose-900/20 blur-[130px] pointer-events-none" />

      {/* ========================================================================= */}
      {/* 1. LEFT SIDE: TOP-LEFT ROUND & TIMER + USERNAMES LIST (TOP TO BOTTOM)     */}
      {/* ========================================================================= */}
      {/* Desktop Column: lg and up */}
      <aside className="hidden lg:flex flex-col items-start absolute top-4 left-4 xl:left-6 z-30 pointer-events-auto select-none w-56 xl:w-64 space-y-3">
        {/* Top-Left: Round Display (Image Asset) */}
        <div className="relative w-36 sm:w-44 md:w-48 h-12 sm:h-14 -rotate-2 transition-transform hover:scale-105 duration-300 drop-shadow-[0_8px_16px_rgba(0,0,0,0.7)]">
          <Image
            src={roundImgSrc}
            alt={`Round #${currentStageNumber}`}
            fill
            className="object-contain"
            priority
          />
        </div>

        {/* Jackbox-style Dark Blob Timer Badge */}
        <div className="relative group">
          <div className="px-5 py-1.5 rounded-[22px] bg-[#0c142b]/95 border-2 border-[#1e294b] shadow-[0_10px_25px_rgba(0,0,0,0.8)] flex items-center justify-center space-x-2 backdrop-blur-md transition-all group-hover:border-amber-400/60">
            <span
              className={`text-2xl sm:text-3xl font-black font-mono tracking-wider transition-colors ${
                timeLeft <= 10 ? 'text-rose-500 animate-pulse' : 'text-[#f59e0b]'
              }`}
            >
              {timeLeft}
            </span>
            <span className="text-[10px] uppercase font-mono font-bold text-slate-400">SEC</span>
          </div>
          {/* Subtle timer glow */}
          <div
            className={`absolute -inset-1 rounded-[24px] blur-md -z-10 transition-opacity ${
              timeLeft <= 10 ? 'bg-rose-500/40 opacity-100' : 'bg-amber-500/20 opacity-0 group-hover:opacity-100'
            }`}
          />
        </div>

        {/* Usernames List: displayed in the left side from up to down */}
        <div className="w-full pt-1">
          <div className="text-[11px] font-mono font-black text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between px-1">
            <span className="flex items-center space-x-1.5">
              <Users className="w-3.5 h-3.5 text-emerald-400" />
              <span>Players</span>
            </span>
            <span className="text-emerald-400 font-bold">
              {players.filter((p) => isPlayerActionDone(p)).length}/{players.length}
            </span>
          </div>

          {/* Vertical list of usernames from up to down */}
          <div className="flex flex-col space-y-2 w-full max-h-[calc(100vh-270px)] overflow-y-auto pr-1">
            {players.map((player, idx) => {
              const isDone = isPlayerActionDone(player);
              const isMe =
                (me?.id && player.id && me.id === player.id) ||
                (me?.nickname && player.nickname && me.nickname === player.nickname);
              const mascot = getMascotForPlayer(player.id || player.nickname);

              return (
                <div
                  key={player.id || idx}
                  className={`relative flex items-center justify-between px-3 py-2 rounded-2xl transition-all duration-300 shadow-md ${
                    isMe
                      ? 'bg-[#1e1438]/95 border border-purple-500/60 shadow-purple-900/30'
                      : 'bg-[#120b24]/90 border border-slate-800/80 hover:border-slate-700'
                  } hover:scale-[1.02]`}
                >
                  {/* Left: Mascot Avatar */}
                  <div className="w-7 h-7 rounded-full bg-slate-950/60 p-0.5 border border-slate-800 shrink-0 flex items-center justify-center mr-2">
                    <GameMascot type={mascot} className="w-6 h-6" />
                  </div>

                  {/* Middle: Nickname & Host Indicator & (you) badge */}
                  <div className="flex-1 min-w-0 mr-2 flex flex-col justify-center">
                    <div className="flex items-center space-x-1 truncate">
                      <span
                        className={`font-comic font-bold text-xs sm:text-sm tracking-wide truncate ${
                          isDone ? 'text-slate-100' : 'text-slate-400'
                        }`}
                      >
                        {player.nickname}
                      </span>
                      {player.is_host && <span title="Host" className="shrink-0">👑</span>}
                      {isMe && (
                        <span className="text-[10px] font-bold text-purple-300 shrink-0">
                          (you)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: Status Icon */}
                  <div className="shrink-0">
                    {isDone ? (
                      <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center">
                        <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                      </div>
                    ) : (
                      <div className="flex items-center space-x-0.5 text-amber-400 font-black text-xs tracking-tighter animate-pulse px-1">
                        <span>•</span>
                        <span>•</span>
                        <span>•</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Mobile/Tablet Top-Left Header (< lg) */}
      <div className="lg:hidden absolute top-2.5 left-2.5 z-30 flex items-center space-x-2 pointer-events-auto select-none">
        <div className="relative w-24 h-9 -rotate-2">
          <Image
            src={roundImgSrc}
            alt={`Round #${currentStageNumber}`}
            fill
            className="object-contain"
            priority
          />
        </div>
        <div className="px-2.5 py-1 rounded-xl bg-[#0c142b]/95 border border-[#1e294b] flex items-center space-x-1 font-mono text-sm font-black text-[#f59e0b]">
          <span>{timeLeft}s</span>
        </div>
      </div>

      {/* Mobile/Tablet Player Drawer Toggle Button */}
      <div className="lg:hidden absolute top-2.5 right-2.5 z-30 pointer-events-auto">
        <button
          type="button"
          onClick={() => setMobileRosterOpen(!mobileRosterOpen)}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-slate-900/85 border border-slate-700 text-xs font-bold text-slate-300 shadow-lg backdrop-blur-md"
        >
          <Users className="w-3.5 h-3.5 text-emerald-400" />
          <span>{players.filter((p) => isPlayerActionDone(p)).length}/{players.length}</span>
        </button>

        {/* Mobile Dropdown Roster */}
        {mobileRosterOpen && (
          <div className="absolute right-0 top-11 w-56 p-3 rounded-2xl bg-slate-950/95 border border-slate-800 shadow-2xl space-y-1.5 z-40 backdrop-blur-xl">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
              <span>Room Players</span>
            </div>
            {players.map((p, idx) => {
              const isMe =
                (me?.id && p.id && me.id === p.id) ||
                (me?.nickname && p.nickname && me.nickname === p.nickname);
              return (
                <div
                  key={p.id || idx}
                  className={`flex items-center justify-between p-2 rounded-xl border text-xs ${
                    isMe
                      ? 'bg-purple-950/70 border-purple-500/50'
                      : 'bg-slate-900/70 border border-slate-800'
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <GameMascot type={getMascotForPlayer(p.id || p.nickname)} className="w-5 h-5" />
                    <span className="truncate font-comic font-bold text-slate-200">{p.nickname}</span>
                    {p.is_host && <span className="shrink-0">👑</span>}
                    {isMe && <span className="text-[10px] font-bold text-purple-300 shrink-0">(you)</span>}
                  </div>
                  {isPlayerActionDone(p) ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                  ) : (
                    <span className="text-amber-400 text-xs font-black animate-pulse">•••</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 2. TOP-CENTER: MENU / INFO BUTTON                                         */}
      {/* ========================================================================= */}
      <div className="absolute top-2.5 sm:top-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center pointer-events-auto select-none">
        {/* Stylized Information Button */}
        <button
          type="button"
          onClick={() => setIsRoomInfoOpen(true)}
          title="Room Details & Options"
          aria-label="Room details"
          className="group relative flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#0c142b]/95 border-2 border-[#1e294b] hover:border-amber-400/80 text-amber-400 hover:text-amber-300 shadow-[0_4px_12px_rgba(0,0,0,0.8)] hover:shadow-[0_0_15px_rgba(245,158,11,0.4)] transition-all duration-300 hover:scale-110 active:scale-95 backdrop-blur-md"
        >
          {/* Subtle ambient aura on hover */}
          <div className="absolute -inset-0.5 rounded-full bg-amber-500/20 blur-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

          {/* Stylized 'i' icon */}
          <span className="relative font-serif italic font-black text-xs sm:text-sm leading-none select-none text-amber-400 group-hover:text-amber-300 transition-colors drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] -translate-y-[0.5px]">
            i
          </span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 4. CENTER STAGE: MAIN GAMEPLAY CONTENT                                     */}
      {/* ========================================================================= */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center w-full px-4 sm:px-6 lg:px-8 pt-20 sm:pt-24 pb-20 sm:pb-24 max-w-7xl mx-auto">
        <GameTimerContext.Provider value={{ timeLeft, isTimeUp: timeLeft <= 0 }}>
          {children}
        </GameTimerContext.Provider>
      </main>

      {/* ========================================================================= */}
      {/* 5. BOTTOM-RIGHT: ROOM CODE, BRAND                                         */}
      {/* ========================================================================= */}
      <footer className="absolute bottom-3 right-3 sm:bottom-5 sm:right-6 z-30 pointer-events-auto select-none flex flex-col items-end space-y-1 text-right">
        {/* Website / Brand Text (JACKBOX.TV style) */}
        <div className="text-[11px] sm:text-xs font-black tracking-widest text-slate-300/90 font-mono uppercase drop-shadow-md">
          THROATGOAT.FUN
        </div>

        {/* Large Room Code (AKHZ style) */}
        <div className="text-3xl sm:text-4xl md:text-5xl font-black tracking-widest font-mono text-[#f59e0b] drop-shadow-[0_4px_14px_rgba(245,158,11,0.5)] transition-transform hover:scale-105">
          {roomCode}
        </div>
      </footer>

      {/* ========================================================================= */}
      {/* 6. ROOM INFO & ADMIN MODAL (TRIGGERED VIA TOP-CENTER (i) BUTTON)           */}
      {/* ========================================================================= */}
      {isRoomInfoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border-2 border-slate-700 p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <h3 className="font-black text-lg text-white">Room Information</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsRoomInfoOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 font-medium">Current Stage</span>
                <span className="font-bold text-white">Stage {currentStageNumber} of 3</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 font-medium">Players Connected</span>
                <span className="font-bold text-emerald-400">{players.length} Players</span>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              {onOpenAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setIsRoomInfoOpen(false);
                    onOpenAdmin();
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs flex items-center justify-center space-x-2 border border-slate-700 transition-all"
                >
                  <Shield className="w-4 h-4 text-amber-400" />
                  <span>Admin Controls (Ctrl+Alt+R)</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsRoomInfoOpen(false)}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition-all"
              >
                Back to Game
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
