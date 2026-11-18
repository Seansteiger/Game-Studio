import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Lock, RotateCcw, X } from 'lucide-react';
import { BuildStackView } from './components/BuildStackView';
import { CardSvg } from './components/CardSvg';
import { FaceUpCapturedDeck, PeripheralOpponents } from './components/PeripheralOpponents';
import { PlayerHandFan } from './components/PlayerHandFan';
import { RulesDrawer } from './components/RulesDrawer';
import { ScoreBreakdownModal } from './components/ScoreBreakdownModal';
import { TableCanvas, type CaptureFlightEvent } from './components/TableCanvas';
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
  diagnoseFailedTargetPlay,
  findValidBuildOptions,
  findValidCaptureOptions,
  findValidTableDigMerges,
  formatBuildRank,
  getPossessionLockedValues,
  getSACasinoPlayerView,
} from './games/sa-casino';
import {
  Card,
  getDeterministicJitter,
  isRedSuit,
  sharedAudioEngine,
} from './studio/core';

interface DragSession {
  card: Card;
  clientX: number;
  clientY: number;
  originX: number;
  originY: number;
}

interface InlineActionState {
  card: Card;
  targetItemId: string | null;
  dugTargetSeat: number | null;
}

interface PendingUndoState {
  prevState: SACasinoState;
  label: string;
  expiresAt: number;
}

