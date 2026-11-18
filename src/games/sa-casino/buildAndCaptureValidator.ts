import { Card, isBigCasino, isLittleCasino } from '../../studio/core';
import {
  BuildOption,
  CaptureOption,
  LooseBuildMergeOption,
  TableBuildStack,
  TableDigMergeOption,
  TableItem,
  TableLooseCard,
} from './types';

export interface PlayerCapturedSnapshot {
  readonly seat: number;
  readonly capturedCards: readonly Card[];
}

export interface ActiveDugCardInput {
  readonly sourceSeat: number;
  readonly card: Card;
}

export interface TrailCheckOptions {
  readonly isRound1Of1v1?: boolean;
  readonly players?: readonly PlayerCapturedSnapshot[];
  readonly activeDugCard?: ActiveDugCardInput | null;
}

export interface RankPartitionItem {
  readonly id: string;
  readonly rank: number;
  readonly isFaceCard: boolean;
}

/**
 * Sorts cards inside a single build component descending by rank
 * (larger cards underneath, smaller cards on top) with deterministic ID tie-breaking.
 */
export function sortComponentDesc(cards: readonly Card[]): Card[] {
  return cards
    .slice()
    .sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
}

function getOpponentTopCapturedCards(
  players: readonly PlayerCapturedSnapshot[],
  seat: number
): { seat: number; card: Card }[] {
  const result: { seat: number; card: Card }[] = [];
  for (const p of players) {
    if (p.seat !== seat && p.capturedCards.length > 0) {
      result.push({
        seat: p.seat,
        card: p.capturedCards[p.capturedCards.length - 1],
      });
    }
  }
  return result;
}

function getAvailableDugCards(
  players: readonly PlayerCapturedSnapshot[],
  seat: number,
  activeDugCard?: ActiveDugCardInput | null
): { seat: number; card: Card }[] {
  if (activeDugCard) {
    if (activeDugCard.sourceSeat === seat) return [];
    return [{ seat: activeDugCard.sourceSeat, card: activeDugCard.card }];
  }
  return getOpponentTopCapturedCards(players, seat);
}

function findRankUnitSubsetsSummingTo<T extends RankPartitionItem>(
  items: readonly T[],
  targetSum: number,
  maxCards = 4
): T[][] {
  if (targetSum <= 0 || items.length === 0) return [];
  const results: T[][] = [];
  const seenKeys = new Set<string>();

  const backtrack = (
    startIdx: number,
    current: T[],
    currentSum: number
  ) => {
    if (currentSum === targetSum && current.length > 0) {
      const key = current
        .map((it) => it.id)
        .sort()
        .join(',');
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        results.push(current.slice());
      }
      return;
    }
    if (currentSum > targetSum || current.length >= maxCards) return;

    for (let i = startIdx; i < items.length; i++) {
      const item = items[i];
      if (item.isFaceCard) continue;
      current.push(item);
      backtrack(i + 1, current, currentSum + item.rank);
      current.pop();
    }
  };

  backtrack(0, [], 0);
  return results;
}

function partitionContainsPlayedAndDugTogether(
  partition: readonly (readonly Card[])[],
  playedCard: Card,
  dugCard: Card,
  targetValue: number
): boolean {
  if (playedCard.rank === targetValue && dugCard.rank === targetValue) {
    return true;
  }
  return partition.some(
    (group) =>
      group.some((c) => c.id === playedCard.id) &&
      group.some((c) => c.id === dugCard.id)
  );
}

/**
 * Checks whether a player's remaining hand contains distinct capture cards
 * for every build stack that player owns on the table (Possession Rule).
 */
export function canPlayerCoverOwnedBuilds(
  remainingHand: readonly Card[],
  table: readonly TableItem[],
  seat: number
): boolean {
  const ownedBuilds = table.filter(
    (item): item is TableBuildStack => item.kind === 'build' && item.ownerSeat === seat
  );

  if (ownedBuilds.length === 0) return true;

  const availableRanks = remainingHand.map((c) => c.rank);
  const used = new Array<boolean>(availableRanks.length).fill(false);

  const matchBuild = (buildIdx: number): boolean => {
    if (buildIdx >= ownedBuilds.length) return true;
    const neededRank = ownedBuilds[buildIdx].targetValue;
    for (let i = 0; i < availableRanks.length; i++) {
      if (!used[i] && availableRanks[i] === neededRank) {
        used[i] = true;
        if (matchBuild(buildIdx + 1)) return true;
        used[i] = false;
      }
    }
    return false;
  };

  return matchBuild(0);
}

/**
 * Returns the set of Card IDs in a player's hand that are obligated to cover
 * their active builds on the table (at least one copy per owned build targetValue).
 */
export function getPossessionLockedValues(
  hand: readonly Card[],
  table: readonly TableItem[],
  seat: number
): Set<number> {
  const locked = new Set<number>();
  const ownedBuilds = table.filter(
    (item): item is TableBuildStack => item.kind === 'build' && item.ownerSeat === seat
  );
  for (const build of ownedBuilds) {
    const countInHand = hand.filter((c) => c.rank === build.targetValue).length;
    const countBuildsOfValue = ownedBuilds.filter(
      (b) => b.targetValue === build.targetValue
    ).length;
    if (countInHand <= countBuildsOfValue) {
      locked.add(build.targetValue);
    }
  }
  return locked;
}

/**
 * Finds all disjoint subsets of numeric loose cards that partition cleanly into groups
 * each summing to `targetSum`. Used for both Capture validation and multi-group Cement validation.
 */
