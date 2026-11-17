import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Eye,
  Layers,
  Trophy,
} from 'lucide-react';
import { sharedAudioEngine } from '../studio/core';
import { DealScoreBreakdown, GameMode } from '../games/sa-casino/types';
import { CardSvg } from './CardSvg';

export interface ScoreBreakdownModalProps {
  breakdown: DealScoreBreakdown;
  matchScores: Record<number, number>;
  sweepsEnabled: boolean;
  mode: GameMode;
  onDealNextHand: () => void;
}

interface ScoreCategoryRow {
  id: string;
  label: string;
  pointRule: string;
  stepIndex: number;
}

const SCORE_CATEGORIES: ScoreCategoryRow[] = [
  { id: 'mostCards', label: 'Most Cards', pointRule: '3 pts', stepIndex: 0 },
  { id: 'bigCasino', label: 'Big Casino 10♦', pointRule: '2 pts', stepIndex: 1 },
  { id: 'littleCasino', label: 'Little Casino 2♠', pointRule: '1 pt', stepIndex: 2 },
  { id: 'mostSpades', label: 'Most Spades', pointRule: '1 pt', stepIndex: 3 },
  { id: 'aces', label: 'Aces', pointRule: '1 pt ea', stepIndex: 4 },
  { id: 'sweeps', label: 'Sweeps', pointRule: '+1 pt ea', stepIndex: 5 },
];