function getBuildPillLabel(
  option: BuildOption,
  playedRank: number
): { text: string; isKeep: boolean; isLocked: boolean } {
  const rankLabel = formatBuildRank(option.targetValue);
  if (option.resultingCemented && option.targetValue === playedRank) {
    return {
      text: `Keep ${rankLabel}`,
      isKeep: true,
      isLocked: true,
    };
  }
  if (option.resultingCemented) {
    return {
      text: `Build ${rankLabel} (Lock)`,
      isKeep: false,
      isLocked: true,
    };
  }
  return {
    text: `Build ${rankLabel}`,
    isKeep: false,
    isLocked: false,
  };
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
  const [inlineActionState, setInlineActionState] = useState<InlineActionState | null>(null);
  const [pendingUndo, setPendingUndo] = useState<PendingUndoState | null>(null);
  const [undoRemainingSec, setUndoRemainingSec] = useState<number>(0);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const [shuffleTriggerKey, setShuffleTriggerKey] = useState(1);
  const [roundDealTriggerKey, setRoundDealTriggerKey] = useState(0);
  const [capturePulseKey, setCapturePulseKey] = useState(0);
  const [sweepTriggerKey, setSweepTriggerKey] = useState(0);
  const [captureFlightEvent, setCaptureFlightEvent] = useState<CaptureFlightEvent | null>(null);
  const captureFlightKeyRef = useRef(0);

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
          case 'CARD_CAPTURED': {
            sharedAudioEngine.playCardSnap(1.06);
            setCapturePulseKey((k) => k + 1);
            const rawCards = (ev.data.capturedCards as readonly Card[] | undefined) ?? [];
            const seat = (ev.data.seat as number | undefined) ?? 0;
            const cards = rawCards.map((c) => ({
              label: c.label,
              isRed: isRedSuit(c.suit),
            }));
            if (cards.length > 0) {
              const nextKey = ++captureFlightKeyRef.current;
              setCaptureFlightEvent({
                key: nextKey,
                seat,
                mode: nextState.mode,
                cards,
              });
            }
            break;
          }
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

  const commitPlayerMove = useCallback(
    (prevState: SACasinoState, action: SACasinoAction, label: string): boolean => {
      const ok = applyAndReact(prevState, action);
      if (ok) {
        setErrorToast(null);
        setPendingUndo({
          prevState,
          label,
          expiresAt: Date.now() + 4000,
        });
        setUndoRemainingSec(4);
      }
      return ok;
    },
    [applyAndReact]
  );

  // 4-second Cancel timer countdown & auto-expiry
  useEffect(() => {
    if (!pendingUndo) {
      setUndoRemainingSec(0);
      return;
    }

    const updateRemaining = () => {
      const remainingMs = pendingUndo.expiresAt - Date.now();
      if (remainingMs <= 0) {
        setPendingUndo(null);
        setUndoRemainingSec(0);
      } else {
        setUndoRemainingSec(Math.ceil(remainingMs / 1000));
      }
    };

    updateRemaining();
    const intervalId = window.setInterval(updateRemaining, 200);
    const timeoutId = window.setTimeout(() => {
      setPendingUndo(null);
      setUndoRemainingSec(0);
    }, Math.max(0, pendingUndo.expiresAt - Date.now()));

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [pendingUndo]);

  // Bot Turn Scheduler (680ms natural cadence; paused during 4s Cancel window)
  useEffect(() => {
    if (pendingUndo !== null) return;
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
  }, [gameState, pendingUndo, applyAndReact]);

  // Round 1 -> Round 2 automatic transition for 1v1 (1350ms; paused during 4s Cancel window)
  const handleDealNextRound = useCallback(() => {
    sharedAudioEngine.unlock();
    applyAndReact(gameState, {
      type: 'DEAL_NEXT_ROUND',
      playerSeat: 0,
      payload: { round: 2 },
    });
  }, [gameState, applyAndReact]);

  useEffect(() => {
    if (pendingUndo !== null) return;
    if (gameState.phase !== 'ROUND_TRANSITION') return;
    const timerId = window.setTimeout(() => {
      handleDealNextRound();
    }, 1350);
    return () => window.clearTimeout(timerId);
  }, [gameState.phase, pendingUndo, handleDealNextRound]);

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

  // Options for the currently dragged or selected card (for table highlights & inline pills)
  const inspectedHandCard = useMemo(() => {
    if (dragState) return dragState.card;
    if (inlineActionState) return inlineActionState.card;
    if (selectedCardId) return myHand.find((c) => c.id === selectedCardId) ?? null;
    return null;
  }, [dragState, inlineActionState, selectedCardId, myHand]);

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
      setInlineActionState(null);
      setPendingUndo(null);
      setUndoRemainingSec(0);
      setCaptureFlightEvent(null);
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
      setInlineActionState({ card, targetItemId: null, dugTargetSeat: null });
    },
    [isMyTurn]
  );

  const handleDragStartCard = useCallback(
    (card: Card, clientX: number, clientY: number) => {
      if (!isMyTurn) return;
      sharedAudioEngine.unlock();
      setSelectedCardId(card.id);
      setInlineActionState(null);
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

      // 1. Dropped anywhere on open felt away from any card/build: immediately Trail when valid
      if (!dropTargetId) {
        const openFeltCutoffY = window.innerHeight - (isMobile ? 145 : 175);
        if (clientY < openFeltCutoffY) {
          if (trail.valid) {
            const ok = commitPlayerMove(
              gameState,
              {
                type: 'TRAIL',
                playerSeat: 0,
                payload: { cardId: card.id },
              },
              `Place ${card.label}`
            );
            if (ok) {
              setSelectedCardId(null);
              setInlineActionState(null);
            }
          } else {
            setSelectedCardId(null);
            setInlineActionState(null);
            setErrorToast(trail.reason ?? `Cannot place ${card.label} on the table.`);
          }
        } else {
          setSelectedCardId(null);
          setInlineActionState(null);
        }
        return;
      }

      // 2. Dropped onto an existing table card/build
      const matchingCaptures = captures.filter((opt) =>
        opt.capturedItemIds.includes(dropTargetId)
      );
      const matchingBuilds = builds.filter((opt) =>
        opt.targetItemIds.includes(dropTargetId)
      );

      if (matchingCaptures.length === 0 && matchingBuilds.length === 0) {
        const targetItem = viewerView.table.find((it) => it.id === dropTargetId);
        const reason = targetItem
          ? diagnoseFailedTargetPlay(card, targetItem, myHand, viewerView.table, 0)
          : `${card.label} cannot capture or build on that target.`;
        setSelectedCardId(null);
        setInlineActionState(null);
        setErrorToast(reason);
        return;
      }

      setSelectedCardId(card.id);
      setInlineActionState({ card, targetItemId: dropTargetId, dugTargetSeat: null });
    },
    [
      hoveredDropTargetId,
      isMyTurn,
      isMobile,
      myHand,
      viewerView.table,
      viewerView.players,
      viewerView.mode,
      viewerView.roundNumber,
      isFinalDealCard,
      commitPlayerMove,
      gameState,
    ]
  );

  // Clicking a table card/build while holding/selecting a hand card opens inline pills targeted to it
  const handleSelectTableItem = useCallback(
    (item: TableItem) => {
      if (!isMyTurn) return;
      sharedAudioEngine.unlock();

      const selectedCard = selectedCardId
        ? myHand.find((c) => c.id === selectedCardId) ?? null
        : null;

      if (selectedCard) {
        const capMatches = findValidCaptureOptions(
          selectedCard,
          myHand,
          viewerView.table,
          0,
          isFinalDealCard,
          viewerView.players
        ).some((opt) => opt.capturedItemIds.includes(item.id));
        const bldMatches = findValidBuildOptions(
          selectedCard,
          myHand,
          viewerView.table,
          0,
          viewerView.players
        ).some((opt) => opt.targetItemIds.includes(item.id));

        if (capMatches || bldMatches) {
          setInlineActionState({
            card: selectedCard,
            targetItemId: item.id,
            dugTargetSeat: null,
          });
        } else {
          setErrorToast(
            diagnoseFailedTargetPlay(selectedCard, item, myHand, viewerView.table, 0)
          );
        }
        return;
      }

      const matchingCard = myHand.find(
        (c) =>
          findValidCaptureOptions(
            c,
            myHand,
            viewerView.table,
            0,
            isFinalDealCard,
            viewerView.players
          ).some((opt) => opt.capturedItemIds.includes(item.id)) ||
          findValidBuildOptions(c, myHand, viewerView.table, 0, viewerView.players).some(
            (opt) => opt.targetItemIds.includes(item.id)
          )
      );

      if (matchingCard) {
        setSelectedCardId(matchingCard.id);
        setInlineActionState({
          card: matchingCard,
          targetItemId: item.id,
          dugTargetSeat: null,
        });
      }
    },
    [isMyTurn, selectedCardId, myHand, viewerView.table, viewerView.players, isFinalDealCard]
  );

  // Move execution handlers
  const handleExecuteCapture = useCallback(
    (option: CaptureOption) => {
      if (!inlineActionState) return;
      const ok = commitPlayerMove(
        gameState,
        {
          type: 'CAPTURE',
          playerSeat: 0,
          payload: {
            cardId: inlineActionState.card.id,
            capturedItemIds: option.capturedItemIds,
            dugCapturedFromSeat: option.dugCapturedFromSeat ?? null,
          },
        },
        option.description
      );
      if (ok) {
        setInlineActionState(null);
        setSelectedCardId(null);
      }
    },
    [inlineActionState, commitPlayerMove, gameState]
  );

  const handleExecuteBuild = useCallback(
    (option: BuildOption) => {
      if (!inlineActionState) return;
      const { text } = getBuildPillLabel(option, inlineActionState.card.rank);
      const ok = commitPlayerMove(
        gameState,
        {
          type: 'BUILD',
          playerSeat: 0,
          payload: {
            cardId: inlineActionState.card.id,
            targetItemIds: option.targetItemIds,
            targetValue: option.targetValue,
            mode: option.buildMode,
            dugCapturedFromSeat: option.dugCapturedFromSeat ?? null,
          },
        },
        text
      );
      if (ok) {
        setInlineActionState(null);
        setSelectedCardId(null);
      }
    },
    [inlineActionState, commitPlayerMove, gameState]
  );

  const handleExecuteTrail = useCallback(() => {
    if (!inlineActionState) return;
    const ok = commitPlayerMove(
      gameState,
      {
        type: 'TRAIL',
        playerSeat: 0,
        payload: { cardId: inlineActionState.card.id },
      },
      `Place ${inlineActionState.card.label}`
    );
    if (ok) {
      setInlineActionState(null);
      setSelectedCardId(null);
    }
  }, [inlineActionState, commitPlayerMove, gameState]);

  const handleExecuteTableDigMerge = useCallback(
    (merge: TableDigMergeOption) => {
      sharedAudioEngine.unlock();
      const ok = commitPlayerMove(
        gameState,
        {
          type: 'DIG_TABLE_TO_BUILD',
          playerSeat: 0,
          payload: {
            buildId: merge.buildId,
            targetItemIds: merge.targetItemIds,
            dugFromSeat: merge.dugFromSeat,
          },
        },
        `Dig ${merge.description}`
      );
      if (ok) {
        setInlineActionState(null);
        setSelectedCardId(null);
      }
    },
    [commitPlayerMove, gameState]
  );

  const handleCancelPendingMove = useCallback(() => {
    if (!pendingUndo) return;
    sharedAudioEngine.unlock();
    setGameState(pendingUndo.prevState);
    setPendingUndo(null);
    setUndoRemainingSec(0);
    setCaptureFlightEvent(null);
    setInlineActionState(null);
    setSelectedCardId(null);
    setErrorToast(null);
    sharedAudioEngine.playCardSlide();
  }, [pendingUndo]);

  const handleConfirmPendingMove = useCallback(() => {
    if (!pendingUndo) return;
    sharedAudioEngine.unlock();
    setPendingUndo(null);
    setUndoRemainingSec(0);
  }, [pendingUndo]);

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
          setInlineActionState({
            card: inspectedHandCard,
            targetItemId: null,
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
        setInlineActionState({
          card: digCard,
          targetItemId: null,
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

  const inlineActionData = useMemo(() => {
    if (!inlineActionState || !isMyTurn) return null;

    const { card, targetItemId, dugTargetSeat } = inlineActionState;
    const { captureOptions, buildOptions, canTrail, trailBlockedReason } = activeCardMoves;

    if (targetItemId !== null) {
      const captures = captureOptions.filter(
        (opt) =>
          opt.capturedItemIds.includes(targetItemId) ||
          (dugTargetSeat !== null && opt.dugCapturedFromSeat === dugTargetSeat)
      );
      const builds = buildOptions.filter((opt) =>
        opt.targetItemIds.includes(targetItemId)
      );
      return {
        card,
        captures,
        builds,
        digMerges: [] as TableDigMergeOption[],
        showTrail: false,
        trailBlockedReason: undefined as string | undefined,
      };
    }

    if (dugTargetSeat !== null) {
      const captures = captureOptions.filter(
        (opt) => opt.dugCapturedFromSeat === dugTargetSeat
      );
      const builds = buildOptions.filter(
        (opt) => opt.dugCapturedFromSeat === dugTargetSeat
      );
      const digMerges = tableDigMerges.filter(
        (merge) => merge.dugFromSeat === dugTargetSeat
      );
      return {
        card,
        captures,
        builds,
        digMerges,
        showTrail: false,
        trailBlockedReason: undefined as string | undefined,
      };
    }

    const captures = captureOptions.slice(0, 2);

    const bestBuildByTarget = new Map<number, BuildOption>();
    const scoreBuildOption = (opt: BuildOption) =>
      (opt.dugCapturedFromSeat == null ? 4 : 0) +
      (opt.resultingCemented && opt.targetValue === card.rank
        ? 2
        : opt.resultingCemented
          ? 1
          : 0);

    for (const opt of buildOptions) {
      const existing = bestBuildByTarget.get(opt.targetValue);
      if (!existing || scoreBuildOption(opt) > scoreBuildOption(existing)) {
        bestBuildByTarget.set(opt.targetValue, opt);
      }
    }
    const builds = Array.from(bestBuildByTarget.values()).slice(0, 4);

    return {
      card,
      captures,
      builds,
      digMerges: [] as TableDigMergeOption[],
      showTrail: canTrail,
      trailBlockedReason: !canTrail ? trailBlockedReason : undefined,
    };
  }, [inlineActionState, isMyTurn, activeCardMoves, tableDigMerges]);

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
    <div className="relative flex h-[100dvh] w-screen flex-col overflow-hidden bg-[#081510] text-[#f4efe6]">
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
          captureFlightEvent={captureFlightEvent}
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
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-2.5 pt-24 pb-36 md:px-24 md:pt-24 md:pb-44"
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
                      hasSelectedHandCard={Boolean(selectedCardId)}
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
        {viewerView.phase === 'ROUND_TRANSITION' && pendingUndo === null && (
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
          className="pointer-events-none absolute bottom-32 right-2 z-20 flex flex-col items-center gap-1 md:bottom-4 md:right-4 md:gap-1.5"
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
        <div className="pointer-events-auto absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center md:bottom-3">
          {/* 4-Second Cancel Timer Pill */}
          {pendingUndo && (
            <div
              key={pendingUndo.expiresAt}
              className="mb-1.5 flex w-max max-w-[94vw] items-center justify-center gap-1.5"
            >
              <button
                type="button"
                onClick={handleCancelPendingMove}
                title={`Undo: ${pendingUndo.label}`}
                className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border border-amber-400/55 bg-gradient-to-r from-[#3a1a12]/95 to-[#2b170e]/95 px-3 py-1 text-[11px] font-semibold text-amber-100 shadow-[0_4px_16px_rgba(0,0,0,0.48)] backdrop-blur-md transition-all duration-150 hover:border-rose-400/75 hover:from-[#471e15] hover:to-[#331a10] active:scale-[0.97]"
              >
                <RotateCcw className="h-3 w-3 shrink-0 text-amber-300" />
                <span>Cancel ({Math.max(1, undoRemainingSec)}s)</span>
                <span className="animate-undo-bar pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-amber-400 to-rose-400" />
              </button>
              <button
                type="button"
                onClick={handleConfirmPendingMove}
                className="inline-flex items-center gap-1 rounded-full border border-emerald-400/45 bg-[#10261b]/95 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 shadow-[0_4px_14px_rgba(0,0,0,0.4)] backdrop-blur-md transition-all duration-150 hover:border-emerald-300/75 hover:bg-[#163425] active:scale-[0.97]"
              >
                <Check className="h-3 w-3 shrink-0 text-emerald-300" />
                <span>Play Now</span>
              </button>
            </div>
          )}

          {/* Inline Non-Blocking Move Pill Buttons */}
          {inlineActionData && (
            <div className="mb-1.5 flex w-max max-w-[94vw] flex-wrap items-center justify-center gap-1.5 px-1 sm:max-w-xl">
              {inlineActionData.captures.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleExecuteCapture(option)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/60 bg-[#0e2a1d]/95 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 shadow-[0_4px_14px_rgba(16,185,129,0.22)] backdrop-blur-md transition-all duration-150 hover:border-emerald-300 hover:bg-[#133827] active:scale-[0.97]"
                >
                  <span className="truncate max-w-[180px] sm:max-w-[240px]">
                    {option.description}
                  </span>
                  {option.isSweep && (
                    <span className="rounded-full border border-emerald-300/60 bg-emerald-500/25 px-1.5 py-0.2 text-[9px] font-bold tracking-wider text-emerald-100 uppercase">
                      SWEEP
                    </span>
                  )}
                </button>
              ))}

              {inlineActionData.builds.map((option) => {
                const { text, isKeep, isLocked } = getBuildPillLabel(
                  option,
                  inlineActionData.card.rank
                );
                const hasDuplicateLabel =
                  inlineActionData.builds.filter(
                    (b) =>
                      getBuildPillLabel(b, inlineActionData.card.rank).text === text &&
                      b.dugCapturedFromSeat === option.dugCapturedFromSeat
                  ).length > 1;
                const extraHint = hasDuplicateLabel
                  ? ` (${option.targetItems
                      .map((it) =>
                        it.kind === 'loose' ? it.card.label : `B${it.targetValue}`
                      )
                      .join('+')})`
                  : '';

                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleExecuteBuild(option)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md transition-all duration-150 active:scale-[0.97] ${
                      isKeep || isLocked
                        ? 'border-amber-400/65 bg-[#312011]/95 text-amber-100 shadow-[0_4px_14px_rgba(245,158,11,0.22)] hover:border-amber-300 hover:bg-[#3f2916]'
                        : 'border-[#c89d54]/55 bg-[#25180e]/95 text-[#f3dfb8] shadow-[0_4px_14px_rgba(200,157,84,0.18)] hover:border-[#dfc088] hover:bg-[#322114]'
                    }`}
                  >
                    {isKeep && <Lock className="h-3 w-3 shrink-0 text-amber-300" />}
                    <span>
                      {text}
                      {extraHint}
                      {option.dugCapturedFromSeat !== null &&
                      option.dugCapturedFromSeat !== undefined
                        ? ' + Dig'
                        : ''}
                    </span>
                  </button>
                );
              })}

              {inlineActionData.digMerges.map((merge) => (
                <button
                  key={merge.id}
                  type="button"
                  onClick={() => handleExecuteTableDigMerge(merge)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/70 bg-[#2a1c11]/95 px-2.5 py-1 text-[11px] font-semibold text-amber-200 shadow-[0_4px_16px_rgba(245,158,11,0.28)] backdrop-blur-md transition-all duration-150 hover:border-amber-300 hover:bg-[#382516] active:scale-[0.97]"
                >
                  Dig {merge.description}
                </button>
              ))}

              {inlineActionData.showTrail && (
                <button
                  type="button"
                  onClick={handleExecuteTrail}
                  className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-[#1b140e]/90 px-2.5 py-1 text-[11px] font-semibold text-[#efe6d5] shadow-[0_4px_14px_rgba(0,0,0,0.35)] backdrop-blur-md transition-all duration-150 hover:border-[#c89d54]/60 hover:bg-[#2a1f16] active:scale-[0.97]"
                >
                  Place on Table
                </button>
              )}

              {!inlineActionData.showTrail &&
                inlineActionData.captures.length === 0 &&
                inlineActionData.builds.length === 0 &&
                inlineActionData.digMerges.length === 0 &&
                inlineActionData.trailBlockedReason && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-950/85 px-2.5 py-1 text-[10px] font-medium text-amber-200 backdrop-blur-md">
                    <Lock className="h-3 w-3 shrink-0 text-amber-400" />
                    Keep for Build
                  </span>
                )}

              <button
                type="button"
                onClick={() => {
                  setInlineActionState(null);
                  setSelectedCardId(null);
                }}
                aria-label="Cancel card selection"
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-[#1c130d]/90 text-stone-300 shadow-sm backdrop-blur-md transition-colors hover:border-[#c89d54]/50 hover:bg-[#2a1d14] hover:text-white active:scale-[0.95]"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {!inlineActionData && isMyTurn && tableDigMerges.length > 0 && (
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

      {/* End-of-Deal Score Breakdown Modal */}
      {viewerView.phase === 'DEAL_OVER' &&
        viewerView.dealScoreBreakdown &&
        pendingUndo === null && (
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