export function findDisjointSumPartitions<T extends RankPartitionItem>(
  cards: readonly T[],
  targetSum: number
): T[][][] {
  const results: T[][][] = [];
  const seenKeys = new Set<string>();

  // Helper: find all subsets of remaining indices summing to targetSum
  const findSubsets = (
    pool: readonly T[],
    startIdx: number,
    current: T[],
    currentSum: number,
    out: { group: T[]; rest: T[] }[],
    usedMask: boolean[]
  ) => {
    if (currentSum === targetSum && current.length > 0) {
      const rest: T[] = [];
      for (let i = 0; i < pool.length; i++) {
        if (!usedMask[i]) rest.push(pool[i]);
      }
      out.push({ group: current.slice(), rest });
      return;
    }
    if (currentSum > targetSum) return;

    for (let i = startIdx; i < pool.length; i++) {
      if (usedMask[i]) continue;
      if (pool[i].isFaceCard) continue;
      usedMask[i] = true;
      current.push(pool[i]);
      findSubsets(pool, i + 1, current, currentSum + pool[i].rank, out, usedMask);
      current.pop();
      usedMask[i] = false;
    }
  };

  // Canonical key so equivalent partitions aren't duplicated
  const buildCanonicalKey = (groups: readonly (readonly T[])[]): string => {
    return groups
      .map((g) => g.map((c) => c.id).sort().join('+'))
      .sort()
      .join('|');
  };

  const searchPartitions = (remaining: readonly T[], chosenGroups: T[][]) => {
    if (chosenGroups.length > 0) {
      const key = buildCanonicalKey(chosenGroups);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        results.push(chosenGroups.map((g) => g.slice()));
      }
    }

    if (remaining.length === 0) return;
    const candidates: { group: T[]; rest: T[] }[] = [];
    findSubsets(
      remaining,
      0,
      [],
      0,
      candidates,
      new Array<boolean>(remaining.length).fill(false)
    );

    // Anchor on the first remaining card or allow skipping cards not used in any group
    const seenGroupKeys = new Set<string>();
    for (const cand of candidates) {
      const gk = cand.group.map((c) => c.id).sort().join('+');
      if (seenGroupKeys.has(gk)) continue;
      seenGroupKeys.add(gk);
      chosenGroups.push(cand.group);
      searchPartitions(cand.rest, chosenGroups);
      chosenGroups.pop();
    }
  };

  searchPartitions(cards, []);
  return results;
}

/**
 * Checks whether an exact set of cards can be partitioned completely into
 * one or more disjoint groups, each summing to `targetSum`.
 */
export function canExactPartitionIntoSums<T extends Pick<RankPartitionItem, 'rank' | 'isFaceCard'>>(
  cards: readonly T[],
  targetSum: number
): T[][] | null {
  if (cards.length === 0) return null;
  if (cards.some((c) => c.isFaceCard)) return null;
  const totalSum = cards.reduce((acc, c) => acc + c.rank, 0);
  if (totalSum === 0 || totalSum % targetSum !== 0) return null;

  const numGroups = totalSum / targetSum;
  const sorted = cards.slice().sort((a, b) => b.rank - a.rank);
  const groups: T[][] = Array.from({ length: numGroups }, () => []);
  const groupSums = new Array<number>(numGroups).fill(0);

  const backtrack = (idx: number): boolean => {
    if (idx === sorted.length) {
      return groupSums.every((s) => s === targetSum);
    }
    const card = sorted[idx];
    for (let g = 0; g < numGroups; g++) {
      if (groupSums[g] + card.rank > targetSum) continue;
      // Symmetry breaking: avoid trying identical empty or equal-sum groups
      let duplicate = false;
      for (let prev = 0; prev < g; prev++) {
        if (groupSums[prev] === groupSums[g]) {
          duplicate = true;
          break;
        }
      }
      if (duplicate) continue;

      groups[g].push(card);
      groupSums[g] += card.rank;
      if (backtrack(idx + 1)) return true;
      groupSums[g] -= card.rank;
      groups[g].pop();
    }
    return false;
  };

  return backtrack(0) ? groups : null;
}

function scoreCardsTactically(cards: readonly Card[]): number {
  let score = cards.length * 10;
  for (const c of cards) {
    if (isBigCasino(c)) score += 90;
    else if (isLittleCasino(c)) score += 55;
    else if (c.rank === 1) score += 45;
    if (c.suit === 'S') score += 16;
  }
  return score;
}

/**
 * Enumerates valid capture options for playing `playedCard` from `seat`.
 * Enforces:
 * - Face cards (J, Q, K) capture matching ranks only (never numeric sums).
 * - Numeric cards (A=1..10) capture matching ranks, matching builds, and disjoint sum groups.
 * - Possession Rule: player's remaining hand must still cover any uncaptured owned builds.
 */
