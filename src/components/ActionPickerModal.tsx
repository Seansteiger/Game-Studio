import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Layers, Lock, PlusCircle, X } from 'lucide-react';
import { Card, getRankSymbol, getSuitName } from '../studio/core';
import {
  BuildOption,
  CaptureOption,
  MaskedPlayerSeatState,
  TableDigMergeOption,
} from '../games/sa-casino/types';
import { CardSvg } from './CardSvg';

export interface ActionPickerModalProps {
  card: Card;
  captureOptions: readonly CaptureOption[];
  buildOptions: readonly BuildOption[];
  tableDigMerges?: readonly TableDigMergeOption[];
  players?: readonly MaskedPlayerSeatState[];
  canTrail: boolean;
  trailBlockedReason?: string;
  droppedTargetId?: string | null;
  dugTargetSeat?: number | null;
  onExecuteCapture: (option: CaptureOption) => void;
  onExecuteBuild: (option: BuildOption) => void;
  onExecuteTableDigMerge?: (merge: TableDigMergeOption) => void;
  onExecuteTrail: () => void;
  onClose: () => void;
}

function getRankTitle(card: Card): string {
  const rankName =
    card.rank === 1
      ? 'Ace'
      : card.rank === 11
        ? 'Jack'
        : card.rank === 12
          ? 'Queen'
          : card.rank === 13
            ? 'King'
            : getRankSymbol(card.rank);
  return `${rankName} of ${getSuitName(card.suit)}`;
}

function formatDugSourceLabel(
  dugSeat: number | null | undefined,
  players: readonly MaskedPlayerSeatState[] | undefined
): string | null {
  if (dugSeat === null || dugSeat === undefined) return null;
  const source = players?.find((p) => p.seat === dugSeat);
  const topCard = source?.topCapturedCard;
  const shortName = source?.name.replace(/\s*\((Bot|Partner)\)$/i, '');
  if (topCard && shortName) return `Dig ${topCard.label} (${shortName})`;
  if (topCard) return `Dig ${topCard.label}`;
  return 'Dig Top Card';
}

