import { useEffect, useRef, useState } from 'react';
import { Card } from '../studio/core';
import { CardSvg } from './CardSvg';

export interface PlayerHandFanProps {
  hand: readonly Card[];
  isMyTurn: boolean;
  selectedCardId: string | null;
  possessionLockedRanks: Set<number>;
  capturableCardIds: Set<string>;
  buildableCardIds: Set<string>;
  onSelectCard: (card: Card) => void;
  onDragStartCard: (card: Card, clientX: number, clientY: number) => void;
  onDragMoveCard: (clientX: number, clientY: number) => void;
  onDragEndCard: (card: Card, clientX: number, clientY: number) => void;
}

interface PointerSession {
  pointerId: number;
  card: Card;
  startX: number;
  startY: number;
  hasDragged: boolean;
}

const DRAG_THRESHOLD_PX = 8;

export function PlayerHandFan({
  hand,
  isMyTurn,
  selectedCardId,
  possessionLockedRanks,
  capturableCardIds,
  buildableCardIds,
  onSelectCard,
  onDragStartCard,
  onDragMoveCard,
  onDragEndCard,
}: PlayerHandFanProps) {
  const sessionRef = useRef<PointerSession | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = viewportWidth < 768;
  const count = hand.length;
  const cardSize: 'sm' | 'md' | 'lg' = isMobile
    ? 'sm'
    : count > 10
      ? 'md'
      : 'lg';
  const cardWidth = cardSize === 'sm' ? 68 : cardSize === 'md' ? 88 : 104;

  // Adaptive horizontal spacing so 1-13 cards form a balanced foreground arc without horizontal overflow
  const desktopBaseSpread =
    count >= 12 ? 42 : count >= 9 ? 48 : count >= 6 ? 56 : 64;
  const cardSpreadPx = isMobile
    ? Math.max(
        16,
        Math.min(32, Math.floor((viewportWidth - 116) / Math.max(1, count - 1)))
      )
    : Math.min(
        desktopBaseSpread,
        Math.max(30, Math.floor((viewportWidth - 180) / Math.max(1, count - 1)))
      );
  const maxArcDeg = Math.min(isMobile ? 8 : 14, Math.max(4, (count - 1) * 1.2));

  const handlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    card: Card
  ) => {
    if (!isMyTurn) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    e.currentTarget.setPointerCapture(e.pointerId);
    sessionRef.current = {
      pointerId: e.pointerId,
      card,
      startX: e.clientX,
      startY: e.clientY,
      hasDragged: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== e.pointerId) return;

    if (!session.hasDragged) {
      const dist = Math.hypot(e.clientX - session.startX, e.clientY - session.startY);
      if (dist > DRAG_THRESHOLD_PX) {
        session.hasDragged = true;
        setDraggingCardId(session.card.id);
        onDragStartCard(session.card, e.clientX, e.clientY);
      }
    } else {
      onDragMoveCard(e.clientX, e.clientY);
    }
  };

  const finishPointer = (
    e: React.PointerEvent<HTMLDivElement>,
    cancelled: boolean
  ) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== e.pointerId) return;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    sessionRef.current = null;

    if (session.hasDragged) {
      setDraggingCardId(null);
      onDragEndCard(session.card, e.clientX, e.clientY);
    } else if (!cancelled && isMyTurn) {
      onSelectCard(session.card);
    }
  };

  if (count === 0) {
    return (
      <div className="pointer-events-none flex h-24 items-center justify-center">
        <span className="rounded-full border border-[#c89d54]/20 bg-[#140e09]/75 px-3 py-1 text-xs font-medium tracking-wide text-stone-400">
          Hand empty — awaiting next deal
        </span>
      </div>
    );
  }

  const containerWidth = Math.max(88, (count - 1) * cardSpreadPx + cardWidth);

  return (
    <div className="relative flex flex-col items-center justify-end select-none">
      {/* Minimal Your Turn dot */}
      {isMyTurn && (
        <div className="pointer-events-none mb-1 flex items-center text-[10px] font-medium tracking-wider uppercase md:mb-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-[#261a10]/90 px-2.5 py-0.5 text-amber-200 shadow-[0_0_16px_rgba(245,158,11,0.2)] backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            Your Turn
          </span>
        </div>
      )}

      {/* Parabolic Curved Fan */}
      <div
        className="relative flex h-32 items-end justify-center pb-3 md:h-44 md:pb-4"
        style={{ width: `${containerWidth}px` }}
      >
        {hand.map((card, index) => {
          const mid = (count - 1) / 2;
          const offset = index - mid;
          const norm = mid === 0 ? 0 : offset / mid; // -1..+1
          const angleDeg = norm * maxArcDeg;
          const translateX = offset * cardSpreadPx;
          // Parabolic arc: center sits higher, edges drop smoothly
          const arcDropY = norm * norm * (isMobile ? 2.5 : 9);

          const isSelected = selectedCardId === card.id;
          const isHovered = hoveredCardId === card.id;
          const isDragging = draggingCardId === card.id;
          const isLocked = possessionLockedRanks.has(card.rank);
          const canCapture = capturableCardIds.has(card.id);
          const canBuild = buildableCardIds.has(card.id);

          const liftY = isSelected
            ? isMobile
              ? -14
              : -22
            : isHovered && isMyTurn
              ? isMobile
                ? -8
                : -14
              : 0;
          const hoverScale = isSelected ? 1.07 : isHovered && isMyTurn ? 1.04 : 1;
          const highlightState = canCapture
            ? 'capture'
            : canBuild
              ? 'build'
              : null;

          return (
            <div
              key={card.id}
              role="button"
              tabIndex={isMyTurn ? 0 : -1}
              aria-label={`Play ${card.label}`}
              onKeyDown={(e) => {
                if (!isMyTurn) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectCard(card);
                }
              }}
              onPointerDown={(e) => handlePointerDown(e, card)}
              onPointerMove={handlePointerMove}
              onPointerUp={(e) => finishPointer(e, false)}
              onPointerCancel={(e) => finishPointer(e, true)}
              onPointerEnter={() => setHoveredCardId(card.id)}
              onPointerLeave={() =>
                setHoveredCardId((prev) => (prev === card.id ? null : prev))
              }
              className={`absolute bottom-4 rounded-xl touch-none transition-[transform,opacity] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-amber-400/80 md:bottom-4 ${
                isMyTurn ? 'cursor-grab active:cursor-grabbing' : 'cursor-default opacity-80'
              } ${isDragging ? 'opacity-25' : 'opacity-100'}`}
              style={{
                transform: `translate3d(${translateX}px, ${arcDropY + liftY}px, 0) rotate(${
                  isSelected ? angleDeg * 0.35 : angleDeg
                }deg) scale(${hoverScale})`,
                zIndex: isSelected ? 60 : isHovered ? 50 : index + 10,
                transformOrigin: '50% 88%',
              }}
            >
              <div
                className={isSelected || isDragging ? '' : 'animate-card-breathe'}
                style={{ animationDelay: `${(index * 0.22).toFixed(2)}s` }}
              >
                <div className="relative">
                  <CardSvg
                    card={card}
                    faceUp
                    size={cardSize}
                    selected={isSelected}
                    highlighted={isMyTurn ? highlightState : null}
                    possessionLocked={isLocked}
                    className={
                      isMyTurn && (isHovered || isSelected)
                        ? 'shadow-[0_14px_28px_rgba(0,0,0,0.6)]'
                        : 'shadow-[0_8px_18px_rgba(0,0,0,0.45)]'
                    }
                  />

                  {/* Capability Indicator Dots (top-right corner) */}
                  {isMyTurn && (canCapture || canBuild) && (
                    <div className="pointer-events-none absolute -top-1.5 right-1 flex items-center gap-1">
                      {canCapture && (
                        <span
                          title="Can capture on table"
                          className="h-2.5 w-2.5 rounded-full border border-emerald-200/80 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.85)]"
                        />
                      )}
                      {canBuild && (
                        <span
                          title="Can build or cement"
                          className="h-2.5 w-2.5 rounded-full border border-amber-100/80 bg-[#d4a44a] shadow-[0_0_8px_rgba(212,164,74,0.85)]"
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
