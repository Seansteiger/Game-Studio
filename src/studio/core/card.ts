import { hashStringToSeed, seededShuffle } from './prng';

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export interface Card {
  readonly id: string;
  readonly suit: Suit;
  readonly rank: Rank;
  readonly label: string;
  readonly isFaceCard: boolean;
}

export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'] as const;
export const RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
export const NUMERIC_RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const FACE_RANKS: readonly Rank[] = [11, 12, 13] as const;

export function getRankSymbol(rank: Rank): string {
  switch (rank) {
    case 1:
      return 'A';
    case 11:
      return 'J';
    case 12:
      return 'Q';
    case 13:
      return 'K';
    default:
      return String(rank);
  }
}

export function getSuitSymbol(suit: Suit): string {
  switch (suit) {
    case 'S':
      return '♠';
    case 'H':
      return '♥';
    case 'D':
      return '♦';
    case 'C':
      return '♣';
  }
}

export function getSuitName(suit: Suit): string {
  switch (suit) {
    case 'S':
      return 'Spades';
    case 'H':
      return 'Hearts';
    case 'D':
      return 'Diamonds';
    case 'C':
      return 'Clubs';
  }
}

export function isRedSuit(suit: Suit): boolean {
  return suit === 'H' || suit === 'D';
}

export function isBigCasino(card: Card): boolean {
  return card.rank === 10 && card.suit === 'D';
}

export function isLittleCasino(card: Card): boolean {
  return card.rank === 2 && card.suit === 'S';
}

export function createCard(suit: Suit, rank: Rank): Card {
  const rankSym = getRankSymbol(rank);
  const suitSym = getSuitSymbol(suit);
  return {
    id: `${rankSym}-${suit}`,
    suit,
    rank,
    label: `${rankSym}${suitSym}`,
    isFaceCard: rank >= 11,
  };
}

function createDeckForRanks(ranks: readonly Rank[]): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of ranks) {
      deck.push(createCard(suit, rank));
    }
  }
  return deck;
}

/**
 * Generates an ordered 52-card standard playing deck.
 */
export function createStandard52Deck(): Card[] {
  return createDeckForRanks(RANKS);
}

/**
 * Generates an ordered 40-card numbered deck (A through 10 across all 4 suits).
 */
export function createNumeric40Deck(): Card[] {
  return createDeckForRanks(NUMERIC_RANKS);
}

/**
 * Generates the 12 removed face cards (J, Q, K across all 4 suits).
 */
export function createRemovedFaceCards12(): Card[] {
  return createDeckForRanks(FACE_RANKS);
}

/**
 * Deterministically prepares the 40-card SA Casino deck (A–10 only in activePool)
 * and sets aside the 12 face cards (J, Q, K) in cutPile.
 */
export function prepareSACasino40Deck(seed: number): { activePool: Card[]; cutPile: Card[] } {
  return {
    activePool: seededShuffle(createNumeric40Deck(), seed),
    cutPile: createRemovedFaceCards12(),
  };
}

/**
 * Reusable Deck utility encapsulating deterministic shuffling and cutting.
 */
export class Deck {
  private cards: Card[];

  constructor(cards?: readonly Card[]) {
    this.cards = cards ? cards.slice() : createStandard52Deck();
  }

  public shuffle(seed: number): this {
    this.cards = seededShuffle(this.cards, seed);
    return this;
  }

  public getCards(): readonly Card[] {
    return this.cards;
  }

  public cut(cutCount: number): { activePool: Card[]; cutPile: Card[] } {
    return cutDeckForDeal(this.cards, cutCount);
  }
}

/**
 * Splits a shuffled 52-card deck into an active pool and a face-down cut pile.
 */
export function cutDeckForDeal(
  shuffledDeck: readonly Card[],
  cutCount: number
): { activePool: Card[]; cutPile: Card[] } {
  const safeCut = Math.max(0, Math.min(cutCount, shuffledDeck.length));
  const cutPile = shuffledDeck.slice(0, safeCut);
  const activePool = shuffledDeck.slice(safeCut);
  return { activePool, cutPile };
}

/**
 * Deterministic organic rotational and micro-position jitter (±6 deg) for tossed table cards.
 */
export function getDeterministicJitter(cardId: string): {
  rotDeg: number;
  offsetX: number;
  offsetY: number;
} {
  const hash = hashStringToSeed(cardId);
  const r1 = ((hash & 0xffff) / 0xffff) * 2 - 1;
  const r2 = (((hash >>> 8) & 0xff) / 0xff) * 2 - 1;
  const r3 = (((hash >>> 16) & 0xff) / 0xff) * 2 - 1;
  return {
    rotDeg: Number((r1 * 6.0).toFixed(2)),
    offsetX: Number((r2 * 4.0).toFixed(2)),
    offsetY: Number((r3 * 3.5).toFixed(2)),
  };
}