export function ScoreBreakdownModal({
  breakdown,
  matchScores,
  sweepsEnabled,
  mode,
  onDealNextHand,
}: ScoreBreakdownModalProps) {
  const [revealedStep, setRevealedStep] = useState<number>(-1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activePileTab, setActivePileTab] = useState<'cut' | number>('cut');

  useEffect(() => {
    setRevealedStep(-1);
    const timers: number[] = [];
    const stepDelays = [160, 340, 520, 700, 880, 1060];

    stepDelays.forEach((delay, step) => {
      const id = window.setTimeout(() => {
        setRevealedStep(step);
        sharedAudioEngine.playScoreTick(step);
      }, delay);
      timers.push(id);
    });

    const totalTimer = window.setTimeout(() => {
      setRevealedStep(6);
    }, 1180);
    timers.push(totalTimer);

    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [breakdown]);

  const { mostCardsTieNote, mostSpadesTieNote } = useMemo(() => {
    const teams = breakdown.teams;
    const anyMostCardsWinner = teams.some((t) => t.points.mostCards > 0);
    const maxCards = Math.max(...teams.map((t) => t.cardCount));
    const cardLeaders = teams.filter((t) => t.cardCount === maxCards);
    const cardsTie = !anyMostCardsWinner && cardLeaders.length > 1;

    const anyMostSpadesWinner = teams.some((t) => t.points.mostSpades > 0);
    const maxSpades = Math.max(...teams.map((t) => t.spadeCount));
    const spadeLeaders = teams.filter((t) => t.spadeCount === maxSpades);
    const spadesTie = !anyMostSpadesWinner && maxSpades > 0 && spadeLeaders.length > 1;

    return {
      mostCardsTieNote: cardsTie
        ? `${cardLeaders.map((t) => t.cardCount).join('–')} = 0 pts`
        : null,
      mostSpadesTieNote: spadesTie
        ? `${spadeLeaders.map((t) => t.spadeCount).join('–')} = 0 pts`
        : null,
    };
  }, [breakdown.teams]);

  const winnerNames = useMemo(() => {
    const winners = breakdown.teams.filter((t) =>
      breakdown.winningTeamIds.includes(t.teamId)
    );
    if (winners.length === 0) return 'Deal Complete';
    if (winners.length > 1) {
      return `Tied Deal: ${winners.map((w) => w.label).join(' & ')}`;
    }
    return `${winners[0].label} Wins Deal`;
  }, [breakdown]);

  const inspectedCards = useMemo(() => {
    if (activePileTab === 'cut') {
      return breakdown.cutPileRevealed;
    }
    const found = breakdown.teams.find((t) => t.teamId === activePileTab);
    return found?.capturedCards ?? [];
  }, [activePileTab, breakdown]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Deal score breakdown"
    >
      <div className="animate-modal-enter flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#c89d54]/50 bg-gradient-to-b from-[#281a11] via-[#1a110b] to-[#120b07] shadow-[0_28px_80px_rgba(0,0,0,0.85)]">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#c89d54]/25 bg-[#22150d]/90 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#c89d54]/45 bg-[#332114] text-[#e6c588] shadow-inner">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-semibold tracking-[0.18em] text-[#c89d54] uppercase">
                {mode === '2v2-teams' ? 'Partnership Scorecard' : 'Deal Scorecard'}
              </p>
              <h2 className="font-display text-lg font-bold text-[#f6efe2]">
                {winnerNames}
              </h2>
            </div>
          </div>

          {/* Updated Match Score Summary Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {breakdown.teams.map((team) => {
              const matchTotal = matchScores[team.teamId] ?? 0;
              const isWinner = breakdown.winningTeamIds.includes(team.teamId);
              return (
                <div
                  key={team.teamId}
                  className={`rounded-xl border px-3 py-1.5 text-right ${
                    isWinner
                      ? 'border-amber-400/55 bg-amber-500/15'
                      : 'border-white/10 bg-black/30'
                  }`}
                >
                  <div className="text-[10px] font-medium text-stone-300">
                    {team.label}
                  </div>
                  <div className="font-mono-num text-sm font-bold text-[#f6efe2]">
                    {matchTotal}{' '}
                    <span className="text-[10px] font-normal text-stone-400">
                      match pts
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Scorecard Table + Expandable Pile Drawer */}
        <div className="thin-scroll flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="overflow-x-auto rounded-xl border border-[#c89d54]/20 bg-black/30">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 bg-[#1f140d]/80 text-[11px] font-semibold tracking-wider text-stone-300 uppercase">
                  <th className="px-3.5 py-2.5">Category</th>
                  {breakdown.teams.map((team) => (
                    <th key={team.teamId} className="px-3.5 py-2.5 text-right">
                      {team.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {SCORE_CATEGORIES.map((cat) => {
                  const isLit = revealedStep >= cat.stepIndex;
                  const isSweepsDisabledRow =
                    cat.id === 'sweeps' && !sweepsEnabled;

                  return (
                    <tr
                      key={cat.id}
                      className={`transition-opacity duration-200 ${
                        isLit ? 'opacity-100' : 'opacity-25'
                      } ${
                        isLit && revealedStep === cat.stepIndex
                          ? 'bg-[#c89d54]/12'
                          : 'bg-transparent'
                      }`}
                    >
                      <td className="px-3.5 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-[#f4efe6]">
                            {cat.label}
                          </span>
                          <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-mono-num text-[#d8b478]">
                            {isSweepsDisabledRow ? 'Off' : cat.pointRule}
                          </span>
                          {cat.id === 'mostCards' && mostCardsTieNote && isLit && (
                            <span className="rounded-full border border-amber-400/35 bg-amber-950/70 px-2 py-0.5 text-[10px] font-mono-num text-amber-200">
                              Tie ({mostCardsTieNote})
                            </span>
                          )}
                          {cat.id === 'mostSpades' && mostSpadesTieNote && isLit && (
                            <span className="rounded-full border border-amber-400/35 bg-amber-950/70 px-2 py-0.5 text-[10px] font-mono-num text-amber-200">
                              Tie ({mostSpadesTieNote})
                            </span>
                          )}
                        </div>
                      </td>

                      {breakdown.teams.map((team) => {
                        let pts = 0;
                        let detail = '';

                        switch (cat.id) {
                          case 'mostCards':
                            pts = team.points.mostCards;
                            detail = `${team.cardCount} cards`;
                            break;
                          case 'bigCasino':
                            pts = team.points.bigCasino;
                            detail = team.hasBigCasino ? 'Captured' : '—';
                            break;
                          case 'littleCasino':
                            pts = team.points.littleCasino;
                            detail = team.hasLittleCasino ? 'Captured' : '—';
                            break;
                          case 'mostSpades':
                            pts = team.points.mostSpades;
                            detail = `${team.spadeCount} ♠`;
                            break;
                          case 'aces':
                            pts = team.points.aces;
                            detail = `${team.aceCount} A`;
                            break;
                          case 'sweeps':
                            pts = team.points.sweeps;
                            detail = isSweepsDisabledRow
                              ? `${team.sweeps} (off)`
                              : `${team.sweeps} × 1`;
                            break;
                        }

                        return (
                          <td
                            key={team.teamId}
                            className="px-3.5 py-2.5 text-right font-mono-num"
                          >
                            <div className="flex flex-col items-end">
                              <span
                                className={`text-sm font-bold ${
                                  !isLit
                                    ? 'text-stone-600'
                                    : pts > 0
                                      ? 'text-emerald-300'
                                      : 'text-stone-400'
                                }`}
                              >
                                {isLit ? (pts > 0 ? `+${pts}` : '0') : '·'}
                              </span>
                              <span className="text-[10px] text-stone-400">
                                {detail}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}

                {/* Deal Total Row */}
                <tr
                  className={`border-t border-[#c89d54]/35 bg-[#241810]/85 transition-opacity duration-200 ${
                    revealedStep >= 6 ? 'opacity-100' : 'opacity-40'
                  }`}
                >
                  <td className="px-3.5 py-3 font-display text-sm font-bold text-[#f3dfb7]">
                    Deal Total
                  </td>
                  {breakdown.teams.map((team) => {
                    const isWinner = breakdown.winningTeamIds.includes(
                      team.teamId
                    );
                    return (
                      <td
                        key={team.teamId}
                        className="px-3.5 py-3 text-right font-mono-num"
                      >
                        <span
                          className={`text-base font-bold ${
                            isWinner ? 'text-amber-300' : 'text-[#f4efe6]'
                          }`}
                        >
                          +{team.points.total}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          {/* 40-Card Numeral Deck Guarantee Banner */}
          <div className="rounded-xl border border-[#c89d54]/20 bg-[#1a130c]/75 px-3.5 py-2 text-[11px] leading-relaxed text-stone-300/90">
            <span className="font-semibold text-[#f3dfb7]">40-Card Numeral Deck (Ace–10):</span>{' '}
            All <span className="font-mono-num">12</span> <span className="font-mono-num">J, Q, K</span>{' '}
            face cards and Jokers are removed—guaranteeing{' '}
            <span className="text-[#f3d48c] font-semibold">Big Casino (10♦)</span>,{' '}
            <span className="text-slate-200 font-semibold">Little Casino (2♠)</span>, all{' '}
            <span className="text-emerald-200 font-semibold">4 Aces</span>, and all{' '}
            <span className="text-[#f4efe6] font-semibold">10 Spades</span> were live in this deal.
          </div>

          {/* Expandable Drawer: Captured Piles & 12 Removed Face Cards */}
          <div className="rounded-xl border border-[#c89d54]/25 bg-black/25">
            <button
              type="button"
              onClick={() => setDrawerOpen((prev) => !prev)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-white/5"
            >
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-[#c89d54]" />
                <span className="text-xs font-semibold tracking-wide text-[#f0e3cc]">
                  Inspect Captured Piles &amp; Removed Face Cards (J, Q, K)
                </span>
              </div>
              {drawerOpen ? (
                <ChevronUp className="h-4 w-4 text-stone-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-stone-400" />
              )}
            </button>

            {drawerOpen && (
              <div className="border-t border-white/10 px-4 py-3">
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActivePileTab('cut')}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all ${
                      activePileTab === 'cut'
                        ? 'border-[#c89d54] bg-[#c89d54]/20 text-[#f3dfb7]'
                        : 'border-white/10 bg-white/5 text-stone-300 hover:bg-white/10'
                    }`}
                  >
                    <Layers className="h-3 w-3" />
                    Removed J·Q·K ({breakdown.cutPileRevealed.length})
                  </button>

                  {breakdown.teams.map((team) => (
                    <button
                      key={team.teamId}
                      type="button"
                      onClick={() => setActivePileTab(team.teamId)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all ${
                        activePileTab === team.teamId
                          ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                          : 'border-white/10 bg-white/5 text-stone-300 hover:bg-white/10'
                      }`}
                    >
                      {team.label} ({team.capturedCards.length})
                    </button>
                  ))}
                </div>

                {inspectedCards.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {inspectedCards.map((c) => (
                      <CardSvg key={c.id} card={c} faceUp size="xs" />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-stone-400">
                    No cards in this pile.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer CTA */}
        <div className="flex items-center justify-end border-t border-[#c89d54]/20 bg-[#1a110b]/90 px-5 py-3.5">
          <button
            type="button"
            onClick={onDealNextHand}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-300/60 bg-gradient-to-b from-[#d9ad5b] to-[#b88635] px-5 py-2.5 text-sm font-bold tracking-wide text-[#1a1006] shadow-[0_8px_24px_rgba(200,157,84,0.35)] transition-all duration-150 hover:brightness-105 active:scale-[0.98]"
          >
            <span>Deal Next Hand</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
