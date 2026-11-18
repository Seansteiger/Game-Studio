import { useId } from 'react';
import { Card } from '../studio/core';
import { MaskedPlayerSeatState, SACasinoPlayerView } from '../games/sa-casino/types';
import { CardSvg } from './CardSvg';

export interface PeripheralOpponentsProps {
  view: SACasinoPlayerView;
  activeSeat: number;
  diggableSeats?: ReadonlySet<number>;
  onClickDigSeat?: (seat: number) => void;
}

export interface FaceUpCapturedDeckProps {
  topCard: Card | null;
  hasMultipleCards: boolean;
  size: 'xs' | 'sm';
  isDiggable?: boolean;
  onClickDig?: () => void;
  playerName: string;
}

const DECK_DIMENSIONS: Record<FaceUpCapturedDeckProps['size'], { width: number; height: number }> = {
  xs: { width: 52, height: 74 },
  sm: { width: 68, height: 96 },
};

export function FaceUpCapturedDeck({
  topCard,
  hasMultipleCards,
  size,
  isDiggable = false,
  onClickDig,
  playerName,
}: FaceUpCapturedDeckProps) {
  const dims = DECK_DIMENSIONS[size];

  if (!topCard) {
    return (
      <div
        className="shrink-0 rounded-[6px] border border-dashed border-white/10 bg-black/20"
        style={{ width: dims.width, height: dims.height }}
        aria-label={`${playerName} empty capture pile`}
      />
    );
  }

  const stackContent = (
    <div
      className="relative shrink-0"
      style={{ width: dims.width, height: dims.height }}
    >
      {hasMultipleCards && (
        <>
          <div
            className="absolute inset-0 rounded-[7px] border border-[#d6ccb4]/55 bg-[#e6decb] shadow-sm"
            style={{ transform: 'translate3d(-3px, 3px, 0)' }}
          />
          <div
            className="absolute inset-0 rounded-[7px] border border-[#d6ccb4]/75 bg-[#f0e9d9] shadow-sm"
            style={{ transform: 'translate3d(-1.5px, 1.5px, 0)' }}
          />
        </>
      )}

      <div className="relative">
        <CardSvg
          card={topCard}
          faceUp
          size={size}
          highlighted={isDiggable ? 'build' : null}
          className={
            isDiggable
              ? 'ring-2 ring-amber-400/85 shadow-[0_0_16px_rgba(245,158,11,0.4)]'
              : 'shadow-md'
          }
        />
      </div>

      {isDiggable && (
        <span className="pointer-events-none absolute -bottom-2 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-amber-300/70 bg-[#26190d]/95 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-amber-200 shadow-md">
          Dig {topCard.label}
        </span>
      )}
    </div>
  );

  if (isDiggable && onClickDig) {
    return (
      <button
        type="button"
        onClick={onClickDig}
        title={`Dig ${topCard.label}`}
        aria-label={`Dig ${topCard.label} from ${playerName}`}
        className="pointer-events-auto relative cursor-pointer rounded-[7px] transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.97] focus:outline-none"
      >
        {stackContent}
      </button>
    );
  }

  return (
    <div
      className="relative"
      aria-label={`${playerName} top captured card ${topCard.label}`}
    >
      {stackContent}
    </div>
  );
}

interface SeatRoleInfo {
  player: MaskedPlayerSeatState;
  isPartner: boolean;
  position: 'north' | 'west' | 'east';
}

function getPeripheralSeats(view: SACasinoPlayerView): SeatRoleInfo[] {
  const bySeat = new Map<number, MaskedPlayerSeatState>();
  for (const p of view.players) {
    bySeat.set(p.seat, p);
  }

  const seats: SeatRoleInfo[] = [];

  if (view.mode === '1v1') {
    const north = bySeat.get(1);
    if (north) {
      seats.push({ player: north, isPartner: false, position: 'north' });
    }
    return seats;
  }

  if (view.mode === '3p-ffa') {
    const west = bySeat.get(1);
    const east = bySeat.get(2);
    if (west) seats.push({ player: west, isPartner: false, position: 'west' });
    if (east) seats.push({ player: east, isPartner: false, position: 'east' });
    return seats;
  }

  // '2v2-teams': Seat 2 = North Partner, Seat 1 = West Opponent, Seat 3 = East Opponent
  const north = bySeat.get(2);
  const west = bySeat.get(1);
  const east = bySeat.get(3);
  if (north) seats.push({ player: north, isPartner: true, position: 'north' });
  if (west) seats.push({ player: west, isPartner: false, position: 'west' });
  if (east) seats.push({ player: east, isPartner: false, position: 'east' });
  return seats;
}

