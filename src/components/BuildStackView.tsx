import { useEffect, useState, type KeyboardEvent } from 'react';
import { Lock } from 'lucide-react';
import { TableBuildStack } from '../games/sa-casino/types';
import { CardSvg } from './CardSvg';

export interface BuildStackViewProps {
  build: TableBuildStack;
  ownerName: string;
  isOwnedByViewer: boolean;
  isOwnedByPartner: boolean;
  isTargeted: boolean;
  hasSelectedHandCard?: boolean;
  highlightMode?: 'capture' | 'build' | 'cement' | null;
  compact?: boolean;
  onSelectBuild?: (build: TableBuildStack) => void;
  dataDropId?: string;
}

export function BuildStackView({
  build,
  ownerName,
  isOwnedByViewer,
  isOwnedByPartner,
  isTargeted,
  hasSelectedHandCard = false,
  highlightMode = null,
  compact = false,
  onSelectBuild,
  dataDropId,
}: BuildStackViewProps) {
  const [peekDepth, setPeekDepth] = useState(0);

  // Reset peek state whenever the cards inside this build change
  useEffect(() => {
    setPeekDepth(0);
  }, [build.cards.length, build.id]);

  const cardSize = compact ? 'xs' : 'sm';
  const cardW = compact ? 52 : 68;
  const cardH = compact ? 74 : 96;
  const totalCards = build.cards.length;
  const effectiveDepth = Math.min(peekDepth, Math.max(0, totalCards - 1));

  const handleClick = () => {
    if (hasSelectedHandCard) {
      onSelectBuild?.(build);
      return;
    }
    if (totalCards > 1) {
      setPeekDepth((prev) => (prev + 1) % totalCards);
    } else {
      onSelectBuild?.(build);
    }
  };

  const handleContainerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const displayNumber = build.targetValue === 1 ? 'A' : String(build.targetValue);
  const ownerHint = isOwnedByViewer
    ? 'Yours'
    : isOwnedByPartner
      ? `${ownerName} (Partner)`
      : ownerName;

  // Extra width/height only when peeking so adjacent cards don't shift unexpectedly at rest
  const peekSpreadX = effectiveDepth > 0 ? effectiveDepth * (compact ? 14 : 18) : 0;

  return (
    <div
      role="button"
      tabIndex={0}
      data-table-item-id={build.id}
      data-drop-id={dataDropId}
      onClick={handleClick}
      onKeyDown={handleContainerKeyDown}
      title={
        hasSelectedHandCard
          ? `Play card on ${displayNumber} build (${ownerHint})`
          : totalCards > 1
            ? `Tap to peek cards in ${displayNumber} build (${ownerHint})`
            : `${displayNumber} build (${ownerHint})`
      }
      aria-label={`${build.isCemented ? 'Locked ' : ''}Build ${displayNumber} (${ownerHint})`}
      className="group relative flex flex-col items-center cursor-pointer select-none focus:outline-none"
      style={{
        paddingRight: peekSpreadX > 0 ? `${Math.min(48, peekSpreadX)}px` : undefined,
      }}
    >
      {/* Clean Floating Build Number Directly Above the Deck (+ Lock Icon if Cemented) */}
      <div
        className={`mb-1 flex items-center justify-center gap-1 font-mono-num font-extrabold leading-none tracking-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)] ${
          build.isCemented ? 'text-[#f3d48c]' : 'text-[#f4efe6]'
        } ${compact ? 'text-sm' : 'text-base'}`}
      >
        <span>{displayNumber}</span>
        {build.isCemented && (
          <Lock
            className={`${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} text-[#e6be72] shrink-0`}
            strokeWidth={2.5}
            aria-label="Locked"
          />
        )}
      </div>

      {/* Borderless Stacked Card Deck Directly on the Felt */}
      <div className="relative" style={{ width: cardW, height: cardH }}>
        {build.cards.map((card, idx) => {
          // distanceFromTop: 0 for top card, 1 for 2nd from top, 2 for 3rd, etc.
          const distanceFromTop = totalCards - 1 - idx;

          // Cards deeper than current peekDepth stay neatly tucked in the stack underneath
          let tx = -Math.min(distanceFromTop, 3) * 1.4;
          let ty = Math.min(distanceFromTop, 3) * 1.4;
          let rotDeg = 0;

          if (effectiveDepth > 0 && distanceFromTop < effectiveDepth) {
            // Each revealed top layer pivots/rotates outward to expose the rank/suit corner below it
            const peelStep = effectiveDepth - distanceFromTop;
            rotDeg = 14 + (peelStep - 1) * 7;
            tx = peelStep * (compact ? 15 : 20);
            ty = peelStep * (compact ? 3 : 4);
          }

          const isTopCard = distanceFromTop === 0;
          const isCurrentRevealedCard = distanceFromTop === effectiveDepth;

          return (
            <div
              key={card.id}
              className="absolute left-0 top-0 transition-transform duration-200 ease-out"
              style={{
                transformOrigin: '18% 85%',
                transform: `translate3d(${tx}px, ${ty}px, 0) rotate(${rotDeg}deg)`,
                zIndex: idx + 1,
              }}
            >
              <CardSvg
                card={card}
                faceUp
                size={cardSize}
                selected={isTopCard && isTargeted}
                highlighted={
                  isTopCard
                    ? highlightMode
                    : isCurrentRevealedCard && effectiveDepth > 0
                      ? 'build'
                      : null
                }
                className={
                  isTopCard
                    ? 'shadow-[0_6px_16px_rgba(0,0,0,0.48)]'
                    : 'shadow-[0_2px_6px_rgba(0,0,0,0.35)]'
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default BuildStackView;