export function ActionPickerModal({
  card,
  captureOptions,
  buildOptions,
  tableDigMerges = [],
  players,
  canTrail,
  trailBlockedReason,
  droppedTargetId,
  dugTargetSeat = null,
  onExecuteCapture,
  onExecuteBuild,
  onExecuteTableDigMerge,
  onExecuteTrail,
  onClose,
}: ActionPickerModalProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const sortedCaptures = useMemo(() => {
    if (!droppedTargetId && dugTargetSeat === null) return captureOptions;
    return [...captureOptions].sort((a, b) => {
      const aDugHit = dugTargetSeat !== null && a.dugCapturedFromSeat === dugTargetSeat ? 2 : 0;
      const bDugHit = dugTargetSeat !== null && b.dugCapturedFromSeat === dugTargetSeat ? 2 : 0;
      const aDropHit = droppedTargetId && a.capturedItemIds.includes(droppedTargetId) ? 1 : 0;
      const bDropHit = droppedTargetId && b.capturedItemIds.includes(droppedTargetId) ? 1 : 0;
      return bDugHit + bDropHit - (aDugHit + aDropHit);
    });
  }, [captureOptions, droppedTargetId, dugTargetSeat]);

  const buildsByTarget = useMemo(() => {
    const map = new Map<number, BuildOption[]>();
    for (const opt of buildOptions) {
      const existing = map.get(opt.targetValue);
      if (existing) {
        existing.push(opt);
      } else {
        map.set(opt.targetValue, [opt]);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([targetValue, opts]) => ({
        targetValue,
        options:
          droppedTargetId || dugTargetSeat !== null
            ? [...opts].sort((a, b) => {
                const aDugHit =
                  dugTargetSeat !== null && a.dugCapturedFromSeat === dugTargetSeat ? 2 : 0;
                const bDugHit =
                  dugTargetSeat !== null && b.dugCapturedFromSeat === dugTargetSeat ? 2 : 0;
                const aHit = droppedTargetId && a.targetItemIds.includes(droppedTargetId) ? 1 : 0;
                const bHit = droppedTargetId && b.targetItemIds.includes(droppedTargetId) ? 1 : 0;
                return bDugHit + bHit - (aDugHit + aHit);
              })
            : opts,
      }));
  }, [buildOptions, droppedTargetId, dugTargetSeat]);

  const defaultBuildValue = useMemo(() => {
    if (buildsByTarget.length === 0) return null;
    if (dugTargetSeat !== null) {
      const dugMatched = buildsByTarget.find((group) =>
        group.options.some((o) => o.dugCapturedFromSeat === dugTargetSeat)
      );
      if (dugMatched) return dugMatched.targetValue;
    }
    if (droppedTargetId) {
      const matched = buildsByTarget.find((group) =>
        group.options.some((o) => o.targetItemIds.includes(droppedTargetId))
      );
      if (matched) return matched.targetValue;
    }
    return buildsByTarget[0].targetValue;
  }, [buildsByTarget, droppedTargetId, dugTargetSeat]);

  const [selectedBuildValue, setSelectedBuildValue] = useState<number | null>(
    defaultBuildValue
  );

  useEffect(() => {
    setSelectedBuildValue(defaultBuildValue);
  }, [defaultBuildValue, card.id]);

  const activeBuildGroup = useMemo(() => {
    if (buildsByTarget.length === 0) return null;
    return (
      buildsByTarget.find((g) => g.targetValue === selectedBuildValue) ??
      buildsByTarget[0]
    );
  }, [buildsByTarget, selectedBuildValue]);

  const hasCaptures = sortedCaptures.length > 0;
  const hasBuilds = buildsByTarget.length > 0;
  const hasTableDigMerges = tableDigMerges.length > 0 && Boolean(onExecuteTableDigMerge);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Play options for ${card.label}`}
    >
      <div
        className="animate-modal-enter relative flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#c89d54]/45 bg-gradient-to-b from-[#291a11] via-[#1c120c] to-[#140c08] shadow-[0_24px_64px_rgba(0,0,0,0.78)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#c89d54]/20 bg-[#22150d]/85 px-4 py-3">
          <div className="flex items-center gap-3">
            <CardSvg card={card} faceUp size="sm" selected className="shrink-0" />
            <div>
              <p className="text-[10px] font-semibold tracking-[0.16em] text-[#c89d54] uppercase">
                Choose Move
              </p>
              <h3 className="font-display text-base font-bold text-[#f6efe2]">
                {getRankTitle(card)}
              </h3>
              {(droppedTargetId || dugTargetSeat !== null) && (
                <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-950/75 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                  <Check className="h-2.5 w-2.5" />
                  {dugTargetSeat !== null ? 'Digging Top Card' : 'Selected Target'}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-stone-300 transition-colors hover:border-[#c89d54]/40 hover:bg-white/10 hover:text-white active:scale-[0.96]"
            aria-label="Close action picker"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Moves Body */}
        <div className="thin-scroll flex-1 space-y-4 overflow-y-auto px-4 py-3.5">
          {/* Capture Plays */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-[11px] font-bold tracking-[0.14em] text-emerald-300/90 uppercase">
                Capture
              </h4>
              <span className="text-[10px] font-mono-num text-stone-400">
                {sortedCaptures.length} available
              </span>
            </div>

            {hasCaptures ? (
              <div className="space-y-1.5">
                {sortedCaptures.map((option) => {
                  const matchesDrop =
                    (Boolean(droppedTargetId) &&
                      option.capturedItemIds.includes(droppedTargetId!)) ||
                    (dugTargetSeat !== null && option.dugCapturedFromSeat === dugTargetSeat);
                  const dugLabel = formatDugSourceLabel(option.dugCapturedFromSeat, players);

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => onExecuteCapture(option)}
                      className={`group flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-all duration-150 active:scale-[0.98] ${
                        matchesDrop
                          ? 'border-emerald-400/75 bg-emerald-950/65 shadow-[0_0_16px_rgba(16,185,129,0.2)] hover:bg-emerald-900/70'
                          : 'border-emerald-500/25 bg-[#0f241a]/80 hover:border-emerald-400/60 hover:bg-[#132e21]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {option.capturedItems.map((item) => (
                            <span
                              key={item.id}
                              className="inline-flex items-center gap-1 rounded-md border border-white/12 bg-black/35 px-1.5 py-0.5 text-[11px] font-mono-num font-semibold text-[#f4efe6]"
                            >
                              {item.kind === 'loose' ? (
                                item.card.label
                              ) : (
                                <>
                                  {item.isCemented && (
                                    <Lock className="h-2.5 w-2.5 text-amber-300" />
                                  )}
                                  <span>Build {item.targetValue}</span>
                                </>
                              )}
                            </span>
                          ))}
                          {dugLabel && (
                            <span className="rounded-md border border-amber-400/45 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                              {dugLabel}
                            </span>
                          )}
                          {option.isSweep && (
                            <span className="rounded-full border border-emerald-300/60 bg-emerald-500/25 px-2 py-0.5 text-[10px] font-bold tracking-wider text-emerald-200 uppercase">
                              SWEEP +1 PT
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] text-stone-300/85">
                          Takes{' '}
                          <span className="font-mono-num font-semibold text-emerald-200">
                            {option.totalCardsCaptured}
                          </span>{' '}
                          {option.totalCardsCaptured === 1 ? 'card' : 'cards'} total
                        </p>
                      </div>

                      <ChevronRight className="h-4 w-4 shrink-0 text-emerald-300/70 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-emerald-200" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-stone-400">
                No captures available for {card.label}.
              </p>
            )}
          </section>

          {/* Build Plays */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.14em] text-[#e5be76] uppercase">
                <Layers className="h-3.5 w-3.5" />
                Build
              </h4>
              {hasBuilds && (
                <span className="text-[10px] font-mono-num text-stone-400">
                  {buildOptions.length} option{buildOptions.length === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {hasBuilds && activeBuildGroup ? (
              <div className="space-y-2.5">
                {/* Interactive Target Value Picker (2..10) */}
                <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[#c89d54]/20 bg-black/30 p-1.5">
                  <span className="px-1.5 text-[10px] font-semibold tracking-wider text-stone-400 uppercase">
                    Build:
                  </span>
                  {buildsByTarget.map(({ targetValue }) => {
                    const isActive = activeBuildGroup.targetValue === targetValue;
                    return (
                      <button
                        key={targetValue}
                        type="button"
                        onClick={() => setSelectedBuildValue(targetValue)}
                        className={`min-w-[30px] rounded-lg px-2 py-1 text-xs font-mono-num font-bold transition-all duration-150 active:scale-[0.96] ${
                          isActive
                            ? 'bg-[#c89d54] text-[#1a1008] shadow-[0_2px_10px_rgba(200,157,84,0.4)]'
                            : 'bg-white/5 text-[#e6d6bc] hover:bg-white/10'
                        }`}
                      >
                        {targetValue}
                      </button>
                    );
                  })}
                </div>

                {/* Options for selected targetValue */}
                <div className="space-y-1.5">
                  {activeBuildGroup.options.map((option) => {
                    const isCement = option.buildMode === 'CEMENT';
                    const isRaise = option.buildMode === 'RAISE_OPEN';
                    const matchesDrop =
                      (Boolean(droppedTargetId) &&
                        option.targetItemIds.includes(droppedTargetId!)) ||
                      (dugTargetSeat !== null && option.dugCapturedFromSeat === dugTargetSeat);
                    const dugLabel = formatDugSourceLabel(option.dugCapturedFromSeat, players);

                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => onExecuteBuild(option)}
                        className={`group flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-all duration-150 active:scale-[0.98] ${
                          matchesDrop
                            ? 'border-amber-400/80 bg-[#3a2614] shadow-[0_0_16px_rgba(245,158,11,0.2)]'
                            : isCement
                              ? 'border-amber-500/35 bg-[#2a1c11] hover:border-amber-400/70 hover:bg-[#352315]'
                              : 'border-[#c89d54]/25 bg-[#22160e] hover:border-[#c89d54]/60 hover:bg-[#2c1d13]'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {isCement ? (
                              <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/45 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-amber-200 uppercase">
                                <Lock className="h-2.5 w-2.5" />
                                Lock {option.targetValue} Build
                              </span>
                            ) : isRaise ? (
                              <span className="inline-flex items-center gap-1 rounded-md border border-sky-400/40 bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-sky-200 uppercase">
                                Build up to {option.targetValue}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-md border border-[#c89d54]/40 bg-[#c89d54]/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-[#f0d29c] uppercase">
                                Build {option.targetValue}
                              </span>
                            )}

                            {dugLabel && (
                              <span className="rounded-md border border-amber-400/45 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                                {dugLabel}
                              </span>
                            )}
                          </div>

                          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] font-mono-num text-stone-300">
                            {option.components.map((group, gi) => (
                              <span
                                key={gi}
                                className="inline-flex items-center rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-[#f0e3cc]"
                              >
                                {group.map((c) => c.label).join(' + ')}
                              </span>
                            ))}
                          </div>
                        </div>

                        <ChevronRight className="h-4 w-4 shrink-0 text-[#c89d54]/75 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-amber-300" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-stone-400">
                {card.isFaceCard
                  ? 'Face cards cannot be used in builds.'
                  : 'No builds available with your remaining cards.'}
              </p>
            )}
          </section>

          {/* Dig Table + Opponent Top Card into Own Active Build (Case C) */}
          {hasTableDigMerges && onExecuteTableDigMerge && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.14em] text-amber-300 uppercase">
                  <PlusCircle className="h-3.5 w-3.5" />
                  Dig into Your Build
                </h4>
              </div>
              <div className="space-y-1.5">
                {tableDigMerges.map((merge) => (
                  <button
                    key={merge.id}
                    type="button"
                    onClick={() => onExecuteTableDigMerge(merge)}
                    className="group flex w-full items-center justify-between gap-2 rounded-xl border border-amber-400/45 bg-[#2a1c11] px-3 py-2.5 text-left transition-all duration-150 hover:border-amber-300/80 hover:bg-[#362415] active:scale-[0.98]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-amber-200">
                        Dig {merge.description}
                      </div>
                      <p className="mt-0.5 text-[11px] text-stone-300/80">
                        Free move — keeps your turn
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-amber-300/75 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-amber-200" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Throw on Table */}
          <section>
            <h4 className="mb-2 text-[11px] font-bold tracking-[0.14em] text-stone-300 uppercase">
              Throw on Table
            </h4>

            {canTrail ? (
              <button
                type="button"
                onClick={onExecuteTrail}
                className="group flex w-full items-center justify-between rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-left transition-all duration-150 hover:border-[#c89d54]/50 hover:bg-white/10 active:scale-[0.98]"
              >
                <div>
                  <div className="text-xs font-semibold text-[#f4efe6]">
                    Throw {card.label} on Table
                  </div>
                  <p className="text-[11px] text-stone-400">
                    Put card face-up on the table without capturing.
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-stone-400 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[#e6c588]" />
              </button>
            ) : (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/35 bg-amber-950/45 px-3 py-2.5 text-xs text-amber-200/95">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <div className="font-semibold text-amber-200">
                    Can&apos;t Throw — Keep for Build
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-amber-100/80">
                    {trailBlockedReason ??
                      `You must keep ${card.label} in hand to cover your active build on the table.`}
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