function formatSeatName(name: string): string {
  return name.replace(/\s*\((Bot|Partner)\)$/i, '');
}

export interface OpponentHandsOverlayProps {
  position: 'north' | 'west' | 'east';
  isActive: boolean;
  compact?: boolean;
}

export function OpponentHandsOverlay({
  position,
  isActive,
  compact = false,
}: OpponentHandsOverlayProps) {
  const uid = useId().replace(/:/g, '');
  const cuffGradId = `cuff-${uid}`;
  const handGradId = `hand-${uid}`;

  const positionClass =
    position === 'north'
      ? compact
        ? 'left-1/2 -top-2.5 -translate-x-1/2'
        : 'left-1/2 -top-3.5 -translate-x-1/2'
      : position === 'west'
        ? '-left-6 top-1/2 -translate-y-1/2'
        : '-right-6 top-1/2 -translate-y-1/2';

  const reachTransform = !isActive
    ? 'translate3d(0px, 0px, 0)'
    : position === 'north'
      ? `translate3d(0px, ${compact ? 3 : 5}px, 0)`
      : position === 'west'
        ? 'translate3d(5px, 0px, 0)'
        : 'translate3d(-5px, 0px, 0)';

  const orientationClass =
    position === 'west'
      ? '-rotate-90'
      : position === 'east'
        ? 'rotate-90'
        : '';

  const sizeClass = compact ? 'h-[38px] w-[90px]' : 'h-[54px] w-[126px]';

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute z-0 select-none opacity-75 ${positionClass}`}
    >
      <div
        className="transition-transform duration-300 ease-out"
        style={{ transform: reachTransform }}
      >
        <svg
          viewBox="0 0 144 64"
          fill="none"
          className={`${sizeClass} ${orientationClass} overflow-visible`}
        >
          <defs>
            <linearGradient id={cuffGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1d120b" />
              <stop offset="100%" stopColor="#382317" />
            </linearGradient>
            <linearGradient id={handGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#845f44" />
              <stop offset="65%" stopColor="#a77d5c" />
              <stop offset="100%" stopColor="#bc9371" />
            </linearGradient>
          </defs>

          {/* Left stylized cuff, wrist & fingertips */}
          <g>
            <path
              d="M18 2 L44 2 L48 22 L20 22 Z"
              fill={`url(#${cuffGradId})`}
              stroke="rgba(200, 157, 84, 0.45)"
              strokeWidth="1.1"
            />
            <path
              d="M20 21.5 L48 21.5 L47.5 24.5 L20.5 24.5 Z"
              fill="rgba(240, 226, 199, 0.72)"
            />
            <path
              d="M23 24.5 C22 33 25 43 30 49 C32.5 52 36 52.5 38 50.5 C39.5 49 39 45.5 37.5 43 C39.5 46.5 42.5 50 45 49.5 C47.5 49 48 45 46.5 41.5 C48.2 44.5 50.8 46.5 52.8 45.5 C54.5 44.5 54 40.5 52 37 C49 31.5 46.5 27 45.5 24.5 Z"
              fill={`url(#${handGradId})`}
              stroke="rgba(243, 226, 195, 0.52)"
              strokeWidth="1.05"
              strokeLinejoin="round"
            />
            <path
              d="M32 39 C33.5 42.5 35.5 46 37.5 48.5 M39.5 36.5 C41.5 40.5 43.5 44.5 45.5 47.5"
              stroke="rgba(243, 226, 195, 0.28)"
              strokeWidth="0.9"
              strokeLinecap="round"
            />
          </g>

          {/* Right stylized cuff, wrist & fingertips */}
          <g transform="translate(144, 0) scale(-1, 1)">
            <path
              d="M18 2 L44 2 L48 22 L20 22 Z"
              fill={`url(#${cuffGradId})`}
              stroke="rgba(200, 157, 84, 0.45)"
              strokeWidth="1.1"
            />
            <path
              d="M20 21.5 L48 21.5 L47.5 24.5 L20.5 24.5 Z"
              fill="rgba(240, 226, 199, 0.72)"
            />
            <path
              d="M23 24.5 C22 33 25 43 30 49 C32.5 52 36 52.5 38 50.5 C39.5 49 39 45.5 37.5 43 C39.5 46.5 42.5 50 45 49.5 C47.5 49 48 45 46.5 41.5 C48.2 44.5 50.8 46.5 52.8 45.5 C54.5 44.5 54 40.5 52 37 C49 31.5 46.5 27 45.5 24.5 Z"
              fill={`url(#${handGradId})`}
              stroke="rgba(243, 226, 195, 0.52)"
              strokeWidth="1.05"
              strokeLinejoin="round"
            />
            <path
              d="M32 39 C33.5 42.5 35.5 46 37.5 48.5 M39.5 36.5 C41.5 40.5 43.5 44.5 45.5 47.5"
              stroke="rgba(243, 226, 195, 0.28)"
              strokeWidth="0.9"
              strokeLinecap="round"
            />
          </g>
        </svg>
      </div>
    </div>
  );
}

