import {
  Card,
  TurnEngineDefinition,
  prepareSACasino40Deck,
} from '../../studio/core';
import {
  canPlayerCoverOwnedBuilds,
  canPullOpponentTopCard,
  canTrailCard,
  findValidBuildOptions,
  formatBuildRank,
  sortComponentDesc,
  validateCaptureSelection,
} from './buildAndCaptureValidator';
import { calculateDealScore } from './scoring';
import {
  BuildOption,
  GameMode,
  HouseRules,
  MaskedPlayerSeatState,
  PlayerSeatState,
  SACasinoAction,
  SACasinoConfig,
  SACasinoPlayerView,
  SACasinoState,
  SACasinoVisualEvent,
  TableBuildStack,
  TableItem,
  TableLooseCard,
} from './types';

export const SA_CASINO_CUT_COUNT = 12;
export const SA_CASINO_ACTIVE_POOL_SIZE = 40;

function getDefaultSeats(mode: GameMode, customNames?: readonly string[]): PlayerSeatState[] {
  if (mode === '1v1') {
    return [
      { seat: 0, name: customNames?.[0] ?? 'You', isAI: false, teamId: 0, hand: [], capturedCards: [], sweeps: 0 },
      { seat: 1, name: customNames?.[1] ?? 'Kobus (Bot)', isAI: true, teamId: 1, hand: [], capturedCards: [], sweeps: 0 },
    ];
  }
  if (mode === '3p-ffa') {
    return [
      { seat: 0, name: customNames?.[0] ?? 'You', isAI: false, teamId: 0, hand: [], capturedCards: [], sweeps: 0 },
      { seat: 1, name: customNames?.[1] ?? 'Thabo (Bot)', isAI: true, teamId: 1, hand: [], capturedCards: [], sweeps: 0 },
      { seat: 2, name: customNames?.[2] ?? 'Annelize (Bot)', isAI: true, teamId: 2, hand: [], capturedCards: [], sweeps: 0 },
    ];
  }
  return [
    { seat: 0, name: customNames?.[0] ?? 'You', isAI: false, teamId: 0, hand: [], capturedCards: [], sweeps: 0 },
    { seat: 1, name: customNames?.[1] ?? 'Pieter (Bot)', isAI: true, teamId: 1, hand: [], capturedCards: [], sweeps: 0 },
    { seat: 2, name: customNames?.[2] ?? 'Nomsa (Partner)', isAI: true, teamId: 0, hand: [], capturedCards: [], sweeps: 0 },
    { seat: 3, name: customNames?.[3] ?? 'Sibusiso (Bot)', isAI: true, teamId: 1, hand: [], capturedCards: [], sweeps: 0 },
  ];
}

export function createInitialSACasinoState(config: SACasinoConfig): SACasinoState {
  const mode = config.mode;
  const dealNumber = config.dealNumber ?? 1;
  const houseRules: HouseRules = {
    sweepsEnabled: config.houseRules?.sweepsEnabled ?? true,
    targetMatchScore: config.houseRules?.targetMatchScore ?? 21,
  };

  const basePlayers = getDefaultSeats(mode, config.playerNames);
  const playerCount = basePlayers.length;
  const dealerSeat = ((config.dealerSeat ?? (dealNumber - 1)) % playerCount + playerCount) % playerCount;
  const firstTurnSeat = (dealerSeat + 1) % playerCount;

  // Deterministic 40-card numeric deck (A–10 only); 12 face cards (J, Q, K) removed before play
  const { activePool, cutPile } = prepareSACasino40Deck(config.seed);

  const cardsPerHand = mode === '3p-ffa' ? 13 : 10;
  const initialTableCount = mode === '3p-ffa' ? 1 : 0;
  const totalRounds: 1 | 2 = mode === '1v1' ? 2 : 1;

  let cursor = 0;
  const dealtPlayers = basePlayers.map((p) => {
    const hand = activePool.slice(cursor, cursor + cardsPerHand);
    cursor += cardsPerHand;
    return { ...p, hand };
  });

  const initialTable: TableItem[] = activePool
    .slice(cursor, cursor + initialTableCount)
    .map((card): TableLooseCard => ({
      kind: 'loose',
      id: `loose:${card.id}`,
      card,
    }));
  cursor += initialTableCount;

  const remainingDrawPile = activePool.slice(cursor);

  const matchScores: Record<number, number> = { ...(config.matchScores ?? {}) };
  for (const p of dealtPlayers) {
    if (matchScores[p.teamId] === undefined) {
      matchScores[p.teamId] = 0;
    }
  }

  return {
    mode,
    seed: config.seed,
    dealNumber,
    roundNumber: 1,
    totalRounds,
    dealerSeat,
    currentTurnSeat: firstTurnSeat,
    lastCapturerSeat: null,
    cutPile,
    drawPile: remainingDrawPile,
    table: initialTable,
    players: dealtPlayers,
    houseRules,
    matchScores,
    phase: 'PLAYING',
    turnCount: 0,
    activeDugCard: null,
    lastActionSummary: {
      seat: dealerSeat,
      playerName: dealtPlayers[dealerSeat].name,
      actionType: 'DEAL',
      description:
        mode === '3p-ffa'
          ? '40-card deck (A–10 only). Dealt 13 each & 1 face-up.'
          : mode === '1v1'
          ? '40-card deck (A–10 only). Dealt 10 each (Round 1 of 2).'
          : '40-card deck (A–10 only). Dealt 10 each across 2v2 teams.',
      swept: false,
      playedCard: null,
    },
    dealScoreBreakdown: null,
  };
}

