import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  ActiveDugCard,
  BuildOption,
  CaptureOption,
  GameMode,
  LooseBuildMergeOption,
  MaskedPlayerSeatState,
  SACasinoAction,
  SACasinoState,
  SACasinoVisualEvent,
  TableDigMergeOption,
  TableItem,
  TableLooseCard,
  applySACasinoAction,
  canPullOpponentTopCard,
  canTrailCard,
  chooseTacticalBotAction,
  createInitialSACasinoState,
  diagnoseFailedTargetPlay,
  findValidBuildOptions,
  findValidCaptureOptions,
  findValidLooseToBuildMerges,
  findValidTableDigMerges,
  formatBuildRank,
  getPossessionLockedValues,
  getSACasinoPlayerView,
  sortComponentDesc,
} from './games/sa-casino';
import {
  Card,
  getDeterministicJitter,
  isRedSuit,
  sharedAudioEngine,
} from './studio/core';

const DRAG_THRESHOLD_PX = 8;

interface DragSession {
  card: Card;
  clientX: number;
  clientY: number;
  originX: number;
  originY: number;
}

interface TableDragSession {
  sourceItem: TableLooseCard;
  clientX: number;
  clientY: number;
  originX: number;
  originY: number;
}

interface DigDragSession {
  sourceSeat: number;
  card: Card;
  clientX: number;
  clientY: number;
  originX: number;
  originY: number;
}

interface StagedTableGroup {
  itemIds: string[];
  anchorId: string;
}

interface StagedDragSession {
  itemIds: string[];
  cards: Card[];
  clientX: number;
  clientY: number;
  originX: number;
  originY: number;
}

interface AnchorCoords {
  x: number;
  y: number;
}

interface TableComboActionState {
  targetItemId: string;
  looseMerges: LooseBuildMergeOption[];
  handCaptures: { card: Card; option: CaptureOption }[];
  handBuilds: { card: Card; option: BuildOption }[];
}

interface TablePointerSession {
  pointerId: number;
  mode: 'loose' | 'staged';
  item: TableLooseCard;
  canDrag: boolean;
  stagedItemIds?: string[];
  stagedCards?: Card[];
  startX: number;
  startY: number;
  hasDragged: boolean;
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

function findTableItemIdAtPoint(
  clientX: number,
  clientY: number,
  ignoreId?: string | null
): string | null {
  if (typeof document === 'undefined' || !document.elementsFromPoint) return null;
  const elements = document.elementsFromPoint(clientX, clientY);
  for (const el of elements) {
    const target = el.closest?.('[data-table-item-id]');
    if (target) {
      const id = target.getAttribute('data-table-item-id');
      if (id && id !== ignoreId) return id;
    }
  }
  return null;
}

function haveSameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = a.slice().sort();
  const sb = b.slice().sort();
  return sa.every((id, idx) => id === sb[idx]);
}

function isNonUndoableAction(prevState: SACasinoState, action: SACasinoAction): boolean {
  if (prevState.activeDugCard !== null) return true;
  if (
    action.type === 'PULL_OPPONENT_TOP_CARD' ||
    action.type === 'DIG_TABLE_TO_BUILD' ||
    action.type === 'MERGE_LOOSE_TO_BUILD'
  ) {
    return true;
  }
  if (
    (action.type === 'CAPTURE' || action.type === 'BUILD') &&
    action.payload.dugCapturedFromSeat != null
  ) {
    return true;
  }
  return false;
}

function findComboMovesForItems(
  requiredIds: readonly string[],
  hand: readonly Card[],
  table: readonly TableItem[],
  players: readonly MaskedPlayerSeatState[],
  isFinalDealCard: boolean,
  activeDugCard: ActiveDugCard | null = null
): {
  handCaptures: { card: Card; option: CaptureOption }[];
  handBuilds: { card: Card; option: BuildOption }[];
} {
  const handCaptures: { card: Card; option: CaptureOption }[] = [];
  const handBuilds: { card: Card; option: BuildOption }[] = [];

  for (const card of hand) {
    const capOpts = findValidCaptureOptions(
      card,
      hand,
      table,
      0,
      isFinalDealCard,
      players,
      activeDugCard
    ).filter((opt) => requiredIds.every((id) => opt.capturedItemIds.includes(id)));

    const nonDugCaps = capOpts.filter((opt) => opt.dugCapturedFromSeat == null);
    const chosenCap = activeDugCard ? capOpts[0] : (nonDugCaps[0] ?? capOpts[0]);
    if (chosenCap) {
      handCaptures.push({ card, option: chosenCap });
    }

    const bldOpts = findValidBuildOptions(
      card,
      hand,
      table,
      0,
      players,
      activeDugCard
    ).filter(
      (opt) =>
        (activeDugCard !== null || opt.dugCapturedFromSeat == null) &&
        requiredIds.every((id) => opt.targetItemIds.includes(id))
    );

    if (bldOpts.length > 0) {
      const sortedBuilds = bldOpts
        .slice()
        .sort(
          (a, b) =>
            a.targetItemIds.length - b.targetItemIds.length ||
            Number(b.resultingCemented) - Number(a.resultingCemented)
        );
      const seenKey = new Set<string>();
      for (const opt of sortedBuilds) {
        const key = `${opt.targetValue}:${opt.buildMode}`;
        if (seenKey.has(key)) continue;
        seenKey.add(key);
        handBuilds.push({ card, option: opt });
      }
    }
  }

  return { handCaptures, handBuilds };
}

