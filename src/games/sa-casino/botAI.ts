import { Card, isBigCasino, isLittleCasino } from '../../studio/core';
import {
  canTrailCard,
  findValidBuildOptions,
  findValidCaptureOptions,
  findValidTableDigMerges,
} from './buildAndCaptureValidator';
import {
  BuildOption,
  SACasinoAction,
  SACasinoPlayerView,
  TableBuildStack,
  TableItem,
} from './types';

interface RankedCandidate {
  score: number;
  action: SACasinoAction;
}

/**
 * Counts how many copies of each rank (1..13) are already publicly seen
 * across all captured piles, the live table, and the bot's own hand.
 * Used to estimate vulnerability of open builds without reading hidden hands.
 */
function buildSeenRankCounts(view: SACasinoPlayerView, botHand: readonly Card[]): Map<number, number> {
  const counts = new Map<number, number>();
  const addCard = (c: Card) => {
    counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  };

  for (const p of view.players) {
    for (const c of p.capturedCards) addCard(c);
  }
  for (const item of view.table) {
    if (item.kind === 'loose') addCard(item.card);
    else for (const c of item.cards) addCard(c);
  }
  for (const c of botHand) addCard(c);
  return counts;
}

function getPartnerSeat(view: SACasinoPlayerView, seat: number): number | null {
  if (view.mode !== '2v2-teams') return null;
  const partner = view.players.find((p) => p.seat !== seat && p.teamId === view.players[seat].teamId);
  return partner ? partner.seat : null;
}

function evaluateTrailDanger(
  card: Card,
  table: readonly TableItem[],
  sweepsEnabled: boolean
): number {
  let penalty = 0;

  // Avoid trailing high-scoring cards unless forced
  if (isBigCasino(card)) penalty += 95;
  else if (isLittleCasino(card)) penalty += 62;
  else if (card.rank === 1) penalty += 52;
  if (card.suit === 'S') penalty += 15;

  // Check if trailing this card allows an immediate single-card capture or easy sweep
  const looseCards = table.filter((it) => it.kind === 'loose');
  const matchingLoose = looseCards.some((it) => it.card.rank === card.rank);
  if (matchingLoose) penalty += 22;

  if (!card.isFaceCard) {
    const looseSum = looseCards.reduce(
      (sum, it) => sum + (it.card.isFaceCard ? 0 : it.card.rank),
      0
    );
    if (sweepsEnabled && looseSum + card.rank <= 10 && table.length <= 2) {
      penalty += 26;
    }
    if (card.rank >= 7 && card.rank <= 10) {
      // Mid/high numeric cards can be summed easily
      penalty += 4;
    }
  }

  return penalty;
}

function scoreBuildOption(
  opt: BuildOption,
  playedCard: Card,
  botHand: readonly Card[],
  view: SACasinoPlayerView,
  botSeat: number,
  seenCounts: Map<number, number>
): number {
  let score = 35;

  // Prefer cementing so opponents cannot raise or alter target value
  if (opt.resultingCemented) score += 32;

  // Bonus for locking high-value cards inside a build we hold the capture card for
  for (const item of opt.targetItems) {
    const cards = item.kind === 'loose' ? [item.card] : item.cards;
    for (const c of cards) {
      if (isBigCasino(c)) score += 55;
      else if (isLittleCasino(c)) score += 35;
      else if (c.rank === 1) score += 28;
      else if (c.suit === 'S') score += 9;
      score += 6;
    }
  }
  if (isBigCasino(playedCard)) score += 40;
  else if (isLittleCasino(playedCard)) score += 24;
  else if (playedCard.suit === 'S') score += 8;

  // Extra bonus if stealing/raising an opponent's open build
  const affectsOpponentBuild = opt.targetItems.some(
    (it): it is TableBuildStack =>
      it.kind === 'build' && it.ownerSeat !== botSeat
  );
  if (affectsOpponentBuild) score += 26;

  // If 4 copies of targetValue are seen or bot holds 2 copies, build is very safe
  const seenOfTarget = seenCounts.get(opt.targetValue) ?? 0;
  const botCopiesOfTarget = botHand.filter((c) => c.rank === opt.targetValue).length;
  if (seenOfTarget >= 3 || botCopiesOfTarget >= 2) {
    score += 18;
  }

  // Slight penalty if modifying partner's open build unnecessarily in 2v2
  const partnerSeat = getPartnerSeat(view, botSeat);
  if (
    partnerSeat !== null &&
    opt.targetItems.some(
      (it) => it.kind === 'build' && it.ownerSeat === partnerSeat
    ) &&
    !opt.resultingCemented
  ) {
    score -= 20;
  }

  return score;
}

/**
 * Selects a legal, tactically strong action for an AI seat using strictly
 * the public & self-masked SACasinoPlayerView (zero hidden-hand cheating).
 */
