'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Crown, Users, Volume2, VolumeX } from 'lucide-react';
import { GamePhase } from '@/types/game';
import { soundManager } from '@/lib/audio/soundManager';

interface GameHeaderProps {
  roomCode: string;
  phase: GamePhase;
  currentStageNumber: number;
  playerCount?: number;
  myNickname?: string;
  isHost?: boolean;
}

export function GameHeader({
  roomCode,
  phase,
  currentStageNumber,
  playerCount = 0,
  myNickname,
  isHost = false,
}: GameHeaderProps) {
  const [isMuted, setIsMuted] = React.useState<boolean>(() => soundManager.isSoundMuted());

  const handleToggleSound = () => {
    const newMuted = soundManager.toggleMute();
    setIsMuted(newMuted);
  };
  const getPhaseBadge = () => {
    switch (phase) {
      case 'LOBBY':
        return <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-bold text-amber-300 border border-amber-500/30">LOBBY</span>;
      case 'SUBMITTING':
        return <span className="rounded-full bg-blue-500/20 px-3 py-1 text-xs font-bold text-blue-300 border border-blue-500/30">SUBMISSION</span>;
      case 'VOTING':
        return <span className="rounded-full bg-purple-500/20 px-3 py-1 text-xs font-bold text-purple-300 border border-purple-500/30">VOTING</span>;
      case 'RESULTS':
        return <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300 border border-emerald-500/30">RESULTS</span>;
      case 'FINISHED':
        return <span className="rounded-full bg-rose-500/20 px-3 py-1 text-xs font-bold text-rose-300 border border-rose-500/30">FINAL LEADERBOARD</span>;
    }
  };

  return (
    <header className="w-full border-b border-slate-800 bg-slate-950/80 backdrop-blur-md px-4 py-3 sticky top-0 z-40">
      <div className="mx-auto flex max-w-4xl items-center justify-between">
        {/* Left: Brand & Room Code */}
        <div className="flex items-center space-x-3">
          <Link href="/" className="flex items-center space-x-2 group">
            <div className="relative flex items-center justify-center w-8 h-8">
              {/* Subtle ambient aura */}
              <div className="absolute inset-0 bg-rose-500/25 rounded-full blur-[2px] pointer-events-none" />
              <Image
                src="/icon.png"
                alt="Throat Goat Logo"
                width={32}
                height={32}
                className="relative w-full h-full object-contain filter drop-shadow-[0_2px_6px_rgba(244,63,94,0.45)] drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] select-none"
              />
            </div>
            <div className="flex items-center space-x-1 font-black text-rose-500 text-lg tracking-tight font-comic">
              <span>THROAT</span>
              <span className="text-amber-400">GOAT</span>
            </div>
          </Link>
          <div className="hidden sm:flex items-center space-x-1 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-mono font-bold text-slate-300 border border-slate-700">
            <span className="text-slate-500">ROOM:</span>
            <span className="text-amber-300 tracking-wider">{roomCode}</span>
          </div>
        </div>

        {/* Center: Phase Badge */}
        <div className="flex items-center">{getPhaseBadge()}</div>

        {/* Right: Player Profile Pill & Sound Toggle */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          <button
            type="button"
            onClick={handleToggleSound}
            title={isMuted ? 'Unmute Game Sounds' : 'Mute Game Sounds'}
            aria-label={isMuted ? 'Unmute Game Sounds' : 'Mute Game Sounds'}
            className={`flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-slate-900 border transition-all duration-200 hover:scale-110 active:scale-95 shadow-sm ${
              isMuted
                ? 'border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-600'
                : 'border-slate-700 text-amber-400 hover:text-amber-300 hover:border-amber-400/50'
            }`}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          <div className="flex items-center space-x-1 text-xs text-slate-400">
            <Users className="w-3.5 h-3.5" />
            <span>{playerCount}</span>
          </div>

          {myNickname && (
            <div className="flex items-center space-x-1.5 rounded-full bg-slate-900 border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200">
              {isHost && <Crown className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />}
              <span className="truncate max-w-[100px]">{myNickname}</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
