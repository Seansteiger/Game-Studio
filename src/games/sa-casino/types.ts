import { Card, GameAction, VisualEvent } from '../../studio/core';

export type GameMode = '1v1' | '3p-ffa' | '2v2-teams';

export interface HouseRules {
  sweepsEnabled: boolean;
  targetMatchScore: number;
}

export interface TableLooseCard {
  readonly kind: 'loose';
  readonly id: string;
  readonly card: Card;
}

export interface TableBuildStack {
  readonly kind: 'build';
  readonly id: string;
  readonly cards: readonly Card[];
  readonly components: readonly (readonly Card[])[];
  readonly targetValue: number;
  readonly ownerSeat: number;
  readonly isCemented: boolean;
}

export type TableItem = TableLooseCard | TableBuildStack;

export interface PlayerSeatState {
  readonly seat: number;
  readonly name: string;
  readonly isAI: boolean;
  readonly teamId: number;
  readonly hand: readonly Card[];
  readonly capturedCards: readonly Card[];
  readonly sweeps: number;
}

export interface MaskedPlayerSeatState {
  readonly seat: number;
  readonly name: string;
  readonly isAI: boolean;
  readonly teamId: number;
  readonly handCount: number;
  readonly hand: readonly Card[] | null;
  readonly capturedCount: number;
  readonly capturedCards: readonly Card[];
  readonly topCapturedCard: Card | null;
  readonly sweeps: number;
}

export interface TeamScoreSummary {
  readonly teamId: number;
  readonly label: string;
  readonly seats: readonly number[];
  readonly cardCount: number;
  readonly spadeCount: number;
  readonly aceCount: number;
  readonly hasBigCasino: boolean;
  readonly hasLittleCasino: boolean;
  readonly sweeps: number;
  readonly points: {
    readonly mostCards: number;
    readonly bigCasino: number;
    readonly littleCasino: number;
    readonly mostSpades: number;
    readonly aces: number;
    readonly sweeps: number;
    readonly total: number;
  };
  readonly capturedCards: readonly Card[];
}

export interface DealScoreBreakdown {
  readonly teams: readonly TeamScoreSummary[];
  readonly cutPileRevealed: readonly Card[];
  readonly winningTeamIds: readonly number[];
}

export interface LastActionSummary {
  readonly seat: number;
  readonly playerName: string;
  readonly actionType: 'TRAIL' | 'CAPTURE' | 'BUILD' | 'CEMENT' | 'DEAL';
  readonly description: string;
  readonly swept: boolean;
  readonly playedCard: Card | null;
}

export type GamePhase = 'PLAYING' | 'ROUND_TRANSITION' | 'DEAL_OVER';

export interface SACasinoConfig {
  readonly mode: GameMode;
  readonly seed: number;
  readonly dealNumber?: number;
  readonly dealerSeat?: number;
  readonly houseRules?: Partial<HouseRules>;
  readonly matchScores?: Record<number, number>;
  readonly playerNames?: readonly string[];
}

export interface SACasinoState {
  readonly mode: GameMode;
  readonly seed: number;
  readonly dealNumber: number;
  readonly roundNumber: 1 | 2;
  readonly totalRounds: 1 | 2;
  readonly dealerSeat: number;
  readonly currentTurnSeat: number;
  readonly lastCapturerSeat: number | null;
  readonly cutPile: readonly Card[];
  readonly drawPile: readonly Card[];
  readonly table: readonly TableItem[];
  readonly players: readonly PlayerSeatState[];
  readonly houseRules: HouseRules;
  readonly matchScores: Record<number, number>;
  readonly phase: GamePhase;
  readonly turnCount: number;
  readonly lastActionSummary: LastActionSummary | null;
  readonly dealScoreBreakdown: DealScoreBreakdown | null;
}

export interface SACasinoPlayerView {
  readonly viewerSeat: number;
  readonly mode: GameMode;
  readonly seed: number;
  readonly dealNumber: number;
  readonly roundNumber: 1 | 2;
  readonly totalRounds: 1 | 2;
  readonly dealerSeat: number;
  readonly currentTurnSeat: number;
  readonly lastCapturerSeat: number | null;
  readonly cutPileCount: number;
  readonly cutPileRevealed: readonly Card[] | null;
  readonly drawPileCount: number;
  readonly table: readonly TableItem[];
  readonly players: readonly MaskedPlayerSeatState[];
  readonly houseRules: HouseRules;
  readonly matchScores: Record<number, number>;
  readonly phase: GamePhase;
  readonly turnCount: number;
  readonly lastActionSummary: LastActionSummary | null;
  readonly dealScoreBreakdown: DealScoreBreakdown | null;
}

export interface TrailPayload {
  readonly cardId: string;
}

export interface CapturePayload {
  readonly cardId: string;
  readonly capturedItemIds: readonly string[];
  readonly dugCapturedFromSeat?: number | null;
}

export interface BuildPayload {
  readonly cardId: string;
  readonly targetItemIds: readonly string[];
  readonly targetValue: number;
  readonly mode: 'CREATE_OPEN' | 'RAISE_OPEN' | 'CEMENT';
  readonly dugCapturedFromSeat?: number | null;
}

export interface DigTableToBuildPayload {
  readonly buildId: string;
  readonly targetItemIds: readonly string[];
  readonly dugFromSeat: number;
}

export interface DealNextRoundPayload {
  readonly round: 2;
}

export type SACasinoAction =
  | GameAction<'TRAIL', TrailPayload>
  | GameAction<'CAPTURE', CapturePayload>
  | GameAction<'BUILD', BuildPayload>
  | GameAction<'DIG_TABLE_TO_BUILD', DigTableToBuildPayload>
  | GameAction<'DEAL_NEXT_ROUND', DealNextRoundPayload>;

export interface CaptureOption {
  readonly id: string;
  readonly capturedItemIds: readonly string[];
  readonly capturedItems: readonly TableItem[];
  readonly dugCapturedFromSeat?: number | null;
  readonly totalCardsCaptured: number;
  readonly description: string;
  readonly isSweep: boolean;
  readonly tacticalScore: number;
}

export interface BuildOption {
  readonly id: string;
  readonly targetItemIds: readonly string[];
  readonly targetItems: readonly TableItem[];
  readonly targetValue: number;
  readonly buildMode: 'CREATE_OPEN' | 'RAISE_OPEN' | 'CEMENT';
  readonly resultingCemented: boolean;
  readonly dugCapturedFromSeat?: number | null;
  readonly components: readonly (readonly Card[])[];
  readonly description: string;
}

export interface TableDigMergeOption {
  readonly id: string;
  readonly buildId: string;
  readonly targetValue: number;
  readonly targetItemIds: readonly string[];
  readonly targetItems: readonly TableLooseCard[];
  readonly dugFromSeat: number;
  readonly dugCard: Card;
  readonly description: string;
}

export type SACasinoVisualEvent = VisualEvent<
  | 'DEAL_STARTED'
  | 'ROUND_2_DEALT'
  | 'CARD_TRAILED'
  | 'CARD_CAPTURED'
  | 'BUILD_CREATED'
  | 'BUILD_RAISED'
  | 'BUILD_CEMENTED'
  | 'SWEEP_SCORED'
  | 'DEAL_FINISHED',
  Record<string, unknown>
>;
