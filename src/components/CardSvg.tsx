import { useId } from 'react';
import {
  Card,
  Suit,
  getRankSymbol,
  isBigCasino,
  isLittleCasino,
  isRedSuit,
} from '../studio/core/card';

export interface CardSvgProps {
  card?: Card;
  faceUp?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  selected?: boolean;
  highlighted?: 'capture' | 'build' | 'cement' | null;
  possessionLocked?: boolean;
  className?: string;
}

const SIZE_DIMENSIONS: Record<NonNullable<CardSvgProps['size']>, { width: number; height: number }> = {
  xs: { width: 52, height: 74 },
  sm: { width: 68, height: 96 },
  md: { width: 88, height: 124 },
  lg: { width: 104, height: 148 },
};

/**
 * Vector suit paths normalized to a 24x24 viewBox centered at (12, 12).
 */
function renderSuitPath(suit: Suit): string {
  switch (suit) {
    case 'S':
      return 'M12 2.2 C9.4 5.8 4.2 9.4 4.2 13.8 C4.2 16.7 6.5 18.6 8.9 18.6 C10.3 18.6 11.2 18.0 11.7 17.3 L10.2 21.8 L13.8 21.8 L12.3 17.3 C12.8 18.0 13.7 18.6 15.1 18.6 C17.5 18.6 19.8 16.7 19.8 13.8 C19.8 9.4 14.6 5.8 12 2.2 Z';
    case 'H':
      return 'M12 21.2 C12 21.2 3.6 15.4 3.6 9.3 C3.6 6.2 6.0 3.8 8.8 3.8 C10.4 3.8 11.5 4.7 12 5.9 C12.5 4.7 13.6 3.8 15.2 3.8 C18.0 3.8 20.4 6.2 20.4 9.3 C20.4 15.4 12 21.2 12 21.2 Z';
    case 'D':
      return 'M12 2.2 L19.6 12 L12 21.8 L4.4 12 Z';
    case 'C':
      return 'M12 2.6 C9.6 2.6 7.8 4.4 7.8 6.8 C7.8 7.9 8.3 8.9 9.0 9.6 C8.4 9.4 7.7 9.2 7.0 9.2 C4.6 9.2 2.8 11.0 2.8 13.4 C2.8 15.7 4.7 17.5 7.0 17.5 C8.8 17.5 10.3 16.4 10.9 14.8 L9.8 21.4 L14.2 21.4 L13.1 14.8 C13.7 16.4 15.2 17.5 17.0 17.5 C19.3 17.5 21.2 15.7 21.2 13.4 C21.2 11.0 19.4 9.2 17.0 9.2 C16.3 9.2 15.6 9.4 15.0 9.6 C15.7 8.9 16.2 7.9 16.2 6.8 C16.2 4.4 14.4 2.6 12 2.6 Z';
  }
}

interface SuitGlyphProps {
  suit: Suit;
  x: number;
  y: number;
  size: number;
  fill: string;
  inverted?: boolean;
}

function SuitGlyph({ suit, x, y, size, fill, inverted = false }: SuitGlyphProps) {
  const scale = size / 24;
  const half = size / 2;
  const transform = inverted
    ? `translate(${x + half}, ${y + half}) rotate(180) translate(${-half}, ${-half}) scale(${scale})`
    : `translate(${x - half}, ${y - half}) scale(${scale})`;

  return <path d={renderSuitPath(suit)} fill={fill} transform={transform} />;
}

interface PipCoord {
  x: number;
  y: number;
  inverted?: boolean;
}