function formatCaptureTargetSummary(option: CaptureOption): string {
  const parts = option.capturedItems.map((it) =>
    it.kind === 'loose' ? it.card.label : `B${formatBuildRank(it.targetValue)}`
  );
  return parts.join('+');
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

  const mainRef = useRef<HTMLElement | null>(null);
  const tablePointerRef = useRef<TablePointerSession | null>(null);
  const suppressNextTableClickRef = useRef(false);

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragSession | null>(null);
  const [tableDragState, setTableDragState] = useState<TableDragSession | null>(null);
  const [digDragState, setDigDragState] = useState<DigDragSession | null>(null);
  const [stagedTableGroup, setStagedTableGroup] = useState<StagedTableGroup | null>(null);
  const [stagedDragState, setStagedDragState] = useState<StagedDragSession | null>(null);
  const [tableComboState, setTableComboState] = useState<TableComboActionState | null>(null);
  const [dugFocusTargetId, setDugFocusTargetId] = useState<string | null>(null);
  const [anchorCoords, setAnchorCoords] = useState<AnchorCoords | null>(null);
  const [anchorPlaceBelow, setAnchorPlaceBelow] = useState(false);
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
      const nonUndoable = isNonUndoableAction(prevState, action);
      setGameState(nextState);
      setStagedTableGroup(null);
      setTableComboState(null);
      if (nonUndoable) {
        setPendingUndo(null);
        setUndoRemainingSec(0);
      }

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
        if (!isNonUndoableAction(prevState, action)) {
          setPendingUndo({
            prevState,
            label,
            expiresAt: Date.now() + 4000,
          });
          setUndoRemainingSec(4);
        }
      }
      return ok;
    },
    [applyAndReact]
  );

  // Clear ephemeral interaction state when turn leaves Seat 0 or activeDugCard resolves
  useEffect(() => {
    if (!isMyTurn) {
      tablePointerRef.current = null;
      setTableDragState(null);
      setDigDragState(null);
      setStagedDragState(null);
      setStagedTableGroup(null);
      setTableComboState(null);
      setInlineActionState(null);
      setSelectedCardId(null);
      setDugFocusTargetId(null);
      setHoveredDropTargetId(null);
    }
  }, [isMyTurn]);

  const activeDugKey = viewerView.activeDugCard
    ? `${viewerView.activeDugCard.sourceSeat}:${viewerView.activeDugCard.card.id}:${viewerView.activeDugCard.attachedTargetId ?? ''}`
    : null;

  useEffect(() => {
    setDugFocusTargetId(viewerView.activeDugCard?.attachedTargetId ?? null);
  }, [activeDugKey]);

  useEffect(() => {
    if (!stagedTableGroup) return;
    const allStillLoose = stagedTableGroup.itemIds.every((id) =>
      viewerView.table.some((it) => it.kind === 'loose' && it.id === id)
    );
    if (!allStillLoose || stagedTableGroup.itemIds.length < 2) {
      setStagedTableGroup(null);
    }
  }, [stagedTableGroup, viewerView.table]);

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
      isMyTurn
        ? findValidTableDigMerges(
            viewerView.table,
            viewerView.players,
            0,
            viewerView.activeDugCard
          )
        : [],
    [isMyTurn, viewerView.table, viewerView.players, viewerView.activeDugCard]
  );

  const looseBuildMerges = useMemo(
    () =>
      isMyTurn && viewerView.activeDugCard === null
        ? findValidLooseToBuildMerges(viewerView.table, 0)
        : [],
    [isMyTurn, viewerView.activeDugCard, viewerView.table]
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
          viewerView.players,
          viewerView.activeDugCard
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
          viewerView.players,
          viewerView.activeDugCard
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
  }, [myHand, viewerView.table, viewerView.players, viewerView.activeDugCard, isMyTurn, isFinalDealCard]);

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
      viewerView.players,
      viewerView.activeDugCard
    );
    const buildOptions = findValidBuildOptions(
      inspectedHandCard,
      myHand,
      viewerView.table,
      0,
      viewerView.players,
      viewerView.activeDugCard
    );
    const trail = canTrailCard(inspectedHandCard, myHand, viewerView.table, 0, {
      isRound1Of1v1: viewerView.mode === '1v1' && viewerView.roundNumber === 1,
      players: viewerView.players,
      activeDugCard: viewerView.activeDugCard,
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
    viewerView.activeDugCard,
    viewerView.mode,
    viewerView.roundNumber,
    isFinalDealCard,
  ]);

  // Table target highlight lookup while dragging or picking
  const tableHighlightMap = useMemo(() => {
    const map = new Map<string, 'capture' | 'build' | 'cement'>();
    if (!isMyTurn) return map;

    if (tableDragState) {
      const source = tableDragState.sourceItem;
      const stagedIds = stagedTableGroup?.itemIds ?? [];
      const stagedSum = stagedTableGroup
        ? viewerView.table
            .filter((it): it is TableLooseCard => it.kind === 'loose' && stagedIds.includes(it.id))
            .reduce((acc, it) => acc + it.card.rank, 0)
        : 0;

      for (const item of viewerView.table) {
        if (item.id === source.id) continue;
        if (item.kind === 'build' && item.ownerSeat === 0) {
          if (
            looseBuildMerges.some(
              (m) => m.buildId === item.id && m.targetItemIds.includes(source.id)
            )
          ) {
            map.set(item.id, 'cement');
          }
        } else if (item.kind === 'loose') {
          if (!source.card.isFaceCard && !item.card.isFaceCard) {
            if (stagedTableGroup && stagedTableGroup.anchorId === item.id) {
              if (!stagedIds.includes(source.id) && stagedIds.length < 4 && stagedSum + source.card.rank <= 10) {
                map.set(item.id, 'build');
              }
            } else if (source.card.rank + item.card.rank <= 10) {
              map.set(item.id, 'build');
            }
          }
        } else if (item.kind === 'build' && item.ownerSeat !== 0) {
          const combo = findComboMovesForItems(
            [item.id, source.id],
            myHand,
            viewerView.table,
            viewerView.players,
            isFinalDealCard
          );
          if (combo.handCaptures.length > 0) map.set(item.id, 'capture');
          else if (combo.handBuilds.length > 0) map.set(item.id, 'build');
        }
      }
      return map;
    }

    if (stagedDragState) {
      const stagedSum = stagedDragState.cards.reduce((acc, c) => acc + c.rank, 0);
      for (const item of viewerView.table) {
        if (stagedDragState.itemIds.includes(item.id)) continue;
        if (item.kind === 'build' && item.ownerSeat === 0) {
          if (
            looseBuildMerges.some(
              (m) => m.buildId === item.id && haveSameIdSet(m.targetItemIds, stagedDragState.itemIds)
            )
          ) {
            map.set(item.id, 'cement');
          }
        } else if (item.kind === 'build' && item.ownerSeat !== 0) {
          const combo = findComboMovesForItems(
            [item.id, ...stagedDragState.itemIds],
            myHand,
            viewerView.table,
            viewerView.players,
            isFinalDealCard
          );
          if (combo.handCaptures.length > 0) map.set(item.id, 'capture');
          else if (combo.handBuilds.length > 0) map.set(item.id, 'build');
        } else if (
          item.kind === 'loose' &&
          !item.card.isFaceCard &&
          stagedDragState.itemIds.length < 4 &&
          stagedSum + item.card.rank <= 10
        ) {
          map.set(item.id, 'build');
        }
      }
      return map;
    }

    if (digDragState) {
      for (const m of tableDigMerges) {
        if (m.dugFromSeat === digDragState.sourceSeat) {
          map.set(m.buildId, 'cement');
          for (const id of m.targetItemIds) map.set(id, 'build');
        }
      }
      for (const card of myHand) {
        const capOpts = findValidCaptureOptions(
          card,
          myHand,
          viewerView.table,
          0,
          isFinalDealCard,
          viewerView.players
        );
        for (const opt of capOpts) {
          if (opt.dugCapturedFromSeat === digDragState.sourceSeat) {
            for (const id of opt.capturedItemIds) map.set(id, 'capture');
          }
        }
        const bldOpts = findValidBuildOptions(
          card,
          myHand,
          viewerView.table,
          0,
          viewerView.players
        );
        for (const opt of bldOpts) {
          if (opt.dugCapturedFromSeat === digDragState.sourceSeat) {
            for (const id of opt.targetItemIds) {
              if (!map.has(id)) map.set(id, opt.resultingCemented ? 'cement' : 'build');
            }
          }
        }
      }
      return map;
    }

    if (inspectedHandCard) {
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
    }

    if (stagedTableGroup) {
      for (const m of looseBuildMerges) {
        if (haveSameIdSet(m.targetItemIds, stagedTableGroup.itemIds)) {
          map.set(m.buildId, 'cement');
        }
      }
      return map;
    }

    if (viewerView.activeDugCard !== null) {
      for (const m of tableDigMerges) {
        map.set(m.buildId, 'cement');
        for (const id of m.targetItemIds) map.set(id, 'build');
      }
      for (const card of myHand) {
        const capOpts = findValidCaptureOptions(
          card,
          myHand,
          viewerView.table,
          0,
          isFinalDealCard,
          viewerView.players,
          viewerView.activeDugCard
        );
        for (const opt of capOpts) {
          for (const id of opt.capturedItemIds) map.set(id, 'capture');
        }
        const bldOpts = findValidBuildOptions(
          card,
          myHand,
          viewerView.table,
          0,
          viewerView.players,
          viewerView.activeDugCard
        );
        for (const opt of bldOpts) {
          for (const id of opt.targetItemIds) {
            if (!map.has(id)) map.set(id, opt.resultingCemented ? 'cement' : 'build');
          }
        }
      }
    }

    return map;
  }, [
    isMyTurn,
    tableDragState,
    stagedDragState,
    digDragState,
    stagedTableGroup,
    inspectedHandCard,
    activeCardMoves,
    looseBuildMerges,
    tableDigMerges,
    myHand,
    viewerView.table,
    viewerView.players,
    viewerView.activeDugCard,
    isFinalDealCard,
  ]);

  // Reset UI overlays when starting a fresh deal
  const startFreshDeal = useCallback(
    (config: {
      mode: GameMode;
      dealNumber: number;
      dealerSeat?: number;
      matchScores?: Record<number, number>;
    }) => {
      sharedAudioEngine.unlock();
      tablePointerRef.current = null;
      setSelectedCardId(null);
      setDragState(null);
      setTableDragState(null);
      setDigDragState(null);
      setStagedTableGroup(null);
      setStagedDragState(null);
      setTableComboState(null);
      setDugFocusTargetId(null);
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
      setStagedTableGroup(null);
      setTableComboState(null);

      if (viewerView.activeDugCard !== null) {
        if (selectedCardId === card.id) {
          setSelectedCardId(null);
          return;
        }
        const caps = findValidCaptureOptions(
          card,
          myHand,
          viewerView.table,
          0,
          isFinalDealCard,
          viewerView.players,
          viewerView.activeDugCard
        );
        const blds = findValidBuildOptions(
          card,
          myHand,
          viewerView.table,
          0,
          viewerView.players,
          viewerView.activeDugCard
        );
        if (caps.length === 0 && blds.length === 0) {
          setErrorToast(
            `${card.label} cannot capture or build with dug ${viewerView.activeDugCard.card.label}.`
          );
          return;
        }
        setSelectedCardId(card.id);
        setInlineActionState(null);
        if (dugFocusTargetId) {
          const matchesTarget =
            caps.some((opt) => opt.capturedItemIds.includes(dugFocusTargetId)) ||
            blds.some((opt) => opt.targetItemIds.includes(dugFocusTargetId));
          if (!matchesTarget) {
            setDugFocusTargetId(null);
          }
        }
        return;
      }

      setSelectedCardId(card.id);
      setInlineActionState({ card, targetItemId: null, dugTargetSeat: null });
    },
    [
      isMyTurn,
      viewerView.activeDugCard,
      viewerView.table,
      viewerView.players,
      selectedCardId,
      myHand,
      isFinalDealCard,
      dugFocusTargetId,
    ]
  );

  const handleDragStartCard = useCallback(
    (card: Card, clientX: number, clientY: number) => {
      if (!isMyTurn) return;
      sharedAudioEngine.unlock();
      setSelectedCardId(card.id);
      setInlineActionState(null);
      setStagedTableGroup(null);
      setTableComboState(null);
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
        viewerView.players,
        viewerView.activeDugCard
      );
      const builds = findValidBuildOptions(
        card,
        myHand,
        viewerView.table,
        0,
        viewerView.players,
        viewerView.activeDugCard
      );
      const trail = canTrailCard(card, myHand, viewerView.table, 0, {
        isRound1Of1v1: viewerView.mode === '1v1' && viewerView.roundNumber === 1,
        players: viewerView.players,
        activeDugCard: viewerView.activeDugCard,
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
        const reason = viewerView.activeDugCard
          ? `${card.label} cannot capture or build on that target with dug ${viewerView.activeDugCard.card.label}.`
          : targetItem
            ? diagnoseFailedTargetPlay(card, targetItem, myHand, viewerView.table, 0)
            : `${card.label} cannot capture or build on that target.`;
        setSelectedCardId(null);
        setInlineActionState(null);
        setErrorToast(reason);
        return;
      }

      setSelectedCardId(card.id);
      if (viewerView.activeDugCard !== null) {
        setDugFocusTargetId(dropTargetId);
        setInlineActionState(null);
      } else {
        setInlineActionState({ card, targetItemId: dropTargetId, dugTargetSeat: null });
      }
    },
    [
      hoveredDropTargetId,
      isMyTurn,
      isMobile,
      myHand,
      viewerView.table,
      viewerView.players,
      viewerView.activeDugCard,
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
      setTableComboState(null);

      if (viewerView.activeDugCard !== null) {
        const selectedCard = selectedCardId
          ? myHand.find((c) => c.id === selectedCardId) ?? null
          : null;
        const mergeMatches = tableDigMerges.some(
          (m) => m.buildId === item.id || m.targetItemIds.includes(item.id)
        );
        const cardMatches = (c: Card) =>
          findValidCaptureOptions(
            c,
            myHand,
            viewerView.table,
            0,
            isFinalDealCard,
            viewerView.players,
            viewerView.activeDugCard
          ).some((opt) => opt.capturedItemIds.includes(item.id)) ||
          findValidBuildOptions(
            c,
            myHand,
            viewerView.table,
            0,
            viewerView.players,
            viewerView.activeDugCard
          ).some((opt) => opt.targetItemIds.includes(item.id));

        if (selectedCard && cardMatches(selectedCard)) {
          setDugFocusTargetId(item.id);
          return;
        }
        const anyMatching = mergeMatches || myHand.some(cardMatches);
        if (anyMatching) {
          if (selectedCard && !cardMatches(selectedCard)) {
            setSelectedCardId(null);
          }
          setDugFocusTargetId(item.id);
        } else {
          setErrorToast(
            `No legal move with dug ${viewerView.activeDugCard.card.label} on that target.`
          );
        }
        return;
      }

      if (stagedTableGroup && stagedTableGroup.anchorId === item.id) {
        return;
      }
      setStagedTableGroup(null);

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
    [
      isMyTurn,
      viewerView.activeDugCard,
      viewerView.table,
      viewerView.players,
      stagedTableGroup,
      selectedCardId,
      myHand,
      tableDigMerges,
      isFinalDealCard,
    ]
  );

  // Move execution handlers
  const clearAllSelectionOverlays = useCallback(() => {
    setInlineActionState(null);
    setSelectedCardId(null);
    setStagedTableGroup(null);
    setTableComboState(null);
    setDugFocusTargetId(null);
  }, []);

  const handleExecuteCapture = useCallback(
    (card: Card, option: CaptureOption) => {
      const ok = commitPlayerMove(
        gameState,
        {
          type: 'CAPTURE',
          playerSeat: 0,
          payload: {
            cardId: card.id,
            capturedItemIds: option.capturedItemIds,
            dugCapturedFromSeat: option.dugCapturedFromSeat ?? null,
          },
        },
        option.description
      );
      if (ok) {
        clearAllSelectionOverlays();
      }
    },
    [commitPlayerMove, gameState, clearAllSelectionOverlays]
  );

  const handleExecuteBuild = useCallback(
    (card: Card, option: BuildOption) => {
      const { text } = getBuildPillLabel(option, card.rank);
      const ok = commitPlayerMove(
        gameState,
        {
          type: 'BUILD',
          playerSeat: 0,
          payload: {
            cardId: card.id,
            targetItemIds: option.targetItemIds,
            targetValue: option.targetValue,
            mode: option.buildMode,
            dugCapturedFromSeat: option.dugCapturedFromSeat ?? null,
          },
        },
        text
      );
      if (ok) {
        clearAllSelectionOverlays();
      }
    },
    [commitPlayerMove, gameState, clearAllSelectionOverlays]
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
      clearAllSelectionOverlays();
    }
  }, [inlineActionState, commitPlayerMove, gameState, clearAllSelectionOverlays]);

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
        clearAllSelectionOverlays();
      }
    },
    [commitPlayerMove, gameState, clearAllSelectionOverlays]
  );

  const handleExecuteLooseMerge = useCallback(
    (merge: LooseBuildMergeOption) => {
      sharedAudioEngine.unlock();
      const ok = applyAndReact(gameState, {
        type: 'MERGE_LOOSE_TO_BUILD',
        playerSeat: 0,
        payload: {
          buildId: merge.buildId,
          targetItemIds: merge.targetItemIds,
        },
      });
      if (ok) {
        setErrorToast(null);
        clearAllSelectionOverlays();
      }
    },
    [applyAndReact, gameState, clearAllSelectionOverlays]
  );

  // Loose table card & staged stack pointer drag handlers
  const handleLooseDrop = useCallback(
    (sourceItem: TableLooseCard, dropTargetId: string | null) => {
      if (!dropTargetId || dropTargetId === sourceItem.id) return;
      const targetItem = viewerView.table.find((it) => it.id === dropTargetId);
      if (!targetItem) return;

      // 1. Dropped onto own active build
      if (targetItem.kind === 'build' && targetItem.ownerSeat === 0) {
        const matchingMerges = looseBuildMerges.filter(
          (m) => m.buildId === targetItem.id && m.targetItemIds.includes(sourceItem.id)
        );
        if (matchingMerges.length === 1) {
          handleExecuteLooseMerge(matchingMerges[0]);
        } else if (matchingMerges.length > 1) {
          setSelectedCardId(null);
          setInlineActionState(null);
          setStagedTableGroup(null);
          setTableComboState({
            targetItemId: targetItem.id,
            looseMerges: matchingMerges,
            handCaptures: [],
            handBuilds: [],
          });
        } else {
          const buildLabel = formatBuildRank(targetItem.targetValue);
          if (sourceItem.card.isFaceCard) {
            setErrorToast('Face cards cannot be added to a build.');
          } else if (sourceItem.card.rank > targetItem.targetValue) {
            setErrorToast(
              `${sourceItem.card.rank} is higher than your ${buildLabel} build.`
            );
          } else {
            setErrorToast(
              `${sourceItem.card.rank} does not add up to your ${buildLabel} build.`
            );
          }
        }
        return;
      }

      // 2. Dropped onto another loose card (or onto an existing staged stack anchor)
      if (targetItem.kind === 'loose') {
        if (sourceItem.card.isFaceCard || targetItem.card.isFaceCard) {
          setErrorToast('Face cards cannot be stacked into numeric sums.');
          return;
        }

        if (
          stagedTableGroup &&
          stagedTableGroup.anchorId === targetItem.id &&
          !stagedTableGroup.itemIds.includes(sourceItem.id)
        ) {
          const currentSum = viewerView.table
            .filter(
              (it): it is TableLooseCard =>
                it.kind === 'loose' && stagedTableGroup.itemIds.includes(it.id)
            )
            .reduce((acc, it) => acc + it.card.rank, 0);

          if (stagedTableGroup.itemIds.length >= 4) {
            setErrorToast('Cannot stack more than 4 loose cards together.');
            return;
          }
          if (currentSum + sourceItem.card.rank > 10) {
            setErrorToast(
              `${currentSum} + ${sourceItem.card.rank} = ${currentSum + sourceItem.card.rank} exceeds 10.`
            );
            return;
          }
          setSelectedCardId(null);
          setInlineActionState(null);
          setTableComboState(null);
          setStagedTableGroup({
            itemIds: [...stagedTableGroup.itemIds, sourceItem.id],
            anchorId: stagedTableGroup.anchorId,
          });
          return;
        }

        const pairSum = sourceItem.card.rank + targetItem.card.rank;
        if (pairSum > 10) {
          setErrorToast(
            `${sourceItem.card.rank} + ${targetItem.card.rank} = ${pairSum} exceeds 10.`
          );
          return;
        }

        setSelectedCardId(null);
        setInlineActionState(null);
        setTableComboState(null);
        setStagedTableGroup({
          itemIds: [targetItem.id, sourceItem.id],
          anchorId: targetItem.id,
        });
        return;
      }

      // 3. Dropped onto an opponent's build (captures / merges uncemented builds with hand cards)
      if (targetItem.kind === 'build' && targetItem.ownerSeat !== 0) {
        const combo = findComboMovesForItems(
          [targetItem.id, sourceItem.id],
          myHand,
          viewerView.table,
          viewerView.players,
          isFinalDealCard
        );
        if (combo.handCaptures.length > 0 || combo.handBuilds.length > 0) {
          setSelectedCardId(null);
          setInlineActionState(null);
          setStagedTableGroup(null);
          setTableComboState({
            targetItemId: targetItem.id,
            looseMerges: [],
            handCaptures: combo.handCaptures,
            handBuilds: combo.handBuilds,
          });
        } else {
          const buildLabel = formatBuildRank(targetItem.targetValue);
          setErrorToast(
            targetItem.isCemented
              ? `Build ${buildLabel} is locked and cannot be combined with ${sourceItem.card.label}.`
              : `No card in your hand can capture or merge Build ${buildLabel} with ${sourceItem.card.label}.`
          );
        }
      }
    },
    [
      viewerView.table,
      viewerView.players,
      looseBuildMerges,
      stagedTableGroup,
      myHand,
      isFinalDealCard,
      handleExecuteLooseMerge,
    ]
  );

  const handleStagedDrop = useCallback(
    (itemIds: readonly string[], cards: readonly Card[], dropTargetId: string | null) => {
      if (!dropTargetId || (stagedTableGroup && dropTargetId === stagedTableGroup.anchorId)) {
        return;
      }
      const targetItem = viewerView.table.find((it) => it.id === dropTargetId);
      if (!targetItem) return;

      const stagedSum = cards.reduce((sum, c) => sum + c.rank, 0);
      const stagedLabel = cards.map((c) => c.label).join(' + ');

      // 1. Dropped onto own active build
      if (targetItem.kind === 'build' && targetItem.ownerSeat === 0) {
        const match = looseBuildMerges.find(
          (m) => m.buildId === targetItem.id && haveSameIdSet(m.targetItemIds, itemIds)
        );
        if (match) {
          handleExecuteLooseMerge(match);
        } else {
          setErrorToast(
            `${stagedLabel} (${stagedSum}) does not add up to your ${formatBuildRank(targetItem.targetValue)} build.`
          );
        }
        return;
      }

      // 2. Dropped onto opponent's build (uncemented capture / merge)
      if (targetItem.kind === 'build' && targetItem.ownerSeat !== 0) {
        const combo = findComboMovesForItems(
          [targetItem.id, ...itemIds],
          myHand,
          viewerView.table,
          viewerView.players,
          isFinalDealCard
        );
        if (combo.handCaptures.length > 0 || combo.handBuilds.length > 0) {
          setSelectedCardId(null);
          setInlineActionState(null);
          setStagedTableGroup(null);
          setTableComboState({
            targetItemId: targetItem.id,
            looseMerges: [],
            handCaptures: combo.handCaptures,
            handBuilds: combo.handBuilds,
          });
        } else {
          setErrorToast(
            `No card in your hand can capture or merge Build ${formatBuildRank(targetItem.targetValue)} with those staged cards.`
          );
        }
        return;
      }

      // 3. Dropped onto another unstaged loose card
      if (targetItem.kind === 'loose' && !itemIds.includes(targetItem.id)) {
        if (
          !targetItem.card.isFaceCard &&
          itemIds.length < 4 &&
          stagedSum + targetItem.card.rank <= 10
        ) {
          setStagedTableGroup({
            itemIds: [...itemIds, targetItem.id],
            anchorId: targetItem.id,
          });
        } else {
          setErrorToast(
            `Cannot stack ${targetItem.card.label} onto staged cards (${stagedSum}).`
          );
        }
      }
    },
    [
      stagedTableGroup,
      viewerView.table,
      viewerView.players,
      looseBuildMerges,
      myHand,
      isFinalDealCard,
      handleExecuteLooseMerge,
    ]
  );

  const handleTablePointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLElement>,
      item: TableLooseCard,
      stagedInfo?: { itemIds: string[]; cards: Card[] }
    ) => {
      if (!isMyTurn) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      e.currentTarget.setPointerCapture(e.pointerId);
      const canDrag = viewerView.activeDugCard === null;

      tablePointerRef.current = {
        pointerId: e.pointerId,
        mode: stagedInfo ? 'staged' : 'loose',
        item,
        canDrag,
        stagedItemIds: stagedInfo?.itemIds,
        stagedCards: stagedInfo?.cards,
        startX: e.clientX,
        startY: e.clientY,
        hasDragged: false,
      };
    },
    [isMyTurn, viewerView.activeDugCard]
  );

  const handleTablePointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const session = tablePointerRef.current;
    if (!session || session.pointerId !== e.pointerId) return;
    if (!session.canDrag) return;

    const ignoreId = session.item.id;

    if (!session.hasDragged) {
      const dist = Math.hypot(e.clientX - session.startX, e.clientY - session.startY);
      if (dist > DRAG_THRESHOLD_PX) {
        session.hasDragged = true;
        sharedAudioEngine.unlock();
        setInlineActionState(null);
        setTableComboState(null);
        setSelectedCardId(null);

        if (session.mode === 'staged' && session.stagedItemIds && session.stagedCards) {
          setStagedDragState({
            itemIds: session.stagedItemIds,
            cards: session.stagedCards,
            clientX: e.clientX,
            clientY: e.clientY,
            originX: session.startX,
            originY: session.startY,
          });
        } else {
          setTableDragState({
            sourceItem: session.item,
            clientX: e.clientX,
            clientY: e.clientY,
            originX: session.startX,
            originY: session.startY,
          });
        }
        setHoveredDropTargetId(findTableItemIdAtPoint(e.clientX, e.clientY, ignoreId));
      }
    } else {
      if (session.mode === 'staged') {
        setStagedDragState((prev) =>
          prev ? { ...prev, clientX: e.clientX, clientY: e.clientY } : null
        );
      } else {
        setTableDragState((prev) =>
          prev ? { ...prev, clientX: e.clientX, clientY: e.clientY } : null
        );
      }
      setHoveredDropTargetId(findTableItemIdAtPoint(e.clientX, e.clientY, ignoreId));
    }
  }, []);

  const finishTablePointer = useCallback(
    (e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
      const session = tablePointerRef.current;
      if (!session || session.pointerId !== e.pointerId) return;

      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }

      tablePointerRef.current = null;
      suppressNextTableClickRef.current = true;
      window.setTimeout(() => {
        suppressNextTableClickRef.current = false;
      }, 0);

      if (session.hasDragged) {
        const dropTargetId =
          findTableItemIdAtPoint(e.clientX, e.clientY, session.item.id) ??
          hoveredDropTargetId;
        setTableDragState(null);
        setStagedDragState(null);
        setHoveredDropTargetId(null);

        if (!cancelled && isMyTurn && viewerView.activeDugCard === null) {
          if (session.mode === 'staged' && session.stagedItemIds && session.stagedCards) {
            handleStagedDrop(session.stagedItemIds, session.stagedCards, dropTargetId);
          } else {
            handleLooseDrop(session.item, dropTargetId);
          }
        }
      } else if (!cancelled && isMyTurn) {
        if (session.mode === 'loose') {
          handleSelectTableItem(session.item);
        }
      }
    },
    [
      hoveredDropTargetId,
      isMyTurn,
      viewerView.activeDugCard,
      handleStagedDrop,
      handleLooseDrop,
      handleSelectTableItem,
    ]
  );

  const handleCancelPendingMove = useCallback(() => {
    if (!pendingUndo) return;
    sharedAudioEngine.unlock();
    setGameState(pendingUndo.prevState);
    setPendingUndo(null);
    setUndoRemainingSec(0);
    setCaptureFlightEvent(null);
    clearAllSelectionOverlays();
    setErrorToast(null);
    sharedAudioEngine.playCardSlide();
  }, [pendingUndo, clearAllSelectionOverlays]);

  const handleConfirmPendingMove = useCallback(() => {
    if (!pendingUndo) return;
    sharedAudioEngine.unlock();
    setPendingUndo(null);
    setUndoRemainingSec(0);
  }, [pendingUndo]);

  const diggableSeats = useMemo(() => {
    const seats = new Set<number>();
    if (!isMyTurn || viewerView.activeDugCard !== null) return seats;

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
  }, [
    isMyTurn,
    viewerView.activeDugCard,
    tableDigMerges,
    inspectedHandCard,
    activeCardMoves,
    handDiggableSeats,
  ]);

  const handleClickDigSeat = useCallback(
    (seat: number) => {
      if (!isMyTurn || viewerView.activeDugCard !== null) return;
      sharedAudioEngine.unlock();
      setStagedTableGroup(null);
      setTableComboState(null);

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
      viewerView.activeDugCard,
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

  // Direct opponent top-card drag handlers -> PULL_OPPONENT_TOP_CARD / activeDugCard
  const handleDragStartDigSeat = useCallback(
    (seat: number, card: Card, clientX: number, clientY: number) => {
      if (!isMyTurn || viewerView.activeDugCard !== null) return;
      sharedAudioEngine.unlock();
      setSelectedCardId(null);
      setInlineActionState(null);
      setTableComboState(null);
      setDigDragState({
        sourceSeat: seat,
        card,
        clientX,
        clientY,
        originX: clientX,
        originY: clientY,
      });
      setHoveredDropTargetId(findTableItemIdAtPoint(clientX, clientY));
    },
    [isMyTurn, viewerView.activeDugCard]
  );

  const handleDragMoveDigSeat = useCallback((clientX: number, clientY: number) => {
    setDigDragState((prev) => (prev ? { ...prev, clientX, clientY } : null));
    setHoveredDropTargetId(findTableItemIdAtPoint(clientX, clientY));
  }, []);

  const handleDragEndDigSeat = useCallback(
    (sourceSeat: number, card: Card, clientX: number, clientY: number) => {
      const dropTargetId = findTableItemIdAtPoint(clientX, clientY);
      setDigDragState(null);
      setHoveredDropTargetId(null);

      if (!isMyTurn || viewerView.activeDugCard !== null) return;

      const check = canPullOpponentTopCard(
        sourceSeat,
        myHand,
        viewerView.table,
        0,
        viewerView.players,
        isFinalDealCard,
        dropTargetId
      );

      if (!check.valid) {
        setErrorToast(
          check.reason ?? `Cannot pull ${card.label} onto that target.`
        );
        return;
      }

      const ok = applyAndReact(gameState, {
        type: 'PULL_OPPONENT_TOP_CARD',
        playerSeat: 0,
        payload: {
          sourceSeat,
          targetItemId: dropTargetId ?? null,
        },
      });

      if (ok) {
        setErrorToast(null);
        setSelectedCardId(null);
        setInlineActionState(null);
        setTableComboState(null);
        setStagedTableGroup(null);
        setPendingUndo(null);
        setUndoRemainingSec(0);
        setDugFocusTargetId(dropTargetId ?? null);
      }
    },
    [
      isMyTurn,
      viewerView.activeDugCard,
      myHand,
      viewerView.table,
      viewerView.players,
      isFinalDealCard,
      applyAndReact,
      gameState,
    ]
  );

  const inlineActionData = useMemo(() => {
    if (!inlineActionState || !isMyTurn || viewerView.activeDugCard !== null) return null;

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
  }, [inlineActionState, isMyTurn, viewerView.activeDugCard, activeCardMoves, tableDigMerges]);

  // Action data for staged loose bundle (e.g. 6+4 stacked on table)
  const stagedGroupActionData = useMemo(() => {
    if (!stagedTableGroup || !isMyTurn || viewerView.activeDugCard !== null) return null;
    const stagedItems = stagedTableGroup.itemIds
      .map((id) => viewerView.table.find((it) => it.kind === 'loose' && it.id === id))
      .filter((it): it is TableLooseCard => Boolean(it));
    if (stagedItems.length < 2) return null;

    const matchingBuildMerges = looseBuildMerges.filter((m) =>
      haveSameIdSet(m.targetItemIds, stagedTableGroup.itemIds)
    );
    const combo = findComboMovesForItems(
      stagedTableGroup.itemIds,
      myHand,
      viewerView.table,
      viewerView.players,
      isFinalDealCard
    );

    return {
      anchorId: stagedTableGroup.anchorId,
      looseMerges: matchingBuildMerges,
      handCaptures: combo.handCaptures,
      handBuilds: combo.handBuilds,
    };
  }, [
    stagedTableGroup,
    isMyTurn,
    viewerView.activeDugCard,
    viewerView.table,
    viewerView.players,
    looseBuildMerges,
    myHand,
    isFinalDealCard,
  ]);

  // Action data while an opponent's top card has been pulled (activeDugCard !== null)
  const activeDugBarData = useMemo(() => {
    const activeDug = viewerView.activeDugCard;
    if (!activeDug || !isMyTurn) return null;

    const targetId = dugFocusTargetId;
    const validTargetId =
      targetId && viewerView.table.some((it) => it.id === targetId) ? targetId : null;
    const selectedCard = selectedCardId
      ? myHand.find((c) => c.id === selectedCardId) ?? null
      : null;

    const filteredDigMerges = selectedCard
      ? []
      : tableDigMerges.filter(
          (m) =>
            !validTargetId ||
            m.buildId === validTargetId ||
            m.targetItemIds.includes(validTargetId)
        );

    const cardsToCheck = selectedCard ? [selectedCard] : myHand;
    const dugCaptures: { card: Card; option: CaptureOption }[] = [];
    const dugBuilds: { card: Card; option: BuildOption }[] = [];

    for (const card of cardsToCheck) {
      const capOpts = findValidCaptureOptions(
        card,
        myHand,
        viewerView.table,
        0,
        isFinalDealCard,
        viewerView.players,
        activeDug
      ).filter((opt) => !validTargetId || opt.capturedItemIds.includes(validTargetId));

      if (selectedCard) {
        for (const opt of capOpts.slice(0, 3)) {
          dugCaptures.push({ card, option: opt });
        }
      } else if (capOpts[0]) {
        dugCaptures.push({ card, option: capOpts[0] });
      }

      const bldOpts = findValidBuildOptions(
        card,
        myHand,
        viewerView.table,
        0,
        viewerView.players,
        activeDug
      ).filter((opt) => !validTargetId || opt.targetItemIds.includes(validTargetId));

      const seenBuildKeys = new Set<string>();
      for (const opt of bldOpts) {
        const key = `${opt.targetValue}:${opt.buildMode}`;
        if (seenBuildKeys.has(key)) continue;
        seenBuildKeys.add(key);
        dugBuilds.push({ card, option: opt });
      }
    }

    return {
      activeDug,
      targetItemId: validTargetId,
      digMerges: filteredDigMerges,
      dugCaptures,
      dugBuilds,
    };
  }, [
    viewerView.activeDugCard,
    viewerView.table,
    viewerView.players,
    isMyTurn,
    dugFocusTargetId,
    selectedCardId,
    myHand,
    tableDigMerges,
    isFinalDealCard,
  ]);

  // Determine which selector (if any) currently owns the anchored floating pills
  const anchorSelector = useMemo(() => {
    if (!isMyTurn) return null;
    if (activeDugBarData) {
      return activeDugBarData.targetItemId
        ? `[data-table-item-id="${activeDugBarData.targetItemId}"]`
        : null;
    }
    if (tableComboState) {
      return `[data-table-item-id="${tableComboState.targetItemId}"]`;
    }
    if (stagedGroupActionData) {
      return `[data-table-item-id="${stagedGroupActionData.anchorId}"]`;
    }
    if (inlineActionData && inlineActionState) {
      if (inlineActionState.targetItemId !== null) {
        return `[data-table-item-id="${inlineActionState.targetItemId}"]`;
      }
      if (inlineActionState.dugTargetSeat !== null) {
        return `[data-captured-seat="${inlineActionState.dugTargetSeat}"]`;
      }
    }
    return null;
  }, [
    isMyTurn,
    activeDugBarData,
    tableComboState,
    stagedGroupActionData,
    inlineActionData,
    inlineActionState,
  ]);

  // Measure target element relative to <main> and clamp within safe bounds
  useLayoutEffect(() => {
    const mainEl = mainRef.current;
    if (!mainEl || !anchorSelector) {
      setAnchorCoords(null);
      return;
    }

    const measure = () => {
      const mainRect = mainEl.getBoundingClientRect();
      if (mainRect.width <= 0 || mainRect.height <= 0) {
        setAnchorCoords(null);
        return;
      }

      const candidates = mainEl.querySelectorAll(anchorSelector);
      let targetRect: DOMRect | null = null;
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          targetRect = rect;
          break;
        }
      }

      if (!targetRect) {
        setAnchorCoords(null);
        return;
      }

      const rawX = targetRect.left - mainRect.left + targetRect.width * 0.5;
      const topRel = targetRect.top - mainRect.top;
      const placeBelow = topRel < 64;
      const rawY = placeBelow
        ? targetRect.bottom - mainRect.top + 8
        : topRel - 10;

      const minX = Math.min(96, mainRect.width * 0.5);
      const maxX = Math.max(minX, mainRect.width - 96);
      const minY = 48;
      const maxY = Math.max(minY, mainRect.height - 150);

      setAnchorPlaceBelow(placeBelow);
      setAnchorCoords({
        x: Math.max(minX, Math.min(maxX, rawX)),
        y: Math.max(minY, Math.min(maxY, rawY)),
      });
    };

    measure();
    window.addEventListener('resize', measure);
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => measure())
        : null;
    if (resizeObserver) {
      resizeObserver.observe(mainEl);
    }

    return () => {
      window.removeEventListener('resize', measure);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [anchorSelector, viewerView.table, viewerView.players, stagedTableGroup, isMobile]);

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
  const looseCardDims =
    looseCardSize === 'xs'
      ? { width: 52, height: 74 }
      : looseCardSize === 'sm'
        ? { width: 68, height: 96 }
        : { width: 88, height: 124 };
  const compactBuilds = isMobile || tableCount >= 6;
  const jitterScale = tableCount >= 5 ? 0.5 : 1;

  const activeTetherDrag = dragState ?? tableDragState ?? stagedDragState ?? digDragState;
  const isAnchoredBarVisible = Boolean(anchorSelector && anchorCoords);

  const renderFloatingActionPills = (anchored: boolean) => {
    const containerClass = anchored
      ? 'flex w-max max-w-[min(92vw,360px)] flex-wrap items-center justify-center gap-1.5'
      : 'mb-1.5 flex w-max max-w-[94vw] flex-wrap items-center justify-center gap-1.5 px-1 sm:max-w-xl';

    // 1. Mandatory Active Dug Card Completion Bar (NO Cancel/Undo!)
    if (activeDugBarData) {
      return (
        <div className={containerClass}>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/75 bg-[#2a1a0d]/95 px-2.5 py-1 text-[11px] font-semibold text-amber-100 shadow-[0_4px_16px_rgba(245,158,11,0.3)] backdrop-blur-md">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 animate-pulse" />
            <span>
              Using {activeDugBarData.activeDug.card.label} — Pick matching card in hand to finish
            </span>
          </span>

          {activeDugBarData.digMerges.map((merge) => (
            <button
              key={merge.id}
              type="button"
              onClick={() => handleExecuteTableDigMerge(merge)}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/70 bg-[#2a1c11]/95 px-2.5 py-1 text-[11px] font-semibold text-amber-200 shadow-[0_4px_16px_rgba(245,158,11,0.28)] backdrop-blur-md transition-all duration-150 hover:border-amber-300 hover:bg-[#382516] active:scale-[0.97]"
            >
              Add {merge.dugCard.label} + {merge.targetItems.map((i) => i.card.label).join(' + ')} to{' '}
              {formatBuildRank(merge.targetValue)} Build
            </button>
          ))}

          {activeDugBarData.dugCaptures.map(({ card, option }) => (
            <button
              key={`${card.id}:${option.id}`}
              type="button"
              onClick={() => handleExecuteCapture(card, option)}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/60 bg-[#0e2a1d]/95 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 shadow-[0_4px_14px_rgba(16,185,129,0.22)] backdrop-blur-md transition-all duration-150 hover:border-emerald-300 hover:bg-[#133827] active:scale-[0.97]"
            >
              <span className="max-w-[220px] truncate">
                {activeDugBarData.targetItemId
                  ? `Capture w/ ${card.label}`
                  : `Capture ${formatCaptureTargetSummary(option)} w/ ${card.label}`}
              </span>
              {option.isSweep && (
                <span className="rounded-full border border-emerald-300/60 bg-emerald-500/25 px-1.5 py-0.2 text-[9px] font-bold tracking-wider text-emerald-100 uppercase">
                  SWEEP
                </span>
              )}
            </button>
          ))}

          {activeDugBarData.dugBuilds.map(({ card, option }) => {
            const { text, isKeep, isLocked } = getBuildPillLabel(option, card.rank);
            return (
              <button
                key={`${card.id}:${option.id}`}
                type="button"
                onClick={() => handleExecuteBuild(card, option)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md transition-all duration-150 active:scale-[0.97] ${
                  isKeep || isLocked
                    ? 'border-amber-400/65 bg-[#312011]/95 text-amber-100 shadow-[0_4px_14px_rgba(245,158,11,0.22)] hover:border-amber-300 hover:bg-[#3f2916]'
                    : 'border-[#c89d54]/55 bg-[#25180e]/95 text-[#f3dfb8] shadow-[0_4px_14px_rgba(200,157,84,0.18)] hover:border-[#dfc088] hover:bg-[#322114]'
                }`}
              >
                {isKeep && <Lock className="h-3 w-3 shrink-0 text-amber-300" />}
                <span>
                  {text} w/ {card.label}
                </span>
              </button>
            );
          })}
        </div>
      );
    }

    // 2. Table Combo Actions (multi-merge on own build or loose/staged + opponent uncemented build)
    if (tableComboState) {
      return (
        <div className={containerClass}>
          {tableComboState.looseMerges.map((merge) => (
            <button
              key={merge.id}
              type="button"
              onClick={() => handleExecuteLooseMerge(merge)}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/70 bg-[#2a1c11]/95 px-2.5 py-1 text-[11px] font-semibold text-amber-200 shadow-[0_4px_16px_rgba(245,158,11,0.28)] backdrop-blur-md transition-all duration-150 hover:border-amber-300 hover:bg-[#382516] active:scale-[0.97]"
            >
              Move {merge.targetItems.map((i) => i.card.label).join(' + ')} to{' '}
              {formatBuildRank(merge.targetValue)} Build
            </button>
          ))}

          {tableComboState.handCaptures.map(({ card, option }) => (
            <button
              key={`${card.id}:${option.id}`}
              type="button"
              onClick={() => handleExecuteCapture(card, option)}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/60 bg-[#0e2a1d]/95 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 shadow-[0_4px_14px_rgba(16,185,129,0.22)] backdrop-blur-md transition-all duration-150 hover:border-emerald-300 hover:bg-[#133827] active:scale-[0.97]"
            >
              <span>
                Capture w/ {card.label}
                {option.dugCapturedFromSeat != null ? ' + Dig' : ''}
              </span>
              {option.isSweep && (
                <span className="rounded-full border border-emerald-300/60 bg-emerald-500/25 px-1.5 py-0.2 text-[9px] font-bold tracking-wider text-emerald-100 uppercase">
                  SWEEP
                </span>
              )}
            </button>
          ))}

          {tableComboState.handBuilds.map(({ card, option }) => {
            const { text, isKeep, isLocked } = getBuildPillLabel(option, card.rank);
            return (
              <button
                key={`${card.id}:${option.id}`}
                type="button"
                onClick={() => handleExecuteBuild(card, option)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md transition-all duration-150 active:scale-[0.97] ${
                  isKeep || isLocked
                    ? 'border-amber-400/65 bg-[#312011]/95 text-amber-100 shadow-[0_4px_14px_rgba(245,158,11,0.22)] hover:border-amber-300 hover:bg-[#3f2916]'
                    : 'border-[#c89d54]/55 bg-[#25180e]/95 text-[#f3dfb8] shadow-[0_4px_14px_rgba(200,157,84,0.18)] hover:border-[#dfc088] hover:bg-[#322114]'
                }`}
              >
                {isKeep && <Lock className="h-3 w-3 shrink-0 text-amber-300" />}
                <span>
                  {text} w/ {card.label}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setTableComboState(null)}
            aria-label="Cancel action"
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-[#1c130d]/90 text-stone-300 shadow-sm backdrop-blur-md transition-colors hover:border-[#c89d54]/50 hover:bg-[#2a1d14] hover:text-white active:scale-[0.95]"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      );
    }

    // 3. Staged Loose Card Stack Actions
    if (stagedGroupActionData) {
      return (
        <div className={containerClass}>
          {stagedGroupActionData.looseMerges.map((merge) => (
            <button
              key={merge.id}
              type="button"
              onClick={() => handleExecuteLooseMerge(merge)}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/70 bg-[#2a1c11]/95 px-2.5 py-1 text-[11px] font-semibold text-amber-200 shadow-[0_4px_16px_rgba(245,158,11,0.28)] backdrop-blur-md transition-all duration-150 hover:border-amber-300 hover:bg-[#382516] active:scale-[0.97]"
            >
              Add to {formatBuildRank(merge.targetValue)} Build
            </button>
          ))}

          {stagedGroupActionData.handCaptures.map(({ card, option }) => (
            <button
              key={`${card.id}:${option.id}`}
              type="button"
              onClick={() => handleExecuteCapture(card, option)}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/60 bg-[#0e2a1d]/95 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 shadow-[0_4px_14px_rgba(16,185,129,0.22)] backdrop-blur-md transition-all duration-150 hover:border-emerald-300 hover:bg-[#133827] active:scale-[0.97]"
            >
              <span>
                Capture w/ {card.label}
                {option.dugCapturedFromSeat != null ? ' + Dig' : ''}
              </span>
              {option.isSweep && (
                <span className="rounded-full border border-emerald-300/60 bg-emerald-500/25 px-1.5 py-0.2 text-[9px] font-bold tracking-wider text-emerald-100 uppercase">
                  SWEEP
                </span>
              )}
            </button>
          ))}

          {stagedGroupActionData.handBuilds.map(({ card, option }) => {
            const { text, isKeep, isLocked } = getBuildPillLabel(option, card.rank);
            return (
              <button
                key={`${card.id}:${option.id}`}
                type="button"
                onClick={() => handleExecuteBuild(card, option)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md transition-all duration-150 active:scale-[0.97] ${
                  isKeep || isLocked
                    ? 'border-amber-400/65 bg-[#312011]/95 text-amber-100 shadow-[0_4px_14px_rgba(245,158,11,0.22)] hover:border-amber-300 hover:bg-[#3f2916]'
                    : 'border-[#c89d54]/55 bg-[#25180e]/95 text-[#f3dfb8] shadow-[0_4px_14px_rgba(200,157,84,0.18)] hover:border-[#dfc088] hover:bg-[#322114]'
                }`}
              >
                {isKeep && <Lock className="h-3 w-3 shrink-0 text-amber-300" />}
                <span>
                  {text} w/ {card.label}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setStagedTableGroup(null)}
            title="Unstack cards"
            aria-label="Unstack staged cards"
            className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-[#1c130d]/90 px-2 py-1 text-[11px] font-semibold text-stone-300 shadow-sm backdrop-blur-md transition-colors hover:border-[#c89d54]/50 hover:bg-[#2a1d14] hover:text-white active:scale-[0.95]"
          >
            <X className="h-3 w-3" />
            <span>Unstack</span>
          </button>
        </div>
      );
    }

    // 4. Standard Inline Hand / Deck Actions
    if (inlineActionData) {
      return (
        <div className={containerClass}>
          {inlineActionData.captures.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => handleExecuteCapture(inlineActionData.card, option)}
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
                onClick={() => handleExecuteBuild(inlineActionData.card, option)}
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
      );
    }

    return null;
  };

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
      <main ref={mainRef} className="relative flex-1 overflow-hidden">
        {/* 60fps Canvas Table Layer (Baize, Walnut Rail, Drag Arc, Shockwaves) */}
        <TableCanvas
          shuffleTriggerKey={shuffleTriggerKey}
          roundDealTriggerKey={roundDealTriggerKey}
          capturePulseKey={capturePulseKey}
          sweepTriggerKey={sweepTriggerKey}
          captureFlightEvent={captureFlightEvent}
          activeDragPoint={
            activeTetherDrag
              ? { x: activeTetherDrag.clientX, y: activeTetherDrag.clientY }
              : null
          }
          handOriginPoint={
            activeTetherDrag
              ? { x: activeTetherDrag.originX, y: activeTetherDrag.originY }
              : null
          }
        />

        {/* Peripheral Opponent & Partner Seats */}
        <PeripheralOpponents
          view={viewerView}
          activeSeat={viewerView.currentTurnSeat}
          diggableSeats={diggableSeats}
          onClickDigSeat={handleClickDigSeat}
          onDragStartDigSeat={handleDragStartDigSeat}
          onDragMoveDigSeat={handleDragMoveDigSeat}
          onDragEndDigSeat={handleDragEndDigSeat}
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
                      hasSelectedHandCard={Boolean(selectedCardId || viewerView.activeDugCard)}
                      highlightMode={highlightMode}
                      compact={compactBuilds}
                      onSelectBuild={() => handleSelectTableItem(item)}
                      dataDropId={item.id}
                    />
                  );
                }

                // Hide non-anchor members of a staged table stack while stacked
                if (
                  stagedTableGroup &&
                  stagedTableGroup.itemIds.includes(item.id) &&
                  item.id !== stagedTableGroup.anchorId
                ) {
                  return null;
                }

                // Render staged bundle (sorted smaller-on-larger with floating sum above)
                if (stagedTableGroup && stagedTableGroup.anchorId === item.id) {
                  const stagedItems = stagedTableGroup.itemIds
                    .map((id) =>
                      viewerView.table.find(
                        (it): it is TableLooseCard => it.kind === 'loose' && it.id === id
                      )
                    )
                    .filter((it): it is TableLooseCard => Boolean(it));

                  if (stagedItems.length >= 2) {
                    const sortedStagedCards = sortComponentDesc(
                      stagedItems.map((it) => it.card)
                    );
                    const stagedSum = sortedStagedCards.reduce(
                      (acc, c) => acc + c.rank,
                      0
                    );
                    const isDraggingStaged = stagedDragState !== null;

                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        data-table-item-id={item.id}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setStagedTableGroup(null);
                          }
                        }}
                        onPointerDown={(e) =>
                          handleTablePointerDown(e, item, {
                            itemIds: stagedItems.map((it) => it.id),
                            cards: sortedStagedCards,
                          })
                        }
                        onPointerMove={handleTablePointerMove}
                        onPointerUp={(e) => finishTablePointer(e, false)}
                        onPointerCancel={(e) => finishTablePointer(e, true)}
                        className={`group relative flex flex-col items-center touch-none select-none rounded-[8px] transition-opacity duration-150 focus:outline-none ${
                          isMyTurn && viewerView.activeDugCard === null
                            ? 'cursor-grab active:cursor-grabbing'
                            : 'cursor-pointer'
                        } ${isDraggingStaged ? 'opacity-30' : 'opacity-100'}`}
                        aria-label={`Staged cards summing to ${stagedSum}`}
                      >
                        <div
                          className={`mb-1 flex items-center justify-center gap-1 font-mono-num font-extrabold leading-none tracking-tight text-amber-200 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)] ${
                            compactBuilds ? 'text-sm' : 'text-base'
                          }`}
                        >
                          <span>{formatBuildRank(stagedSum)}</span>
                        </div>
                        <div
                          className="relative"
                          style={{
                            width: looseCardDims.width,
                            height: looseCardDims.height,
                          }}
                        >
                          {sortedStagedCards.map((card, idx) => {
                            const distanceFromTop = sortedStagedCards.length - 1 - idx;
                            const tx = -distanceFromTop * 4;
                            const ty = distanceFromTop * 3.5;
                            const isTopCard = distanceFromTop === 0;
                            return (
                              <div
                                key={card.id}
                                className="absolute left-0 top-0 transition-transform duration-150 ease-out"
                                style={{
                                  transform: `translate3d(${tx}px, ${ty}px, 0)`,
                                  zIndex: idx + 1,
                                }}
                              >
                                <CardSvg
                                  card={card}
                                  faceUp
                                  size={looseCardSize}
                                  selected={isTopCard && isTargeted}
                                  highlighted={isTopCard ? highlightMode ?? 'build' : null}
                                  className={
                                    isTopCard
                                      ? 'shadow-[0_8px_20px_rgba(0,0,0,0.52)]'
                                      : 'shadow-[0_2px_6px_rgba(0,0,0,0.35)]'
                                  }
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }
                }

                const isDraggingThis = tableDragState?.sourceItem.id === item.id;
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
                    onClick={() => {
                      if (suppressNextTableClickRef.current) {
                        suppressNextTableClickRef.current = false;
                        return;
                      }
                      handleSelectTableItem(item);
                    }}
                    onPointerDown={(e) => handleTablePointerDown(e, item)}
                    onPointerMove={handleTablePointerMove}
                    onPointerUp={(e) => finishTablePointer(e, false)}
                    onPointerCancel={(e) => finishTablePointer(e, true)}
                    className={`group relative touch-none select-none rounded-[8px] transition-[transform,opacity] duration-150 ease-out focus:outline-none ${
                      isMyTurn && viewerView.activeDugCard === null
                        ? 'cursor-grab active:cursor-grabbing'
                        : 'cursor-pointer'
                    } ${isDraggingThis ? 'opacity-30' : 'opacity-100'}`}
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

        {/* Anchored Floating Action Buttons Right On/Next to Target Card, Build, or Deck */}
        {isAnchoredBarVisible && anchorCoords && (
          <div
            className="pointer-events-auto absolute z-40"
            style={{
              left: anchorCoords.x,
              top: anchorCoords.y,
              transform: anchorPlaceBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
            }}
          >
            {renderFloatingActionPills(true)}
          </div>
        )}

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
          {/* 4-Second Cancel Timer Pill (only for reversible hand moves; never for dug cards or loose merges) */}
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

          {/* Non-Anchored Move Pill Buttons Above Hand Fan */}
          {!anchorSelector && renderFloatingActionPills(false)}

          {!inlineActionData &&
            !activeDugBarData &&
            !stagedGroupActionData &&
            !tableComboState &&
            isMyTurn &&
            tableDigMerges.length > 0 && (
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
            className="pointer-events-none absolute left-1/2 top-4 z-[45] -translate-x-1/2 rounded-xl border border-amber-400/50 bg-[#29170c]/95 px-4 py-2 text-xs font-medium text-amber-100 shadow-lg backdrop-blur-md"
          >
            {errorToast}
          </div>
        )}
      </main>

      {/* Floating Drag Ghost Following Pointer (Hand Card, Loose Table Card, or Dug Card) */}
      {(dragState || tableDragState || digDragState) && (
        <div
          className="pointer-events-none fixed left-0 top-0 z-50"
          style={{
            transform: `translate3d(${
              (dragState ?? tableDragState ?? digDragState)!.clientX - 44
            }px, ${
              (dragState ?? tableDragState ?? digDragState)!.clientY - 62
            }px, 0) rotate(-4deg) scale(1.06)`,
          }}
        >
          <CardSvg
            card={
              dragState
                ? dragState.card
                : tableDragState
                  ? tableDragState.sourceItem.card
                  : digDragState!.card
            }
            faceUp
            size={dragState ? 'md' : tableDragState ? looseCardSize : 'sm'}
            selected
            className="shadow-[0_22px_48px_rgba(0,0,0,0.72)]"
          />
        </div>
      )}

      {/* Floating Drag Ghost for Staged Loose Card Stack */}
      {stagedDragState && (
        <div
          className="pointer-events-none fixed left-0 top-0 z-50"
          style={{
            transform: `translate3d(${
              stagedDragState.clientX - looseCardDims.width * 0.5
            }px, ${
              stagedDragState.clientY - looseCardDims.height * 0.5
            }px, 0) rotate(-3deg) scale(1.06)`,
          }}
        >
          <div
            className="relative"
            style={{ width: looseCardDims.width, height: looseCardDims.height }}
          >
            {stagedDragState.cards.map((card, idx) => {
              const distanceFromTop = stagedDragState.cards.length - 1 - idx;
              return (
                <div
                  key={card.id}
                  className="absolute left-0 top-0"
                  style={{
                    transform: `translate3d(${-distanceFromTop * 4}px, ${
                      distanceFromTop * 3.5
                    }px, 0)`,
                    zIndex: idx + 1,
                  }}
                >
                  <CardSvg
                    card={card}
                    faceUp
                    size={looseCardSize}
                    selected={distanceFromTop === 0}
                    className="shadow-[0_22px_48px_rgba(0,0,0,0.72)]"
                  />
                </div>
              );
            })}
          </div>
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
