import { Lock } from 'lucide-react';
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
  const componentSummary = formatComponentSummary(build.components);
  const cardSize = compact ? 'xs' : 'sm';
  const cardW = compact ? 52 : 68;
  const cardH = compact ? 74 : 96;

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

  if (!build.isCemented) {
    const stepX = compact ? 13 : 18;
    const stepY = compact ? 7 : 10;
    const stackW = cardW + Math.max(0, build.cards.length - 1) * stepX;
    const stackH = cardH + Math.max(0, build.cards.length - 1) * stepY;

    return (
      <button
        type="button"
        data-table-item-id={build.id}
        data-drop-id={dataDropId}
        onClick={() => onSelectBuild?.(build)}
        className={`group relative flex flex-col items-center rounded-xl bg-[#0a2319]/75 border border-[#c89d54]/40 backdrop-blur-[2px] cursor-pointer select-none transition-all duration-150 hover:border-[#c89d54]/80 focus:outline-none ${
          compact ? 'p-1.5' : 'p-2'
        } ${ringClass}`}
      >
        {/* Top Build Pill */}
        <div
          className={`flex items-center gap-1.5 rounded-full font-semibold tracking-wider uppercase bg-gradient-to-r from-emerald-950/95 to-[#281d11]/95 border border-[#c89d54]/60 text-[#f5dfb0] shadow-sm font-mono-num tabular-nums whitespace-nowrap ${
            compact ? 'mb-1 px-2 py-0.5 text-[9px]' : 'mb-1.5 px-2.5 py-0.5 text-[10px]'
          }`}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span>Build {build.targetValue}</span>
        </div>

        {/* Diagonal Offset Card Stack */}
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

        {/* Subtle Owner Label */}
        <div
          className={`inline-flex items-center gap-1 rounded-full border font-medium tracking-wide font-mono-num tabular-nums ${
            compact ? 'mt-1 px-1.5 py-0.5 text-[9px]' : 'mt-1.5 px-2 py-0.5 text-[10px]'
          } ${ownerBadgeStyle}`}
        >
          <span>{ownerName}</span>
          {isOwnedByPartner && <span className="text-emerald-400">· TEAM</span>}
        </div>
      </button>
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
    <button
      type="button"
      data-table-item-id={build.id}
      data-drop-id={dataDropId}
      onClick={() => onSelectBuild?.(build)}
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
        {/* Top Mechanical Lock Badge */}
        <div
          className={`flex items-center gap-1 rounded-full font-bold tracking-wider uppercase bg-[#2b1b10] border border-[#c89d54] text-[#f5d78e] shadow-sm font-mono-num tabular-nums whitespace-nowrap ${
            compact ? 'mb-1 px-2 py-0.5 text-[9px]' : 'mb-1.5 px-2.5 py-0.5 text-[10px]'
          }`}
        >
          <Lock
            className={`${compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} text-[#e6be72] shrink-0`}
            strokeWidth={2.4}
          />
          <span>Lock {build.targetValue} Build</span>
        </div>

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

        {/* Owner Label */}
        <div
          className={`inline-flex items-center gap-1 rounded-full border font-medium tracking-wide font-mono-num tabular-nums ${
            compact ? 'mt-1 px-1.5 py-0.5 text-[9px]' : 'mt-1.5 px-2 py-0.5 text-[10px]'
          } ${ownerBadgeStyle}`}
        >
          <span>{ownerName}</span>
          {isOwnedByPartner && <span className="text-emerald-400">· TEAM</span>}
        </div>
      </div>
    </button>
  );
}

export default BuildStackView;