function getNumberPipCoords(rank: number): PipCoord[] {
  const L = 32;
  const C = 44;
  const R = 56;
  const T = 30;
  const B = 94;
  const M = 62;
  const UM = 50;
  const LM = 74;

  switch (rank) {
    case 2:
      return [
        { x: C, y: 34 },
        { x: C, y: 90, inverted: true },
      ];
    case 3:
      return [
        { x: C, y: T },
        { x: C, y: M },
        { x: C, y: B, inverted: true },
      ];
    case 4:
      return [
        { x: L, y: T },
        { x: R, y: T },
        { x: L, y: B, inverted: true },
        { x: R, y: B, inverted: true },
      ];
    case 5:
      return [
        { x: L, y: T },
        { x: R, y: T },
        { x: C, y: M },
        { x: L, y: B, inverted: true },
        { x: R, y: B, inverted: true },
      ];
    case 6:
      return [
        { x: L, y: T },
        { x: R, y: T },
        { x: L, y: M },
        { x: R, y: M },
        { x: L, y: B, inverted: true },
        { x: R, y: B, inverted: true },
      ];
    case 7:
      return [
        { x: L, y: T },
        { x: R, y: T },
        { x: C, y: 45 },
        { x: L, y: M },
        { x: R, y: M },
        { x: L, y: B, inverted: true },
        { x: R, y: B, inverted: true },
      ];
    case 8:
      return [
        { x: L, y: T },
        { x: R, y: T },
        { x: C, y: 45 },
        { x: L, y: M },
        { x: R, y: M },
        { x: C, y: 79, inverted: true },
        { x: L, y: B, inverted: true },
        { x: R, y: B, inverted: true },
      ];
    case 9:
      return [
        { x: L, y: 28 },
        { x: R, y: 28 },
        { x: L, y: UM },
        { x: R, y: UM },
        { x: C, y: M },
        { x: L, y: LM, inverted: true },
        { x: R, y: LM, inverted: true },
        { x: L, y: 96, inverted: true },
        { x: R, y: 96, inverted: true },
      ];
    case 10:
      return [
        { x: L, y: 28 },
        { x: R, y: 28 },
        { x: C, y: 39 },
        { x: L, y: UM },
        { x: R, y: UM },
        { x: L, y: LM, inverted: true },
        { x: R, y: LM, inverted: true },
        { x: C, y: 85, inverted: true },
        { x: L, y: 96, inverted: true },
        { x: R, y: 96, inverted: true },
      ];
    default:
      return [];
  }
}

function CourtEmblem({ rank, suit, inkColor }: { rank: 11 | 12 | 13; suit: Suit; inkColor: string }) {
  const gold = '#c89d54';
  const goldMuted = 'rgba(200, 157, 84, 0.35)';

  return (
    <g>
      {/* Inner court frame */}
      <rect
        x={19}
        y={19}
        width={50}
        height={86}
        rx={3}
        fill="rgba(200, 157, 84, 0.04)"
        stroke={goldMuted}
        strokeWidth={1}
      />
      <rect
        x={22}
        y={22}
        width={44}
        height={80}
        rx={2}
        fill="none"
        stroke={inkColor}
        strokeOpacity={0.18}
        strokeWidth={0.75}
      />

      {/* Corner geometric miters */}
      <path
        d="M22 28 L28 22 M60 22 L66 28 M22 96 L28 102 M60 102 L66 96"
        stroke={gold}
        strokeWidth={1}
        strokeLinecap="round"
      />

      {rank === 11 && (
        /* Jack: Geometric Heraldic Shield & Halberd Chevron Crest */
        <g>
          <polygon
            points="44,31 55,44 52,66 44,75 36,66 33,44"
            fill="none"
            stroke={inkColor}
            strokeWidth={1.6}
          />
          <polygon
            points="44,36 51,46 49,64 44,70 39,64 37,46"
            fill={inkColor}
            fillOpacity={0.08}
            stroke={gold}
            strokeWidth={1.1}
          />
          <path d="M36 52 L44 43 L52 52" fill="none" stroke={inkColor} strokeWidth={1.6} />
          <path d="M38 58 L44 51 L50 58" fill="none" stroke={gold} strokeWidth={1.3} />
          <line x1={44} y1={27} x2={44} y2={79} stroke={gold} strokeWidth={1.1} strokeOpacity={0.8} />
          <SuitGlyph suit={suit} x={44} y={89} size={13} fill={inkColor} />
        </g>
      )}

      {rank === 12 && (
        /* Queen: Geometric Protea Botanical Rosette & Crown Crest */
        <g>
          {/* Crown arc & geometric petals */}
          <path
            d="M31 44 L36 33 L44 40 L52 33 L57 44 Z"
            fill={gold}
            fillOpacity={0.22}
            stroke={gold}
            strokeWidth={1.3}
            strokeLinejoin="round"
          />
          <circle cx={44} cy={62} r={14} fill="none" stroke={inkColor} strokeWidth={1.2} strokeOpacity={0.3} />
          <polygon
            points="44,47 48,58 59,62 48,66 44,77 40,66 29,62 40,58"
            fill={inkColor}
            fillOpacity={0.1}
            stroke={inkColor}
            strokeWidth={1.3}
          />
          <polygon
            points="44,53 51,62 44,71 37,62"
            fill="none"
            stroke={gold}
            strokeWidth={1.3}
          />
          <circle cx={44} cy={62} r={2.4} fill={gold} />
          <SuitGlyph suit={suit} x={44} y={89} size={13} fill={inkColor} />
        </g>
      )}

      {rank === 13 && (
        /* King: Geometric 3-Peak Sovereign Crown & Diamond Medallion */
        <g>
          <path
            d="M29 45 L32 32 L39 39 L44 29 L49 39 L56 32 L59 45 Z"
            fill={gold}
            fillOpacity={0.28}
            stroke={gold}
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
          <line x1={29} y1={48} x2={59} y2={48} stroke={inkColor} strokeWidth={1.6} />
          <polygon
            points="44,52 57,64 44,76 31,64"
            fill={inkColor}
            fillOpacity={0.09}
            stroke={inkColor}
            strokeWidth={1.5}
          />
          <polygon
            points="44,56 52,64 44,72 36,64"
            fill="none"
            stroke={gold}
            strokeWidth={1.2}
          />
          <line x1={32} y1={79} x2={56} y2={79} stroke={gold} strokeWidth={1.1} />
          <SuitGlyph suit={suit} x={44} y={90} size={13} fill={inkColor} />
        </g>
      )}
    </g>
  );
}