export function chooseTacticalBotAction(
  playerView: SACasinoPlayerView,
  botSeat: number
): SACasinoAction {
  const botPlayer = playerView.players[botSeat];
  const hand = botPlayer?.hand;
  if (!hand || hand.length === 0) {
    throw new Error(`Bot seat ${botSeat} has no visible hand to act with.`);
  }

  const isFinalRound = playerView.roundNumber === playerView.totalRounds;
  const totalRemainingCards = playerView.players.reduce((s, p) => s + p.handCount, 0);
  const isFinalDealCard = isFinalRound && totalRemainingCards <= 1;

  const partnerSeat = getPartnerSeat(playerView, botSeat);
  const seenCounts = buildSeenRankCounts(playerView, hand);
  const isRound1Of1v1 = playerView.mode === '1v1' && playerView.roundNumber === 1;
  const candidates: RankedCandidate[] = [];

  // 0. Optional Table Dig Merge into own active build (free reinforcement before playing a hand card)
  const tableDigMerges = findValidTableDigMerges(playerView.table, playerView.players, botSeat);
  for (const merge of tableDigMerges) {
    if (partnerSeat !== null && merge.dugFromSeat === partnerSeat) {
      continue;
    }
    let score = 115 + merge.targetItems.length * 10;
    if (isBigCasino(merge.dugCard)) score += 60;
    else if (isLittleCasino(merge.dugCard)) score += 35;
    else if (merge.dugCard.rank === 1) score += 25;
    candidates.push({
      score,
      action: {
        type: 'DIG_TABLE_TO_BUILD',
        playerSeat: botSeat,
        payload: {
          buildId: merge.buildId,
          targetItemIds: merge.targetItemIds,
          dugFromSeat: merge.dugFromSeat,
        },
      },
    });
  }

  for (const card of hand) {
    // 1. Capture options
    const captures = findValidCaptureOptions(
      card,
      hand,
      playerView.table,
      botSeat,
      isFinalDealCard,
      playerView.players
    );
    for (const cap of captures) {
      let score = cap.tacticalScore + 25;

      // In 2v2: don't immediately steal partner's freshly placed open build unless it holds Big/Little Casino or is a sweep
      const touchesPartnerBuild = cap.capturedItems.some(
        (it) => it.kind === 'build' && it.ownerSeat === partnerSeat
      );
      if (touchesPartnerBuild && !cap.isSweep) {
        const hasPremiumCard = cap.capturedItems.some((it) =>
          it.kind === 'loose'
            ? isBigCasino(it.card) || isLittleCasino(it.card)
            : it.cards.some((c) => isBigCasino(c) || isLittleCasino(c))
        );
        if (!hasPremiumCard) {
          score -= 18;
        }
      }

      if (partnerSeat !== null && cap.dugCapturedFromSeat === partnerSeat) {
        score -= 22;
      }

      candidates.push({
        score,
        action: {
          type: 'CAPTURE',
          playerSeat: botSeat,
          payload: {
            cardId: card.id,
            capturedItemIds: cap.capturedItemIds,
            dugCapturedFromSeat: cap.dugCapturedFromSeat ?? null,
          },
        },
      });
    }

    // 2. Build & Cement options
    const builds = findValidBuildOptions(
      card,
      hand,
      playerView.table,
      botSeat,
      playerView.players
    );
    for (const bld of builds) {
      let score = scoreBuildOption(bld, card, hand, playerView, botSeat, seenCounts);
      if (bld.dugCapturedFromSeat !== null && bld.dugCapturedFromSeat !== undefined) {
        score += partnerSeat !== null && bld.dugCapturedFromSeat === partnerSeat ? -15 : 22;
      }
      candidates.push({
        score,
        action: {
          type: 'BUILD',
          playerSeat: botSeat,
          payload: {
            cardId: card.id,
            targetItemIds: bld.targetItemIds,
            targetValue: bld.targetValue,
            mode: bld.buildMode,
            dugCapturedFromSeat: bld.dugCapturedFromSeat ?? null,
          },
        },
      });
    }

    // 3. Trail option
    const trailCheck = canTrailCard(card, hand, playerView.table, botSeat, {
      isRound1Of1v1,
      players: playerView.players,
    });
    if (trailCheck.valid) {
      const danger = evaluateTrailDanger(
        card,
        playerView.table,
        playerView.houseRules.sweepsEnabled
      );
      // Prefer trailing cards we have duplicates of or low face/non-point cards
      const copies = hand.filter((c) => c.rank === card.rank).length;
      const duplicateBonus = copies > 1 ? 6 : 0;
      candidates.push({
        score: 12 - danger + duplicateBonus,
        action: {
          type: 'TRAIL',
          playerSeat: botSeat,
          payload: { cardId: card.id },
        },
      });
    }
  }

  if (candidates.length === 0) {
    throw new Error(`No legal moves found for bot seat ${botSeat}.`);
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].action;
}
