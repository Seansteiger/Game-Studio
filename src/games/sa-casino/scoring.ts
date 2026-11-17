import { Card, isBigCasino, isLittleCasino } from '../../studio/core';
import {
  DealScoreBreakdown,
  GameMode,
  HouseRules,
  PlayerSeatState,
  TeamScoreSummary,
} from './types';

function getTeamDefinition(
  mode: GameMode,
  players: readonly PlayerSeatState[]
): { teamId: number; label: string; seats: number[] }[] {
  if (mode === '2v2-teams') {
    return [
      { teamId: 0, label: 'You & North', seats: [0, 2] },
      { teamId: 1, label: 'West & East', seats: [1, 3] },
    ];
  }
  return players.map((p) => ({
    teamId: p.teamId,
    label: p.name,
    seats: [p.seat],
  }));
}

/**
 * Computes the official South African Casino scoring breakdown at deal end:
 * - Most Cards Captured: 3 pts (strict majority / >= 21 in 2-side games, 0 pts on 20-20 tie)
 * - Big Casino (10♦): 2 pts
 * - Little Casino (2♠): 1 pt
 * - Most Spades: 1 pt (0 pts on tie)
 * - Aces: 1 pt per Ace captured
 * - Sweeps (optional house rule): +1 pt per sweep
 */
export function calculateDealScore(
  players: readonly PlayerSeatState[],
  cutPile: readonly Card[],
  mode: GameMode,
  houseRules: HouseRules
): DealScoreBreakdown {
  const teamDefs = getTeamDefinition(mode, players);

  const rawTeams = teamDefs.map((def) => {
    const members = players.filter((p) => def.seats.includes(p.seat));
    const capturedCards = members.flatMap((m) => m.capturedCards);
    const sweeps = members.reduce((sum, m) => sum + m.sweeps, 0);
    const spadeCount = capturedCards.filter((c) => c.suit === 'S').length;
    const aceCount = capturedCards.filter((c) => c.rank === 1).length;
    const hasBigCasino = capturedCards.some(isBigCasino);
    const hasLittleCasino = capturedCards.some(isLittleCasino);

    return {
      ...def,
      capturedCards,
      cardCount: capturedCards.length,
      spadeCount,
      aceCount,
      hasBigCasino,
      hasLittleCasino,
      sweeps,
    };
  });

  // Most Cards (3 pts): strict winner, and in 2-side games >= 21 cards (no tie points on 20-20)
  const maxCardCount = Math.max(...rawTeams.map((t) => t.cardCount));
  const cardLeaders = rawTeams.filter((t) => t.cardCount === maxCardCount);
  const mostCardsWinnerId =
    cardLeaders.length === 1 && (rawTeams.length > 2 || maxCardCount >= 21)
      ? cardLeaders[0].teamId
      : null;

  // Most Spades (1 pt): strict highest spade count (0 pts on tie)
  const maxSpadeCount = Math.max(...rawTeams.map((t) => t.spadeCount));
  const spadeLeaders = rawTeams.filter((t) => t.spadeCount === maxSpadeCount);
  const mostSpadesWinnerId =
    spadeLeaders.length === 1 && maxSpadeCount > 0 ? spadeLeaders[0].teamId : null;

  const teams: TeamScoreSummary[] = rawTeams.map((t) => {
    const mostCardsPts = t.teamId === mostCardsWinnerId ? 3 : 0;
    const bigCasinoPts = t.hasBigCasino ? 2 : 0;
    const littleCasinoPts = t.hasLittleCasino ? 1 : 0;
    const mostSpadesPts = t.teamId === mostSpadesWinnerId ? 1 : 0;
    const acesPts = t.aceCount;
    const sweepsPts = houseRules.sweepsEnabled ? t.sweeps : 0;
    const total =
      mostCardsPts + bigCasinoPts + littleCasinoPts + mostSpadesPts + acesPts + sweepsPts;

    return {
      teamId: t.teamId,
      label: t.label,
      seats: t.seats,
      cardCount: t.cardCount,
      spadeCount: t.spadeCount,
      aceCount: t.aceCount,
      hasBigCasino: t.hasBigCasino,
      hasLittleCasino: t.hasLittleCasino,
      sweeps: t.sweeps,
      points: {
        mostCards: mostCardsPts,
        bigCasino: bigCasinoPts,
        littleCasino: littleCasinoPts,
        mostSpades: mostSpadesPts,
        aces: acesPts,
        sweeps: sweepsPts,
        total,
      },
      capturedCards: t.capturedCards,
    };
  });

  const bestScore = Math.max(...teams.map((t) => t.points.total));
  const winningTeamIds = teams
    .filter((t) => t.points.total === bestScore)
    .map((t) => t.teamId);

  return {
    teams,
    cutPileRevealed: cutPile,
    winningTeamIds,
  };
}