function ActionCalloutPill({
  text,
  swept,
  className = '',
}: {
  text: string;
  swept: boolean;
  className?: string;
}) {
  return (
    <div
      className={`max-w-[230px] truncate rounded-full border px-2.5 py-0.5 text-[10px] font-medium tracking-wide backdrop-blur-sm transition-opacity duration-200 ${
        swept
          ? 'border-emerald-400/50 bg-emerald-950/90 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
          : 'border-[#c89d54]/30 bg-[#1a120c]/90 text-[#e7d6b8]'
      } ${className}`}
    >
      {swept ? `SWEEP! ${text}` : text}
    </div>
  );
}

function MinimalNamePill({
  info,
  isActive,
  lastActionText,
  lastActionSwept,
}: {
  info: SeatRoleInfo;
  isActive: boolean;
  lastActionText: string | null;
  lastActionSwept: boolean;
}) {
  const { player, isPartner } = info;
  const displayName = formatSeatName(player.name);

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`flex items-center gap-2 rounded-full border px-3 py-1 backdrop-blur-md transition-[border-color,box-shadow,background-color] duration-200 ${
          isActive
            ? 'border-amber-400/85 bg-[#23180f]/95 shadow-[0_0_18px_rgba(245,158,11,0.28)]'
            : isPartner
              ? 'border-emerald-500/35 bg-[#112219]/85 shadow-md'
              : 'border-[#c89d54]/25 bg-[#19110b]/85 shadow-md'
        }`}
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full transition-colors duration-200 ${
            isActive
              ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)] animate-pulse'
              : 'bg-stone-600/70'
          }`}
        />

        <span className="max-w-[110px] truncate text-[11px] font-semibold tracking-wide text-[#f4efe6]">
          {displayName}
        </span>

        {isPartner && (
          <span className="rounded-full border border-emerald-400/30 bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-emerald-300">
            Partner
          </span>
        )}
      </div>

      {lastActionText && (
        <ActionCalloutPill text={lastActionText} swept={lastActionSwept} />
      )}
    </div>
  );
}

function NorthSeat({
  info,
  isActive,
  isDiggable,
  onClickDig,
  lastActionText,
  lastActionSwept,
}: {
  info: SeatRoleInfo;
  isActive: boolean;
  isDiggable: boolean;
  onClickDig?: () => void;
  lastActionText: string | null;
  lastActionSwept: boolean;
}) {
  const count = info.player.handCount;
  const stepPx = count > 8 ? 14 : count > 5 ? 17 : 20;
  const maxAngle = Math.min(14, count * 1.5);
  const displayName = formatSeatName(info.player.name);

  return (
    <div className="pointer-events-none flex flex-col items-center gap-2">
      <MinimalNamePill
        info={info}
        isActive={isActive}
        lastActionText={null}
        lastActionSwept={lastActionSwept}
      />

      <div className="flex items-center gap-3">
        {/* Perspective-foreshortened face-down card fan with stylized tabletop hands */}
        {count > 0 && (
          <div
            className="relative flex h-[74px] items-start justify-center"
            style={{
              perspective: '520px',
              width: `${Math.max(88, (count - 1) * stepPx + 46)}px`,
            }}
          >
            <OpponentHandsOverlay position="north" isActive={isActive} />
            <div
              className="relative z-10 flex h-full w-full scale-[0.88] origin-top items-center justify-center"
              style={{ transform: 'rotateX(22deg)', transformStyle: 'preserve-3d' }}
            >
              {Array.from({ length: count }).map((_, idx) => {
                const mid = (count - 1) / 2;
                const offset = idx - mid;
                const ratio = mid === 0 ? 0 : offset / mid;
                const angle = -ratio * maxAngle;
                const translateX = offset * stepPx;
                const translateY = -Math.abs(ratio) * 3;
                return (
                  <div
                    key={idx}
                    className="absolute transition-transform duration-200 ease-out"
                    style={{
                      transform: `translate3d(${translateX}px, ${translateY}px, 0) rotate(${angle}deg)`,
                      zIndex: idx + 1,
                    }}
                  >
                    <div
                      className="animate-card-breathe"
                      style={{ animationDelay: `${(idx * 0.25).toFixed(2)}s` }}
                    >
                      <CardSvg
                        faceUp={false}
                        size="xs"
                        className={
                          isActive
                            ? 'ring-1 ring-amber-400/50 shadow-lg'
                            : 'shadow-md'
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Face-Up Captured Deck showing only top-most card */}
        <div className="flex flex-col items-center gap-1">
          <FaceUpCapturedDeck
            topCard={info.player.topCapturedCard}
            hasMultipleCards={info.player.capturedCount > 1}
            size="xs"
            isDiggable={isDiggable}
            onClickDig={onClickDig}
            playerName={displayName}
          />
          <span className="rounded-full border border-[#c89d54]/25 bg-[#150e09]/85 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-[#dfc088] backdrop-blur-sm">
            Captures
          </span>
        </div>
      </div>

      {lastActionText && (
        <ActionCalloutPill
          text={lastActionText}
          swept={lastActionSwept}
          className="mt-0.5"
        />
      )}
    </div>
  );
}

function SideSeat({
  info,
  side,
  isActive,
  isDiggable,
  onClickDig,
  lastActionText,
  lastActionSwept,
}: {
  info: SeatRoleInfo;
  side: 'west' | 'east';
  isActive: boolean;
  isDiggable: boolean;
  onClickDig?: () => void;
  lastActionText: string | null;
  lastActionSwept: boolean;
}) {
  const count = info.player.handCount;
  const visibleBackCount = Math.min(count, 13);
  const stepPy = visibleBackCount > 9 ? 11 : visibleBackCount > 5 ? 14 : 17;
  const maxAngle = Math.min(16, visibleBackCount * 1.4);
  const inwardTilt = side === 'west' ? 76 : -76;
  const displayName = formatSeatName(info.player.name);

  return (
    <div
      className={`pointer-events-none flex flex-col gap-2 ${
        side === 'west' ? 'items-start' : 'items-end'
      }`}
    >
      <MinimalNamePill
        info={info}
        isActive={isActive}
        lastActionText={lastActionText}
        lastActionSwept={lastActionSwept}
      />

      <div
        className={`flex items-center gap-3 ${
          side === 'west' ? 'flex-row' : 'flex-row-reverse'
        }`}
      >
        {visibleBackCount > 0 && (
          <div
            className={`relative flex items-center justify-center ${
              side === 'west' ? 'ml-3' : 'mr-3'
            }`}
            style={{
              height: `${Math.max(76, (visibleBackCount - 1) * stepPy + 52)}px`,
              width: '64px',
            }}
          >
            <OpponentHandsOverlay position={side} isActive={isActive} />
            <div className="relative z-10 flex h-full w-full items-center justify-center">
              {Array.from({ length: visibleBackCount }).map((_, idx) => {
                const mid = (visibleBackCount - 1) / 2;
                const offset = idx - mid;
                const ratio = mid === 0 ? 0 : offset / mid;
                const fanRot =
                  side === 'west'
                    ? inwardTilt + ratio * maxAngle
                    : inwardTilt - ratio * maxAngle;
                const translateY = offset * stepPy;
                const translateX =
                  side === 'west' ? -Math.abs(ratio) * 3 : Math.abs(ratio) * 3;

                return (
                  <div
                    key={idx}
                    className="absolute transition-transform duration-200 ease-out"
                    style={{
                      transform: `translate3d(${translateX}px, ${translateY}px, 0) rotate(${fanRot}deg)`,
                      zIndex: idx + 1,
                    }}
                  >
                    <div
                      className="animate-card-breathe"
                      style={{ animationDelay: `${(idx * 0.2).toFixed(2)}s` }}
                    >
                      <CardSvg
                        faceUp={false}
                        size="xs"
                        className={
                          isActive
                            ? 'ring-1 ring-amber-400/55 shadow-lg'
                            : 'shadow-md'
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Face-Up Captured Deck next to hand fan */}
        <div className="flex flex-col items-center gap-1">
          <FaceUpCapturedDeck
            topCard={info.player.topCapturedCard}
            hasMultipleCards={info.player.capturedCount > 1}
            size="xs"
            isDiggable={isDiggable}
            onClickDig={onClickDig}
            playerName={displayName}
          />
          <span className="rounded-full border border-[#c89d54]/25 bg-[#150e09]/85 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-[#dfc088] backdrop-blur-sm">
            Captures
          </span>
        </div>
      </div>
    </div>
  );
}

function MobileOpponentSeat({
  info,
  seatCount,
  isActive,
  isDiggable,
  onClickDig,
}: {
  info: SeatRoleInfo;
  seatCount: number;
  isActive: boolean;
  isDiggable: boolean;
  onClickDig?: () => void;
}) {
  const shortName = formatSeatName(info.player.name);
  const count = info.player.handCount;

  const cardScale = seatCount === 1 ? 0.62 : seatCount === 2 ? 0.58 : 0.52;
  const cardW = Math.round(52 * cardScale);
  const cardH = Math.round(74 * cardScale);
  const maxVisible = seatCount === 1 ? 10 : seatCount === 2 ? 8 : 7;
  const visibleCount = Math.min(count, maxVisible);
  const stepPx =
    seatCount === 1 ? (visibleCount > 7 ? 9.5 : 11.5) : seatCount === 2 ? 6.5 : 4.2;
  const maxAngle = Math.min(10, visibleCount * 1.2);
  const fanWidth =
    visibleCount > 0 ? Math.max(cardW, (visibleCount - 1) * stepPx + cardW) : cardW;

  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5">
      {/* Compact Seat Name Pill */}
      <div
        className={`flex max-w-[140px] items-center gap-1 rounded-full border px-2 py-0.5 backdrop-blur-md transition-[border-color,box-shadow,background-color] duration-200 ${
          isActive
            ? 'border-amber-400/85 bg-[#23180f]/95 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
            : info.isPartner
              ? 'border-emerald-500/35 bg-[#112219]/85'
              : 'border-[#c89d54]/25 bg-[#19110b]/85'
        }`}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            isActive
              ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)] animate-pulse'
              : 'bg-stone-600/75'
          }`}
        />
        <span className="truncate text-[10px] font-semibold leading-none text-[#f4efe6]">
          {shortName}
        </span>
        {info.isPartner && (
          <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-500/20 px-1 py-0.2 text-[8px] font-bold leading-none tracking-wide text-emerald-300">
            {seatCount >= 3 ? 'P' : 'Partner'}
          </span>
        )}
      </div>

      {/* Upper Table Edge: Mini Face-Down Card Fan + Compact Face-Up Captured Deck */}
      <div
        className={`flex items-center justify-center ${
          seatCount >= 3 ? 'gap-1' : 'gap-2'
        }`}
      >
        <div
          className="relative flex shrink-0 items-center justify-center"
          style={{ width: `${fanWidth}px`, height: `${cardH}px` }}
        >
          {seatCount === 1 && visibleCount > 0 && (
            <OpponentHandsOverlay position="north" isActive={isActive} compact />
          )}

          {visibleCount > 0 && (
            <div className="relative z-10 flex h-full w-full items-center justify-center">
              {Array.from({ length: visibleCount }).map((_, idx) => {
                const mid = (visibleCount - 1) / 2;
                const offset = idx - mid;
                const ratio = mid === 0 ? 0 : offset / mid;
                const angle = -ratio * maxAngle;
                const translateX = offset * stepPx;
                const translateY = -Math.abs(ratio) * 1.5;

                return (
                  <div
                    key={idx}
                    className="absolute transition-transform duration-200 ease-out"
                    style={{
                      width: 52,
                      height: 74,
                      transform: `translate3d(${translateX}px, ${translateY}px, 0) rotate(${angle}deg) scale(${cardScale})`,
                      zIndex: idx + 1,
                    }}
                  >
                    <CardSvg
                      faceUp={false}
                      size="xs"
                      className={
                        isActive
                          ? 'ring-1 ring-amber-400/50 shadow-md'
                          : 'shadow-sm'
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Scaled FaceUpCapturedDeck showing top-most card & stack layers */}
        <div
          className="relative shrink-0 overflow-visible"
          style={{ width: `${cardW}px`, height: `${cardH}px` }}
        >
          <div
            className="origin-top-left"
            style={{
              width: 52,
              height: 74,
              transform: `scale(${cardScale})`,
            }}
          >
            <FaceUpCapturedDeck
              topCard={info.player.topCapturedCard}
              hasMultipleCards={info.player.capturedCount > 1}
              size="xs"
              isDiggable={isDiggable}
              onClickDig={onClickDig}
              playerName={shortName}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function PeripheralOpponents({
  view,
  activeSeat,
  diggableSeats,
  onClickDigSeat,
}: PeripheralOpponentsProps) {
  const peripheralSeats = getPeripheralSeats(view);
  const north = peripheralSeats.find((s) => s.position === 'north');
  const west = peripheralSeats.find((s) => s.position === 'west');
  const east = peripheralSeats.find((s) => s.position === 'east');
  const mobileSeats =
    view.mode === '2v2-teams'
      ? [west, north, east].filter((s): s is SeatRoleInfo => Boolean(s))
      : peripheralSeats;

  const getSeatAction = (seat: number): { text: string | null; swept: boolean } => {
    const summary = view.lastActionSummary;
    if (!summary || summary.seat !== seat || summary.actionType === 'DEAL') {
      return { text: null, swept: false };
    }
    return {
      text: summary.description,
      swept: summary.swept,
    };
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {/* Mobile Upper Table Edge Opponents (< 768px) */}
      <div className="md:hidden absolute top-1.5 inset-x-1.5 flex max-h-[96px] flex-col items-center gap-0.5">
        <div
          className={`flex w-full items-start ${
            mobileSeats.length === 1
              ? 'justify-center'
              : mobileSeats.length === 2
                ? 'justify-around px-2'
                : 'justify-between px-0.5'
          }`}
        >
          {mobileSeats.map((info) => {
            const isActive =
              activeSeat === info.player.seat && view.phase === 'PLAYING';
            const topCard = info.player.topCapturedCard;
            const isDiggable = Boolean(diggableSeats?.has(info.player.seat) && topCard);

            return (
              <MobileOpponentSeat
                key={info.player.seat}
                info={info}
                seatCount={mobileSeats.length}
                isActive={isActive}
                isDiggable={isDiggable}
                onClickDig={
                  onClickDigSeat ? () => onClickDigSeat(info.player.seat) : undefined
                }
              />
            );
          })}
        </div>

        {/* Compact Mobile Last-Action Callout */}
        {(() => {
          const actionOwner = peripheralSeats.find(
            (s) => getSeatAction(s.player.seat).text !== null
          );
          if (!actionOwner) return null;
          const action = getSeatAction(actionOwner.player.seat);
          if (!action.text) return null;
          const ownerShort = formatSeatName(actionOwner.player.name);
          return (
            <ActionCalloutPill
              text={`${ownerShort}: ${action.text}`}
              swept={action.swept}
              className="max-w-[92vw] text-[9px] leading-tight"
            />
          );
        })()}
      </div>

      {/* Desktop Perspective Seats (>= 768px) */}
      {/* North Seat */}
      {north && (
        <div className="hidden md:block absolute left-1/2 top-2 -translate-x-1/2">
          <NorthSeat
            info={north}
            isActive={activeSeat === north.player.seat && view.phase === 'PLAYING'}
            isDiggable={Boolean(diggableSeats?.has(north.player.seat))}
            onClickDig={
              onClickDigSeat ? () => onClickDigSeat(north.player.seat) : undefined
            }
            lastActionText={getSeatAction(north.player.seat).text}
            lastActionSwept={getSeatAction(north.player.seat).swept}
          />
        </div>
      )}

      {/* West Seat */}
      {west && (
        <div className="hidden md:block absolute left-3 top-1/2 -translate-y-1/2">
          <SideSeat
            info={west}
            side="west"
            isActive={activeSeat === west.player.seat && view.phase === 'PLAYING'}
            isDiggable={Boolean(diggableSeats?.has(west.player.seat))}
            onClickDig={
              onClickDigSeat ? () => onClickDigSeat(west.player.seat) : undefined
            }
            lastActionText={getSeatAction(west.player.seat).text}
            lastActionSwept={getSeatAction(west.player.seat).swept}
          />
        </div>
      )}

      {/* East Seat */}
      {east && (
        <div className="hidden md:block absolute right-3 top-1/2 -translate-y-1/2">
          <SideSeat
            info={east}
            side="east"
            isActive={activeSeat === east.player.seat && view.phase === 'PLAYING'}
            isDiggable={Boolean(diggableSeats?.has(east.player.seat))}
            onClickDig={
              onClickDigSeat ? () => onClickDigSeat(east.player.seat) : undefined
            }
            lastActionText={getSeatAction(east.player.seat).text}
            lastActionSwept={getSeatAction(east.player.seat).swept}
          />
        </div>
      )}
    </div>
  );
}