export function CardSvg({
  card,
  faceUp = true,
  size = 'md',
  selected = false,
  highlighted = null,
  possessionLocked = false,
  className = '',
}: CardSvgProps) {
  const uid = useId().replace(/:/g, '');
  const dims = SIZE_DIMENSIONS[size];
  const isFaceDown = !faceUp || !card;

  let ringClass = '';
  if (selected) {
    ringClass =
      'ring-2 ring-[#e6be72] shadow-[0_12px_26px_rgba(0,0,0,0.58),0_0_0_3px_rgba(200,157,84,0.28)] -translate-y-1.5';
  } else if (highlighted === 'capture') {
    ringClass =
      'ring-2 ring-emerald-400 shadow-[0_8px_20px_rgba(16,185,129,0.34)]';
  } else if (highlighted === 'build') {
    ringClass =
      'ring-2 ring-[#c89d54] shadow-[0_8px_20px_rgba(200,157,84,0.34)]';
  } else if (highlighted === 'cement') {
    ringClass =
      'ring-2 ring-amber-300 shadow-[0_8px_20px_rgba(245,158,11,0.38)]';
  } else {
    ringClass = 'shadow-[0_4px_12px_rgba(0,0,0,0.45),0_1px_2px_rgba(0,0,0,0.32)]';
  }

  if (isFaceDown) {
    const backGradId = `card-back-grad-${uid}`;
    const latticeId = `sa-lattice-${uid}`;
    const clipId = `card-back-clip-${uid}`;

    return (
      <div
        className={`relative inline-block shrink-0 rounded-[7px] select-none transition-transform duration-150 ${ringClass} ${className}`}
        style={{ width: dims.width, height: dims.height }}
      >
        <svg
          width={dims.width}
          height={dims.height}
          viewBox="0 0 88 124"
          shapeRendering="geometricPrecision"
          className="block w-full h-full rounded-[7px]"
          aria-label="Face-down playing card"
        >
          <defs>
            <linearGradient id={backGradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#5a1818" />
              <stop offset="55%" stopColor="#481212" />
              <stop offset="100%" stopColor="#380d0d" />
            </linearGradient>
            <pattern id={latticeId} width="14" height="14" patternUnits="userSpaceOnUse">
              <path
                d="M7 0 L14 7 L7 14 L0 7 Z"
                fill="none"
                stroke="#c89d54"
                strokeWidth="0.65"
                strokeOpacity="0.34"
              />
              <circle cx="7" cy="7" r="0.9" fill="#c89d54" fillOpacity="0.4" />
            </pattern>
            <clipPath id={clipId}>
              <rect x="8" y="8" width="72" height="108" rx="3.5" />
            </clipPath>
          </defs>

          {/* Outer warm ivory cardstock rim */}
          <rect x="0.5" y="0.5" width="87" height="123" rx="6.5" fill="#f5efe2" stroke="#d9ceb7" strokeWidth="1" />

          {/* Mahogany field */}
          <rect x="5" y="5" width="78" height="114" rx="4.5" fill={`url(#${backGradId})`} />

          {/* Geometric South African diamond/protea lattice */}
          <g clipPath={`url(#${clipId})`}>
            <rect x="8" y="8" width="72" height="108" fill={`url(#${latticeId})`} />
          </g>

          {/* Burnished gold outer & inner stepped frames */}
          <rect
            x="8"
            y="8"
            width="72"
            height="108"
            rx="3.5"
            fill="none"
            stroke="#c89d54"
            strokeWidth="1.25"
          />
          <rect
            x="11"
            y="11"
            width="66"
            height="102"
            rx="2"
            fill="none"
            stroke="#c89d54"
            strokeOpacity="0.5"
            strokeWidth="0.7"
          />

          {/* Central geometric Protea / Diamond medallion */}
          <g transform="translate(44, 62)">
            <polygon
              points="0,-20 14,0 0,20 -14,0"
              fill="#380d0d"
              stroke="#c89d54"
              strokeWidth="1.25"
            />
            <polygon
              points="0,-14 10,0 0,14 -10,0"
              fill="#5a1818"
              stroke="#c89d54"
              strokeWidth="0.9"
            />
            <polygon
              points="0,-9 4,-3 11,0 4,3 0,9 -4,3 -11,0 -4,-3"
              fill="#c89d54"
              fillOpacity="0.85"
            />
            <circle cx="0" cy="0" r="2.2" fill="#380d0d" />
          </g>
        </svg>
      </div>
    );
  }

  const rankStr = getRankSymbol(card.rank);
  const red = isRedSuit(card.suit);
  const isCompactSize = size === 'xs' || size === 'sm';
  const inkColor = red
    ? isCompactSize
      ? '#981118'
      : '#a91d24'
    : isCompactSize
      ? '#0d0f13'
      : '#181a1f';
  const bigCasino = isBigCasino(card);
  const littleCasino = isLittleCasino(card);
  const isAce = card.rank === 1;
  const pips = !card.isFaceCard && !isAce ? getNumberPipCoords(card.rank) : [];
  const isTen = card.rank === 10;

  // Slightly larger, heavier corner index & suit on xs/sm cards for effortless legibility on dense tables and mobile
  const cornerX = isCompactSize ? 11.5 : 10.5;
  const cornerRankY = isCompactSize ? 20 : 18.5;
  const cornerSuitY = size === 'xs' ? 31.5 : size === 'sm' ? 30.5 : 27;
  const cornerSuitSize = size === 'xs' ? 13 : size === 'sm' ? 12 : 10.5;
  const cornerFontSize =
    size === 'xs'
      ? isTen
        ? '15.2'
        : '17.2'
      : size === 'sm'
        ? isTen
          ? '14.2'
          : '16'
        : isTen
          ? '12.5'
          : '14';
  const cornerFontWeight = isCompactSize ? '800' : '700';

  return (
    <div
      className={`relative inline-block shrink-0 rounded-[7px] select-none transition-transform duration-150 ${ringClass} ${className}`}
      style={{ width: dims.width, height: dims.height }}
    >
      <svg
        width={dims.width}
        height={dims.height}
        viewBox="0 0 88 124"
        shapeRendering="geometricPrecision"
        className="block w-full h-full rounded-[7px]"
        aria-label={card.label}
      >
        {/* Warm ivory cardstock base */}
        <rect x="0.5" y="0.5" width="87" height="123" rx="6.5" fill="#fbf8f1" stroke="#ddd5c2" strokeWidth="1" />

        {/* Subtle inner hairline border */}
        <rect
          x="3.5"
          y="3.5"
          width="81"
          height="117"
          rx="4.5"
          fill="none"
          stroke="#e5dec9"
          strokeWidth="0.8"
        />

        {/* Special Scoring Card Inner Filigree Frames */}
        {bigCasino && (
          <g>
            <rect
              x="14"
              y="13"
              width="60"
              height="96"
              rx="3"
              fill="rgba(200, 157, 84, 0.06)"
              stroke="#c89d54"
              strokeWidth="1.35"
            />
            <rect
              x="16.5"
              y="15.5"
              width="55"
              height="91"
              rx="2"
              fill="none"
              stroke="#c89d54"
              strokeOpacity="0.45"
              strokeWidth="0.7"
            />
            <path
              d="M14 19 L20 13 M68 13 L74 19 M14 103 L20 109 M68 109 L74 103"
              stroke="#c89d54"
              strokeWidth="1.2"
            />
          </g>
        )}

        {littleCasino && (
          <g>
            <rect
              x="14"
              y="13"
              width="60"
              height="96"
              rx="3"
              fill="rgba(100, 116, 139, 0.06)"
              stroke="#64748b"
              strokeWidth="1.25"
            />
            <rect
              x="16.5"
              y="15.5"
              width="55"
              height="91"
              rx="2"
              fill="none"
              stroke="#94a3b8"
              strokeOpacity="0.6"
              strokeWidth="0.7"
            />
            <path
              d="M14 19 L20 13 M68 13 L74 19 M14 103 L20 109 M68 109 L74 103"
              stroke="#64748b"
              strokeWidth="1.15"
            />
          </g>
        )}

        {/* Top-Left Corner Index */}
        <g>
          <text
            x={cornerX}
            y={cornerRankY}
            textAnchor="middle"
            fill={inkColor}
            fontSize={cornerFontSize}
            fontWeight={cornerFontWeight}
            letterSpacing={isTen ? '-1.2' : '-0.3'}
            className="font-mono-num"
          >
            {rankStr}
          </text>
          <SuitGlyph
            suit={card.suit}
            x={cornerX}
            y={cornerSuitY}
            size={cornerSuitSize}
            fill={inkColor}
          />
        </g>

        {/* Bottom-Right Corner Index (180deg inverted) */}
        <g transform="translate(88, 124) rotate(180)">
          <text
            x={cornerX}
            y={cornerRankY}
            textAnchor="middle"
            fill={inkColor}
            fontSize={cornerFontSize}
            fontWeight={cornerFontWeight}
            letterSpacing={isTen ? '-1.2' : '-0.3'}
            className="font-mono-num"
          >
            {rankStr}
          </text>
          <SuitGlyph
            suit={card.suit}
            x={cornerX}
            y={cornerSuitY}
            size={cornerSuitSize}
            fill={inkColor}
          />
        </g>

        {/* Center Card Artwork */}
        {isAce && (
          <g>
            {/* Ornate geometric center pip frame */}
            <polygon
              points="44,33 65,45 65,75 44,87 23,75 23,45"
              fill="rgba(200, 157, 84, 0.05)"
              stroke="#c89d54"
              strokeWidth="1"
              strokeOpacity="0.65"
            />
            <polygon
              points="44,37 61,47 61,73 44,83 27,73 27,47"
              fill="none"
              stroke={inkColor}
              strokeWidth="0.7"
              strokeOpacity="0.22"
            />
            <SuitGlyph suit={card.suit} x={44} y={60} size={32} fill={inkColor} />
          </g>
        )}

        {card.isFaceCard && (
          <CourtEmblem rank={card.rank as 11 | 12 | 13} suit={card.suit} inkColor={inkColor} />
        )}

        {pips.length > 0 && (
          <g>
            {pips.map((pip, idx) => (
              <SuitGlyph
                key={idx}
                suit={card.suit}
                x={pip.x}
                y={pip.y}
                size={card.rank >= 8 ? 13 : 15}
                fill={inkColor}
                inverted={pip.inverted}
              />
            ))}
          </g>
        )}

        {/* Possession Lock Indicator Badge (Top-Right) */}
        {possessionLocked && (
          <g transform="translate(50, 5)">
            <rect
              x="0"
              y="0"
              width="33"
              height="12.5"
              rx="3.5"
              fill="#92400e"
              stroke="#fbbf24"
              strokeWidth="0.9"
            />
            {/* Tiny vector padlock */}
            <path
              d="M5.2 5.4 V4.2 C5.2 3.2 6.0 2.5 7.0 2.5 C8.0 2.5 8.8 3.2 8.8 4.2 V5.4"
              fill="none"
              stroke="#fef3c7"
              strokeWidth="0.9"
            />
            <rect x="4.5" y="5.4" width="5" height="4.2" rx="0.8" fill="#fef3c7" />
            <text
              x="21.5"
              y="8.7"
              textAnchor="middle"
              fill="#fef3c7"
              fontSize="6.5"
              fontWeight="700"
              letterSpacing="0.3"
              className="font-mono-num"
            >
              LOCK
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

export default CardSvg;