export function findValidCaptureOptions(
  playedCard: Card,
  hand: readonly Card[],
  table: readonly TableItem[],
  seat: number,
  isFinalDealCard: boolean,
  players: readonly PlayerCapturedSnapshot[] = [],
  activeDugCard: ActiveDugCardInput | null = null
): CaptureOption[] {
  const remainingHand = hand.filter((c) => c.id !== playedCard.id);
  const matchingBuilds = table.filter(
    (item): item is TableBuildStack =>
      item.kind === 'build' && item.targetValue === playedCard.rank
  );
  const matchingLoose = table.filter(
    (item): item is TableLooseCard =>
      item.kind === 'loose' && item.card.rank === playedCard.rank
  );
  const opponentTopCards = getAvailableDugCards(players, seat, activeDugCard);
  const mustUseDug = Boolean(activeDugCard);

  const options: CaptureOption[] = [];
  const seenOptionKeys = new Set<string>();

  const registerOption = (
    items: TableItem[],
    dugEntry?: { seat: number; card: Card }
  ) => {
    if (items.length === 0) return;
    if (mustUseDug && (!dugEntry || dugEntry.seat !== activeDugCard?.sourceSeat)) {
      return;
    }
    const ids = items.map((it) => it.id).sort();
    const dugSeat = dugEntry ? dugEntry.seat : null;
    const key = `${ids.join(',')}|dig:${dugSeat ?? 'none'}`;
    if (seenOptionKeys.has(key)) return;

    const remainingTable = table.filter((it) => !ids.includes(it.id));
    if (!canPlayerCoverOwnedBuilds(remainingHand, remainingTable, seat)) {
      return;
    }

    seenOptionKeys.add(key);
    const capturedCards: Card[] = [];
    for (const it of items) {
      if (it.kind === 'loose') capturedCards.push(it.card);
      else capturedCards.push(...it.cards);
    }
    if (dugEntry) {
      capturedCards.push(dugEntry.card);
    }
    capturedCards.push(playedCard);

    const isSweep = remainingTable.length === 0 && !isFinalDealCard;
    const tacticalScore = scoreCardsTactically(capturedCards) + (isSweep ? 38 : 0);

    const descParts = items.map((it) =>
      it.kind === 'loose'
        ? it.card.label
        : `${it.isCemented ? 'Locked' : 'Build'} ${it.targetValue}`
    );
    const dugSuffix = dugEntry ? ` + Dig ${dugEntry.card.label}` : '';

    options.push({
      id: dugEntry
        ? `cap:${playedCard.id}:${ids.join(',')}:dig${dugEntry.seat}`
        : `cap:${playedCard.id}:${ids.join(',')}`,
      capturedItemIds: ids,
      capturedItems: items,
      dugCapturedFromSeat: dugSeat,
      totalCardsCaptured: capturedCards.length,
      description: `Capture ${descParts.join(' + ')}${dugSuffix}`,
      isSweep,
      tacticalScore,
    });
  };

  if (playedCard.isFaceCard) {
    // Face cards capture matching ranks only (no numeric sums)
    if (matchingLoose.length > 0 || matchingBuilds.length > 0) {
      const baseItems = [...matchingBuilds, ...matchingLoose];
      if (!mustUseDug) {
        registerOption(baseItems);
      }
      for (const dug of opponentTopCards) {
        if (dug.card.rank === playedCard.rank) {
          registerOption(baseItems, dug);
        }
      }
    }
    options.sort((a, b) => b.tacticalScore - a.tacticalScore || b.totalCardsCaptured - a.totalCardsCaptured);
    return options;
  }

  // Numeric cards (A..10): capture matching builds, matching loose cards,
  // and sum combinations of loose numeric cards + uncemented smaller builds
  interface CaptureSumUnit extends RankPartitionItem {
    readonly item: TableItem;
  }

  const otherNumericLoose = table.filter(
    (item): item is TableLooseCard =>
      item.kind === 'loose' && !item.card.isFaceCard && item.card.rank !== playedCard.rank
  );
  const openSmallBuilds = table.filter(
    (item): item is TableBuildStack =>
      item.kind === 'build' && !item.isCemented && item.targetValue < playedCard.rank
  );

  const sumUnits: CaptureSumUnit[] = [
    ...otherNumericLoose.map((item) => ({
      id: item.id,
      rank: item.card.rank,
      isFaceCard: false,
      item,
    })),
    ...openSmallBuilds.map((item) => ({
      id: item.id,
      rank: item.targetValue,
      isFaceCard: false,
      item,
    })),
  ];

  const flattenPartition = (partition: readonly (readonly CaptureSumUnit[])[]): TableItem[] =>
    partition.flatMap((group) => group.map((unit) => unit.item));

  // Find all disjoint partitions of numeric loose cards & uncemented smaller builds summing to playedCard.rank
  const partitions = sumUnits.length > 0 ? findDisjointSumPartitions(sumUnits, playedCard.rank) : [];

  if (!mustUseDug) {
    // Maximal / primary options combining matching builds + matching loose + sum partitions
    if (matchingBuilds.length > 0 || matchingLoose.length > 0) {
      registerOption([...matchingBuilds, ...matchingLoose]);
    }

    for (const partition of partitions) {
      const partitionItems = flattenPartition(partition);
      // With all matching builds and matching loose cards (standard full capture)
      registerOption([...matchingBuilds, ...matchingLoose, ...partitionItems]);
      // Pure partition capture (if player only clicks a specific combo and no matching builds/loose)
      if (matchingBuilds.length === 0 && matchingLoose.length === 0) {
        registerOption(partitionItems);
      }
    }
  }

  // Digging Case A: Capture an opponent's top captured card alongside at least one table item
  for (const dug of opponentTopCards) {
    if (dug.card.isFaceCard) continue;

    if (dug.card.rank === playedCard.rank) {
      if (matchingBuilds.length > 0 || matchingLoose.length > 0) {
        registerOption([...matchingBuilds, ...matchingLoose], dug);
      }
      for (const partition of partitions) {
        const partitionItems = flattenPartition(partition);
        registerOption([...matchingBuilds, ...matchingLoose, ...partitionItems], dug);
        if (matchingBuilds.length === 0 && matchingLoose.length === 0) {
          registerOption(partitionItems, dug);
        }
      }
    } else if (dug.card.rank < playedCard.rank) {
      const needed = playedCard.rank - dug.card.rank;
      const partnerSubsets = findRankUnitSubsetsSummingTo(sumUnits, needed);
      for (const partnerUnits of partnerSubsets) {
        const partnerIds = new Set(partnerUnits.map((s) => s.id));
        const partnerItems = partnerUnits.map((s) => s.item);
        const remainingUnits = sumUnits.filter((s) => !partnerIds.has(s.id));

        registerOption([...matchingBuilds, ...matchingLoose, ...partnerItems], dug);

        const remPartitions =
          remainingUnits.length > 0
            ? findDisjointSumPartitions(remainingUnits, playedCard.rank)
            : [];
        for (const partition of remPartitions) {
          registerOption(
            [...matchingBuilds, ...matchingLoose, ...partnerItems, ...flattenPartition(partition)],
            dug
          );
        }
      }
    }
  }

  // Sort best / largest capture first
  options.sort((a, b) => b.tacticalScore - a.tacticalScore || b.totalCardsCaptured - a.totalCardsCaptured);
  return options;
}