function advanceAfterPlayerTurn(
  state: SACasinoState,
  updatedPlayers: PlayerSeatState[],
  updatedTable: TableItem[],
  updatedLastCapturerSeat: number | null,
  summary: SACasinoState['lastActionSummary'],
  events: SACasinoVisualEvent[]
): SACasinoState {
  const allHandsEmpty = updatedPlayers.every((p) => p.hand.length === 0);

  if (!allHandsEmpty) {
    const nextSeat = (state.currentTurnSeat + 1) % updatedPlayers.length;
    return {
      ...state,
      players: updatedPlayers,
      table: updatedTable,
      lastCapturerSeat: updatedLastCapturerSeat,
      currentTurnSeat: nextSeat,
      turnCount: state.turnCount + 1,
      activeDugCard: null,
      lastActionSummary: summary,
    };
  }

  // In 1v1, Round 1 ends with 20 cards remaining in drawPile -> transition to Round 2 keeping live table!
  if (state.mode === '1v1' && state.roundNumber === 1 && state.drawPile.length === 20) {
    return {
      ...state,
      players: updatedPlayers,
      table: updatedTable,
      lastCapturerSeat: updatedLastCapturerSeat,
      phase: 'ROUND_TRANSITION',
      turnCount: state.turnCount + 1,
      activeDugCard: null,
      lastActionSummary: summary,
    };
  }

  // Deal is finished: award any remaining loose/uncaptured table cards to lastCapturerSeat (fallback to dealerSeat)
  let finalPlayers = updatedPlayers;
  let finalTable = updatedTable;
  if (updatedTable.length > 0) {
    const sweepSeat = updatedLastCapturerSeat ?? state.dealerSeat;
    const leftoverCards = updatedTable.flatMap((it) =>
      it.kind === 'loose' ? [it.card] : [...it.cards]
    );
    finalPlayers = updatedPlayers.map((p) =>
      p.seat === sweepSeat
        ? { ...p, capturedCards: [...p.capturedCards, ...leftoverCards] }
        : p
    );
    finalTable = [];
  }

  const breakdown = calculateDealScore(
    finalPlayers,
    state.cutPile,
    state.mode,
    state.houseRules
  );

  const nextMatchScores = { ...state.matchScores };
  for (const t of breakdown.teams) {
    nextMatchScores[t.teamId] = (nextMatchScores[t.teamId] ?? 0) + t.points.total;
  }

  events.push({
    id: `ev:deal-over:${state.turnCount}`,
    type: 'DEAL_FINISHED',
    data: { winningTeamIds: breakdown.winningTeamIds },
  });

  return {
    ...state,
    players: finalPlayers,
    table: finalTable,
    lastCapturerSeat: updatedLastCapturerSeat,
    matchScores: nextMatchScores,
    phase: 'DEAL_OVER',
    turnCount: state.turnCount + 1,
    activeDugCard: null,
    lastActionSummary: summary,
    dealScoreBreakdown: breakdown,
  };
}

export function isFinalDealCardInState(state: SACasinoState): boolean {
  const isFinalRound = state.roundNumber === state.totalRounds;
  if (!isFinalRound) return false;
  const totalRemainingCards = state.players.reduce((sum, p) => sum + p.hand.length, 0);
  return totalRemainingCards <= 1;
}

