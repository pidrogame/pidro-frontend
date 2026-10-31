import type { ReadinessSnapshot, SeatLifecycleSnapshot, ServerGameState } from '@pidro/shared';

/**
 * Every event the app sends to PostHog. Saved insights and the dashboard look
 * these names up, so a rename here is a rename there too (PID-311). The server
 * owns game_finished; the app never sends it.
 */
export const ANALYTICS_EVENTS = [
  'room_created',
  'room_joined',
  'invite_previewed',
  'invite_joined',
  'guest_created',
  'hand_started',
  'orientation_changed',
  'classic_entry_tapped',
  'guest_chosen',
  'claim_started',
  'claim_succeeded',
  'claim_failed',
  'classic_forgot_started',
  'table_wait_started',
  'table_wait_ended',
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];
export type Orientation = 'portrait' | 'landscape';

export const orientationOf = (width: number, height: number): Orientation =>
  width > height ? 'landscape' : 'portrait';

const HAND_PHASES = new Set([
  'dealing',
  'bidding',
  'declaring',
  'declaring_trump',
  'trump_declaration',
  'discarding',
  'second_deal',
  'playing',
]);

/** A hand in play, told apart from the same number in a rematch; null between hands. */
export function handKey(state: ServerGameState | null): string | null {
  if (!state || typeof state.hand_number !== 'number' || !HAND_PHASES.has(state.phase)) return null;
  return `${state.game_instance_id ?? ''}:${state.hand_number}`;
}

// The last hand seen at each table outlives the screen, so a rejoin into the
// same hand is not a new one.
const handsSeen = new Map<string, string>();

export function firstSightOfHand(roomCode: string, key: string): boolean {
  if (handsSeen.get(roomCode) === key) return false;
  handsSeen.set(roomCode, key);
  return true;
}

/**
 * Reports an orientation only once it has held for `delayMs`, so a phone
 * tilting on a table, or a rotation and back, sends nothing.
 */
export function settleOrientation(
  initial: Orientation,
  delayMs: number,
  onChange: (from: Orientation, to: Orientation) => void
) {
  let settled = initial;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    update(next: Orientation) {
      clearTimeout(timer);
      if (next === settled) return;
      timer = setTimeout(() => {
        const from = settled;
        settled = next;
        onChange(from, next);
      }, delayMs);
    },
    cancel: () => clearTimeout(timer),
  };
}

/** Open seats and bots at a waiting table, from its readiness snapshot. */
export function seatCounts(readiness: ReadinessSnapshot | null) {
  const seats = Object.values(readiness?.seats ?? {});
  return {
    vacant: seats.filter((seat) => seat.occupant_type === 'vacant').length,
    bots: seats.filter((seat) => seat.occupant_type === 'bot').length,
  };
}

/** A bot holds a seat, whether it sat down with the table or stands in for a player. */
export function hasBots(
  readiness: ReadinessSnapshot | null,
  lifecycle: SeatLifecycleSnapshot | null
) {
  return (
    seatCounts(readiness).bots > 0 ||
    Object.values(lifecycle?.seats ?? {}).some(
      (seat) => seat.status === 'bot_substitute' || seat.status === 'permanent_bot'
    )
  );
}

export type TableWait = { since: number; bots: number };
export type TableWaitOutcome = 'game_started' | 'left' | 'bots_added';

/**
 * A seated player waits from the moment their table is not full until the game
 * starts or they go: leaving, being moved off the seat, or the app going to the
 * background. A closed channel clears the seat until it rejoins, which is not
 * leaving; the socket also pauses in the background, so that exit counts
 * while unjoined. A game that starts with more bots than the wait began with
 * was filled by bots.
 */
export function nextTableWait(
  wait: TableWait | null,
  table: {
    seated: boolean;
    joined: boolean;
    background: boolean;
    waiting: boolean;
    started: boolean;
    vacant: number;
    bots: number;
  },
  now: number
): {
  wait: TableWait | null;
  started?: boolean;
  ended?: { wait_seconds: number; outcome: TableWaitOutcome };
} {
  if (!table.joined && !table.background) return { wait };
  const seated = table.seated && !table.background;
  if (!wait) {
    return seated && table.waiting && table.vacant > 0
      ? { wait: { since: now, bots: table.bots }, started: true }
      : { wait: null };
  }
  const outcome: TableWaitOutcome | null = !seated
    ? 'left'
    : table.started
      ? table.bots > wait.bots
        ? 'bots_added'
        : 'game_started'
      : null;
  if (!outcome) return { wait };
  return { wait: null, ended: { wait_seconds: Math.round((now - wait.since) / 1000), outcome } };
}

// Field errors come back as the field's name; everything else as an UPPER_SNAKE code.
const FIELD_CODES = new Set(['email', 'password', 'username']);

/** A failed claim says how and which code, never a message or what the player typed. */
export function claimFailure(method: string, code: unknown) {
  const known =
    typeof code === 'string' && (FIELD_CODES.has(code) || /^[A-Z][A-Z0-9_]{1,47}$/.test(code));
  return { method, error_code: known ? code : 'unknown' };
}
