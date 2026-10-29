export const DEAL_CARD_STAGGER_MS = 70;
export const DEAL_CARD_TRAVEL_MS = 460;
export const DEAL_ACTION_REVEAL_BUFFER_MS = 100;
export const HAND_PRESENTATION_TIMEOUT_MS = 2_000;

/** All remaining cards fold together, without a per-card stagger. */
export const FOLD_FLIGHT_MS = 360;

export const PLAY_CARD_TRAVEL_MS = 340;
// A bounded overshoot settles on the same deadline as the turn light.
export const PLAY_CARD_CURVE = [0.22, 0.8, 0.3, 1.06] as const;
export const PLAY_CARD_LIFT = 0.12;
export const OPPONENT_CARD_LIFT = 0.055;
export const PLAY_CARD_LIFT_MS = 70;
export const PLAY_CARD_LIFT_CURVE = [0.2, 0.8, 0.3, 1] as const;
export const PLAY_CARD_SCALE = 1.06;
export const OPPONENT_CARD_SCALE = 1.025;
export const HAND_CLOSE_SPRING = { stiffness: 260, damping: 29, mass: 0.8 } as const;
// Off pending a team decision on how a finished trick leaves the table.
export const TRICK_SWEEP_ENABLED = false;
export const TRICK_GATHER_MS = 100;
export const TRICK_SWEEP_MS = 220;
export const TRICK_GATHER_PROGRESS = 0.3;
export const TRICK_GATHER_CURVE = [0.2, 0.65, 0.3, 1] as const;
export const TRICK_SWEEP_CURVE = [0.4, 0, 0.75, 1] as const;
export const TRICK_SWEEP_SCALE = 0.8;
export const PLAY_CONFIRM_TIMEOUT_MS = 5_000;
// Older snapshots without transition metadata.
export const TRICK_TRANSITION_MS = 1_500;

// Twelve little packets, rather than 36 individual throws. The last packet
// settles before the player gets a beat to read their hand and then sort it.
export const DEAL_PACKET_INTERVAL_MS = 260;
export const DEAL_PACKET_CARD_STAGGER_MS = 24;
export const DEAL_PACKET_TRAVEL_MS = 300;
export const DEAL_SORT_PAUSE_MS = 2 * DEAL_PACKET_CARD_STAGGER_MS + DEAL_PACKET_TRAVEL_MS + 240;
export const DEAL_SORT_DURATION_MS = 560;

export const CUT_CARD_STAGGER_MS = 620;
export const CUT_CARD_TRAVEL_MS = 520;
export const CUT_WINNER_PAUSE_MS = 900;

const CLOCKWISE = ['north', 'east', 'south', 'west'] as const;
type Seat = (typeof CLOCKWISE)[number];

export function dealtCardCounts(dealer: Seat, packets: number): Record<Seat, number> {
  const counts = { north: 0, east: 0, south: 0, west: 0 };
  const start = CLOCKWISE.indexOf(dealer) + 1;
  for (let packet = 0; packet < Math.min(12, packets); packet++) {
    counts[CLOCKWISE[(start + packet) % 4]] += 3;
  }
  return counts;
}

export function dealAnimationDurationMs(cardCount: number): number {
  if (cardCount <= 0) return 0;
  return (cardCount - 1) * DEAL_CARD_STAGGER_MS + DEAL_CARD_TRAVEL_MS;
}

// The second deal at Classic's pace (from a recording of it): after trump,
// each player in turn from the dealer's left throws their non-trumps face
// down in front of them; the piles stay long enough to count; they clear;
// the dealer gives each player their cards one at a time; the dealer takes
// the rest unseen. One object so the fixture's tuner can change it live;
// the server's second_deal_transition_delay_ms holds play for as long.
export const secondDealTiming = {
  /** Before the first throw. */
  startMs: 400,
  /** Between one player's throw and the next. */
  throwGapMs: 550,
  /** The piles on the felt, to count, after the last throw. */
  holdMs: 3_000,
  /** The piles clear and the pack lands in its corner. */
  packMs: 500,
  /** Between one dealt card and the next. */
  cardMs: 230,
  /** Between one player's cards and the next player's. */
  seatGapMs: 250,
  /** The rest of the pack to the dealer, then the hands settle. */
  robMs: 700,
  /** The dealer's throw on the felt, to count, after everyone else's (PID-306). */
  dealerHoldMs: 2_000,
};
export type SecondDealTiming = typeof secondDealTiming;
export const SECOND_DEAL_DEFAULTS: SecondDealTiming = { ...secondDealTiming };
/** Dev tuning only: change the live timing, or put the defaults back. */
export function setSecondDealTiming(next: Partial<SecondDealTiming>) {
  Object.assign(secondDealTiming, next);
}
export function resetSecondDealTiming() {
  Object.assign(secondDealTiming, SECOND_DEAL_DEFAULTS);
}

/** How long the whole second deal plays, for `n` cards dealt. */
export function secondDealDurationMs(dealt: number, timing: SecondDealTiming = secondDealTiming) {
  return (
    timing.startMs +
    2 * timing.throwGapMs +
    timing.holdMs +
    timing.packMs +
    dealt * timing.cardMs +
    2 * timing.seatGapMs +
    timing.robMs +
    timing.dealerHoldMs
  );
}
/** Killed trumps lie face up at the start of play this long, or until the first card lands (PID-306). */
export const KILLED_SHOW_MS = 3_000;
/** Cards in one swoop leave a hair apart, so it reads as a handful. */
export const SECOND_DEAL_SWOOP_STAGGER_MS = 35;
/** A thrown or dealt card's flight. */
export const SECOND_DEAL_FLIGHT_MS = 300;
/** What is left of the deck once everyone holds nine. */
export const SECOND_DEAL_PACK = 52 - 36;