/**
 * Validates whether a specific capture selection is strictly legal.
 */
export function validateCaptureSelection(
  playedCard: Card,
  hand: readonly Card[],
  table: readonly TableItem[],
  capturedItemIds: readonly string[],
  seat: number,
  players: readonly PlayerCapturedSnapshot[] = [],
  dugCapturedFromSeat?: number | null,
  activeDugCard: ActiveDugCardInput | null = null
): { valid: boolean; reason?: string } {
  if (capturedItemIds.length === 0) {
    return { valid: false, reason: 'Select at least one card or build to capture.' };
  }
  const uniqueIds = new Set(capturedItemIds);
  if (uniqueIds.size !== capturedItemIds.length) {
    return { valid: false, reason: 'Duplicate table targets selected.' };
  }

  const selectedItems: TableItem[] = [];
  for (const id of capturedItemIds) {
    const found = table.find((item) => item.id === id);
    if (!found) return { valid: false, reason: 'Selected table item no longer exists.' };
    selectedItems.push(found);
  }

  let dugCard: Card | null = null;
  if (activeDugCard) {
    if (dugCapturedFromSeat !== activeDugCard.sourceSeat) {
      return {
        valid: false,
        reason: 'You must capture using the card you pulled from your opponent.',
      };
    }
    dugCard = activeDugCard.card;
  } else if (dugCapturedFromSeat !== undefined && dugCapturedFromSeat !== null) {
    if (dugCapturedFromSeat === seat) {
      return { valid: false, reason: 'Cannot dig your own captured pile.' };
    }
    const sourcePlayer = players.find((p) => p.seat === dugCapturedFromSeat);
    if (!sourcePlayer || sourcePlayer.capturedCards.length === 0) {
      return { valid: false, reason: 'Target opponent has no top captured card to dig.' };
    }
    dugCard = sourcePlayer.capturedCards[sourcePlayer.capturedCards.length - 1];
  }

  const remainingHand = hand.filter((c) => c.id !== playedCard.id);
  const remainingTable = table.filter((it) => !uniqueIds.has(it.id));
  if (!canPlayerCoverOwnedBuilds(remainingHand, remainingTable, seat)) {
    return {
      valid: false,
      reason: 'Possession rule: you must keep a capture card in hand for your active build.',
    };
  }

  if (playedCard.isFaceCard) {
    const allMatch = selectedItems.every((it) =>
      it.kind === 'loose' ? it.card.rank === playedCard.rank : it.targetValue === playedCard.rank
    );
    if (!allMatch || (dugCard && dugCard.rank !== playedCard.rank)) {
      return { valid: false, reason: 'Face cards can only capture matching rank cards.' };
    }
    return { valid: true };
  }

  const nonMatchingUnits: { rank: number; isFaceCard: boolean }[] = [];
  for (const item of selectedItems) {
    if (item.kind === 'build') {
      if (item.targetValue === playedCard.rank) {
        continue;
      }
      if (item.isCemented) {
        return {
          valid: false,
          reason: `Build value ${item.targetValue} is locked and does not match ${playedCard.rank}.`,
        };
      }
      if (item.targetValue > playedCard.rank) {
        return {
          valid: false,
          reason: `Build value ${item.targetValue} does not match ${playedCard.rank}.`,
        };
      }
      nonMatchingUnits.push({ rank: item.targetValue, isFaceCard: false });
    } else {
      if (item.card.isFaceCard) {
        return { valid: false, reason: 'Numeric cards cannot capture face cards.' };
      }
      if (item.card.rank !== playedCard.rank) {
        nonMatchingUnits.push({ rank: item.card.rank, isFaceCard: false });
      }
    }
  }

  if (dugCard) {
    if (dugCard.isFaceCard) {
      return { valid: false, reason: 'Numeric cards cannot capture face cards.' };
    }
    if (dugCard.rank !== playedCard.rank) {
      nonMatchingUnits.push({ rank: dugCard.rank, isFaceCard: false });
    }
  }

  if (nonMatchingUnits.length > 0) {
    const partition = canExactPartitionIntoSums(nonMatchingUnits, playedCard.rank);
    if (!partition) {
      return {
        valid: false,
        reason: `Selected loose cards do not sum cleanly to ${playedCard.rank}.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Enumerates all legal Build and Cement options when playing `playedCard`.
 */
export function findValidBuildOptions(
  playedCard: Card,
  hand: readonly Card[],
  table: readonly TableItem[],
  seat: number,
  players: readonly PlayerCapturedSnapshot[] = [],
  activeDugCard: ActiveDugCardInput | null = null
): BuildOption[] {
  if (playedCard.isFaceCard) return [];

  const remainingHand = hand.filter((c) => c.id !== playedCard.id);
  const candidateTargets = Array.from(
    new Set(remainingHand.filter((c) => !c.isFaceCard).map((c) => c.rank))
  ).sort((a, b) => a - b);

  if (candidateTargets.length === 0) return [];

  const looseNumeric = table.filter(
    (item): item is TableLooseCard => item.kind === 'loose' && !item.card.isFaceCard
  );
  const buildsOnTable = table.filter(
    (item): item is TableBuildStack => item.kind === 'build'
  );
  const opponentTopCards = getAvailableDugCards(players, seat, activeDugCard);
  const mustUseDug = Boolean(activeDugCard);

  const options: BuildOption[] = [];
  const seenOptionKeys = new Set<string>();

  // Helper to record validated option if single-build-per-player & possession rules hold
  const tryRegisterBuild = (
    targetItems: TableItem[],
    targetValue: number,
    buildMode: 'CREATE_OPEN' | 'RAISE_OPEN' | 'CEMENT',
    resultingCemented: boolean,
    components: Card[][],
    dugEntry?: { seat: number; card: Card }
  ) => {
    if (mustUseDug && (!dugEntry || dugEntry.seat !== activeDugCard?.sourceSeat)) {
      return;
    }
    const targetIds = targetItems.map((it) => it.id).sort();
    const dugSeat = dugEntry ? dugEntry.seat : null;
    const key = `${buildMode}:${targetValue}:${targetIds.join(',')}:dig:${dugSeat ?? 'none'}`;
    if (seenOptionKeys.has(key)) return;

    const allCards = components.flat();

    const simulatedBuild: TableBuildStack = {
      kind: 'build',
      id: 'sim-build',
      cards: allCards,
      components,
      targetValue,
      ownerSeat: seat,
      isCemented: resultingCemented,
    };

    const remainingTable = [
      ...table.filter((it) => !targetIds.includes(it.id)),
      simulatedBuild,
    ];

    // Rule 2: At most 1 active build owned per player at a time
    const ownedBuildsCount = remainingTable.filter(
      (it): it is TableBuildStack => it.kind === 'build' && it.ownerSeat === seat
    ).length;
    if (ownedBuildsCount > 1) {
      return;
    }

    if (!canPlayerCoverOwnedBuilds(remainingHand, remainingTable, seat)) {
      return;
    }

    seenOptionKeys.add(key);

    const compLabels = components.map((g) => g.map((c) => c.label).join('+')).join(' & ');
    let description = '';
    if (buildMode === 'CREATE_OPEN') {
      description = `Build ${targetValue} (${compLabels})`;
    } else if (buildMode === 'RAISE_OPEN') {
      description = `Build up to ${targetValue} (${compLabels})`;
    } else {
      description = `Lock ${targetValue} Build (${compLabels})`;
    }
    if (dugEntry) {
      description += ` + Dig ${dugEntry.card.label}`;
    }

    options.push({
      id: `bld:${playedCard.id}:${key}`,
      targetItemIds: targetIds,
      targetItems,
      targetValue,
      buildMode,
      resultingCemented,
      dugCapturedFromSeat: dugSeat,
      components,
      description,
    });
  };

  // Enumerate subsets of loose numeric cards (capped safely at <= 4 loose cards per build to avoid blowup)
  const looseSubsets: TableLooseCard[][] = [[]];
  for (const item of looseNumeric) {
    const len = looseSubsets.length;
    for (let i = 0; i < len; i++) {
      if (looseSubsets[i].length < 4) {
        looseSubsets.push([...looseSubsets[i], item]);
      }
    }
  }

  for (const targetValue of candidateTargets) {
    // 1. Building on loose cards only (no existing build)
    for (const subset of looseSubsets) {
      if (subset.length === 0) continue;
      const subsetCards = subset.map((s) => s.card);
      const cardsInBuild = [playedCard, ...subsetCards];
      const sum = cardsInBuild.reduce((acc, c) => acc + c.rank, 0);

      // Case 1A: Single fresh open build (sum === targetValue, targetValue >= 2)
      if (!mustUseDug && sum === targetValue && targetValue >= 2) {
        tryRegisterBuild(subset, targetValue, 'CREATE_OPEN', false, [
          sortComponentDesc(cardsInBuild),
        ]);
      }

      // Case 1B: Multiple groups summing to targetValue -> immediately Cemented!
      // e.g. playing 6 onto loose 6 -> [[6], [6]] (Cemented 6)
      // or playing 2 onto loose 5 + loose 7 -> [[7], [5, 2]] (Cemented 7)
      if (!mustUseDug && sum >= targetValue * 2 && sum % targetValue === 0) {
        const partition = canExactPartitionIntoSums(cardsInBuild, targetValue);
        if (partition && partition.length >= 2) {
          tryRegisterBuild(
            subset,
            targetValue,
            'CEMENT',
            true,
            partition.map(sortComponentDesc)
          );
        }
      }

      // Dig Case B1: Existing loose card of rank `targetValue` on table + playedCard + dug top card
      if (subset.some((s) => s.card.rank === targetValue)) {
        for (const dug of opponentTopCards) {
          if (dug.card.isFaceCard) continue;
          const dugBuildCards = [playedCard, dug.card, ...subsetCards];
          const dugSum = dugBuildCards.reduce((acc, c) => acc + c.rank, 0);
          if (dugSum >= targetValue * 2 && dugSum % targetValue === 0) {
            const partition = canExactPartitionIntoSums(dugBuildCards, targetValue);
            if (
              partition &&
              partition.length >= 2 &&
              partitionContainsPlayedAndDugTogether(partition, playedCard, dug.card, targetValue)
            ) {
              tryRegisterBuild(
                subset,
                targetValue,
                'CEMENT',
                true,
                partition.map(sortComponentDesc),
                dug
              );
            }
          }
        }
      }
    }

    // 2. Modifying / Reinforcing an existing build on the table
    for (const existingBuild of buildsOnTable) {
      // 2A: Cementing an existing build of the SAME targetValue (works on open OR already cemented builds)
      if (existingBuild.targetValue === targetValue) {
        const baseComponents = existingBuild.components.map((g) => g.slice());
        for (const subset of looseSubsets) {
          const subsetCards = subset.map((s) => s.card);

          if (!mustUseDug) {
            const addedCards = [playedCard, ...subsetCards];
            const addedPartition = canExactPartitionIntoSums(addedCards, targetValue);
            if (addedPartition && addedPartition.length >= 1) {
              const newComponents = [
                ...baseComponents,
                ...addedPartition.map(sortComponentDesc),
              ];
              tryRegisterBuild(
                [existingBuild, ...subset],
                targetValue,
                'CEMENT',
                true,
                newComponents
              );
            }
          }

          // Dig Case B2: Reinforce/cement existing build of `targetValue` using playedCard + dug top card (+ optional loose)
          for (const dug of opponentTopCards) {
            if (dug.card.isFaceCard) continue;
            const dugAddedCards = [playedCard, dug.card, ...subsetCards];
            const dugPartition = canExactPartitionIntoSums(dugAddedCards, targetValue);
            if (
              dugPartition &&
              dugPartition.length >= 1 &&
              partitionContainsPlayedAndDugTogether(dugPartition, playedCard, dug.card, targetValue)
            ) {
              const newComponents = [
                ...baseComponents,
                ...dugPartition.map(sortComponentDesc),
              ];
              tryRegisterBuild(
                [existingBuild, ...subset],
                targetValue,
                'CEMENT',
                true,
                newComponents,
                dug
              );
            }
          }
        }

        // Rule A: Merge another uncemented build on the table + playedCard (+ loose / dug) into player's owned build
        if (existingBuild.ownerSeat === seat) {
          for (const otherBuild of buildsOnTable) {
            if (otherBuild.id === existingBuild.id || otherBuild.isCemented) continue;

            if (otherBuild.targetValue < targetValue) {
              for (const subset of looseSubsets) {
                const subsetCards = subset.map((s) => s.card);
                const subsetSum = subsetCards.reduce((acc, c) => acc + c.rank, 0);

                if (!mustUseDug && otherBuild.targetValue + playedCard.rank + subsetSum === targetValue) {
                  const mergedGroup = sortComponentDesc([
                    ...otherBuild.cards,
                    playedCard,
                    ...subsetCards,
                  ]);
                  tryRegisterBuild(
                    [existingBuild, otherBuild, ...subset],
                    targetValue,
                    'CEMENT',
                    true,
                    [...baseComponents, mergedGroup]
                  );
                }

                for (const dug of opponentTopCards) {
                  if (dug.card.isFaceCard) continue;
                  if (
                    otherBuild.targetValue + playedCard.rank + dug.card.rank + subsetSum ===
                    targetValue
                  ) {
                    const mergedGroup = sortComponentDesc([
                      ...otherBuild.cards,
                      playedCard,
                      dug.card,
                      ...subsetCards,
                    ]);
                    tryRegisterBuild(
                      [existingBuild, otherBuild, ...subset],
                      targetValue,
                      'CEMENT',
                      true,
                      [...baseComponents, mergedGroup],
                      dug
                    );
                  }
                }
              }
            } else if (otherBuild.targetValue === targetValue) {
              const otherComponents = otherBuild.components.map(sortComponentDesc);
              for (const subset of looseSubsets) {
                const subsetCards = subset.map((s) => s.card);

                if (!mustUseDug) {
                  const addedCards = [playedCard, ...subsetCards];
                  const addedPartition = canExactPartitionIntoSums(addedCards, targetValue);
                  if (addedPartition && addedPartition.length >= 1) {
                    tryRegisterBuild(
                      [existingBuild, otherBuild, ...subset],
                      targetValue,
                      'CEMENT',
                      true,
                      [
                        ...baseComponents,
                        ...otherComponents,
                        ...addedPartition.map(sortComponentDesc),
                      ]
                    );
                  }
                }

                for (const dug of opponentTopCards) {
                  if (dug.card.isFaceCard) continue;
                  const dugAddedCards = [playedCard, dug.card, ...subsetCards];
                  const dugPartition = canExactPartitionIntoSums(dugAddedCards, targetValue);
                  if (
                    dugPartition &&
                    dugPartition.length >= 1 &&
                    partitionContainsPlayedAndDugTogether(
                      dugPartition,
                      playedCard,
                      dug.card,
                      targetValue
                    )
                  ) {
                    tryRegisterBuild(
                      [existingBuild, otherBuild, ...subset],
                      targetValue,
                      'CEMENT',
                      true,
                      [
                        ...baseComponents,
                        ...otherComponents,
                        ...dugPartition.map(sortComponentDesc),
                      ],
                      dug
                    );
                  }
                }
              }
            }
          }
        }
      }

      // 2B: Raising an OPEN (non-cemented) build to a higher targetValue (<= 10)
      if (!mustUseDug && !existingBuild.isCemented && targetValue > existingBuild.targetValue && targetValue <= 10) {
        for (const subset of looseSubsets) {
          const addedSum =
            playedCard.rank + subset.reduce((acc, s) => acc + s.card.rank, 0);
          if (existingBuild.targetValue + addedSum === targetValue) {
            const singleGroup = sortComponentDesc([
              ...existingBuild.cards,
              playedCard,
              ...subset.map((s) => s.card),
            ]);
            tryRegisterBuild(
              [existingBuild, ...subset],
              targetValue,
              'RAISE_OPEN',
              false,
              [singleGroup]
            );
          }
        }
      }
    }
  }

  return options;
}

/**
 * Enumerates valid opponent top-card + loose table card merges into the player's own active build (Dig Case C).
 */
export function findValidTableDigMerges(
  table: readonly TableItem[],
  players: readonly PlayerCapturedSnapshot[],
  seat: number,
  activeDugCard: ActiveDugCardInput | null = null
): TableDigMergeOption[] {
  const ownedBuilds = table.filter(
    (item): item is TableBuildStack => item.kind === 'build' && item.ownerSeat === seat
  );
  if (ownedBuilds.length === 0) return [];

  const looseNumeric = table.filter(
    (item): item is TableLooseCard => item.kind === 'loose' && !item.card.isFaceCard
  );
  if (looseNumeric.length === 0) return [];

  const opponentTopCards = getAvailableDugCards(players, seat, activeDugCard);
  if (opponentTopCards.length === 0) return [];

  const looseUnits = looseNumeric.map((item) => ({
    id: item.id,
    rank: item.card.rank,
    isFaceCard: false,
    item,
  }));

  const options: TableDigMergeOption[] = [];
  const seenKeys = new Set<string>();

  for (const build of ownedBuilds) {
    for (const dug of opponentTopCards) {
      if (dug.card.isFaceCard || dug.card.rank >= build.targetValue) continue;
      const needed = build.targetValue - dug.card.rank;
      const subsets = findRankUnitSubsetsSummingTo(looseUnits, needed);
      for (const unitSubset of subsets) {
        const subset = unitSubset.map((u) => u.item);
        const targetItemIds = subset.map((it) => it.id).sort();
        const key = `${build.id}|dig:${dug.seat}|${targetItemIds.join(',')}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        const looseLabels = subset.map((it) => it.card.label).join(' + ');
        options.push({
          id: `dig-merge:${build.id}:seat${dug.seat}:${targetItemIds.join(',')}`,
          buildId: build.id,
          targetValue: build.targetValue,
          targetItemIds,
          targetItems: subset,
          dugFromSeat: dug.seat,
          dugCard: dug.card,
          description: `${dug.card.label} + ${looseLabels} into Build ${build.targetValue}`,
        });
      }
    }
  }

  return options;
}

