import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionPickerModal } from './components/ActionPickerModal';
import { BuildStackView } from './components/BuildStackView';
import { CardSvg } from './components/CardSvg';
import { FaceUpCapturedDeck, PeripheralOpponents } from './components/PeripheralOpponents';
import { PlayerHandFan } from './components/PlayerHandFan';
import { RulesDrawer } from './components/RulesDrawer';
import { ScoreBreakdownModal } from './components/ScoreBreakdownModal';
import { TableCanvas } from './components/TableCanvas';
import { TopHudBar } from './components/TopHudBar';
import {
  BuildOption,
  CaptureOption,
  GameMode,
  SACasinoAction,
  SACasinoState,
  SACasinoVisualEvent,
  TableDigMergeOption,
  TableItem,
  applySACasinoAction,
  canTrailCard,
  chooseTacticalBotAction,
  createInitialSACasinoState,
  findValidBuildOptions,
  findValidCaptureOptions,
  findValidTableDigMerges,
  getPossessionLockedValues,
  getSACasinoPlayerView,
} from './games/sa-casino';
import {
  Card,
  getDeterministicJitter,
  sharedAudioEngine,
} from './studio/core';

interface DragSession {
  card: Card;
  clientX: number;
  clientY: number;
  originX: number;
  originY: number;
}

interface PickerSession {
  card: Card;
  droppedTargetId: string | null;
  dugTargetSeat?: number | null;
}

function nextSeed(prev?: number): number {
  const base = (Date.now() ^ ((prev ?? 0x9e3779b9) + 0x517cc1b7)) >>> 0;
  return base === 0 ? 1337 : base;
}

function findTableItemIdAtPoint(clientX: number, clientY: number): string | null {
  if (typeof document === 'undefined' || !document.elementsFromPoint) return null;
  const elements = document.elementsFromPoint(clientX, clientY);
  for (const el of elements) {
    const target = el.closest?.('[data-table-item-id]');
    if (target) {
      const id = target.getAttribute('data-table-item-id');
      if (id) return id;
    }
  }
  return null;
}