export function applySACasinoAction(
  state: SACasinoState,
  action: SACasinoAction
): { state: SACasinoState; events: SACasinoVisualEvent[]; error?: string } {
  const events: SACasinoVisualEvent[] = [];

  if (action.type === 'DEAL_NEXT_ROUND') {
    if (state.phase !== 'ROUND_TRANSITION' || state.roundNumber !== 1 || state.drawPile.length < 20) {
      return { state, events, error: 'Cannot deal Round 2 from current state.' };
    }
    const p0Hand = state.drawPile.slice(0, 10);
    const p1Hand = state.drawPile.slice(10, 20);
    const nextPlayers = state.players.map((p, idx) => ({
      ...p,
      hand: idx === 0 ? p0Hand : p1Hand,
    }));
    const firstTurnSeat = (state.dealerSeat + 1) % nextPlayers.length;

    events.push({
      id: `ev:r2:${state.turnCount}`,
      type: 'ROUND_2_DEALT',
      data: { liveTableCount: state.table.length },
    });

    return {
      state: {
        ...state,
        roundNumber: 2,
        drawPile: [],
        players: nextPlayers,
        currentTurnSeat: firstTurnSeat,
        phase: 'PLAYING',
        activeDugCard: null,
        lastActionSummary: {
          seat: state.dealerSeat,
          playerName: nextPlayers[state.dealerSeat].name,
          actionType: 'DEAL',
          description: `Dealt Round 2 (10 cards each). ${state.table.length} table item(s) remain live.`,
          swept: false,
          playedCard: null,
        },
      },
      events,
    };
  }

  if (state.phase !== 'PLAYING') {
    return { state, events, error: 'Game is not currently accepting player moves.' };
  }

  if (action.playerSeat !== state.currentTurnSeat) {
    return { state, events, error: `Not seat ${action.playerSeat}'s turn.` };
  }

  const activePlayer = state.players[action.playerSeat];
  if (!activePlayer) {
    return { state, events, error: 'Invalid player seat.' };
  }

  if (action.type === 'DIG_TABLE_TO_BUILD') {
    const { buildId, targetItemIds, dugFromSeat } = action.payload;
    if (dugFromSeat === action.playerSeat) {
      return { state, events, error: 'Cannot dig your own captured pile.' };
    }

    let dugCard: Card;
    let shouldPopFromSource = false;
    if (state.activeDugCard !== null) {
      if (dugFromSeat !== state.activeDugCard.sourceSeat) {
        return {
          state,
          events,
          error: 'You must finish playing or capturing the card you took from your opponent.',
        };
      }
      dugCard = state.activeDugCard.card;
    } else {
      const sourcePlayer = state.players.find((p) => p.seat === dugFromSeat);
      if (!sourcePlayer || sourcePlayer.capturedCards.length === 0) {
        return { state, events, error: 'Target opponent has no top captured card to dig.' };
      }
      dugCard = sourcePlayer.capturedCards[sourcePlayer.capturedCards.length - 1];
      shouldPopFromSource = true;
    }

    if (dugCard.isFaceCard) {
      return { state, events, error: 'Face cards cannot be merged into a numeric build.' };
    }

    const ownedBuild = state.table.find(
      (it): it is TableBuildStack =>
        it.kind === 'build' && it.id === buildId && it.ownerSeat === action.playerSeat
    );
    if (!ownedBuild) {
      return { state, events, error: 'You can only merge dug cards into your own active build.' };
    }

    const resolved = resolveNumericLooseTargets(
      state.table,
      targetItemIds,
      'Select at least one loose table card to merge with the dug card.'
    );
    if ('error' in resolved) {
      return { state, events, error: resolved.error };
    }

    const combinedSum =
      dugCard.rank + resolved.cards.reduce((sum, c) => sum + c.rank, 0);
    if (combinedSum !== ownedBuild.targetValue) {
      return {
        state,
        events,
        error: `Dug ${dugCard.label} plus selected table cards (${combinedSum}) does not equal Build ${ownedBuild.targetValue}.`,
      };
    }

    const nextTable = appendComponentToOwnedBuild(
      state.table,
      ownedBuild,
      resolved.uniqueIds,
      [dugCard, ...resolved.cards]
    );

    const nextPlayers = shouldPopFromSource
      ? state.players.map((p) =>
          p.seat === dugFromSeat
            ? { ...p, capturedCards: p.capturedCards.slice(0, -1) }
            : p
        )
      : state.players.slice();

    const looseLabels = resolved.cards.map((c) => c.label).join(' + ');
    const description = `Dug ${dugCard.label} + ${looseLabels} into Build ${formatBuildRank(ownedBuild.targetValue)}`;

    events.push({
      id: `ev:bld:${state.turnCount}`,
      type: 'BUILD_CEMENTED',
      data: {
        seat: action.playerSeat,
        playedCard: null,
        dugCard,
        dugFromSeat,
        targetValue: ownedBuild.targetValue,
        isCemented: true,
      },
    });

    return {
      state: {
        ...state,
        players: nextPlayers,
        table: nextTable,
        turnCount: state.turnCount + 1,
        activeDugCard: null,
        lastActionSummary: {
          seat: action.playerSeat,
          playerName: activePlayer.name,
          actionType: 'CEMENT',
          description,
          swept: false,
          playedCard: null,
        },
      },
      events,
    };
  }

  if (action.type === 'MERGE_LOOSE_TO_BUILD') {
    if (state.activeDugCard !== null) {
      return {
        state,
        events,
        error: 'You must finish playing or capturing the card you took from your opponent.',
      };
    }

    const { buildId, targetItemIds } = action.payload;
    const ownedBuild = state.table.find(
      (it): it is TableBuildStack =>
        it.kind === 'build' && it.id === buildId && it.ownerSeat === action.playerSeat
    );
    if (!ownedBuild) {
      return {
        state,
        events,
        error: 'You can only merge loose table cards into your own active build.',
      };
    }

    const resolved = resolveNumericLooseTargets(
      state.table,
      targetItemIds,
      'Select at least one loose table card to move into your build.'
    );
    if ('error' in resolved) {
      return { state, events, error: resolved.error };
    }

    const combinedSum = resolved.cards.reduce((sum, c) => sum + c.rank, 0);
    if (combinedSum !== ownedBuild.targetValue) {
      return {
        state,
        events,
        error: `Selected loose cards (${combinedSum}) do not equal Build ${formatBuildRank(ownedBuild.targetValue)}.`,
      };
    }

    const nextTable = appendComponentToOwnedBuild(
      state.table,
      ownedBuild,
      resolved.uniqueIds,
      resolved.cards
    );

    const looseLabels = resolved.cards.map((c) => c.label).join(' + ');
    const description = `Moved ${looseLabels} into Build ${formatBuildRank(ownedBuild.targetValue)}`;

    events.push({
      id: `ev:bld:${state.turnCount}`,
      type: 'BUILD_CEMENTED',
      data: {
        seat: action.playerSeat,
        playedCard: null,
        targetValue: ownedBuild.targetValue,
        isCemented: true,
      },
    });

    return {
      state: {
        ...state,
        table: nextTable,
        turnCount: state.turnCount + 1,
        lastActionSummary: {
          seat: action.playerSeat,
          playerName: activePlayer.name,
          actionType: 'CEMENT',
          description,
          swept: false,
          playedCard: null,
        },
      },
      events,
    };
  }

  if (action.type === 'PULL_OPPONENT_TOP_CARD') {
    if (state.activeDugCard !== null) {
      return {
        state,
        events,
        error: 'You must finish playing or capturing the card you took from your opponent.',
      };
    }

    const { sourceSeat, targetItemId = null } = action.payload;
    if (sourceSeat === action.playerSeat) {
      return { state, events, error: 'Cannot dig your own captured pile.' };
    }
    const sourcePlayer = state.players.find((p) => p.seat === sourceSeat);
    if (!sourcePlayer || sourcePlayer.capturedCards.length === 0) {
      return { state, events, error: 'Target opponent has no top captured card to pull.' };
    }

    const pullCheck = canPullOpponentTopCard(
      sourceSeat,
      activePlayer.hand,
      state.table,
      action.playerSeat,
      state.players,
      isFinalDealCardInState(state),
      targetItemId
    );
    if (!pullCheck.valid) {
      return { state, events, error: pullCheck.reason };
    }

    const dugCard = sourcePlayer.capturedCards[sourcePlayer.capturedCards.length - 1];
    const nextPlayers = state.players.map((p) =>
      p.seat === sourceSeat
        ? { ...p, capturedCards: p.capturedCards.slice(0, -1) }
        : p
    );

    return {
      state: {
        ...state,
        players: nextPlayers,
        turnCount: state.turnCount + 1,
        activeDugCard: {
          sourceSeat,
          card: dugCard,
          attachedTargetId: targetItemId,
        },
        lastActionSummary: {
          seat: action.playerSeat,
          playerName: activePlayer.name,
          actionType: 'DIG',
          description: `Pulled ${dugCard.label} from ${sourcePlayer.name}`,
          swept: false,
          playedCard: null,
        },
      },
      events,
    };
  }

  const playedCard = activePlayer.hand.find((c) => c.id === action.payload.cardId);
  if (!playedCard) {
    return { state, events, error: 'Card is not in active player hand.' };
  }

  const remainingHand = activePlayer.hand.filter((c) => c.id !== playedCard.id);

  if (action.type === 'TRAIL') {
    if (state.activeDugCard !== null) {
      return {
        state,
        events,
        error: 'You must finish playing or capturing the card you took from your opponent.',
      };
    }
    const check = canTrailCard(playedCard, activePlayer.hand, state.table, action.playerSeat, {
      isRound1Of1v1: state.mode === '1v1' && state.roundNumber === 1,
      players: state.players,
      activeDugCard: state.activeDugCard,
    });
    if (!check.valid) {
      return { state, events, error: check.reason };
    }

    const looseItem: TableLooseCard = {
      kind: 'loose',
      id: `loose:${playedCard.id}`,
      card: playedCard,
    };
    const nextTable = [...state.table, looseItem];
    const nextPlayers = state.players.map((p) =>
      p.seat === action.playerSeat ? { ...p, hand: remainingHand } : p
    );

    events.push({
      id: `ev:trail:${state.turnCount}`,
      type: 'CARD_TRAILED',
      data: { seat: action.playerSeat, card: playedCard },
    });

    return {
      state: advanceAfterPlayerTurn(
        state,
        nextPlayers,
        nextTable,
        state.lastCapturerSeat,
        {
          seat: action.playerSeat,
          playerName: activePlayer.name,
          actionType: 'TRAIL',
          description: `Played ${playedCard.label} on table`,
          swept: false,
          playedCard,
        },
        events
      ),
      events,
    };
  }

  if (action.type === 'CAPTURE') {
    const dugSeat = action.payload.dugCapturedFromSeat ?? null;
    if (state.activeDugCard !== null && dugSeat !== state.activeDugCard.sourceSeat) {
      return {
        state,
        events,
        error: 'You must finish playing or capturing the card you took from your opponent.',
      };
    }
    const check = validateCaptureSelection(
      playedCard,
      activePlayer.hand,
      state.table,
      action.payload.capturedItemIds,
      action.playerSeat,
      state.players,
      dugSeat,
      state.activeDugCard
    );
    if (!check.valid) {
      return { state, events, error: check.reason };
    }

    const capturedSet = new Set(action.payload.capturedItemIds);
    const capturedItems = state.table.filter((it) => capturedSet.has(it.id));
    const nextTable = state.table.filter((it) => !capturedSet.has(it.id));

    let dugCard: Card | null = null;
    if (state.activeDugCard !== null) {
      dugCard = state.activeDugCard.card;
    } else if (dugSeat !== null) {
      const dugSourcePlayer = state.players.find((p) => p.seat === dugSeat);
      dugCard =
        dugSourcePlayer && dugSourcePlayer.capturedCards.length > 0
          ? dugSourcePlayer.capturedCards[dugSourcePlayer.capturedCards.length - 1]
          : null;
    }

    // Strict LIFO capture ordering: captured table/dug cards first, playedCard LAST (on top face-up)
    const wonCards: Card[] = [];
    for (const item of capturedItems) {
      if (item.kind === 'loose') wonCards.push(item.card);
      else wonCards.push(...item.cards);
    }
    if (dugCard) {
      wonCards.push(dugCard);
    }
    wonCards.push(playedCard);

    const isSweep =
      nextTable.length === 0 && !isFinalDealCardInState(state);

    const shouldPopDugFromSource = state.activeDugCard === null && dugSeat !== null;
    const nextPlayers = state.players.map((p) => {
      if (p.seat === action.playerSeat) {
        return {
          ...p,
          hand: remainingHand,
          capturedCards: [...p.capturedCards, ...wonCards],
          sweeps: p.sweeps + (isSweep ? 1 : 0),
        };
      }
      if (shouldPopDugFromSource && p.seat === dugSeat) {
        return {
          ...p,
          capturedCards: p.capturedCards.slice(0, -1),
        };
      }
      return p;
    });

    events.push({
      id: `ev:cap:${state.turnCount}`,
      type: 'CARD_CAPTURED',
      data: {
        seat: action.playerSeat,
        playedCard,
        dugCard,
        dugFromSeat: dugSeat,
        capturedCards: wonCards,
        capturedCount: wonCards.length,
        isSweep,
      },
    });

    if (isSweep && state.houseRules.sweepsEnabled) {
      events.push({
        id: `ev:sweep:${state.turnCount}`,
        type: 'SWEEP_SCORED',
        data: { seat: action.playerSeat },
      });
    }

    const dugDesc = dugCard ? ` (dug ${dugCard.label})` : '';
    return {
      state: advanceAfterPlayerTurn(
        state,
        nextPlayers,
        nextTable,
        action.playerSeat,
        {
          seat: action.playerSeat,
          playerName: activePlayer.name,
          actionType: 'CAPTURE',
          description: `Captured ${wonCards.length} cards with ${playedCard.label}${dugDesc}${isSweep ? ' (SWEEP!)' : ''}`,
          swept: isSweep,
          playedCard,
        },
        events
      ),
      events,
    };
  }

  if (action.type === 'BUILD') {
    const inputDugSeat = action.payload.dugCapturedFromSeat ?? null;
    if (state.activeDugCard !== null && inputDugSeat !== state.activeDugCard.sourceSeat) {
      return {
        state,
        events,
        error: 'You must finish playing or capturing the card you took from your opponent.',
      };
    }

    const validBuilds = findValidBuildOptions(
      playedCard,
      activePlayer.hand,
      state.table,
      action.playerSeat,
      state.players,
      state.activeDugCard
    );
    const sortedInputIds = action.payload.targetItemIds.slice().sort().join(',');
    const matchingOption: BuildOption | undefined = validBuilds.find(
      (opt) =>
        opt.targetValue === action.payload.targetValue &&
        opt.buildMode === action.payload.mode &&
        opt.targetItemIds.slice().sort().join(',') === sortedInputIds &&
        (opt.dugCapturedFromSeat ?? null) === inputDugSeat
    );

    if (!matchingOption) {
      return {
        state,
        events,
        error: 'Build violates SA Casino building, cementing, or possession rules.',
      };
    }

    const usedIds = new Set(matchingOption.targetItemIds);
    const newBuild: TableBuildStack = {
      kind: 'build',
      id: `build:${state.turnCount}:${playedCard.id}:${matchingOption.targetValue}`,
      cards: matchingOption.components.flat(),
      components: matchingOption.components,
      targetValue: matchingOption.targetValue,
      ownerSeat: action.playerSeat,
      isCemented: matchingOption.resultingCemented,
    };

    const nextTable: TableItem[] = [
      ...state.table.filter((it) => !usedIds.has(it.id)),
      newBuild,
    ];

    const ownedBuildsCount = nextTable.filter(
      (it): it is TableBuildStack => it.kind === 'build' && it.ownerSeat === action.playerSeat
    ).length;
    if (ownedBuildsCount > 1) {
      return {
        state,
        events,
        error: 'Single build rule: you can only own one active build on the table at a time.',
      };
    }

    if (!canPlayerCoverOwnedBuilds(remainingHand, nextTable, action.playerSeat)) {
      return {
        state,
        events,
        error: 'Possession rule: missing matching capture card in hand.',
      };
    }

    const shouldPopDugFromSource = state.activeDugCard === null && inputDugSeat !== null;
    const nextPlayers = state.players.map((p) => {
      if (p.seat === action.playerSeat) {
        return { ...p, hand: remainingHand };
      }
      if (shouldPopDugFromSource && p.seat === inputDugSeat) {
        return { ...p, capturedCards: p.capturedCards.slice(0, -1) };
      }
      return p;
    });

    const eventType =
      matchingOption.buildMode === 'CEMENT'
        ? 'BUILD_CEMENTED'
        : matchingOption.buildMode === 'RAISE_OPEN'
        ? 'BUILD_RAISED'
        : 'BUILD_CREATED';

    events.push({
      id: `ev:bld:${state.turnCount}`,
      type: eventType,
      data: {
        seat: action.playerSeat,
        playedCard,
        targetValue: matchingOption.targetValue,
        isCemented: matchingOption.resultingCemented,
      },
    });

    return {
      state: advanceAfterPlayerTurn(
        state,
        nextPlayers,
        nextTable,
        state.lastCapturerSeat,
        {
          seat: action.playerSeat,
          playerName: activePlayer.name,
          actionType: matchingOption.resultingCemented ? 'CEMENT' : 'BUILD',
          description: matchingOption.description,
          swept: false,
          playedCard,
        },
        events
      ),
      events,
    };
  }

  return { state, events, error: 'Unsupported action type.' };
}