/**
 * Finds all subsets of loose numeric table cards (1..4 cards) summing to `ownedBuild.targetValue`
 * that can be moved directly into `seat`'s active build (`MERGE_LOOSE_TO_BUILD`).
 */
export function findValidLooseToBuildMerges(
  table: readonly TableItem[],
  seat: number
): LooseBuildMergeOption[] {
  const ownedBuilds = table.filter(
    (item): item is TableBuildStack => item.kind === 'build' && item.ownerSeat === seat
  );
  if (ownedBuilds.length === 0) return [];

  const looseNumeric = table.filter(
    (item): item is TableLooseCard => item.kind === 'loose' && !item.card.isFaceCard
  );
  if (looseNumeric.length === 0) return [];

  const looseUnits = looseNumeric.map((item) => ({
    id: item.id,
    rank: item.card.rank,
    isFaceCard: false,
    item,
  }));

  const options: LooseBuildMergeOption[] = [];
  const seenKeys = new Set<string>();

  for (const build of ownedBuilds) {
    const subsets = findRankUnitSubsetsSummingTo(looseUnits, build.targetValue, 4);
    for (const unitSubset of subsets) {
      const subset = unitSubset.map((u) => u.item);
      const targetItemIds = subset.map((it) => it.id).sort();
      const key = `${build.id}|${targetItemIds.join(',')}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const looseLabels = subset.map((it) => it.card.label).join(' + ');
      options.push({
        id: `loose-merge:${build.id}:${targetItemIds.join(',')}`,
        buildId: build.id,
        targetValue: build.targetValue,
        targetItemIds,
        targetItems: subset,
        description: `${looseLabels} into Build ${formatBuildRank(build.targetValue)}`,
      });
    }
  }

  return options;
}

/**
 * Checks whether pulling `sourceSeat`'s top captured card has at least one legal
 * DIG_TABLE_TO_BUILD, CAPTURE (with `dugCapturedFromSeat === sourceSeat`), or BUILD
 * (with `dugCapturedFromSeat === sourceSeat`) available in `seat`'s hand
 * (and involving `targetItemId` if provided).
 */
export function canPullOpponentTopCard(
  sourceSeat: number,
  hand: readonly Card[],
  table: readonly TableItem[],
  seat: number,
  players: readonly PlayerCapturedSnapshot[],
  isFinalDealCard: boolean,
  targetItemId?: string | null
): { valid: boolean; reason?: string } {
  if (sourceSeat === seat) {
    return { valid: false, reason: 'Cannot dig your own captured pile.' };
  }
  const sourcePlayer = players.find((p) => p.seat === sourceSeat);
  if (!sourcePlayer || sourcePlayer.capturedCards.length === 0) {
    return { valid: false, reason: 'Target opponent has no top captured card to pull.' };
  }

  const dugCard = sourcePlayer.capturedCards[sourcePlayer.capturedCards.length - 1];
  const activeDug: ActiveDugCardInput = { sourceSeat, card: dugCard };

  if (targetItemId !== undefined && targetItemId !== null) {
    const targetExists = table.some((it) => it.id === targetItemId);
    if (!targetExists) {
      return { valid: false, reason: 'Selected table card or build no longer exists.' };
    }
  }

  const digMerges = findValidTableDigMerges(table, players, seat, activeDug);
  if (
    digMerges.some(
      (m) =>
        m.dugFromSeat === sourceSeat &&
        (!targetItemId || m.buildId === targetItemId || m.targetItemIds.includes(targetItemId))
    )
  ) {
    return { valid: true };
  }

  for (const card of hand) {
    const captures = findValidCaptureOptions(
      card,
      hand,
      table,
      seat,
      isFinalDealCard,
      players,
      activeDug
    );
    if (
      captures.some(
        (cap) =>
          cap.dugCapturedFromSeat === sourceSeat &&
          (!targetItemId || cap.capturedItemIds.includes(targetItemId))
      )
    ) {
      return { valid: true };
    }

    const builds = findValidBuildOptions(card, hand, table, seat, players, activeDug);
    if (
      builds.some(
        (bld) =>
          bld.dugCapturedFromSeat === sourceSeat &&
          (!targetItemId || bld.targetItemIds.includes(targetItemId))
      )
    ) {
      return { valid: true };
    }
  }

  return {
    valid: false,
    reason: targetItemId
      ? `No legal capture or build in your hand can use ${dugCard.label} with that table item.`
      : `You do not hold the required card to capture or build with ${dugCard.label}.`,
  };
}

export function formatBuildRank(value: number): string {
  return value === 1 ? 'A' : String(value);
}

function rankArticle(value: number): string {
  return value === 1 || value === 8 ? 'an' : 'a';
}

/**
 * Diagnoses why `playedCard` cannot legally capture or build onto `targetItem`.
 * Used to give clear in-game contingency feedback instead of silently dropping the card.
 */
export function diagnoseFailedTargetPlay(
  playedCard: Card,
  targetItem: TableItem,
  hand: readonly Card[],
  table: readonly TableItem[],
  seat: number
): string {
  const remainingHand = hand.filter((c) => c.id !== playedCard.id);
  const ownedBuild = table.find(
    (item): item is TableBuildStack => item.kind === 'build' && item.ownerSeat === seat
  );

  if (targetItem.kind === 'build') {
    const buildVal = targetItem.targetValue;
    const buildLabel = formatBuildRank(buildVal);

    if (playedCard.rank === buildVal && !canPlayerCoverOwnedBuilds(remainingHand, table.filter((it) => it.id !== targetItem.id), seat)) {
      return `Hold onto your ${playedCard.label} — you need it to capture your ${formatBuildRank(ownedBuild?.targetValue ?? buildVal)} build.`;
    }

    if (targetItem.isCemented && playedCard.rank !== buildVal) {
      return `Build ${buildLabel} is locked — it can only be captured with a ${buildLabel}.`;
    }

    if (ownedBuild && ownedBuild.id !== targetItem.id) {
      return `You already have a ${formatBuildRank(ownedBuild.targetValue)} build on the table.`;
    }

    if (playedCard.rank === buildVal) {
      const hasSecondCopy = remainingHand.some((c) => c.rank === buildVal);
      if (!hasSecondCopy) {
        return `You need another ${buildLabel} in your hand to keep ${buildLabel}.`;
      }
    }

    const raisedSum = buildVal + playedCard.rank;
    if (raisedSum > 10) {
      return `Cannot build over 10 (${formatBuildRank(playedCard.rank)} + ${buildLabel} = ${raisedSum}).`;
    }
    if (!remainingHand.some((c) => c.rank === raisedSum)) {
      return `You need ${rankArticle(raisedSum)} ${formatBuildRank(raisedSum)} in your hand to build ${formatBuildRank(raisedSum)}.`;
    }
  } else {
    const targetVal = targetItem.card.rank;
    const targetLabel = formatBuildRank(targetVal);

    if (ownedBuild) {
      return `You already have ${rankArticle(ownedBuild.targetValue)} ${formatBuildRank(ownedBuild.targetValue)} build on the table.`;
    }

    if (playedCard.rank === targetVal) {
      const hasSecondCopy = remainingHand.some((c) => c.rank === targetVal);
      if (!hasSecondCopy) {
        return `You need another ${targetLabel} in your hand to keep ${targetLabel}.`;
      }
    }

    const combinedSum = playedCard.rank + targetVal;
    if (combinedSum > 10) {
      return `Cannot build over 10 (${formatBuildRank(playedCard.rank)} + ${targetLabel} = ${combinedSum}).`;
    }
    if (!remainingHand.some((c) => c.rank === combinedSum)) {
      return `You need ${rankArticle(combinedSum)} ${formatBuildRank(combinedSum)} in your hand to build ${formatBuildRank(combinedSum)}.`;
    }
  }

  return `${playedCard.label} cannot capture or build on that card.`;
}

/**
 * Checks whether a card can legally be trailed onto the table.
 */
export function canTrailCard(
  playedCard: Card,
  hand: readonly Card[],
  table: readonly TableItem[],
  seat: number,
  options?: TrailCheckOptions
): { valid: boolean; reason?: string } {
  if (options?.activeDugCard) {
    return {
      valid: false,
      reason: 'You must finish playing or capturing the card you took from your opponent.',
    };
  }

  const remainingHand = hand.filter((c) => c.id !== playedCard.id);
  if (!canPlayerCoverOwnedBuilds(remainingHand, table, seat)) {
    return {
      valid: false,
      reason: `Hold onto your ${playedCard.label} — you need it to capture your active build.`,
    };
  }

  if (options?.isRound1Of1v1) {
    const ownsBuild = table.some(
      (item) => item.kind === 'build' && item.ownerSeat === seat
    );
    if (ownsBuild) {
      const players = options.players ?? [];
      const hasLegalCaptureOrBuild = hand.some(
        (c) =>
          findValidCaptureOptions(c, hand, table, seat, false, players).length > 0 ||
          findValidBuildOptions(c, hand, table, seat, players).length > 0
      );
      if (hasLegalCaptureOrBuild) {
        return {
          valid: false,
          reason:
            'In Round 1, capture or keep building while you have a build on the table.',
        };
      }
    }
  }

  return { valid: true };
}
