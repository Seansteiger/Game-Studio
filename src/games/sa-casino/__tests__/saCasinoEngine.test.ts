import { describe, expect, it } from 'vitest';
import { createCard } from '../../../studio/core';
import {
  applySACasinoAction,
  calculateDealScore,
  canPullOpponentTopCard,
  canTrailCard,
  chooseTacticalBotAction,
  createInitialSACasinoState,
  diagnoseFailedTargetPlay,
  findValidBuildOptions,
  findValidCaptureOptions,
  findValidLooseToBuildMerges,
  findValidTableDigMerges,
  getSACasinoPlayerView,
  sortComponentDesc,
  validateCaptureSelection,
} from '../index';
import { SACasinoState, TableBuildStack, TableLooseCard } from '../types';

function makeLoose(card: ReturnType<typeof createCard>): TableLooseCard {
  return { kind: 'loose', id: `loose:${card.id}`, card };
}

function makeBuild(
  id: string,
  cards: ReturnType<typeof createCard>[],
  components: ReturnType<typeof createCard>[][],
  targetValue: number,
  ownerSeat: number,
  isCemented: boolean
): TableBuildStack {
  return {
    kind: 'build',
    id,
    cards,
    components,
    targetValue,
    ownerSeat,
    isCemented,
  };
}