function resolveNumericLooseTargets(
  table: readonly TableItem[],
  targetItemIds: readonly string[],
  emptyMessage: string
): { cards: Card[]; uniqueIds: Set<string> } | { error: string } {
  if (targetItemIds.length === 0) {
    return { error: emptyMessage };
  }
  const uniqueIds = new Set(targetItemIds);
  if (uniqueIds.size !== targetItemIds.length) {
    return { error: 'Duplicate table targets selected.' };
  }
  const cards: Card[] = [];
  for (const id of targetItemIds) {
    const found = table.find((it) => it.id === id);
    if (!found || found.kind !== 'loose' || found.card.isFaceCard) {
      return { error: 'Selected merge targets must be numeric loose table cards.' };
    }
    cards.push(found.card);
  }
  return { cards, uniqueIds };
}

function appendComponentToOwnedBuild(
  table: readonly TableItem[],
  ownedBuild: TableBuildStack,
  consumedIds: ReadonlySet<string>,
  rawGroup: readonly Card[]
): TableItem[] {
  const sortedGroup = sortComponentDesc(rawGroup);
  const nextComponents = [
    ...ownedBuild.components.map((g) => g.slice()),
    sortedGroup,
  ];
  const updatedBuild: TableBuildStack = {
    ...ownedBuild,
    cards: nextComponents.flat(),
    components: nextComponents,
    isCemented: true,
  };
  return table
    .filter((it) => !consumedIds.has(it.id))
    .map((it) => (it.id === ownedBuild.id ? updatedBuild : it));
}

