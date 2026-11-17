import { BookOpen, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { GameMode, SACasinoPlayerView } from '../games/sa-casino/types';

export interface TopHudBarProps {
  view: SACasinoPlayerView;
  muted: boolean;
  onChangeMode: (mode: GameMode) => void;
  onNewDeal: () => void;
  onToggleMute: () => void;
  onOpenRules: () => void;
}

const MODE_OPTIONS: { mode: GameMode; label: string }[] = [
  { mode: '1v1', label: '1v1' },
  { mode: '3p-ffa', label: '3P' },
  { mode: '2v2-teams', label: '2v2' },
];

export function TopHudBar({
  view,
  muted,
  onChangeMode,
  onNewDeal,
  onToggleMute,
  onOpenRules,
}: TopHudBarProps) {
  const scoreEntries =
    view.mode === '2v2-teams'
      ? [
          {
            teamId: 0,
            label: 'You & North',
            score: view.matchScores[0] ?? 0,
            isYou: true,
          },
          {
            teamId: 1,
            label: 'West & East',
            score: view.matchScores[1] ?? 0,
            isYou: false,
          },
        ]
      : view.players.map((p) => ({
          teamId: p.teamId,
          label: p.seat === 0 ? 'You' : p.name.replace(/\s*\(Bot\)$/i, ''),
          score: view.matchScores[p.teamId] ?? 0,
          isYou: p.seat === 0,
        }));

  const roundBadge = view.mode === '1v1' ? `Round ${view.roundNumber}` : null;

  return (
    <header className="relative z-30 flex items-center justify-between gap-1.5 border-b border-[#c89d54]/25 bg-gradient-to-b from-[#231710]/95 to-[#160f0a]/95 px-2 py-1.5 shadow-[0_6px_24px_rgba(0,0,0,0.45)] backdrop-blur-md md:gap-3 md:px-4 md:py-2">
      {/* Left: Title + Mode Switcher */}
      <div className="flex min-w-0 items-center gap-1.5 md:gap-3">
        <h1 className="shrink-0 font-display text-[11px] font-bold tracking-wider text-[#f5efe4] whitespace-nowrap md:text-sm">
          SA CASINO
        </h1>

        <div
          className="flex shrink-0 items-center rounded-lg border border-white/10 bg-black/35 p-0.5"
          role="group"
          aria-label="Game mode"
        >
          {MODE_OPTIONS.map((opt) => {
            const active = view.mode === opt.mode;
            return (
              <button
                key={opt.mode}
                type="button"
                onClick={() => onChangeMode(opt.mode)}
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide transition-all duration-150 active:scale-[0.97] md:px-2.5 md:py-1 md:text-[11px] ${
                  active
                    ? 'bg-[#c89d54] text-[#1a1008] shadow-[0_1px_8px_rgba(200,157,84,0.35)]'
                    : 'text-stone-300/85 hover:bg-white/5 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Center: Simple Score Display + Round Badge (1v1 only) */}
      <div className="flex shrink-0 items-center gap-1.5">
        <div
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/35 px-2 py-0.5 text-[10px] font-mono-num tabular-nums text-[#f4efe6] md:px-3 md:py-1 md:text-[11px]"
          aria-label="Match scores"
        >
          {scoreEntries.map((entry, idx) => (
            <span key={entry.teamId} className="inline-flex items-center gap-1">
              {idx > 0 && <span className="text-stone-500">·</span>}
              <span
                className={`hidden sm:inline font-sans ${
                  entry.isYou ? 'font-semibold text-emerald-300' : 'text-stone-300'
                }`}
              >
                {entry.label}
              </span>
              <span
                className={
                  entry.isYou ? 'font-bold text-emerald-300' : 'font-bold text-[#f4efe6]'
                }
              >
                {entry.score}
              </span>
            </span>
          ))}
        </div>

        {roundBadge && (
          <div className="rounded-full border border-[#c89d54]/30 bg-black/35 px-2 py-0.5 text-[10px] font-mono-num font-medium tabular-nums text-[#e6c588] whitespace-nowrap md:px-2.5 md:py-1 md:text-[11px]">
            {roundBadge}
          </div>
        )}
      </div>

      {/* Right: Rules, New Game, Mute */}
      <div className="flex shrink-0 items-center gap-1 md:gap-1.5">
        <button
          type="button"
          onClick={onOpenRules}
          aria-label="Open rules"
          title="Rules"
          className="inline-flex h-7 w-7 items-center justify-center gap-1 rounded-lg border border-white/12 bg-black/30 text-[11px] font-semibold text-stone-200 transition-all duration-150 hover:border-[#c89d54]/45 hover:bg-white/10 active:scale-[0.97] md:h-auto md:w-auto md:px-2.5 md:py-1.5"
        >
          <BookOpen className="h-3.5 w-3.5 text-[#c89d54] md:h-3 md:w-3" />
          <span className="hidden md:inline">Rules</span>
        </button>

        <button
          type="button"
          onClick={onNewDeal}
          aria-label="New game"
          title="New Game"
          className="inline-flex h-7 w-7 items-center justify-center gap-1 rounded-lg border border-[#c89d54]/40 bg-[#2d1d12] text-[11px] font-semibold text-[#f3dfb7] transition-all duration-150 hover:border-[#c89d54]/75 hover:bg-[#3a2618] active:scale-[0.97] md:h-auto md:w-auto md:px-2.5 md:py-1.5"
        >
          <RotateCcw className="h-3.5 w-3.5 md:h-3 md:w-3" />
          <span className="hidden md:inline">New Game</span>
        </button>

        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? 'Unmute audio' : 'Mute audio'}
          title={muted ? 'Unmute' : 'Mute'}
          className="inline-flex h-7 w-7 items-center justify-center gap-1 rounded-lg border border-white/12 bg-black/35 text-[11px] font-semibold text-stone-300 transition-colors hover:border-[#c89d54]/45 hover:text-[#e6c588] active:scale-[0.97] md:h-auto md:w-auto md:px-2.5 md:py-1.5"
        >
          {muted ? (
            <VolumeX className="h-3.5 w-3.5 text-stone-400 md:h-3 md:w-3" />
          ) : (
            <Volume2 className="h-3.5 w-3.5 text-[#c89d54] md:h-3 md:w-3" />
          )}
          <span className="hidden md:inline">{muted ? 'Muted' : 'Mute'}</span>
        </button>
      </div>
    </header>
  );
}
