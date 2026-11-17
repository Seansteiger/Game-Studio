/**
 * Generic serializable turn-based state machine contract designed
 * to run locally or plug into Supabase Realtime / WebSockets.
 */

export interface GameAction<TType extends string = string, TPayload = unknown> {
  readonly type: TType;
  readonly playerSeat: number;
  readonly payload: TPayload;
  readonly timestamp?: number;
}

export interface VisualEvent<TType extends string = string, TData = unknown> {
  readonly id: string;
  readonly type: TType;
  readonly data: TData;
}

export interface ReducerOutcome<TState, TEvent extends VisualEvent = VisualEvent> {
  readonly state: TState;
  readonly events: readonly TEvent[];
  readonly error?: string;
}

export interface TurnEngineDefinition<
  TConfig,
  TState,
  TAction extends GameAction,
  TPlayerView,
  TEvent extends VisualEvent = VisualEvent,
> {
  readonly gameId: string;
  setup(config: TConfig): TState;
  reducer(state: TState, action: TAction): ReducerOutcome<TState, TEvent>;
  getPlayerView(state: TState, viewerSeat: number): TPlayerView;
}