/**
 * Strips hidden hands, drawPile cards, and cutPile cards before sending state to a client seat.
 */
export function getSACasinoPlayerView(
  state: SACasinoState,
  viewerSeat: number
): SACasinoPlayerView {
  const revealAllCaptures = state.phase === 'DEAL_OVER';
  const maskedPlayers: MaskedPlayerSeatState[] = state.players.map((p) => {
    const topCapturedCard =
      p.capturedCards.length > 0 ? p.capturedCards[p.capturedCards.length - 1] : null;
    return {
      seat: p.seat,
      name: p.name,
      isAI: p.isAI,
      teamId: p.teamId,
      handCount: p.hand.length,
      hand: p.seat === viewerSeat ? p.hand : null,
      capturedCount: p.capturedCards.length,
      // During active play, only expose the top-most captured card of other players (strictly hiding buried cards)
      capturedCards:
        revealAllCaptures || p.seat === viewerSeat
          ? p.capturedCards
          : topCapturedCard
            ? [topCapturedCard]
            : [],
      topCapturedCard,
      sweeps: p.sweeps,
    };
  });

  return {
    viewerSeat,
    mode: state.mode,
    seed: state.seed,
    dealNumber: state.dealNumber,
    roundNumber: state.roundNumber,
    totalRounds: state.totalRounds,
    dealerSeat: state.dealerSeat,
    currentTurnSeat: state.currentTurnSeat,
    lastCapturerSeat: state.lastCapturerSeat,
    cutPileCount: state.cutPile.length,
    cutPileRevealed: state.phase === 'DEAL_OVER' ? state.cutPile : null,
    drawPileCount: state.drawPile.length,
    table: state.table,
    players: maskedPlayers,
    houseRules: state.houseRules,
    matchScores: state.matchScores,
    phase: state.phase,
    turnCount: state.turnCount,
    activeDugCard: state.activeDugCard,
    lastActionSummary: state.lastActionSummary,
    dealScoreBreakdown: state.dealScoreBreakdown,
  };
}

export const SACasinoEngine: TurnEngineDefinition<
  SACasinoConfig,
  SACasinoState,
  SACasinoAction,
  SACasinoPlayerView,
  SACasinoVisualEvent
> = {
  gameId: 'sa-casino',
  setup: createInitialSACasinoState,
  reducer: applySACasinoAction,
  getPlayerView: getSACasinoPlayerView,
};
