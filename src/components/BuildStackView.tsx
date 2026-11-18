import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { TableBuildStack } from '../games/sa-casino/types';
import { getRankSymbol } from '../studio/core/card';
import { CardSvg } from './CardSvg';

export interface BuildStackViewProps {
  build: TableBuildStack;
  ownerName: string;
  isOwnedByViewer: boolean;
  isOwnedByPartner: boolean;
  isTargeted: boolean;
  highlightMode?: 'capture' | 'build' | 'cement' | null;
  compact?: boolean;
  onSelectBuild?: (build: TableBuildStack) => void;
  dataDropId?: string;
}

function formatComponentSummary(components: TableBuildStack['components']): string {
  return components
    .map((group) => group.map((c) => getRankSymbol(c.rank)).join('+'))
    .join(' & ');
}

export function BuildStackView({
  build,
  ownerName,
  isOwnedByViewer,
  isOwnedByPartner,
  isTargeted,
  highlightMode = null,
  compact = false,
  onSelectBuild,
  dataDropId,
}: BuildStackViewProps) {
  const [isPeeking, setIsPeeking] = useState(false);

  const componentSummary = formatComponentSummary(build.components);
  const cardSize = compact ? 'xs' : 'sm';
  const cardW = compact ? 52 : 68;
  const cardH = compact ? 74 : 96;

  const handleTogglePeek = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setIsPeeking((prev) => !prev);
  };

  const handleContainerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectBuild?.(build);
    }
  };

  let ringClass = '';
  if (isTargeted) {
    ringClass =
      'ring-2 ring-[#e6be72] shadow-[0_12px_28px_rgba(0,0,0,0.62),0_0_0_3px_rgba(200,157,84,0.28)] -translate-y-1';
  } else if (highlightMode === 'capture') {
    ringClass = 'ring-2 ring-emerald-400 shadow-[0_8px_22px_rgba(16,185,129,0.32)]';
  } else if (highlightMode === 'build') {
    ringClass = 'ring-2 ring-[#c89d54] shadow-[0_8px_22px_rgba(200,157,84,0.32)]';
  } else if (highlightMode === 'cement') {
    ringClass = 'ring-2 ring-amber-300 shadow-[0_8px_22px_rgba(245,158,11,0.35)]';
  }

  const ownerBadgeStyle = isOwnedByViewer
    ? 'bg-[#2a1f12]/90 text-[#f3d48c] border-[#c89d54]/60'
    : isOwnedByPartner
      ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/45'
      : 'bg-[#121c17]/90 text-[#d6cfc2] border-white/15';

  const peekStepX = compact ? 36 : 46;
  const peekStackW = cardW + Math.max(0, build.cards.length - 1) * peekStepX;

  const topHeaderRow = (
    <div className={`flex items-center justify-center gap-1.5 ${compact ? 'mb-1' : 'mb-1.5'}`}>
      {/* Crisp Build Number Pill (+ Lock icon directly beside the number when cemented) */}
      <div
        className={`inline-flex items-center gap-1 rounded-full font-bold tracking-wider uppercase shadow-sm font-mono-num tabular-nums whitespace-nowrap ${
          build.isCemented
            ? 'bg-[#2b1b10] border border-[#c89d54] text-[#f5d78e]'
            : 'bg-gradient-to-r from-emerald-950/95 to-[#281d11]/95 border border-[#c89d54]/60 text-[#f5dfb0]'
        } ${compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-[11px]'}`}
      >
        {!build.isCemented && (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
        )}
        <span className="font-extrabold leading-none">
          {build.targetValue === 1 ? 'A' : build.targetValue}
        </span>
        {build.isCemented && (
          <Lock
            className={`${compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} text-[#e6be72] shrink-0`}
            strokeWidth={2.4}
            aria-label="Locked build"
          />
        )}
      </div>

      {/* Compact Peek Button */}
      <button
        type="button"
        onClick={handleTogglePeek}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={isPeeking ? 'Collapse build cards' : 'Peek cards in build'}
        aria-pressed={isPeeking}
        title={isPeeking ? 'Hide cards' : 'Peek cards'}
        className={`inline-flex items-center justify-center rounded-full border transition-colors cursor-pointer ${
          isPeeking
            ? 'border-[#e6be72] bg-[#3b2916] text-[#f8e4b6]'
            : 'border-[#c89d54]/45 bg-[#12261c]/90 text-[#d8ccb5] hover:border-[#c89d54] hover:text-[#f8e4b6]'
        } ${compact ? 'h-5 w-5' : 'h-5.5 w-5.5 p-1'}`}
      >
        {isPeeking ? (
          <EyeOff className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
        ) : (
          <Eye className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
        )}
      </button>
    </div>
  );

  const ownerBadge = (
    <div
      className={`inline-flex items-center gap-1 rounded-full border font-medium tracking-wide font-mono-num tabular-nums ${
        compact ? 'mt-1 px-1.5 py-0.5 text-[9px]' : 'mt-1.5 px-2 py-0.5 text-[10px]'
      } ${ownerBadgeStyle}`}
    >
      <span>{ownerName}</span>
      {isOwnedByPartner && <span className="text-emerald-400">· TEAM</span>}
    </div>
  );

  const renderPeekFan = () => (
    <>
      <div
        className={`font-semibold tracking-wide text-[#f3dfb7]/95 font-mono-num tabular-nums ${
          compact ? 'mb-1 text-[9px]' : 'mb-1.5 text-[10px]'
        }`}
      >
        {componentSummary}
      </div>
      <div className="relative" style={{ width: peekStackW, height: cardH }}>
        {build.cards.map((card, idx) => (
          <div
            key={card.id}
            className="absolute top-0 left-0 transition-transform duration-150"
            style={{
              transform: `translate3d(${idx * peekStepX}px, 0px, 0)`,
              zIndex: idx + 1,
            }}
          >
            <CardSvg
              card={card}
              faceUp
              size={cardSize}
              highlighted={idx === build.cards.length - 1 ? highlightMode : null}
            />
          </div>
        ))}
      </div>
    </>
  );

  if (!build.isCemented) {
    const stepX = compact ? 13 : 18;
    const stepY = compact ? 7 : 10;
    const stackW = cardW + Math.max(0, build.cards.length - 1) * stepX;
    const stackH = cardH + Math.max(0, build.cards.length - 1) * stepY;

    return (
      <div
        role="button"
        tabIndex={0}
        data-table-item-id={build.id}
        data-drop-id={dataDropId}
        onClick={() => onSelectBuild?.(build)}
        onKeyDown={handleContainerKeyDown}
        className={`group relative flex flex-col items-center rounded-xl bg-[#0a2319]/75 border border-[#c89d54]/40 backdrop-blur-[2px] cursor-pointer select-none transition-all duration-150 hover:border-[#c89d54]/80 focus:outline-none ${
          compact ? 'p-1.5' : 'p-2'
        } ${ringClass}`}
      >
        {topHeaderRow}

        {isPeeking ? (
          renderPeekFan()
        ) : (
          <div className="relative" style={{ width: stackW, height: stackH }}>
            {build.cards.map((card, idx) => (
              <div
                key={card.id}
                className="absolute top-0 left-0"
                style={{
                  transform: `translate3d(${idx * stepX}px, ${idx * stepY}px, 0)`,
                  zIndex: idx + 1,
                }}
              >
                <CardSvg
                  card={card}
                  faceUp
                  size={cardSize}
                  highlighted={idx === build.cards.length - 1 ? highlightMode : null}
                />
              </div>
            ))}
          </div>
        )}

        {ownerBadge}
      </div>
    );
  }

  // Cemented Build: layout constituent sum groups in tight multi-card layered offsets
  const intraX = compact ? 8 : 11;
  const intraY = compact ? 4 : 6;
  const groupGapX = compact ? 12 : 16;

  interface PositionedCard {
    card: TableBuildStack['cards'][number];
    x: number;
    y: number;
    z: number;
  }

  const positioned: PositionedCard[] = [];
  let cursorX = 0;
  let maxCardRight = cardW;
  let maxCardBottom = cardH;
  let zCounter = 1;

  for (let gIdx = 0; gIdx < build.components.length; gIdx++) {
    const group = build.components[gIdx];
    const groupStartX = cursorX;
    for (let cIdx = 0; cIdx < group.length; cIdx++) {
      const x = groupStartX + cIdx * intraX;
      const y = cIdx * intraY + (gIdx % 2 === 1 ? (compact ? 2 : 3) : 0);
      positioned.push({
        card: group[cIdx],
        x,
        y,
        z: zCounter++,
      });
      maxCardRight = Math.max(maxCardRight, x + cardW);
      maxCardBottom = Math.max(maxCardBottom, y + cardH);
    }
    const groupWidth = cardW + Math.max(0, group.length - 1) * intraX;
    const overlapCut =
      group.length > 1 ? (compact ? 27 : 36) : compact ? 32 : 42;
    cursorX += groupWidth - overlapCut + groupGapX;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-table-item-id={build.id}
      data-drop-id={dataDropId}
      onClick={() => onSelectBuild?.(build)}
      onKeyDown={handleContainerKeyDown}
      className={`group relative flex flex-col items-center rounded-xl bg-[#1b140d]/88 border-2 border-[#c89d54] shadow-[0_10px_24px_rgba(0,0,0,0.55)] cursor-pointer select-none transition-all duration-150 hover:border-[#e6be72] focus:outline-none ${
        compact ? 'p-1' : 'p-1.5'
      } ${ringClass}`}
    >
      {/* Inner double burnished-brass hairline frame */}
      <div
        className={`w-full rounded-[9px] border border-[#c89d54]/60 bg-[#0d1f17]/75 flex flex-col items-center ${
          compact ? 'px-1.5 py-1.5' : 'px-2.5 py-2'
        }`}
      >
        {topHeaderRow}

        {isPeeking ? (
          renderPeekFan()
        ) : (
          <>
            {/* Component Sum Summary */}
            <div
              className={`font-semibold tracking-wide text-[#e5dec9]/90 font-mono-num tabular-nums ${
                compact ? 'mb-1 text-[9px]' : 'mb-1.5 text-[10px]'
              }`}
            >
              {componentSummary}
            </div>

            {/* Tight Multi-Card Layered Offset of Sum Groups */}
            <div className="relative" style={{ width: maxCardRight, height: maxCardBottom }}>
              {positioned.map((item) => (
                <div
                  key={item.card.id}
                  className="absolute top-0 left-0"
                  style={{
                    transform: `translate3d(${item.x}px, ${item.y}px, 0)`,
                    zIndex: item.z,
                  }}
                >
                  <CardSvg card={item.card} faceUp size={cardSize} />
                </div>
              ))}
            </div>
          </>
        )}

        {ownerBadge}
      </div>
    </div>
  );
}

export default BuildStackView;