describe('SA Casino 40-Card Rules Engine', () => {
  it('deals exactly 40 active cards and 12 cut cards in 1v1, 3P FFA, and 2v2 Teams', () => {
    const s1v1 = createInitialSACasinoState({ mode: '1v1', seed: 101 });
    expect(s1v1.cutPile).toHaveLength(12);
    expect(s1v1.players).toHaveLength(2);
    expect(s1v1.players[0].hand).toHaveLength(10);
    expect(s1v1.players[1].hand).toHaveLength(10);
    expect(s1v1.table).toHaveLength(0);
    expect(s1v1.drawPile).toHaveLength(20);
    expect(s1v1.totalRounds).toBe(2);

    const s3p = createInitialSACasinoState({ mode: '3p-ffa', seed: 202 });
    expect(s3p.cutPile).toHaveLength(12);
    expect(s3p.players).toHaveLength(3);
    expect(s3p.players[0].hand).toHaveLength(13);
    expect(s3p.players[1].hand).toHaveLength(13);
    expect(s3p.players[2].hand).toHaveLength(13);
    expect(s3p.table).toHaveLength(1);
    expect(s3p.drawPile).toHaveLength(0);
    expect(s3p.totalRounds).toBe(1);

    const s2v2 = createInitialSACasinoState({ mode: '2v2-teams', seed: 303 });
    expect(s2v2.cutPile).toHaveLength(12);
    expect(s2v2.players).toHaveLength(4);
    expect(s2v2.players.every((p) => p.hand.length === 10)).toBe(true);
    expect(s2v2.players[0].teamId).toBe(s2v2.players[2].teamId);
    expect(s2v2.players[1].teamId).toBe(s2v2.players[3].teamId);
    expect(s2v2.players[0].teamId).not.toBe(s2v2.players[1].teamId);
    expect(s2v2.table).toHaveLength(0);
    expect(s2v2.drawPile).toHaveLength(0);
  });

  it('strictly uses the 40 numbered cards (A-10) in active play with zero J/Q/K across all modes', () => {
    const modes = ['1v1', '3p-ffa', '2v2-teams'] as const;
    const seeds = [1, 42, 101, 202, 303, 999];

    for (const mode of modes) {
      for (const seed of seeds) {
        const state = createInitialSACasinoState({ mode, seed });
        const tableCards = state.table.flatMap((it) =>
          it.kind === 'loose' ? [it.card] : [...it.cards]
        );
        const activePool = [
          ...state.players.flatMap((p) => p.hand),
          ...tableCards,
          ...state.drawPile,
        ];

        // Exactly 40 unique numbered cards (A through 10 across 4 suits)
        expect(activePool).toHaveLength(40);
        const activeIds = new Set(activePool.map((c) => c.id));
        expect(activeIds.size).toBe(40);

        for (const card of activePool) {
          expect(card.rank).toBeGreaterThanOrEqual(1);
          expect(card.rank).toBeLessThanOrEqual(10);
          expect(card.isFaceCard).toBe(false);
        }

        // Cut pile holds strictly the 12 removed face cards (J, Q, K)
        expect(state.cutPile).toHaveLength(12);
        const cutIds = new Set(state.cutPile.map((c) => c.id));
        expect(cutIds.size).toBe(12);
        for (const card of state.cutPile) {
          expect(card.rank).toBeGreaterThanOrEqual(11);
          expect(card.rank).toBeLessThanOrEqual(13);
          expect(card.isFaceCard).toBe(true);
        }

        // Key scoring cards are guaranteed in every 40-card deal:
        // Big Casino (10♦), Little Casino (2♠), all 4 Aces, and all 10 Spades (A♠..10♠)
        expect(activeIds.has('10-D')).toBe(true);
        expect(activeIds.has('2-S')).toBe(true);
        for (const suit of ['S', 'H', 'D', 'C'] as const) {
          expect(activeIds.has(`A-${suit}`)).toBe(true);
        }
        expect(activePool.filter((c) => c.suit === 'S')).toHaveLength(10);
        for (let r = 1; r <= 10; r++) {
          const sym = r === 1 ? 'A' : String(r);
          expect(activeIds.has(`${sym}-S`)).toBe(true);
        }
      }
    }
  });

  it('enforces face card matching-rank-only captures (J, Q, K never sum numeric cards)', () => {
    const jack = createCard('S', 11);
    const five = createCard('H', 5);
    const six = createCard('D', 6);
    const jackOnTable = createCard('C', 11);

    // Table has 5 + 6 (= 11) and another Jack
    const table = [makeLoose(five), makeLoose(six), makeLoose(jackOnTable)];
    const options = findValidCaptureOptions(jack, [jack], table, 0, false);
    expect(options).toHaveLength(1);
    expect(options[0].capturedItemIds).toEqual([`loose:${jackOnTable.id}`]);

    // If only 5 and 6 are on the table, Jack cannot capture 5+6
    const optionsNoJack = findValidCaptureOptions(
      jack,
      [jack],
      [makeLoose(five), makeLoose(six)],
      0,
      false
    );
    expect(optionsNoJack).toHaveLength(0);
  });

  it('captures multiple disjoint sum combinations and matching cards simultaneously', () => {
    const seven = createCard('H', 7);
    const table = [
      makeLoose(createCard('S', 7)),
      makeLoose(createCard('D', 2)),
      makeLoose(createCard('C', 5)),
      makeLoose(createCard('H', 3)),
      makeLoose(createCard('S', 4)),
    ];
    const options = findValidCaptureOptions(seven, [seven], table, 0, false);
    expect(options.length).toBeGreaterThanOrEqual(1);
    // Top option should capture all 5 table cards (7 + (2+5) + (3+4)) + played card = 6 cards total & sweep
    expect(options[0].totalCardsCaptured).toBe(6);
    expect(options[0].isSweep).toBe(true);
  });

  it('enforces Possession Rule, Open Build raising, and Cemented Build locking', () => {
    const twoS = createCard('S', 2);
    const twoD = createCard('D', 2);
    const fiveH = createCard('H', 5);
    const sevenC = createCard('C', 7);
    const nineH = createCard('H', 9);
    const fourC = createCard('C', 4);
    const threeS = createCard('S', 3);

    // Without holding a 7, player CANNOT build 2 + 5 = 7
    const invalidBuilds = findValidBuildOptions(
      twoS,
      [twoS, fourC],
      [makeLoose(fiveH)],
      0
    );
    expect(invalidBuilds.some((b) => b.targetValue === 7)).toBe(false);

    // Holding a 7, player CAN build 2 + 5 = Open Build 7
    const validBuilds = findValidBuildOptions(
      twoS,
      [twoS, sevenC, fourC],
      [makeLoose(fiveH)],
      0
    );
    const openSeven = validBuilds.find(
      (b) => b.targetValue === 7 && b.buildMode === 'CREATE_OPEN'
    );
    expect(openSeven).toBeDefined();

    // Construct state where Seat 0 owns that Open Build 7
    const baseState = createInitialSACasinoState({ mode: '1v1', seed: 42 });
    const customState: SACasinoState = {
      ...baseState,
      currentTurnSeat: 0,
      players: [
        { ...baseState.players[0], hand: [sevenC, fourC] },
        { ...baseState.players[1], hand: [twoD, nineH, threeS] },
      ],
      table: [makeLoose(fiveH)],
    };

    // Actually test via reducer: Seat 0 plays 2S onto 5H (add 2S to Seat 0 hand first)
    const stateBeforeBuild: SACasinoState = {
      ...customState,
      players: [
        { ...customState.players[0], hand: [twoS, sevenC, fourC] },
        { ...customState.players[1], hand: [twoD, nineH, threeS] },
      ],
    };

    const res1 = applySACasinoAction(stateBeforeBuild, {
      type: 'BUILD',
      playerSeat: 0,
      payload: {
        cardId: twoS.id,
        targetItemIds: [`loose:${fiveH.id}`],
        targetValue: 7,
        mode: 'CREATE_OPEN',
      },
    });
    expect(res1.error).toBeUndefined();
    const createdBuild = res1.state.table[0];
    expect(createdBuild.kind).toBe('build');
    if (createdBuild.kind === 'build') {
      expect(createdBuild.isCemented).toBe(false);
      expect(createdBuild.targetValue).toBe(7);
      expect(createdBuild.ownerSeat).toBe(0);
    }

    // Seat 1 raises Seat 0's open 7 build with 2D to 9 (holding 9H)
    const res2 = applySACasinoAction(res1.state, {
      type: 'BUILD',
      playerSeat: 1,
      payload: {
        cardId: twoD.id,
        targetItemIds: [createdBuild.id],
        targetValue: 9,
        mode: 'RAISE_OPEN',
      },
    });
    expect(res2.error).toBeUndefined();
    const raisedBuild = res2.state.table[0];
    expect(raisedBuild.kind).toBe('build');
    if (raisedBuild.kind === 'build') {
      expect(raisedBuild.targetValue).toBe(9);
      expect(raisedBuild.ownerSeat).toBe(1);
      expect(raisedBuild.isCemented).toBe(false);
    }

    // Now test Cementing: Seat 0 builds a cemented 6 stack by combining 6H onto loose 6C while holding 6S
    const sixH = createCard('H', 6);
    const sixC = createCard('C', 6);
    const sixS = createCard('S', 6);
    const stateForCement: SACasinoState = {
      ...baseState,
      currentTurnSeat: 0,
      players: [
        { ...baseState.players[0], hand: [sixH, sixS, fourC] },
        { ...baseState.players[1], hand: [threeS, nineH] },
      ],
      table: [makeLoose(sixC)],
    };

    const cementRes = applySACasinoAction(stateForCement, {
      type: 'BUILD',
      playerSeat: 0,
      payload: {
        cardId: sixH.id,
        targetItemIds: [`loose:${sixC.id}`],
        targetValue: 6,
        mode: 'CEMENT',
      },
    });
    expect(cementRes.error).toBeUndefined();
    const cementedBuild = cementRes.state.table[0];
    expect(cementedBuild.kind).toBe('build');
    if (cementedBuild.kind === 'build') {
      expect(cementedBuild.isCemented).toBe(true);
      expect(cementedBuild.targetValue).toBe(6);
    }

    // Seat 1 tries to raise the cemented 6 build with 3S to 9 (holding 9H) -> MUST BE REJECTED!
    const raiseCementedAttempt = applySACasinoAction(cementRes.state, {
      type: 'BUILD',
      playerSeat: 1,
      payload: {
        cardId: threeS.id,
        targetItemIds: [cementedBuild.id],
        targetValue: 9,
        mode: 'RAISE_OPEN',
      },
    });
    expect(raiseCementedAttempt.error).toBeDefined();

    // Seat 0 cannot trail their last 6S while owning the cemented 6 build
    const trailCheck = canTrailCard(
      sixS,
      cementRes.state.players[0].hand,
      cementRes.state.table,
      0
    );
    expect(trailCheck.valid).toBe(false);
  });

  it('preserves live table cards from Round 1 into Round 2 in 1v1', () => {
    let state = createInitialSACasinoState({ mode: '1v1', seed: 777 });
    expect(state.roundNumber).toBe(1);

    // Play all turns of Round 1 using tactical bots (allowing extra DIG_TABLE_TO_BUILD actions)
    let safety = 0;
    while (state.phase === 'PLAYING' && safety < 60) {
      const seat = state.currentTurnSeat;
      const view = getSACasinoPlayerView(state, seat);
      const action = chooseTacticalBotAction(view, seat);
      const res = applySACasinoAction(state, action);
      expect(res.error).toBeUndefined();
      state = res.state;
      safety++;
    }

    expect(state.phase).toBe('ROUND_TRANSITION');
    const tableBeforeR2 = state.table.slice();

    const r2Res = applySACasinoAction(state, {
      type: 'DEAL_NEXT_ROUND',
      playerSeat: state.dealerSeat,
      payload: { round: 2 },
    });
    expect(r2Res.error).toBeUndefined();
    expect(r2Res.state.roundNumber).toBe(2);
    expect(r2Res.state.phase).toBe('PLAYING');
    expect(r2Res.state.players[0].hand).toHaveLength(10);
    expect(r2Res.state.players[1].hand).toHaveLength(10);
    // Live table cards carried over seamlessly
    expect(r2Res.state.table).toEqual(tableBeforeR2);
  });

  it('calculates scoring correctly including 20-20 card tie = 0 pts', () => {
    const p0Cards = [
      createCard('D', 10), // Big Casino (2)
      createCard('S', 1),  // Ace (1) + Spade
      createCard('S', 3),
      createCard('S', 4),
      ...Array.from({ length: 16 }, (_, idx) =>
        createCard('H', ((idx % 10) + 2) as 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11)
      ),
    ];
    const p1Cards = [
      createCard('S', 2), // Little Casino (1) + Spade
      createCard('C', 1), // Ace (1)
      createCard('D', 1), // Ace (1)
      createCard('S', 5),
      createCard('S', 6),
      createCard('S', 7),
      ...Array.from({ length: 14 }, (_, idx) =>
        createCard('C', ((idx % 10) + 2) as 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11)
      ),
    ];

    const breakdown = calculateDealScore(
      [
        { seat: 0, name: 'P0', isAI: false, teamId: 0, hand: [], capturedCards: p0Cards, sweeps: 1 },
        { seat: 1, name: 'P1', isAI: true, teamId: 1, hand: [], capturedCards: p1Cards, sweeps: 0 },
      ],
      [],
      '1v1',
      { sweepsEnabled: true, targetMatchScore: 21 }
    );

    expect(breakdown.teams[0].cardCount).toBe(20);
    expect(breakdown.teams[1].cardCount).toBe(20);
    // 20-20 tie awards 0 pts for Most Cards!
    expect(breakdown.teams[0].points.mostCards).toBe(0);
    expect(breakdown.teams[1].points.mostCards).toBe(0);
    // P0: Big Casino (2) + 1 Ace (1) + 1 Sweep (1) = 4
    expect(breakdown.teams[0].points.total).toBe(4);
    // P1: Little Casino (1) + Most Spades (4 vs 3 -> 1) + 2 Aces (2) = 4
    expect(breakdown.teams[1].points.total).toBe(4);
  });

  it('plays full bot games to completion across 1v1, 3p-ffa, and 2v2-teams accounting for all 40 active cards', () => {
    const modes = ['1v1', '3p-ffa', '2v2-teams'] as const;

    for (const mode of modes) {
      for (const seed of [11, 22, 33]) {
        let state = createInitialSACasinoState({ mode, seed });
        let steps = 0;

        while (state.phase !== 'DEAL_OVER' && steps < 200) {
          if (state.phase === 'ROUND_TRANSITION') {
            const res = applySACasinoAction(state, {
              type: 'DEAL_NEXT_ROUND',
              playerSeat: state.dealerSeat,
              payload: { round: 2 },
            });
            expect(res.error).toBeUndefined();
            state = res.state;
            continue;
          }

          const seat = state.currentTurnSeat;
          const view = getSACasinoPlayerView(state, seat);
          // Secret masking verification: other seats' hands are hidden
          for (const p of view.players) {
            if (p.seat === seat) expect(p.hand).not.toBeNull();
            else expect(p.hand).toBeNull();
          }

          const action = chooseTacticalBotAction(view, seat);
          const res = applySACasinoAction(state, action);
          expect(res.error).toBeUndefined();
          state = res.state;
          steps++;
        }

        expect(state.phase).toBe('DEAL_OVER');
        expect(state.dealScoreBreakdown).not.toBeNull();

        const totalCaptured = state.players.reduce((s, p) => s + p.capturedCards.length, 0);
        // Every active card (40 total) must be accounted for in captured piles at deal end
        expect(totalCaptured).toBe(40);
        expect(state.cutPile).toHaveLength(12);
      }
    }
  });

  it('orders captured pile LIFO with playedCard on top and exposes topCapturedCard in player view', () => {
    const baseState = createInitialSACasinoState({ mode: '1v1', seed: 101 });
    const fiveH = createCard('H', 5);
    const fiveD = createCard('D', 5);
    const twoC = createCard('C', 2);
    const threeS = createCard('S', 3);
    const nineC = createCard('C', 9);

    const state: SACasinoState = {
      ...baseState,
      currentTurnSeat: 0,
      players: [
        { ...baseState.players[0], hand: [fiveH, nineC], capturedCards: [] },
        { ...baseState.players[1], hand: [twoC, threeS], capturedCards: [] },
      ],
      table: [makeLoose(fiveD)],
    };

    const res = applySACasinoAction(state, {
      type: 'CAPTURE',
      playerSeat: 0,
      payload: { cardId: fiveH.id, capturedItemIds: [`loose:${fiveD.id}`] },
    });
    expect(res.error).toBeUndefined();
    expect(res.state.players[0].capturedCards).toEqual([fiveD, fiveH]);

    const view = getSACasinoPlayerView(res.state, 1);
    expect(view.players[0].topCapturedCard).toEqual(fiveH);
    expect(view.players[1].topCapturedCard).toBeNull();
  });

  it('allows player holding two 7s to either capture or cement a 7 on the table', () => {
    const sevenS = createCard('S', 7);
    const sevenH = createCard('H', 7);
    const sevenD = createCard('D', 7);
    const fourC = createCard('C', 4);

    // Loose 7 on table
    const capOpts = findValidCaptureOptions(sevenS, [sevenS, sevenH], [makeLoose(sevenD)], 0, false);
    expect(capOpts.length).toBeGreaterThanOrEqual(1);

    const buildOptsLoose = findValidBuildOptions(sevenS, [sevenS, sevenH], [makeLoose(sevenD)], 0);
    const cementLoose = buildOptsLoose.find((b) => b.targetValue === 7 && b.buildMode === 'CEMENT');
    expect(cementLoose).toBeDefined();
    expect(cementLoose?.resultingCemented).toBe(true);

    // Existing 7-build on table
    const existing7Build = makeBuild('b7', [fourC, createCard('C', 3)], [[fourC, createCard('C', 3)]], 7, 1, false);
    const buildOptsExisting = findValidBuildOptions(sevenS, [sevenS, sevenH], [existing7Build], 0);
    const cementExisting = buildOptsExisting.find(
      (b) => b.targetValue === 7 && b.buildMode === 'CEMENT' && b.targetItemIds.includes('b7')
    );
    expect(cementExisting).toBeDefined();
    expect(cementExisting?.resultingCemented).toBe(true);
  });

  it('captures a table 5 + opponent top 5 simultaneously with a 5 from hand and reveals card beneath', () => {
    const baseState = createInitialSACasinoState({ mode: '1v1', seed: 55 });
    const fiveH = createCard('H', 5);
    const fiveS = createCard('S', 5);
    const fiveD = createCard('D', 5);
    const eightC = createCard('C', 8);
    const twoD = createCard('D', 2);

    const state: SACasinoState = {
      ...baseState,
      currentTurnSeat: 0,
      players: [
        { ...baseState.players[0], hand: [fiveH, twoD], capturedCards: [] },
        { ...baseState.players[1], hand: [eightC], capturedCards: [eightC, fiveD] },
      ],
      table: [makeLoose(fiveS)],
    };

    const options = findValidCaptureOptions(
      fiveH,
      state.players[0].hand,
      state.table,
      0,
      false,
      state.players
    );
    const digCapture = options.find((o) => o.dugCapturedFromSeat === 1);
    expect(digCapture).toBeDefined();
    expect(digCapture?.totalCardsCaptured).toBe(3);

    const res = applySACasinoAction(state, {
      type: 'CAPTURE',
      playerSeat: 0,
      payload: {
        cardId: fiveH.id,
        capturedItemIds: [`loose:${fiveS.id}`],
        dugCapturedFromSeat: 1,
      },
    });
    expect(res.error).toBeUndefined();
    // Opponent top 5D popped, exposing 8C beneath
    expect(res.state.players[1].capturedCards).toEqual([eightC]);
    expect(getSACasinoPlayerView(res.state, 0).players[1].topCapturedCard).toEqual(eightC);
    // Seat 0 captured table 5S, dug 5D, and played 5H last on top
    expect(res.state.players[0].capturedCards).toEqual([fiveS, fiveD, fiveH]);
  });

  it('builds onto a 7 on table by playing 3 from hand + digging opponent top 4 while holding a 7', () => {
    const baseState = createInitialSACasinoState({ mode: '1v1', seed: 66 });
    const threeH = createCard('H', 3);
    const sevenS = createCard('S', 7);
    const sevenD = createCard('D', 7);
    const fourC = createCard('C', 4);
    const nineC = createCard('C', 9);
    const twoS = createCard('S', 2);

    const state: SACasinoState = {
      ...baseState,
      currentTurnSeat: 0,
      players: [
        { ...baseState.players[0], hand: [threeH, sevenS], capturedCards: [] },
        { ...baseState.players[1], hand: [twoS], capturedCards: [nineC, fourC] },
      ],
      table: [makeLoose(sevenD)],
    };

    const buildOptions = findValidBuildOptions(
      threeH,
      state.players[0].hand,
      state.table,
      0,
      state.players
    );
    const digBuild = buildOptions.find(
      (b) => b.targetValue === 7 && b.buildMode === 'CEMENT' && b.dugCapturedFromSeat === 1
    );
    expect(digBuild).toBeDefined();

    const res = applySACasinoAction(state, {
      type: 'BUILD',
      playerSeat: 0,
      payload: {
        cardId: threeH.id,
        targetItemIds: [`loose:${sevenD.id}`],
        targetValue: 7,
        mode: 'CEMENT',
        dugCapturedFromSeat: 1,
      },
    });
    expect(res.error).toBeUndefined();
    expect(res.state.players[1].capturedCards).toEqual([nineC]);
    expect(res.state.table).toHaveLength(1);
    const built = res.state.table[0];
    expect(built.kind).toBe('build');
    if (built.kind === 'build') {
      expect(built.targetValue).toBe(7);
      expect(built.isCemented).toBe(true);
      expect(built.ownerSeat).toBe(0);
      expect(built.cards).toHaveLength(3);
    }
  });

  it('merges opponent top 2 + table 5 into own active 7-build via DIG_TABLE_TO_BUILD without ending turn', () => {
    const baseState = createInitialSACasinoState({ mode: '1v1', seed: 77 });
    const sevenS = createCard('S', 7);
    const sevenH = createCard('H', 7);
    const twoD = createCard('D', 2);
    const fiveC = createCard('C', 5);
    const fourS = createCard('S', 4);
    const sixH = createCard('H', 6);
    const ownBuild = makeBuild('build-7', [sevenH], [[sevenH]], 7, 0, false);

    const state: SACasinoState = {
      ...baseState,
      currentTurnSeat: 0,
      players: [
        { ...baseState.players[0], hand: [sevenS, fourS], capturedCards: [] },
        { ...baseState.players[1], hand: [sixH], capturedCards: [sixH, twoD] },
      ],
      table: [ownBuild, makeLoose(fiveC)],
    };

    const merges = findValidTableDigMerges(state.table, state.players, 0);
    expect(merges).toHaveLength(1);
    expect(merges[0].dugFromSeat).toBe(1);
    expect(merges[0].targetItemIds).toEqual([`loose:${fiveC.id}`]);

    const res = applySACasinoAction(state, {
      type: 'DIG_TABLE_TO_BUILD',
      playerSeat: 0,
      payload: {
        buildId: ownBuild.id,
        targetItemIds: [`loose:${fiveC.id}`],
        dugFromSeat: 1,
      },
    });
    expect(res.error).toBeUndefined();
    // Same turn, hand untouched, opponent top card popped, build cemented with 3 cards
    expect(res.state.currentTurnSeat).toBe(0);
    expect(res.state.players[0].hand).toEqual([sevenS, fourS]);
    expect(res.state.players[1].capturedCards).toEqual([sixH]);
    expect(res.state.table).toHaveLength(1);
    const updatedBuild = res.state.table[0];
    expect(updatedBuild.kind).toBe('build');
    if (updatedBuild.kind === 'build') {
      expect(updatedBuild.isCemented).toBe(true);
      expect(updatedBuild.cards).toHaveLength(3);
    }
  });

  it('forbids digging own pile and forbids digging to start a brand-new build not on table', () => {
    const threeH = createCard('H', 3);
    const fourC = createCard('C', 4);
    const fiveD = createCard('D', 5);
    const sevenS = createCard('S', 7);
    const twoC = createCard('C', 2);

    const players = [
      { seat: 0, capturedCards: [fourC, fiveD] },
      { seat: 1, capturedCards: [fourC] },
    ];

    // Cannot dig own pile in capture
    const selfDigCheck = validateCaptureSelection(
      fiveD,
      [fiveD],
      [makeLoose(createCard('S', 5))],
      [`loose:5-S`],
      0,
      players,
      0
    );
    expect(selfDigCheck.valid).toBe(false);

    // Cannot capture only opponent's top card with empty table selection
    const emptyTableDig = validateCaptureSelection(
      fourC,
      [fourC],
      [makeLoose(fiveD)],
      [],
      0,
      players,
      1
    );
    expect(emptyTableDig.valid).toBe(false);

    // Table has loose 2, opponent has top 4, player plays 3 holding 7 -> 7 is NOT on table, so digging 4 to build 7 is forbidden
    const illegalNewDigBuild = findValidBuildOptions(
      threeH,
      [threeH, sevenS],
      [makeLoose(twoC)],
      0,
      players
    );
    expect(
      illegalNewDigBuild.some((b) => b.dugCapturedFromSeat === 1 && b.targetValue === 7)
    ).toBe(false);
  });

  it('enforces max 1 build per player at a time, while 2v2 partners can each own 1 build', () => {
    const fourS = createCard('S', 4);
    const fiveH = createCard('H', 5);
    const nineC = createCard('C', 9);
    const eightD = createCard('D', 8);
    const sevenS = createCard('S', 7);
    const threeC = createCard('C', 3);

    const seat0ExistingBuild = makeBuild(
      'b-seat0',
      [createCard('D', 5), createCard('C', 2)],
      [[createCard('D', 5), createCard('C', 2)]],
      7,
      0,
      false
    );

    // Seat 0 already owns Build 7 on table; cannot create a second separate Build 9 on loose 5
    const optsSeat0 = findValidBuildOptions(
      fourS,
      [fourS, sevenS, nineC],
      [seat0ExistingBuild, makeLoose(fiveH)],
      0
    );
    expect(
      optsSeat0.some((b) => b.targetValue === 9 && !b.targetItemIds.includes('b-seat0'))
    ).toBe(false);

    // Seat 0 CAN still raise their own existing Build 7 -> 9 (holding 9C and playing 2)
    const twoS = createCard('S', 2);
    const raiseOwnOpts = findValidBuildOptions(
      twoS,
      [twoS, nineC],
      [seat0ExistingBuild, makeLoose(fiveH)],
      0
    );
    expect(
      raiseOwnOpts.some(
        (b) => b.targetValue === 9 && b.buildMode === 'RAISE_OPEN' && b.targetItemIds.includes('b-seat0')
      )
    ).toBe(true);

    // In 2v2-teams, partner (Seat 2) CAN own their own Build 8 while Seat 0 owns Build 7
    const base2v2 = createInitialSACasinoState({ mode: '2v2-teams', seed: 88 });
    const state2v2: SACasinoState = {
      ...base2v2,
      currentTurnSeat: 2,
      players: [
        { ...base2v2.players[0], hand: [sevenS] },
        { ...base2v2.players[1], hand: [fourS] },
        { ...base2v2.players[2], hand: [threeC, eightD] },
        { ...base2v2.players[3], hand: [nineC] },
      ],
      table: [seat0ExistingBuild, makeLoose(fiveH)],
    };
    const partnerRes = applySACasinoAction(state2v2, {
      type: 'BUILD',
      playerSeat: 2,
      payload: {
        cardId: threeC.id,
        targetItemIds: [`loose:${fiveH.id}`],
        targetValue: 8,
        mode: 'CREATE_OPEN',
      },
    });
    expect(partnerRes.error).toBeUndefined();
    expect(
      partnerRes.state.table.filter((it) => it.kind === 'build')
    ).toHaveLength(2);
  });

  it('enforces 1v1 Round 1 no-trail-while-owning-build rule vs Round 2 freedom', () => {
    const base1v1 = createInitialSACasinoState({ mode: '1v1', seed: 99 });
    const sevenS = createCard('S', 7);
    const fourC = createCard('C', 4);
    const sixD = createCard('D', 6);
    const ownBuild = makeBuild('b-r1', [createCard('H', 7)], [[createCard('H', 7)]], 7, 0, true);

    const round1State: SACasinoState = {
      ...base1v1,
      roundNumber: 1,
      currentTurnSeat: 0,
      players: [
        { ...base1v1.players[0], hand: [sevenS, fourC] },
        { ...base1v1.players[1], hand: [sixD] },
      ],
      table: [ownBuild],
    };

    // Round 1 of 1v1: Seat 0 owns Build 7 and has capture (7S), so trailing 4C MUST be rejected
    const r1TrailCheck = canTrailCard(
      fourC,
      round1State.players[0].hand,
      round1State.table,
      0,
      { isRound1Of1v1: true, players: round1State.players }
    );
    expect(r1TrailCheck.valid).toBe(false);

    const r1TrailAction = applySACasinoAction(round1State, {
      type: 'TRAIL',
      playerSeat: 0,
      payload: { cardId: fourC.id },
    });
    expect(r1TrailAction.error).toBeDefined();

    // Round 2 of 1v1: Seat 0 owns Build 7 and keeps 7S, CAN trail 4C onto table
    const round2State: SACasinoState = {
      ...round1State,
      roundNumber: 2,
      drawPile: [],
    };
    const r2TrailCheck = canTrailCard(
      fourC,
      round2State.players[0].hand,
      round2State.table,
      0,
      { isRound1Of1v1: false, players: round2State.players }
    );
    expect(r2TrailCheck.valid).toBe(true);

    const r2TrailAction = applySACasinoAction(round2State, {
      type: 'TRAIL',
      playerSeat: 0,
      payload: { cardId: fourC.id },
    });
    expect(r2TrailAction.error).toBeUndefined();
    expect(r2TrailAction.state.table).toHaveLength(2);
  });

  it('diagnoses illegal build contingencies clearly (missing target rank, >10, locked build, second build)', () => {
    const threeS = createCard('S', 3);
    const fiveH = createCard('H', 5);
    const sevenD = createCard('D', 7);
    const sixC = createCard('C', 6);
    const twoH = createCard('H', 2);
    const nineC = createCard('C', 9);
    const fourS = createCard('S', 4);

    // 1. Trying to build 8 (3 + 5) without holding an 8 in hand
    const missingTargetMsg = diagnoseFailedTargetPlay(
      threeS,
      makeLoose(fiveH),
      [threeS, fourS],
      [makeLoose(fiveH)],
      0
    );
    expect(missingTargetMsg).toContain('need an 8');

    // 2. Trying to build above 10 (7 + 6 = 13)
    const overTenMsg = diagnoseFailedTargetPlay(
      sevenD,
      makeLoose(sixC),
      [sevenD, nineC],
      [makeLoose(sixC)],
      0
    );
    expect(overTenMsg).toContain('Cannot build over 10');

    // 3. Trying to raise a locked/cemented build
    const lockedBuild = {
      kind: 'build' as const,
      id: 'bld-locked-7',
      cards: [createCard('C', 7), createCard('H', 7)],
      components: [[createCard('C', 7)], [createCard('H', 7)]],
      targetValue: 7,
      ownerSeat: 1,
      isCemented: true,
    };
    const lockedMsg = diagnoseFailedTargetPlay(
      twoH,
      lockedBuild,
      [twoH, nineC],
      [lockedBuild],
      0
    );
    expect(lockedMsg).toContain('locked');

    // 4. Trying to start a second build while already owning an active build
    const ownBuild = {
      kind: 'build' as const,
      id: 'bld-own-4',
      cards: [fourS],
      components: [[fourS]],
      targetValue: 4,
      ownerSeat: 0,
      isCemented: false,
    };
    const secondBuildMsg = diagnoseFailedTargetPlay(
      threeS,
      makeLoose(fiveH),
      [threeS, fourS, createCard('H', 8)],
      [ownBuild, makeLoose(fiveH)],
      0
    );
    expect(secondBuildMsg).toContain('already have a 4 build');
  });

  it('orders build cards smaller-on-larger per component and preserves layering across steps', () => {
    const twoH = createCard('H', 2);
    const sevenS = createCard('S', 7);
    const twoD = createCard('D', 2);
    const sevenC = createCard('C', 7);
    const nineH = createCard('H', 9);
    const nineC = createCard('C', 9);
    const aceD = createCard('D', 1);
    const fourS = createCard('S', 4);
    const sixC = createCard('C', 6);
    const tenD = createCard('D', 10);

    // Direct helper ordering: larger card underneath (index 0), smaller on top (index 1)
    expect(sortComponentDesc([twoH, sevenS])).toEqual([sevenS, twoH]);
    expect(sortComponentDesc([aceD, nineH])).toEqual([nineH, aceD]);
    expect(sortComponentDesc([fourS, sixC])).toEqual([sixC, fourS]);

    const baseState = createInitialSACasinoState({ mode: '1v1', seed: 121 });

    // Step 1: Seat 0 plays 2H onto loose 7S to create Open Build 9 (holding 9H)
    const s0: SACasinoState = {
      ...baseState,
      currentTurnSeat: 0,
      players: [
        { ...baseState.players[0], hand: [twoH, nineH], capturedCards: [] },
        { ...baseState.players[1], hand: [twoD, nineC], capturedCards: [] },
      ],
      table: [makeLoose(sevenS), makeLoose(sevenC)],
    };

    const step1 = applySACasinoAction(s0, {
      type: 'BUILD',
      playerSeat: 0,
      payload: {
        cardId: twoH.id,
        targetItemIds: [`loose:${sevenS.id}`],
        targetValue: 9,
        mode: 'CREATE_OPEN',
      },
    });
    expect(step1.error).toBeUndefined();
    const b1 = step1.state.table.find((it): it is TableBuildStack => it.kind === 'build')!;
    expect(b1.components).toEqual([[sevenS, twoH]]);
    expect(b1.cards).toEqual([sevenS, twoH]);

    // Step 2: Seat 1 cements Build 9 by adding 2D + loose 7C while holding 9C
    // Existing [7S, 2H] stays underneath; new [7C, 2D] sits on top -> [7S, 2H, 7C, 2D]
    const step2 = applySACasinoAction(step1.state, {
      type: 'BUILD',
      playerSeat: 1,
      payload: {
        cardId: twoD.id,
        targetItemIds: [b1.id, `loose:${sevenC.id}`],
        targetValue: 9,
        mode: 'CEMENT',
      },
    });
    expect(step2.error).toBeUndefined();
    const b2 = step2.state.table.find((it): it is TableBuildStack => it.kind === 'build')!;
    expect(b2.isCemented).toBe(true);
    expect(b2.components).toEqual([
      [sevenS, twoH],
      [sevenC, twoD],
    ]);
    expect(b2.cards).toEqual([sevenS, twoH, sevenC, twoD]);

    // RAISE_OPEN also sorts cards descending in the combined component
    const raiseState: SACasinoState = {
      ...baseState,
      currentTurnSeat: 0,
      players: [
        { ...baseState.players[0], hand: [aceD, tenD], capturedCards: [] },
        { ...baseState.players[1], hand: [nineC], capturedCards: [] },
      ],
      table: [makeBuild('open-9', [sevenS, twoH], [[sevenS, twoH]], 9, 1, false)],
    };
    const raiseRes = applySACasinoAction(raiseState, {
      type: 'BUILD',
      playerSeat: 0,
      payload: {
        cardId: aceD.id,
        targetItemIds: ['open-9'],
        targetValue: 10,
        mode: 'RAISE_OPEN',
      },
    });
    expect(raiseRes.error).toBeUndefined();
    const raised = raiseRes.state.table[0] as TableBuildStack;
    expect(raised.components).toEqual([[sevenS, twoH, aceD]]);
    expect(raised.cards).toEqual([sevenS, twoH, aceD]);
  });

  it('merges an opponent uncemented Build 3 + 7 from hand into own Build 10 (while forbidding cemented merges)', () => {
    const baseState = createInitialSACasinoState({ mode: '1v1', seed: 131 });
    const sevenH = createCard('H', 7);
    const tenS = createCard('S', 10);
    const tenD = createCard('D', 10);
    const sixC = createCard('C', 6);
    const fourD = createCard('D', 4);
    const twoC = createCard('C', 2);
    const aceH = createCard('H', 1);

    const ownBuild10 = makeBuild('own-10', [sixC, fourD], [[sixC, fourD]], 10, 0, false);
    const oppOpen3 = makeBuild('opp-open-3', [twoC, aceH], [[twoC, aceH]], 3, 1, false);
    const oppLocked3 = makeBuild(
      'opp-locked-3',
      [twoC, aceH, createCard('S', 3)],
      [[twoC, aceH], [createCard('S', 3)]],
      3,
      1,
      true
    );

    const buildOpts = findValidBuildOptions(
      sevenH,
      [sevenH, tenS],
      [ownBuild10, oppOpen3],
      0
    );
    const mergeOpt = buildOpts.find(
      (b) =>
        b.targetValue === 10 &&
        b.buildMode === 'CEMENT' &&
        b.resultingCemented &&
        b.targetItemIds.includes(ownBuild10.id) &&
        b.targetItemIds.includes(oppOpen3.id)
    );
    expect(mergeOpt).toBeDefined();

    // Cemented opponent Build 3 MUST NOT be mergeable into own Build 10
    const lockedMergeOpts = findValidBuildOptions(
      sevenH,
      [sevenH, tenS],
      [ownBuild10, oppLocked3],
      0
    );
    expect(
      lockedMergeOpts.some((b) => b.targetItemIds.includes(oppLocked3.id))
    ).toBe(false);

    const state: SACasinoState = {
      ...baseState,
      currentTurnSeat: 0,
      players: [
        { ...baseState.players[0], hand: [sevenH, tenS], capturedCards: [] },
        { ...baseState.players[1], hand: [tenD], capturedCards: [] },
      ],
      table: [ownBuild10, oppOpen3],
    };

    const res = applySACasinoAction(state, {
      type: 'BUILD',
      playerSeat: 0,
      payload: {
        cardId: sevenH.id,
        targetItemIds: [ownBuild10.id, oppOpen3.id],
        targetValue: 10,
        mode: 'CEMENT',
      },
    });
    expect(res.error).toBeUndefined();
    expect(res.state.table).toHaveLength(1);
    const merged = res.state.table[0] as TableBuildStack;
    expect(merged.kind).toBe('build');
    expect(merged.ownerSeat).toBe(0);
    expect(merged.targetValue).toBe(10);
    expect(merged.isCemented).toBe(true);
    expect(merged.components).toEqual([
      [sixC, fourD],
      [sevenH, twoC, aceH],
    ]);
    expect(merged.cards).toEqual([sixC, fourD, sevenH, twoC, aceH]);
  });

  it('captures an opponent uncemented Build 3 + loose 7 with a 10, while locking cemented builds to exact rank', () => {
    const baseState = createInitialSACasinoState({ mode: '1v1', seed: 141 });
    const tenS = createCard('S', 10);
    const sevenD = createCard('D', 7);
    const twoH = createCard('H', 2);
    const aceC = createCard('C', 1);
    const threeS = createCard('S', 3);
    const fourH = createCard('H', 4);

    const oppOpen3 = makeBuild('opp-open-3', [twoH, aceC], [[twoH, aceC]], 3, 1, false);
    const oppLocked3 = makeBuild(
      'opp-locked-3',
      [twoH, aceC, threeS],
      [[twoH, aceC], [threeS]],
      3,
      1,
      true
    );

    const capOpts = findValidCaptureOptions(
      tenS,
      [tenS, fourH],
      [oppOpen3, makeLoose(sevenD)],
      0,
      false
    );
    const openCombo = capOpts.find(
      (c) =>
        c.capturedItemIds.includes(oppOpen3.id) &&
        c.capturedItemIds.includes(`loose:${sevenD.id}`)
    );
    expect(openCombo).toBeDefined();
    expect(openCombo?.isSweep).toBe(true);

    // Cemented Build 3 + loose 7 CANNOT be captured by 10
    const lockedCheck = validateCaptureSelection(
      tenS,
      [tenS, fourH],
      [oppLocked3, makeLoose(sevenD)],
      [oppLocked3.id, `loose:${sevenD.id}`],
      0
    );
    expect(lockedCheck.valid).toBe(false);

    // Execute legal capture via reducer
    const state: SACasinoState = {
      ...baseState,
      currentTurnSeat: 0,
      players: [
        { ...baseState.players[0], hand: [tenS, fourH], capturedCards: [] },
        { ...baseState.players[1], hand: [threeS], capturedCards: [] },
      ],
      table: [oppOpen3, makeLoose(sevenD)],
    };
    const res = applySACasinoAction(state, {
      type: 'CAPTURE',
      playerSeat: 0,
      payload: {
        cardId: tenS.id,
        capturedItemIds: [oppOpen3.id, `loose:${sevenD.id}`],
      },
    });
    expect(res.error).toBeUndefined();
    expect(res.state.table).toHaveLength(0);
    expect(res.state.players[0].capturedCards).toHaveLength(4);
    expect(res.state.players[0].capturedCards[3]).toEqual(tenS);
  });

  it('moves loose 4 + 6 directly into own Build 10 via MERGE_LOOSE_TO_BUILD without ending turn', () => {
    const baseState = createInitialSACasinoState({ mode: '1v1', seed: 151 });
    const fourC = createCard('C', 4);
    const sixH = createCard('H', 6);
    const aceS = createCard('S', 1);
    const nineD = createCard('D', 9);
    const tenD = createCard('D', 10);
    const tenC = createCard('C', 10);
    const threeH = createCard('H', 3);

    const ownBuild10 = makeBuild('own-10', [tenC], [[tenC]], 10, 0, false);
    const table = [ownBuild10, makeLoose(fourC), makeLoose(sixH), makeLoose(nineD)];

    const looseMerges = findValidLooseToBuildMerges(table, 0);
    expect(looseMerges).toHaveLength(1);
    expect(looseMerges[0].buildId).toBe(ownBuild10.id);
    expect(looseMerges[0].targetItemIds).toEqual([`loose:${fourC.id}`, `loose:${sixH.id}`].sort());

    const state: SACasinoState = {
      ...baseState,
      currentTurnSeat: 0,
      players: [
        { ...baseState.players[0], hand: [aceS, tenD], capturedCards: [] },
        { ...baseState.players[1], hand: [threeH], capturedCards: [] },
      ],
      table,
    };

    const mergeRes = applySACasinoAction(state, {
      type: 'MERGE_LOOSE_TO_BUILD',
      playerSeat: 0,
      payload: {
        buildId: ownBuild10.id,
        targetItemIds: [`loose:${fourC.id}`, `loose:${sixH.id}`],
      },
    });
    expect(mergeRes.error).toBeUndefined();
    // Turn stays on Seat 0, hand unchanged, loose 4+6 layered as [6H, 4C] on top of [10C] and cemented
    expect(mergeRes.state.currentTurnSeat).toBe(0);
    expect(mergeRes.state.players[0].hand).toEqual([aceS, tenD]);
    const updatedBuild = mergeRes.state.table.find(
      (it): it is TableBuildStack => it.kind === 'build'
    )!;
    expect(updatedBuild.isCemented).toBe(true);
    expect(updatedBuild.components).toEqual([[tenC], [sixH, fourC]]);
    expect(updatedBuild.cards).toEqual([tenC, sixH, fourC]);

    // Seat 0 immediately follows up on the SAME turn by cementing Ace onto loose 9 into Build 10!
    const followUp = applySACasinoAction(mergeRes.state, {
      type: 'BUILD',
      playerSeat: 0,
      payload: {
        cardId: aceS.id,
        targetItemIds: [updatedBuild.id, `loose:${nineD.id}`],
        targetValue: 10,
        mode: 'CEMENT',
      },
    });
    expect(followUp.error).toBeUndefined();
    expect(followUp.state.currentTurnSeat).toBe(1);
    const finalBuild = followUp.state.table[0] as TableBuildStack;
    expect(finalBuild.components).toEqual([[tenC], [sixH, fourC], [nineD, aceS]]);
    expect(finalBuild.cards).toEqual([tenC, sixH, fourC, nineD, aceS]);
  });

  it('enforces PULL_OPPONENT_TOP_CARD validation, blocks TRAIL, and forces completion via CAPTURE, BUILD, or DIG_TABLE_TO_BUILD', () => {
    const baseState = createInitialSACasinoState({ mode: '1v1', seed: 161 });
    const fiveH = createCard('H', 5);
    const fiveS = createCard('S', 5);
    const fiveD = createCard('D', 5);
    const eightC = createCard('C', 8);
    const fourS = createCard('S', 4);
    const twoD = createCard('D', 2);
    const threeH = createCard('H', 3);
    const sevenD = createCard('D', 7);
    const sevenS = createCard('S', 7);
    const nineC = createCard('C', 9);

    // 1. Reject pulling when player lacks the required follow-up card
    const lackCardState: SACasinoState = {
      ...baseState,
      currentTurnSeat: 0,
      players: [
        { ...baseState.players[0], hand: [fourS], capturedCards: [] },
        { ...baseState.players[1], hand: [eightC], capturedCards: [eightC, fiveD] },
      ],
      table: [makeLoose(fiveS)],
    };
    const canPullInvalid = canPullOpponentTopCard(
      1,
      lackCardState.players[0].hand,
      lackCardState.table,
      0,
      lackCardState.players,
      false
    );
    expect(canPullInvalid.valid).toBe(false);

    const rejectedPull = applySACasinoAction(lackCardState, {
      type: 'PULL_OPPONENT_TOP_CARD',
      playerSeat: 0,
      payload: { sourceSeat: 1 },
    });
    expect(rejectedPull.error).toBeDefined();
    expect(rejectedPull.state.activeDugCard).toBeNull();
    expect(rejectedPull.state.players[1].capturedCards).toEqual([eightC, fiveD]);

    // 2. Legal pull followed by blocked TRAIL and completion via CAPTURE
    const capState: SACasinoState = {
      ...baseState,
      currentTurnSeat: 0,
      players: [
        { ...baseState.players[0], hand: [fiveH, twoD], capturedCards: [] },
        { ...baseState.players[1], hand: [eightC], capturedCards: [eightC, fiveD] },
      ],
      table: [makeLoose(fiveS)],
    };
    const pullForCap = applySACasinoAction(capState, {
      type: 'PULL_OPPONENT_TOP_CARD',
      playerSeat: 0,
      payload: { sourceSeat: 1, targetItemId: `loose:${fiveS.id}` },
    });
    expect(pullForCap.error).toBeUndefined();
    expect(pullForCap.state.currentTurnSeat).toBe(0);
    // Opponent top 5D popped permanently right on pull, exposing 8C beneath
    expect(pullForCap.state.players[1].capturedCards).toEqual([eightC]);
    expect(pullForCap.state.activeDugCard).toEqual({
      sourceSeat: 1,
      card: fiveD,
      attachedTargetId: `loose:${fiveS.id}`,
    });

    // TRAIL must be blocked while activeDugCard is pending
    const blockedTrail = applySACasinoAction(pullForCap.state, {
      type: 'TRAIL',
      playerSeat: 0,
      payload: { cardId: twoD.id },
    });
    expect(blockedTrail.error).toBe(
      'You must finish playing or capturing the card you took from your opponent.'
    );

    // CAPTURE without using the pulled card's sourceSeat must fail
    const wrongCap = applySACasinoAction(pullForCap.state, {
      type: 'CAPTURE',
      playerSeat: 0,
      payload: { cardId: fiveH.id, capturedItemIds: [`loose:${fiveS.id}`] },
    });
    expect(wrongCap.error).toBeDefined();

    // Completing CAPTURE with dugCapturedFromSeat=1 clears activeDugCard and does NOT pop 8C again
    const completedCap = applySACasinoAction(pullForCap.state, {
      type: 'CAPTURE',
      playerSeat: 0,
      payload: {
        cardId: fiveH.id,
        capturedItemIds: [`loose:${fiveS.id}`],
        dugCapturedFromSeat: 1,
      },
    });
    expect(completedCap.error).toBeUndefined();
    expect(completedCap.state.activeDugCard).toBeNull();
    expect(completedCap.state.currentTurnSeat).toBe(1);
    expect(completedCap.state.players[1].capturedCards).toEqual([eightC]);
    expect(completedCap.state.players[0].capturedCards).toEqual([fiveS, fiveD, fiveH]);

    // 3. Legal pull followed by completion via BUILD
    const buildState: SACasinoState = {
      ...baseState,
      currentTurnSeat: 0,
      players: [
        { ...baseState.players[0], hand: [threeH, sevenS], capturedCards: [] },
        { ...baseState.players[1], hand: [twoD], capturedCards: [nineC, createCard('C', 4)] },
      ],
      table: [makeLoose(sevenD)],
    };
    const pullForBuild = applySACasinoAction(buildState, {
      type: 'PULL_OPPONENT_TOP_CARD',
      playerSeat: 0,
      payload: { sourceSeat: 1 },
    });
    expect(pullForBuild.error).toBeUndefined();
    expect(pullForBuild.state.players[1].capturedCards).toEqual([nineC]);

    const completedBuild = applySACasinoAction(pullForBuild.state, {
      type: 'BUILD',
      playerSeat: 0,
      payload: {
        cardId: threeH.id,
        targetItemIds: [`loose:${sevenD.id}`],
        targetValue: 7,
        mode: 'CEMENT',
        dugCapturedFromSeat: 1,
      },
    });
    expect(completedBuild.error).toBeUndefined();
    expect(completedBuild.state.activeDugCard).toBeNull();
    expect(completedBuild.state.players[1].capturedCards).toEqual([nineC]);
    const builtStack = completedBuild.state.table[0] as TableBuildStack;
    expect(builtStack.components).toEqual([[sevenD], [createCard('C', 4), threeH]]);
    expect(builtStack.cards).toEqual([sevenD, createCard('C', 4), threeH]);

    // 4. Legal pull followed by completion via DIG_TABLE_TO_BUILD
    const ownBuild7 = makeBuild('own-7', [sevenS], [[sevenS]], 7, 0, false);
    const digMergeState: SACasinoState = {
      ...baseState,
      currentTurnSeat: 0,
      players: [
        { ...baseState.players[0], hand: [sevenD, fourS], capturedCards: [] },
        { ...baseState.players[1], hand: [nineC], capturedCards: [nineC, twoD] },
      ],
      table: [ownBuild7, makeLoose(fiveH)],
    };
    const pullForDigMerge = applySACasinoAction(digMergeState, {
      type: 'PULL_OPPONENT_TOP_CARD',
      playerSeat: 0,
      payload: { sourceSeat: 1 },
    });
    expect(pullForDigMerge.error).toBeUndefined();
    expect(pullForDigMerge.state.players[1].capturedCards).toEqual([nineC]);

    const completedDigMerge = applySACasinoAction(pullForDigMerge.state, {
      type: 'DIG_TABLE_TO_BUILD',
      playerSeat: 0,
      payload: {
        buildId: ownBuild7.id,
        targetItemIds: [`loose:${fiveH.id}`],
        dugFromSeat: 1,
      },
    });
    expect(completedDigMerge.error).toBeUndefined();
    expect(completedDigMerge.state.activeDugCard).toBeNull();
    expect(completedDigMerge.state.currentTurnSeat).toBe(0);
    expect(completedDigMerge.state.players[1].capturedCards).toEqual([nineC]);
    const cemented7 = completedDigMerge.state.table[0] as TableBuildStack;
    expect(cemented7.isCemented).toBe(true);
    expect(cemented7.components).toEqual([[sevenS], [fiveH, twoD]]);
    expect(cemented7.cards).toEqual([sevenS, fiveH, twoD]);

    // 5. MERGE_LOOSE_TO_BUILD is blocked while activeDugCard !== null, and capturing open Build 3 + dug 7 with 10 works
    const open3 = makeBuild('open-3', [twoD, createCard('C', 1)], [[twoD, createCard('C', 1)]], 3, 1, false);
    const own10 = makeBuild('own-10', [createCard('S', 10)], [[createCard('S', 10)]], 10, 0, true);
    const blockedMergeState: SACasinoState = {
      ...baseState,
      currentTurnSeat: 0,
      players: [
        { ...baseState.players[0], hand: [createCard('H', 10), createCard('D', 10)], capturedCards: [] },
        { ...baseState.players[1], hand: [eightC], capturedCards: [eightC, sevenD] },
      ],
      table: [own10, open3, makeLoose(createCard('S', 6)), makeLoose(fourS)],
    };
    const pulled7 = applySACasinoAction(blockedMergeState, {
      type: 'PULL_OPPONENT_TOP_CARD',
      playerSeat: 0,
      payload: { sourceSeat: 1 },
    });
    expect(pulled7.error).toBeUndefined();

    const blockedLooseMerge = applySACasinoAction(pulled7.state, {
      type: 'MERGE_LOOSE_TO_BUILD',
      playerSeat: 0,
      payload: {
        buildId: own10.id,
        targetItemIds: [`loose:${createCard('S', 6).id}`, `loose:${fourS.id}`],
      },
    });
    expect(blockedLooseMerge.error).toBe(
      'You must finish playing or capturing the card you took from your opponent.'
    );

    const capOpenBuildPlusDug = applySACasinoAction(pulled7.state, {
      type: 'CAPTURE',
      playerSeat: 0,
      payload: {
        cardId: createCard('H', 10).id,
        capturedItemIds: [open3.id],
        dugCapturedFromSeat: 1,
      },
    });
    expect(capOpenBuildPlusDug.error).toBeUndefined();
    expect(capOpenBuildPlusDug.state.activeDugCard).toBeNull();
    expect(capOpenBuildPlusDug.state.players[0].capturedCards).toHaveLength(4);
  });
});