export function App() {
  const [gameState, setGameState] = useState<SACasinoState>(() =>
    createInitialSACasinoState({
      mode: '1v1',
      seed: nextSeed(42),
      dealNumber: 1,
      houseRules: { sweepsEnabled: true, targetMatchScore: 21 },
    })
  );

  const [muted, setMuted] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragSession | null>(null);
  const [hoveredDropTargetId, setHoveredDropTargetId] = useState<string | null>(null);
  const [pickerState, setPickerState] = useState<PickerSession | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const [shuffleTriggerKey, setShuffleTriggerKey] = useState(1);
  const [roundDealTriggerKey, setRoundDealTriggerKey] = useState(0);
  const [capturePulseKey, setCapturePulseKey] = useState(0);
  const [sweepTriggerKey, setSweepTriggerKey] = useState(0);

  const foleyTimersRef = useRef<number[]>([]);

  const clearFoleyTimers = useCallback(() => {
    for (const id of foleyTimersRef.current) {
      window.clearTimeout(id);
    }
    foleyTimersRef.current = [];
  }, []);

  const scheduleFoley = useCallback((fn: () => void, delayMs: number) => {
    const id = window.setTimeout(fn, delayMs);
    foleyTimersRef.current.push(id);
  }, []);

  const playDealSequenceFoley = useCallback(() => {
    clearFoleyTimers();
    sharedAudioEngine.playRiffleShuffle();
    scheduleFoley(() => sharedAudioEngine.playCardSlide(), 180);
    scheduleFoley(() => sharedAudioEngine.playCardSlide(), 320);
    scheduleFoley(() => sharedAudioEngine.playCardSlide(), 460);
  }, [clearFoleyTimers, scheduleFoley]);

  useEffect(() => {
    return () => clearFoleyTimers();
  }, [clearFoleyTimers]);

  // Unlock Web Audio API on first user pointer interaction
  useEffect(() => {
    const handleFirstUnlock = () => {
      sharedAudioEngine.unlock();
    };
    window.addEventListener('pointerdown', handleFirstUnlock, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleFirstUnlock);
    };
  }, []);

  // Auto-dismiss transient error toast
  useEffect(() => {
    if (!errorToast) return;
    const t = window.setTimeout(() => setErrorToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [errorToast]);

  // Strictly masked viewer state for Seat 0 (South)
  const viewerView = useMemo(() => getSACasinoPlayerView(gameState, 0), [gameState]);
  const mySeat = viewerView.players[0];
  const myHand = mySeat?.hand ?? [];
  const isMyTurn = viewerView.phase === 'PLAYING' && viewerView.currentTurnSeat === 0;

  const isFinalDealCard = useMemo(() => {
    const isFinalRound = viewerView.roundNumber === viewerView.totalRounds;
    const totalRemainingCards = viewerView.players.reduce((sum, p) => sum + p.handCount, 0);
    return isFinalRound && totalRemainingCards <= 1;
  }, [viewerView.roundNumber, viewerView.totalRounds, viewerView.players]);

  const applyAndReact = useCallback(
    (prevState: SACasinoState, action: SACasinoAction) => {
      const result = applySACasinoAction(prevState, action);
      if (result.error) {
        setErrorToast(result.error);
        return false;
      }

      const nextState = result.state;
      const events: readonly SACasinoVisualEvent[] = result.events;
      setGameState(nextState);

      for (const ev of events) {
        switch (ev.type) {
          case 'DEAL_STARTED':
          case 'ROUND_2_DEALT':
            setRoundDealTriggerKey((k) => k + 1);
            playDealSequenceFoley();
            break;
          case 'CARD_TRAILED':
            sharedAudioEngine.playCardSlide();
            break;
          case 'CARD_CAPTURED':
            sharedAudioEngine.playCardSnap(1.06);
            setCapturePulseKey((k) => k + 1);
            break;
          case 'BUILD_CREATED':
          case 'BUILD_RAISED':
            sharedAudioEngine.playBuildTap(false);
            break;
          case 'BUILD_CEMENTED':
            sharedAudioEngine.playBuildTap(true);
            break;
          case 'SWEEP_SCORED':
            sharedAudioEngine.playSweepFanfare();
            setSweepTriggerKey((k) => k + 1);
            break;
          case 'DEAL_FINISHED':
            break;
        }
      }

      if (
        prevState.currentTurnSeat !== 0 &&
        nextState.currentTurnSeat === 0 &&
        nextState.phase === 'PLAYING'
      ) {
        scheduleFoley(() => sharedAudioEngine.playTurnChime(), 160);
      }

      return true;
    },
    [playDealSequenceFoley, scheduleFoley]
  );

  // Bot Turn Scheduler (680ms natural cadence)
  useEffect(() => {
    if (gameState.phase !== 'PLAYING') return;
    const activeSeat = gameState.currentTurnSeat;
    const activePlayer = gameState.players[activeSeat];
    if (!activePlayer?.isAI) return;

    const timerId = window.setTimeout(() => {
      const botView = getSACasinoPlayerView(gameState, activeSeat);
      const botAction = chooseTacticalBotAction(botView, activeSeat);
      applyAndReact(gameState, botAction);
    }, 680);

    return () => window.clearTimeout(timerId);
  }, [gameState, applyAndReact]);

  // Round 1 -> Round 2 automatic transition for 1v1 (1350ms)
  const handleDealNextRound = useCallback(() => {
    sharedAudioEngine.unlock();
    applyAndReact(gameState, {
      type: 'DEAL_NEXT_ROUND',
      playerSeat: 0,
      payload: { round: 2 },
    });
  }, [gameState, applyAndReact]);

  useEffect(() => {
    if (gameState.phase !== 'ROUND_TRANSITION') return;
    const timerId = window.setTimeout(() => {
      handleDealNextRound();
    }, 1350);
    return () => window.clearTimeout(timerId);
  }, [gameState.phase, handleDealNextRound]);

  const tableDigMerges = useMemo(
    () =>
      isMyTurn ? findValidTableDigMerges(viewerView.table, viewerView.players, 0) : [],
    [isMyTurn, viewerView.table, viewerView.players]
  );

  // Hand capability metadata for Seat 0
  const { possessionLockedRanks, capturableCardIds, buildableCardIds, handDiggableSeats } = useMemo(() => {
    const locked = getPossessionLockedValues(myHand, viewerView.table, 0);
    const capturable = new Set<string>();
    const buildable = new Set<string>();
    const digSeats = new Set<number>();

    if (isMyTurn) {
      for (const card of myHand) {
        const capOpts = findValidCaptureOptions(
          card,
          myHand,
          viewerView.table,
          0,
          isFinalDealCard,
          viewerView.players
        );
        if (capOpts.length > 0) {
          capturable.add(card.id);
          for (const opt of capOpts) {
            if (opt.dugCapturedFromSeat !== null && opt.dugCapturedFromSeat !== undefined) {
              digSeats.add(opt.dugCapturedFromSeat);
            }
          }
        }
        const bldOpts = findValidBuildOptions(
          card,
          myHand,
          viewerView.table,
          0,
          viewerView.players
        );
        if (bldOpts.length > 0) {
          buildable.add(card.id);
          for (const opt of bldOpts) {
            if (opt.dugCapturedFromSeat !== null && opt.dugCapturedFromSeat !== undefined) {
              digSeats.add(opt.dugCapturedFromSeat);
            }
          }
        }
      }
    }

    return {
      possessionLockedRanks: locked,
      capturableCardIds: capturable,
      buildableCardIds: buildable,
      handDiggableSeats: digSeats,
    };
  }, [myHand, viewerView.table, viewerView.players, isMyTurn, isFinalDealCard]);

  // Options for the currently dragged or selected card (for table highlights & modal)
  const inspectedHandCard = useMemo(() => {
    if (dragState) return dragState.card;
    if (pickerState) return pickerState.card;
    if (selectedCardId) return myHand.find((c) => c.id === selectedCardId) ?? null;
    return null;
  }, [dragState, pickerState, selectedCardId, myHand]);

  const activeCardMoves = useMemo(() => {
    if (!inspectedHandCard || !isMyTurn) {
      return {
        captureOptions: [] as CaptureOption[],
        buildOptions: [] as BuildOption[],
        canTrail: false,
        trailBlockedReason: undefined as string | undefined,
      };
    }

    const captureOptions = findValidCaptureOptions(
      inspectedHandCard,
      myHand,
      viewerView.table,
      0,
      isFinalDealCard,
      viewerView.players
    );
    const buildOptions = findValidBuildOptions(
      inspectedHandCard,
      myHand,
      viewerView.table,
      0,
      viewerView.players
    );
    const trail = canTrailCard(inspectedHandCard, myHand, viewerView.table, 0, {
      isRound1Of1v1: viewerView.mode === '1v1' && viewerView.roundNumber === 1,
      players: viewerView.players,
    });

    return {
      captureOptions,
      buildOptions,
      canTrail: trail.valid,
      trailBlockedReason: trail.reason,
    };
  }, [
    inspectedHandCard,
    isMyTurn,
    myHand,
    viewerView.table,
    viewerView.players,
    viewerView.mode,
    viewerView.roundNumber,
    isFinalDealCard,
  ]);

  // Table target highlight lookup while dragging or picking
  const tableHighlightMap = useMemo(() => {
    const map = new Map<string, 'capture' | 'build' | 'cement'>();
    if (!inspectedHandCard || !isMyTurn) return map;

    for (const opt of activeCardMoves.captureOptions) {
      for (const id of opt.capturedItemIds) {
        map.set(id, 'capture');
      }
    }
    for (const opt of activeCardMoves.buildOptions) {
      const mode = opt.resultingCemented ? 'cement' : 'build';
      for (const id of opt.targetItemIds) {
        const existing = map.get(id);
        if (!existing) {
          map.set(id, mode);
        } else if (existing === 'build' && mode === 'cement') {
          map.set(id, 'cement');
        }
      }
    }
    return map;
  }, [inspectedHandCard, isMyTurn, activeCardMoves]);

  // Reset UI overlays when starting a fresh deal
  const startFreshDeal = useCallback(
    (config: {
      mode: GameMode;
      dealNumber: number;
      dealerSeat?: number;
      matchScores?: Record<number, number>;
    }) => {
      sharedAudioEngine.unlock();
      setSelectedCardId(null);
      setDragState(null);
      setHoveredDropTargetId(null);
      setPickerState(null);
      setErrorToast(null);

      setGameState((prev) =>
        createInitialSACasinoState({
          mode: config.mode,
          seed: nextSeed(prev.seed),
          dealNumber: config.dealNumber,
          dealerSeat: config.dealerSeat,
          houseRules: prev.houseRules,
          matchScores: config.matchScores,
        })
      );

      setShuffleTriggerKey((k) => k + 1);
      playDealSequenceFoley();
    },
    [playDealSequenceFoley]
  );

  const handleChangeMode = useCallback(
    (mode: GameMode) => {
      startFreshDeal({ mode, dealNumber: 1, matchScores: {} });
    },
    [startFreshDeal]
  );

  const handleNewDeal = useCallback(() => {
    startFreshDeal({ mode: gameState.mode, dealNumber: 1, matchScores: {} });
  }, [gameState.mode, startFreshDeal]);

  const handleDealNextHand = useCallback(() => {
    const playerCount = gameState.players.length;
    startFreshDeal({
      mode: gameState.mode,
      dealNumber: gameState.dealNumber + 1,
      dealerSeat: (gameState.dealerSeat + 1) % playerCount,
      matchScores: gameState.matchScores,
    });
  }, [gameState.mode, gameState.dealNumber, gameState.dealerSeat, gameState.players.length, gameState.matchScores, startFreshDeal]);

  const handleToggleMute = useCallback(() => {
    sharedAudioEngine.unlock();
    setMuted((prev) => {
      const next = !prev;
      sharedAudioEngine.setMuted(next);
      return next;
    });
  }, []);

  // Hand interaction handlers
  const handleSelectHandCard = useCallback(
    (card: Card) => {
      if (!isMyTurn) return;
      sharedAudioEngine.unlock();
      setSelectedCardId(card.id);
      setPickerState({ card, droppedTargetId: null });
    },
    [isMyTurn]
  );

  const handleDragStartCard = useCallback(
    (card: Card, clientX: number, clientY: number) => {
      if (!isMyTurn) return;
      sharedAudioEngine.unlock();
      setSelectedCardId(card.id);
      setPickerState(null);
      setDragState({
        card,
        clientX,
        clientY,
        originX: clientX,
        originY: clientY,
      });
      setHoveredDropTargetId(findTableItemIdAtPoint(clientX, clientY));
    },
    [isMyTurn]
  );

  const handleDragMoveCard = useCallback((clientX: number, clientY: number) => {
    setDragState((prev) => (prev ? { ...prev, clientX, clientY } : null));
    setHoveredDropTargetId(findTableItemIdAtPoint(clientX, clientY));
  }, []);

  const handleDragEndCard = useCallback(
    (card: Card, clientX: number, clientY: number) => {
      const dropTargetId = findTableItemIdAtPoint(clientX, clientY) ?? hoveredDropTargetId;
      setDragState(null);
      setHoveredDropTargetId(null);

      if (!isMyTurn) return;

      const captures = findValidCaptureOptions(
        card,
        myHand,
        viewerView.table,
        0,
        isFinalDealCard,
        viewerView.players
      );
      const builds = findValidBuildOptions(
        card,
        myHand,
        viewerView.table,
        0,
        viewerView.players
      );
      const trail = canTrailCard(card, myHand, viewerView.table, 0, {
        isRound1Of1v1: viewerView.mode === '1v1' && viewerView.roundNumber === 1,
        players: viewerView.players,
      });

      // If dropped onto open center felt away from any card/build and no capture/build is possible, Trail directly
      if (
        !dropTargetId &&
        captures.length === 0 &&
        builds.length === 0 &&
        trail.valid &&
        clientY < window.innerHeight - 165
      ) {
        const ok = applyAndReact(gameState, {
          type: 'TRAIL',
          playerSeat: 0,
          payload: { cardId: card.id },
        });
        if (ok) {
          setSelectedCardId(null);
        }
        return;
      }

      // Open ActionPickerModal prioritized for dropTargetId so player never accidentally trails
      setSelectedCardId(card.id);
      setPickerState({ card, droppedTargetId: dropTargetId });
    },
    [
      hoveredDropTargetId,
      isMyTurn,
      myHand,
      viewerView.table,
      viewerView.players,
      viewerView.mode,
      viewerView.roundNumber,
      isFinalDealCard,
      applyAndReact,
      gameState,
    ]
  );

  // Clicking a table card/build while a hand card is selected opens the picker targeted to it
  const handleSelectTableItem = useCallback(
    (item: TableItem) => {
      if (!isMyTurn) return;
      sharedAudioEngine.unlock();
      const chosenCard =
        (selectedCardId ? myHand.find((c) => c.id === selectedCardId) : null) ??
        myHand.find((c) => capturableCardIds.has(c.id) || buildableCardIds.has(c.id));

      if (chosenCard) {
        setSelectedCardId(chosenCard.id);
        setPickerState({ card: chosenCard, droppedTargetId: item.id });
      }
    },
    [isMyTurn, selectedCardId, myHand, capturableCardIds, buildableCardIds]
  );

  // Modal move execution handlers
  const handleExecuteCapture = useCallback(
    (option: CaptureOption) => {
      if (!pickerState) return;
      const ok = applyAndReact(gameState, {
        type: 'CAPTURE',
        playerSeat: 0,
        payload: {
          cardId: pickerState.card.id,
          capturedItemIds: option.capturedItemIds,
          dugCapturedFromSeat: option.dugCapturedFromSeat ?? null,
        },
      });
      if (ok) {
        setPickerState(null);
        setSelectedCardId(null);
      }
    },
    [pickerState, applyAndReact, gameState]
  );

  const handleExecuteBuild = useCallback(
    (option: BuildOption) => {
      if (!pickerState) return;
      const ok = applyAndReact(gameState, {
        type: 'BUILD',
        playerSeat: 0,
        payload: {
          cardId: pickerState.card.id,
          targetItemIds: option.targetItemIds,
          targetValue: option.targetValue,
          mode: option.buildMode,
          dugCapturedFromSeat: option.dugCapturedFromSeat ?? null,
        },
      });
      if (ok) {
        setPickerState(null);
        setSelectedCardId(null);
      }
    },
    [pickerState, applyAndReact, gameState]
  );

  const handleExecuteTrail = useCallback(() => {
    if (!pickerState) return;
    const ok = applyAndReact(gameState, {
      type: 'TRAIL',
      playerSeat: 0,
      payload: { cardId: pickerState.card.id },
    });
    if (ok) {
      setPickerState(null);
      setSelectedCardId(null);
    }
  }, [pickerState, applyAndReact, gameState]);

  const handleExecuteTableDigMerge = useCallback(
    (merge: TableDigMergeOption) => {
      sharedAudioEngine.unlock();
      const ok = applyAndReact(gameState, {
        type: 'DIG_TABLE_TO_BUILD',
        playerSeat: 0,
        payload: {
          buildId: merge.buildId,
          targetItemIds: merge.targetItemIds,
          dugFromSeat: merge.dugFromSeat,
        },
      });
      if (ok) {
        setPickerState(null);
        setSelectedCardId(null);
      }
    },
    [applyAndReact, gameState]
  );

  const diggableSeats = useMemo(() => {
    const seats = new Set<number>();
    if (!isMyTurn) return seats;

    for (const merge of tableDigMerges) {
      seats.add(merge.dugFromSeat);
    }
    if (inspectedHandCard) {
      for (const opt of activeCardMoves.captureOptions) {
        if (opt.dugCapturedFromSeat !== null && opt.dugCapturedFromSeat !== undefined) {
          seats.add(opt.dugCapturedFromSeat);
        }
      }
      for (const opt of activeCardMoves.buildOptions) {
        if (opt.dugCapturedFromSeat !== null && opt.dugCapturedFromSeat !== undefined) {
          seats.add(opt.dugCapturedFromSeat);
        }
      }
    } else {
      for (const seat of handDiggableSeats) {
        seats.add(seat);
      }
    }
    return seats;
  }, [isMyTurn, tableDigMerges, inspectedHandCard, activeCardMoves, handDiggableSeats]);

  const handleClickDigSeat = useCallback(
    (seat: number) => {
      if (!isMyTurn) return;
      sharedAudioEngine.unlock();

      if (inspectedHandCard) {
        const hasDigMove =
          activeCardMoves.captureOptions.some((o) => o.dugCapturedFromSeat === seat) ||
          activeCardMoves.buildOptions.some((o) => o.dugCapturedFromSeat === seat);
        if (hasDigMove) {
          setSelectedCardId(inspectedHandCard.id);
          setPickerState({
            card: inspectedHandCard,
            droppedTargetId: null,
            dugTargetSeat: seat,
          });
          return;
        }
      }

      const matchingMerges = tableDigMerges.filter((m) => m.dugFromSeat === seat);
      const digCard = myHand.find(
        (c) =>
          findValidCaptureOptions(
            c,
            myHand,
            viewerView.table,
            0,
            isFinalDealCard,
            viewerView.players
          ).some((o) => o.dugCapturedFromSeat === seat) ||
          findValidBuildOptions(c, myHand, viewerView.table, 0, viewerView.players).some(
            (o) => o.dugCapturedFromSeat === seat
          )
      );

      if (matchingMerges.length === 1 && !digCard) {
        handleExecuteTableDigMerge(matchingMerges[0]);
        return;
      }

      if (digCard) {
        setSelectedCardId(digCard.id);
        setPickerState({
          card: digCard,
          droppedTargetId: null,
          dugTargetSeat: seat,
        });
        return;
      }

      if (matchingMerges.length > 0) {
        handleExecuteTableDigMerge(matchingMerges[0]);
      }
    },
    [
      isMyTurn,
      inspectedHandCard,
      activeCardMoves,
      tableDigMerges,
      myHand,
      viewerView.table,
      viewerView.players,
      isFinalDealCard,
      handleExecuteTableDigMerge,
    ]
  );

  const getSeatShortName = useCallback(
    (seat: number): string => {
      if (seat === 0) return 'You';
      const p = viewerView.players[seat];
      if (!p) return `Seat ${seat}`;
      return p.name.replace(/\s*\((Bot|Partner)\)$/i, '');
    },
    [viewerView.players]
  );

  const tableCount = viewerView.table.length;
  const looseCardSize: 'xs' | 'sm' | 'md' = isMobile
    ? tableCount >= 6
      ? 'xs'
      : 'sm'
    : tableCount >= 7
      ? 'sm'
      : 'md';
  const compactBuilds = isMobile || tableCount >= 6;
  const jitterScale = tableCount >= 5 ? 0.5 : 1;

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[#081510] text-[#f4efe6]">
      {/* Top Walnut & Brass Studio Header */}
      <TopHudBar
        view={viewerView}
        muted={muted}
        onChangeMode={handleChangeMode}
        onNewDeal={handleNewDeal}
        onToggleMute={handleToggleMute}
        onOpenRules={() => setRulesOpen(true)}
      />

      {/* Main First-Person Tabletop Stage */}
      <main className="relative flex-1 overflow-hidden">
        {/* 60fps Canvas Table Layer (Baize, Walnut Rail, Drag Arc, Shockwaves) */}
        <TableCanvas
          shuffleTriggerKey={shuffleTriggerKey}
          roundDealTriggerKey={roundDealTriggerKey}
          capturePulseKey={capturePulseKey}
          sweepTriggerKey={sweepTriggerKey}
          activeDragPoint={
            dragState ? { x: dragState.clientX, y: dragState.clientY } : null
          }
          handOriginPoint={
            dragState ? { x: dragState.originX, y: dragState.originY } : null
          }
        />

        {/* Peripheral Opponent & Partner Seats */}
        <PeripheralOpponents
          view={viewerView}
          activeSeat={viewerView.currentTurnSeat}
          diggableSeats={diggableSeats}
          onClickDigSeat={handleClickDigSeat}
        />

        {/* Subtle Last Action Status Pill (top-right inside felt) */}
        {viewerView.lastActionSummary && (
          <div className="pointer-events-none absolute right-4 top-3 z-20 hidden max-w-xs items-center gap-2 rounded-full border border-[#c89d54]/25 bg-[#16100a]/80 px-3 py-1 text-[11px] text-[#e8dcc4] shadow-md backdrop-blur-sm md:flex">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                viewerView.lastActionSummary.swept
                  ? 'bg-emerald-400'
                  : 'bg-[#c89d54]'
              }`}
            />
            <span className="truncate">
              <strong className="font-semibold text-[#f5e6c8]">
                {getSeatShortName(viewerView.lastActionSummary.seat)}:
              </strong>{' '}
              {viewerView.lastActionSummary.description}
            </span>
          </div>
        )}

        {/* Center Table Arena: Loose Cards & Build Stacks */}
        <section
          aria-label="Center table cards"
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-2.5 pt-14 pb-32 md:px-24 md:pt-24 md:pb-44"
        >
          <div className="pointer-events-auto flex max-h-full max-w-5xl flex-wrap items-center justify-center gap-2 sm:gap-3.5">
            {viewerView.table.length === 0 ? (
              <div className="rounded-2xl border border-[#c89d54]/25 bg-[#081d14]/70 px-5 py-3 text-center backdrop-blur-[2px]">
                <p className="font-display text-xs font-semibold tracking-wider text-[#dfc088] uppercase">
                  Felt Clear
                </p>
                <p className="mt-0.5 text-[11px] text-stone-300/80">
                  {isMyTurn
                    ? 'Play a card onto the table to start.'
                    : 'Waiting for next card.'}
                </p>
              </div>
            ) : (
              viewerView.table.map((item) => {
                const isTargeted = hoveredDropTargetId === item.id;
                const highlightMode = tableHighlightMap.get(item.id) ?? null;

                if (item.kind === 'build') {
                  const ownerPlayer = viewerView.players[item.ownerSeat];
                  const isOwnedByViewer = item.ownerSeat === 0;
                  const isOwnedByPartner =
                    !isOwnedByViewer &&
                    viewerView.mode === '2v2-teams' &&
                    ownerPlayer?.teamId === 0;

                  return (
                    <BuildStackView
                      key={item.id}
                      build={item}
                      ownerName={getSeatShortName(item.ownerSeat)}
                      isOwnedByViewer={isOwnedByViewer}
                      isOwnedByPartner={isOwnedByPartner}
                      isTargeted={isTargeted}
                      highlightMode={highlightMode}
                      compact={compactBuilds}
                      onSelectBuild={() => handleSelectTableItem(item)}
                      dataDropId={item.id}
                    />
                  );
                }

                const jitter = getDeterministicJitter(item.card.id);
                const offsetX = jitter.offsetX * jitterScale;
                const offsetY = jitter.offsetY * jitterScale;
                const targetTransform = isTargeted
                  ? 'translate3d(0px, -6px, 0) rotate(0deg) scale(1.06)'
                  : `translate3d(${offsetX}px, ${offsetY}px, 0) rotate(${jitter.rotDeg}deg)`;

                return (
                  <button
                    key={item.id}
                    type="button"
                    data-table-item-id={item.id}
                    onClick={() => handleSelectTableItem(item)}
                    className="group relative cursor-pointer rounded-[8px] transition-transform duration-150 ease-out focus:outline-none"
                    style={{ transform: targetTransform }}
                    aria-label={`Table card ${item.card.label}`}
                  >
                    <CardSvg
                      card={item.card}
                      faceUp
                      size={looseCardSize}
                      selected={isTargeted}
                      highlighted={highlightMode}
                      className={
                        isTargeted
                          ? 'shadow-[0_14px_30px_rgba(200,157,84,0.42)]'
                          : 'group-hover:-translate-y-0.5'
                      }
                    />
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Round 1 -> Round 2 Transition Banner (1v1) */}
        {viewerView.phase === 'ROUND_TRANSITION' && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 backdrop-blur-[1px]">
            <button
              type="button"
              onClick={handleDealNextRound}
              className="animate-modal-enter group flex flex-col items-center gap-1.5 rounded-2xl border border-[#c89d54]/65 bg-gradient-to-b from-[#2b1c12]/95 to-[#170f09]/95 px-7 py-4 text-center shadow-[0_20px_54px_rgba(0,0,0,0.75)] transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98]"
            >
              <span className="text-[10px] font-bold tracking-[0.22em] text-[#c89d54] uppercase">
                1v1 Round Transition
              </span>
              <span className="font-display text-sm font-bold text-[#f6efe2] sm:text-base">
                Round 1 Complete — Dealing Remaining 20 Cards · Table Cards Remain Live
              </span>
              <span className="mt-0.5 text-[11px] text-emerald-300/90 group-hover:text-emerald-200">
                Dealing automatically · Click to deal immediately
              </span>
            </button>
          </div>
        )}

        {/* South's Face-Up Captured Deck (Bottom-Right) */}
        <aside
          aria-label="Your captures"
          className="pointer-events-none absolute bottom-2 right-2 z-20 flex flex-col items-center gap-1 md:bottom-4 md:right-4 md:gap-1.5"
        >
          <FaceUpCapturedDeck
            topCard={mySeat?.topCapturedCard ?? null}
            hasMultipleCards={(mySeat?.capturedCount ?? 0) > 1}
            size={isMobile ? 'xs' : 'sm'}
            playerName="You"
          />
          <span className="rounded-full border border-[#c89d54]/25 bg-[#150e09]/85 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-[#dfc088] backdrop-blur-sm md:text-[10px]">
            Your Captures
          </span>
        </aside>

        {/* Bottom Player Hand Fan (Seat 0 - South) */}
        <div className="pointer-events-auto absolute bottom-2.5 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center">
          {isMyTurn && tableDigMerges.length > 0 && (
            <div className="mb-1.5 flex flex-wrap items-center justify-center gap-1.5">
              {tableDigMerges.map((merge) => (
                <button
                  key={merge.id}
                  type="button"
                  onClick={() => handleExecuteTableDigMerge(merge)}
                  className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-amber-400/70 bg-[#2a1c11]/95 px-3 py-1 text-[11px] font-semibold text-amber-200 shadow-[0_4px_16px_rgba(245,158,11,0.28)] backdrop-blur-md transition-all duration-150 hover:border-amber-300 hover:bg-[#382516] active:scale-[0.97]"
                >
                  Dig {merge.description}
                </button>
              ))}
            </div>
          )}

          <PlayerHandFan
            hand={myHand}
            isMyTurn={isMyTurn}
            selectedCardId={selectedCardId}
            possessionLockedRanks={possessionLockedRanks}
            capturableCardIds={capturableCardIds}
            buildableCardIds={buildableCardIds}
            onSelectCard={handleSelectHandCard}
            onDragStartCard={handleDragStartCard}
            onDragMoveCard={handleDragMoveCard}
            onDragEndCard={handleDragEndCard}
          />
        </div>

        {/* Transient Error Banner */}
        {errorToast && (
          <div
            role="status"
            className="pointer-events-none absolute left-1/2 top-4 z-40 -translate-x-1/2 rounded-xl border border-amber-400/50 bg-[#29170c]/95 px-4 py-2 text-xs font-medium text-amber-100 shadow-lg backdrop-blur-md"
          >
            {errorToast}
          </div>
        )}
      </main>

      {/* Floating Drag Ghost Following Pointer */}
      {dragState && (
        <div
          className="pointer-events-none fixed left-0 top-0 z-50"
          style={{
            transform: `translate3d(${dragState.clientX - 44}px, ${
              dragState.clientY - 62
            }px, 0) rotate(-4deg) scale(1.06)`,
          }}
        >
          <CardSvg
            card={dragState.card}
            faceUp
            size="md"
            selected
            className="shadow-[0_22px_48px_rgba(0,0,0,0.72)]"
          />
        </div>
      )}

      {/* Move Action Picker Modal */}
      {pickerState && isMyTurn && (
        <ActionPickerModal
          card={pickerState.card}
          captureOptions={activeCardMoves.captureOptions}
          buildOptions={activeCardMoves.buildOptions}
          tableDigMerges={tableDigMerges}
          players={viewerView.players}
          canTrail={activeCardMoves.canTrail}
          trailBlockedReason={activeCardMoves.trailBlockedReason}
          droppedTargetId={pickerState.droppedTargetId}
          dugTargetSeat={pickerState.dugTargetSeat ?? null}
          onExecuteCapture={handleExecuteCapture}
          onExecuteBuild={handleExecuteBuild}
          onExecuteTableDigMerge={handleExecuteTableDigMerge}
          onExecuteTrail={handleExecuteTrail}
          onClose={() => {
            setPickerState(null);
            setSelectedCardId(null);
          }}
        />
      )}

      {/* End-of-Deal Score Breakdown Modal */}
      {viewerView.phase === 'DEAL_OVER' && viewerView.dealScoreBreakdown && (
        <ScoreBreakdownModal
          breakdown={viewerView.dealScoreBreakdown}
          matchScores={viewerView.matchScores}
          sweepsEnabled={viewerView.houseRules.sweepsEnabled}
          mode={viewerView.mode}
          onDealNextHand={handleDealNextHand}
        />
      )}

      {/* House Rules Reference Slide-Over Drawer */}
      <RulesDrawer
        isOpen={rulesOpen}
        sweepsEnabled={viewerView.houseRules.sweepsEnabled}
        onClose={() => setRulesOpen(false)}
      />
    </div>
  );
}

export default App;
