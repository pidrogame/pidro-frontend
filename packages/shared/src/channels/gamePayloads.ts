import type {
  ActiveTurnTimer,
  Card,
  DealerRobPresentation,
  GamePresentation,
  GamePhase,
  LegalAction,
  ServerGameState,
  ServerTurnTimerPayload,
} from '../types/game';
import type { Position } from '../types/lobby';

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isPosition(value: unknown): value is Position {
  return value === 'north' || value === 'east' || value === 'south' || value === 'west';
}

function isCard(value: unknown): value is Card {
  if (!value || typeof value !== 'object') return false;
  const card = value as Partial<Card>;
  return (
    Number.isInteger(card.rank) &&
    card.rank! >= 2 &&
    card.rank! <= 14 &&
    (card.suit === 'hearts' ||
      card.suit === 'diamonds' ||
      card.suit === 'clubs' ||
      card.suit === 'spades')
  );
}

function isCardArray(value: unknown): value is Card[] {
  return Array.isArray(value) && value.every(isCard);
}

function parseDealerRob(value: unknown): DealerRobPresentation | null {
  if (!value || typeof value !== 'object') return null;
  const rob = value as Record<string, unknown>;
  if (
    !isPosition(rob.dealer) ||
    typeof rob.automatic !== 'boolean' ||
    asNumber(rob.started_at_ms) == null ||
    asNumber(rob.ends_at_ms) == null
  ) {
    return null;
  }

  const cardFields = ['pool', 'kept', 'discarded'] as const;
  if (cardFields.some((field) => field in rob && !isCardArray(rob[field]))) return null;

  return rob as unknown as DealerRobPresentation;
}

export function normalizeTurnTimer(payload: unknown): ActiveTurnTimer | null {
  if (!payload || typeof payload !== 'object') return null;

  const data = payload as Partial<ServerTurnTimerPayload>;
  const timerId = asNumber(data.timer_id);
  const durationMs = asNumber(data.duration_ms);
  const transitionDelayMs = asNumber(data.transition_delay_ms);
  const eventSeq = asNumber(data.event_seq);

  if (
    timerId == null ||
    durationMs == null ||
    transitionDelayMs == null ||
    eventSeq == null ||
    (data.scope !== 'seat' && data.scope !== 'room') ||
    typeof data.phase !== 'string'
  ) {
    return null;
  }

  const remainingMs = asNumber(data.remaining_ms) ?? durationMs + transitionDelayMs;

  return {
    timerId,
    scope: data.scope,
    position: (data.position as Position | null | undefined) ?? null,
    phase: data.phase as GamePhase,
    durationMs,
    transitionDelayMs,
    serverTime: typeof data.server_time === 'string' ? data.server_time : new Date().toISOString(),
    remainingMs,
    receivedAtMs: Date.now(),
    eventSeq,
  };
}

export function describeGameAction(action: Record<string, unknown> | undefined): string {
  switch (action?.type) {
    case 'pass':
      return 'passed';
    case 'bid':
      return `bid ${String(action.amount ?? '')}`.trim();
    case 'declare_trump':
      return `declared ${String(action.suit ?? 'trump')}`;
    case 'play_card':
      return 'played a card';
    case 'select_hand':
      return 'selected a hand';
    case 'select_dealer':
      return 'selected the dealer';
    default:
      return 'acted';
  }
}

export function extractGameState(
  data: Record<string, unknown> | undefined,
): ServerGameState | null {
  if (!data) return null;

  const nestedData =
    data.data && typeof data.data === 'object' ? (data.data as Record<string, unknown>) : undefined;
  const candidates = [data.state, data.game_state, nestedData?.game_state, nestedData?.state, data];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && 'phase' in candidate) {
      const delay = asNumber(data.transition_delay_ms ?? nestedData?.transition_delay_ms);
      const state = delay != null && delay >= 0
        ? { ...(candidate as ServerGameState), transition_delay_ms: delay }
        : (candidate as ServerGameState);
      const instance = data.game_instance_id ?? nestedData?.game_instance_id;
      const revision = data.state_revision ?? nestedData?.state_revision;
      const turn = data.turn_event_seq ?? nestedData?.turn_event_seq;
      // Cursor metadata is beside `state` in channel snapshots, never in the engine state.
      return typeof instance === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(instance) &&
        typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0
        ? {
            ...state,
            game_instance_id: instance,
            state_revision: revision,
            ...(typeof turn === 'number' && Number.isSafeInteger(turn) && turn >= 0
              ? { turn_event_seq: turn }
              : {}),
          }
        : state;
    }
  }

  return null;
}

export function extractGamePresentation(
  data: Record<string, unknown> | undefined,
): GamePresentation | null {
  if (!data?.presentation || typeof data.presentation !== 'object') return null;
  const presentation = data.presentation as Record<string, unknown>;

  if (presentation.dealer_selection != null) {
    if (typeof presentation.dealer_selection !== 'object') return null;
    const selection = presentation.dealer_selection as Record<string, unknown>;
    if (asNumber(selection.started_at_ms) == null || asNumber(selection.ends_at_ms) == null) {
      return null;
    }
  }

  if (presentation.dealer_rob != null && !parseDealerRob(presentation.dealer_rob)) return null;
  return presentation as GamePresentation;
}

export function shouldAutoSelectDealer(
  gameState: ServerGameState,
  legalActions: LegalAction[],
  position: Position | null,
): boolean {
  return (
    position === 'north' &&
    gameState.phase === 'dealer_selection' &&
    !gameState.dealer_selection_cuts &&
    legalActions.some((action) => action.type === 'select_dealer')
  );
}
