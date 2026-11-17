import { Card, isRedSuit } from '../studio/core';
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
        {/* Perspective-foreshortened face-down card fan */}
        {count > 0 && (
          <div
            className="relative flex h-[72px] items-start justify-center"
            style={{
              perspective: '520px',
              width: `${Math.max(56, (count - 1) * stepPx + 46)}px`,
            }}
          >
            <div
              className="relative flex h-full w-full scale-[0.88] origin-top items-center justify-center"
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
        <FaceUpCapturedDeck
          topCard={info.player.topCapturedCard}
          hasMultipleCards={info.player.capturedCount > 1}
          size="xs"
          isDiggable={isDiggable}
          onClickDig={onClickDig}
          playerName={displayName}
        />
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
              height: `${Math.max(64, (visibleBackCount - 1) * stepPy + 52)}px`,
              width: '64px',
            }}
          >
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
        )}

        {/* Face-Up Captured Deck next to hand fan */}
        <FaceUpCapturedDeck
          topCard={info.player.topCapturedCard}
          hasMultipleCards={info.player.capturedCount > 1}
          size="xs"
          isDiggable={isDiggable}
          onClickDig={onClickDig}
          playerName={displayName}
        />
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
      {/* Mobile Compact Opponent Status Strip (< 768px) */}
      <div className="md:hidden absolute top-1.5 inset-x-2 flex flex-col items-center gap-1">
        <div className="flex w-full items-center justify-center gap-1.5 flex-wrap">
          {peripheralSeats.map((info) => {
            const isActive =
              activeSeat === info.player.seat && view.phase === 'PLAYING';
            const shortName = formatSeatName(info.player.name);
            const topCard = info.player.topCapturedCard;
            const isDiggable = Boolean(diggableSeats?.has(info.player.seat) && topCard);

            return (
              <div
                key={info.player.seat}
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 backdrop-blur-md transition-[border-color,box-shadow] duration-200 ${
                  isActive
                    ? 'border-amber-400/85 bg-[#23180f]/95 shadow-[0_0_14px_rgba(245,158,11,0.28)]'
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
                <span className="max-w-[68px] truncate text-[10px] font-semibold text-[#f4efe6]">
                  {shortName}
                </span>

                {info.isPartner && (
                  <span className="rounded border border-emerald-400/30 bg-emerald-500/20 px-1 py-0.2 text-[8px] font-bold tracking-wider text-emerald-300 uppercase">
                    Partner
                  </span>
                )}

                <span
                  className="inline-flex items-center gap-0.5 rounded border border-[#c89d54]/35 bg-[#481212]/90 px-1 py-0.2 text-[9px] font-mono-num font-bold text-[#f3dfb7] tabular-nums"
                  title={`${info.player.handCount} cards in hand`}
                >
                  <span className="inline-block h-2.5 w-1.5 rounded-[1px] border border-[#c89d54]/60 bg-[#6e1c1c]" />
                  {info.player.handCount}
                </span>

                {/* Face-Up Top Captured Card */}
                {topCard ? (
                  isDiggable && onClickDigSeat ? (
                    <button
                      type="button"
                      onClick={() => onClickDigSeat(info.player.seat)}
                      title={`Dig ${topCard.label}`}
                      aria-label={`Dig ${topCard.label} from ${shortName}`}
                      className={`pointer-events-auto inline-flex items-center gap-0.5 rounded border border-amber-400 bg-[#fbf8f1] px-1 py-0.5 text-[10px] font-mono-num font-extrabold leading-none shadow-[0_0_10px_rgba(245,158,11,0.45)] active:scale-95 ${
                        isRedSuit(topCard.suit) ? 'text-[#a91d24]' : 'text-[#181a1f]'
                      }`}
                    >
                      <span>{topCard.label}</span>
                    </button>
                  ) : (
                    <span
                      className={`inline-flex items-center rounded border border-[#d6ccb4] bg-[#fbf8f1] px-1 py-0.5 text-[10px] font-mono-num font-extrabold leading-none shadow-sm ${
                        isRedSuit(topCard.suit) ? 'text-[#a91d24]' : 'text-[#181a1f]'
                      }`}
                      aria-label={`${shortName} top captured card ${topCard.label}`}
                    >
                      {topCard.label}
                    </span>
                  )
                ) : (
                  <span
                    className="inline-block h-4 w-3 rounded-[2px] border border-dashed border-white/15 bg-black/25"
                    aria-label={`${shortName} empty capture pile`}
                  />
                )}
              </div>
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
              className="max-w-[92vw] text-[9px]"
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
