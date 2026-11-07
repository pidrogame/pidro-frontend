/**
 * Table layout system. Two layers:
 *  1) pickProfile() — discrete archetype from orientation × device class (web = tablet).
 *  2) computeLayout() — fluid positions within a profile (anchored regions + clamped card size).
 * Pure functions of (width, height, insets): recompute on resize or rotate, and tween to the new slots.
 */
import type { RelativePosition } from '@/types/game';

export type { RelativePosition };

export type Profile = 'phone-portrait' | 'phone-landscape' | 'tablet-portrait' | 'tablet-landscape';
export type Insets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type Seat = {
  x: number;
  y: number;
  rot: number;
  hand: { x: number; y: number };
};
export type TableLayout = {
  width: number;
  height: number;
  profile: Profile;
  cardW: number;
  cardH: number;
  felt: { cx: number; cy: number };
  /**
   * Short phones: smaller avatars without level chips, every other name beside
   * its avatar, and only your avatar and its short line under your hand.
   */
  tight: boolean;
  /**
   * `pileScale`: how large played cards are drawn around the circle.
   * `across`: how far out East's and West's lie, on upright phones past it (PID-333).
   */
  trick: { cx: number; cy: number; r: number; pileScale: number; across: number };
  /**
   * Landscape phones only (PID-305, PID-307): where each seat's played card
   * and thrown cards land, on Classic's cross around the trump mark. `band`
   * is how far East's and West's cards may run down their column, clear of
   * their seat above and yours below.
   */
  front?: Record<RelativePosition, { x: number; y: number }>;
  band?: { top: number; bottom: number };
  /**
   * Landscape phones with room beside the side stacks: East's and West's
   * names run under their avatars, beside their backs (PID-308).
   */
  sidesUnder?: boolean;
  /** How wide those side seats are. */
  sideSeatWidth?: number;
  /**
   * Vertical center of the east and west card-back stacks. Upright phones
   * (PID-393): `seat` is the center of their avatars, `reach` how tall their
   * stacks draw.
   */
  sides: { cy: number; seat?: number; reach?: number };
  seats: Record<RelativePosition, Seat>;
  hand: { cx: number; cy: number; maxWidth: number };
  /** The table's top edge: under the safe top and, upright, the header row. */
  top: number;
  /** The safe-area insets it was laid out in. */
  insets: Insets;
  /** The table's lowest edge: above the home indicator. */
  bottom: number;
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const CARD_RATIO = 110 / 78; // from the legacy card art (spike)
/**
 * Landscape lowers the side stacks below the trick's center line: the side
 * seats sit on top of them, under the header row, and need air between.
 */
const LANDSCAPE_SIDE_DROP = 16;
/**
 * iPads upright lower East and West a little below the trick's center line,
 * as a share of a card's height, so the three other players stop reading as
 * one row across the top. Only as far as the hand allows; their backs stay in
 * full view below them, so they can still be counted.
 */
const PORTRAIT_SIDE_DROP = 0.45;
/**
 * Upright phones (PID-393): the least step between East's or West's backs, as
 * a share of a back, at which six still count at a glance. A stack closes to
 * it before its seat rises.
 */
const SIDE_STACK_LEAST = 0.3;
/**
 * Portrait North, top to bottom, as SeatLayer draws it: a gap, the fan of
 * backs, a gap, then the seat (avatar, level chip, name and status).
 */
const NORTH_SEAT_STACK = { phone: 98, tablet: 115 } as const;
/** A landscape phone's side seat, as SeatLayer stacks it: avatar, level chip, name and status. */
const LANDSCAPE_SIDE_SEAT = 93;
/** One of North's card backs, as SeatLayer draws them. */
// Opponents' backs are big enough to count at a glance: veterans read the
// second deal off them (how many each drew), not just that cards are there.
export const northBackWidth = (cardW: number, compact = false) =>
  compact ? sideBackWidth(cardW) : clamp(cardW * 0.8, 36, 68);
/**
 * Landscape phones keep North's smaller fan, a step below the faces like the
 * side stacks: its row is shared with the name, chip and menu.
 */
export const compactNorth = (L: Pick<TableLayout, 'profile'>) => L.profile === 'phone-landscape';
/**
 * Talk's speech bubble in a landscape phone's corner, and 8pt of air: TALK_ROW
 * wide, PidroSpacing.sm from the edge (GameCanvasTable).
 */
const TALK_CORNER = 12 + 52 + 8;
/** Between a landscape phone's pack and your turn ring, and that ring and your avatar. */
const PACK_AIR = 8;
/** What is left of the deck once everyone holds nine, as `SECOND_DEAL_PACK`. */
const PACK_REST = 52 - 36;
/**
 * The backs a pack of `count` draws: one a card up to the sixteen left for the
 * second deal, then one for every six more, so the first deal's pack thins too.
 */
export const packLayers = (count: number) =>
  Math.min(count, PACK_REST) + Math.ceil(Math.max(0, count - PACK_REST) / 6);
/** Each back in the pack lies this far above the one under it, as a share of its width, and about half that to the right. */
export const PACK_STEP = 0.016;
/** How far a pack of `count` rises above its bottom back. */
const packRise = (backW: number, count: number) => (packLayers(count) - 1) * backW * PACK_STEP;
/**
 * Where the dealer's pack lies, from the first card dealt to the rob
 * (PID-394): beside the dealer, so the deal says who deals. Its bottom back's
 * centre, and whether it lies sideways; the rest of it rises above, its backs
 * North's size. North's lies right of its full fan, its top back level with
 * the fan's; on landscape phones, where North's seat is there, left of it,
 * and on landscape tablets, whose ticker runs there, under North's seat.
 * East's and West's lie sideways, as their backs do, on the free side of
 * their seat: upright, above it, at the screen's edge; on landscape phones
 * under it, beside their backs; on landscape tablets, whose header row is
 * above them, under their backs. Upright, yours waits in the bottom-left
 * corner under the left end of your hand, the right one being talk's
 * (PID-393); where the table has no room for it there (the shortest phones),
 * it lies sideways.
 * Landscape phones keep it right of the hand, level with it, below East's
 * front row; what talk offers rises over it (`liftOverPack`). Where it would
 * reach talk's bubble in the corner (PID-396), it stands above the hand's
 * right end, short of East's backs (640 wide); where East's seat and its line
 * come down there, beside its backs (667 wide), it lies in the bottom-left
 * corner beside your seat, short of your turn ring. A landscape
 * iPad's talk column has that corner, and your name the room left of a full
 * hand: the pack stands above its left end.
 */
export function packSpot(L: TableLayout, dealer: RelativePosition) {
  const portrait = L.profile.endsWith('portrait');
  const compact = compactNorth(L);
  const w = northBackWidth(L.cardW, compact);
  const h = w * CARD_RATIO;
  const full = packRise(w, 52);
  if (dealer === 'north') {
    // The fan moves left on the narrowest landscape phones, never further than its full hand's.
    const fan = northFanWidth(L.cardW, FULL_HAND, compact);
    const cx = L.width / 2 - (portrait ? 0 : landscapeNorthShift(L, L.insets, FULL_HAND));
    const level = northFanTop(L, L.top) + packRise(w, PACK_REST) + h / 2;
    if (portrait) return { x: cx + fan / 2 + TRICK_GAP + w / 2, y: level, sideways: false };
    if (L.front)
      return { x: cx - fan / 2 - TRICK_GAP - full * 0.55 - w / 2, y: level, sideways: false };
    const seatBottom = L.top + 8 + AVATAR_SIZE[L.profile] + LEVEL_HANG;
    return {
      x: cx + fan / 2 + TRICK_GAP + w / 2,
      y: seatBottom + TRICK_GAP + full + h / 2,
      sideways: false,
    };
  }
  if (dealer === 'east' || dealer === 'west') {
    const east = dealer === 'east';
    const edge = east ? L.insets.right : L.insets.left;
    // Lying sideways, the pack is a back's height wide and leans right as it rises.
    const along = (inset: number) => (east ? L.width - inset - full * 0.55 - h / 2 : inset + h / 2);
    if (portrait) {
      const seatTop = sideSeatTop(L, {
        tableTop: L.top,
        seatHeight: L.tight
          ? TIGHT_AVATAR
          : NORTH_SEAT_STACK[L.profile.startsWith('tablet') ? 'tablet' : 'phone'],
        headerBottom: 0,
      });
      return { x: along(edge + 4), y: seatTop - BADGE_RISE - TRICK_GAP - w / 2, sideways: true };
    }
    if (L.front) {
      const seatBottom = L.sidesUnder
        ? landscapeSideSeatTop(L, dealer, LANDSCAPE_SIDE_SEAT) + LANDSCAPE_SIDE_SEAT
        : sideSeatTop(L, { tableTop: L.top, seatHeight: 0, headerBottom: 0 }) +
          AVATAR_SIZE[L.profile] +
          LEVEL_HANG;
      return {
        x: along(sideStackInner(L.cardW, edge) + SIDE_SEAT_GAP),
        y: seatBottom + TRICK_GAP + full + w / 2,
        sideways: true,
      };
    }
    const stacks = sideStacks(L);
    return {
      x: along(edge + 4),
      y: stacks.top + stacks.maxHeight + TRICK_GAP + full + w / 2,
      sideways: true,
    };
  }
  // Standing above your hand, short of a lifted card.
  const aboveHand =
    L.hand.cy - (L.cardH * handScale(L.profile)) / 2 - handLift(L) - TRICK_GAP - h / 2;
  if (L.profile === 'tablet-landscape')
    return { x: handLeft(L, FULL_HAND) + w / 2, y: aboveHand, sideways: false };
  if (!portrait) {
    const x = Math.min(L.hand.cx + L.hand.maxWidth / 2 + 8 + w / 2, L.width - w / 2 - 12);
    const y = Math.min(L.hand.cy, L.bottom - h / 2 - 4);
    if (x + w / 2 + full * 0.55 <= L.width - L.insets.right - TALK_CORNER)
      return { x, y, sideways: false };
    if (L.sidesUnder)
      return {
        x: L.insets.left + LANDSCAPE_SOUTH_LEFT - 2 * PACK_AIR - full * 0.55 - w / 2,
        y: L.bottom - h / 2 - 4,
        sideways: false,
      };
    return {
      x: Math.min(
        handRight(L, FULL_HAND) - w / 2,
        L.width - sideStackInner(L.cardW, L.insets.right) - TRICK_GAP - full * 0.55 - w / 2
      ),
      y: aboveHand,
      sideways: false,
    };
  }
  const left = L.hand.cx - L.hand.maxWidth / 2 - 8;
  const below = L.hand.cy + (L.cardH * handScale(L.profile)) / 2 + 10 + full;
  if (below + h + 4 <= L.bottom)
    return {
      x: Math.max(left + w / 2, L.insets.left + w / 2 + 12),
      y: below + h / 2,
      sideways: false,
    };
  return {
    x: Math.max(left + h / 2, L.insets.left + h / 2 + 4),
    y: L.bottom - 2 - w / 2,
    sideways: true,
  };
}
/**
 * On a landscape phone, how far the word card talk offers right of your hand
 * rises while your pack of `count` lies under it (PID-396): from talk's row,
 * whose bottom is at `rowBottom`, to just above the pack's top back.
 */
export function liftOverPack(L: TableLayout, count: number, rowBottom: number): number {
  const w = northBackWidth(L.cardW, compactNorth(L));
  const pack = packSpot(L, 'south');
  // Only the pack lying right of the hand, level with it, is under what talk shows.
  if (pack.x < L.hand.cx || pack.y + (w * CARD_RATIO) / 2 < L.hand.cy - L.cardH / 2) return 0;
  const top = pack.y - (w * CARD_RATIO) / 2 - packRise(w, count);
  return Math.max(0, rowBottom - top + 8);
}
/**
 * How a hand holds its cards. `still`: a dead straight row. `tilt`: each card
 * a touch off square, fixed by its seed so it never wobbles. `fan`: no chance
 * at all, each card turned a little more toward the ends on a shallow arc.
 */
export type HeldStyle = 'still' | 'tilt' | 'fan';
export const HELD_STYLE: HeldStyle = 'tilt';

/** A held card's pose: `tilt` in degrees, `dy` in points (down is +). `off` is its place from the middle of the hand. */
export function heldPose(
  style: HeldStyle,
  seed: string,
  off: number
): { tilt: number; dy: number } {
  if (style === 'fan') return { tilt: off * 1.1, dy: off * off * 0.5 };
  if (style === 'still') return { tilt: 0, dy: 0 };
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const a = ((h >>> 0) % 1000) / 500 - 1;
  const b = ((h >>> 10) % 1000) / 500 - 1;
  return { tilt: a * 0.7, dy: b };
}
/** East and West's backs, before they lie sideways. */
export const sideBackWidth = (cardW: number) => clamp(cardW * 0.7, 31, 62);
/**
 * How far in from the screen edge East's or West's stack reaches. It bleeds
 * past a bare edge, never into an `edge` inset (the Dynamic Island).
 */
export const sideStackInner = (cardW: number, edge: number) =>
  (edge > 0 ? edge : -Math.min(cardW * 0.28, 18)) + sideBackWidth(cardW) * CARD_RATIO;
/** Landscape phones: a side seat's distance in from its stack, the dealer chip on its corner included. */
export const SIDE_SEAT_GAP = 16;
/** North's fan of backs: each back after the first adds half a back, up to six. */
// The backs grew so they can be counted, and a full hand spreads a little
// wider than it did with smaller backs, as far as the table has room. Few
// cards (right after the second deal) spread to their full step; a full
// hand closes up to fit.
const legacyNorthBack = (cardW: number) => clamp(cardW * 0.66, 31, 58);
const legacySideBack = (cardW: number) => clamp(cardW * 0.62, 30, 56);
/** How much of each sideways back a full stack shows. */
const SIDE_ROOM = 0.56;
/** Points between backs in North's fan of `n`. */
export function northFanStep(cardW: number, n: number, compact = false) {
  const w = northBackWidth(cardW, compact);
  const room = legacyNorthBack(cardW) * (compact ? 0.52 : 0.62) * 5;
  return n > 1 ? Math.min(w * (compact ? 0.52 : 0.7), room / (n - 1)) : 0;
}
/** North's fan of backs, as wide as it draws. */
export const northFanWidth = (cardW: number, count: number, compact = false) =>
  northBackWidth(cardW, compact) + (Math.max(1, count) - 1) * northFanStep(cardW, count, compact);
/**
 * Points between sideways backs in East's or West's stack of `n`, drawn at
 * most `reach` tall (a tight stack squeezed between its seat and your hand).
 */
export function sideStackStep(cardW: number, n: number, reach = sideStackReach(cardW)) {
  const room = reach - sideBackWidth(cardW);
  return n > 1 ? Math.min(sideBackWidth(cardW) * 0.66, room / (n - 1)) : 0;
}
/**
 * Where North's backs start. Portrait hangs them under the header row;
 * landscape tablets tuck them partly above the table, under the floating
 * scores; landscape phones keep them whole along the top edge, to be counted,
 * and only on the shortest tables lift them past it, TRICK_GAP above North's
 * played card.
 */
export const northFanTop = (L: TableLayout, tableTop: number) =>
  L.profile.endsWith('portrait')
    ? tableTop + 8
    : L.front
      ? Math.min(
          tableTop + ROW_EDGE,
          L.front.north.y - L.cardH / 2 - TRICK_GAP - sideBackWidth(L.cardW) * CARD_RATIO
        )
      : tableTop - L.cardH * 0.36;
/** Landscape phones: between a hand row and the screen edge. */
const ROW_EDGE = 4;
/**
 * Landscape phones (PID-307): the least room between any two things on the
 * table, the trump mark, the played cards, the hands and the seats. Classic
 * leaves about as much.
 */
export const TRICK_GAP = 12;
/** The trump mark in the middle of the trick, as a share of a card's width. */
export const TRUMP_MARK = 0.7;
/** The hand's points over the trump mark (PID-332): digits about as tall as a card's corner rank, or larger. */
export const handPointsSize = (L: Pick<TableLayout, 'cardH'>) =>
  Math.round(Math.max(28, L.cardH * 0.34));
/**
 * How much of your hand a landscape phone shows at least, where the table is
 * too short for all of it: its rank, suit and the top of its art,
 * and never less than a 44pt tap target.
 */
const handShown = (cardH: number) => Math.max(44, cardH * 0.8);
/** The least of it: its rank and suit (the top 58% of the card art). */
const handLeast = (cardH: number) => Math.max(44, cardH * 0.62);
/** Below a landscape avatar, its level chip; above it, the winning bid's badge. */
const LEVEL_HANG = 9;
const BADGE_RISE = 3;

/** Portrait seat clearance, including its level chip, name and status line. */
export const northSeatBottom = (L: TableLayout, tableTop: number) =>
  northFanTop(L, tableTop) +
  northBackWidth(L.cardW, compactNorth(L)) * CARD_RATIO +
  12 +
  (L.tight ? TIGHT_AVATAR : NORTH_SEAT_STACK[L.profile.startsWith('tablet') ? 'tablet' : 'phone']);

/** How tall a full East or West stack draws. */
const sideStackReach = (cardW: number) =>
  sideBackWidth(cardW) + legacySideBack(cardW) * SIDE_ROOM * 5;

/** East and west's backs along the edges, up to six, as SeatLayer stacks them. */
export function sideStacks(L: TableLayout) {
  const backW = sideBackWidth(L.cardW);
  // Upright phones' stacks close up to fit under their seats (PID-393).
  const maxHeight = L.sides.reach ?? sideStackReach(L.cardW);
  // Portrait stacks follow the lowered side line, as do landscape phones'
  // under their seats; landscape tablet seats keep to the trick's line and
  // only their stacks drop (LANDSCAPE_SIDE_DROP).
  const top = (L.profile.endsWith('portrait') || L.front ? L.sides.cy : L.trick.cy) - maxHeight / 2;
  const handTop = L.hand.cy - L.cardH / 2;
  return { backW, maxHeight, top, lowestTop: Math.max(top, handTop - 12 - maxHeight) };
}

/**
 * Where East and West's seats start: above their stacks. Upright phones seat
 * them low, beside the trick (`L.sides.seat`, PID-393). iPads upright keep
 * the opponents a triangle: a step below North, the stacks moving down under
 * them as far as the hand allows. Landscape seats never rise into the
 * header row; on phones they sit under it and under North's seat, at the
 * inner top corner of their stack. `seatHeight` is the seat drawn above the stack.
 */
export function sideSeatTop(
  L: TableLayout,
  {
    tableTop,
    seatHeight,
    headerBottom,
  }: { tableTop: number; seatHeight: number; headerBottom: number }
): number {
  const stacks = sideStacks(L);
  // Landscape phones: TRICK_GAP under North's seat and level chip, which
  // they run toward, the winning bid's badge 3pt above the avatar included.
  if (L.front)
    return Math.max(
      headerBottom,
      tableTop + 8 + AVATAR_SIZE[L.profile] + LEVEL_HANG + TRICK_GAP + BADGE_RISE
    );
  if (!L.profile.endsWith('portrait')) return Math.max(headerBottom, stacks.top - 12 - seatHeight);
  if (L.sides.seat != null) return L.sides.seat - sideAvatar(L) / 2;
  const northSeatTop =
    northFanTop(L, tableTop) + northBackWidth(L.cardW, compactNorth(L)) * CARD_RATIO + 12;
  return Math.max(
    tableTop + 8,
    Math.min(
      Math.max(northSeatTop + 16, stacks.top - 12 - seatHeight),
      stacks.lowestTop - 12 - seatHeight
    )
  );
}

/** A trump button: the suit, its name and the count stacked, big enough for older hands. */
export const TRUMP_BUTTON = { width: 76, height: 76 } as const;
/** The shortest tight phones' trump button: still a thumb's width, a little less tall. */
const SHORT_TRUMP_BUTTON = 64;
const TRUMP_GAP = 8;
/** "Pick trump" and the gap under it. */
const TRUMP_CAPTION = 22;
/** Between the picker and your hand: room for a previewed suit to rise, and air. */
const TRUMP_HAND_GAP = 28;
/**
 * The trump picker, in the trick circle: a 2×2 grid in portrait, one row of
 * four in landscape. Where the side seats come down beside it (small phones,
 * landscape), it sits below them instead of over their names. On tight
 * phones short of room above your hand "Pick trump" yields first (the
 * buttons name each suit and its count), then the buttons lose a little
 * height, and on the very shortest (under ~600pt) the picker rises over the
 * side names' ends, never into North (PID-304).
 */
export function trumpPicker(L: TableLayout, tableTop: number, headerBottom: number) {
  const portrait = L.profile.endsWith('portrait');
  const columns = portrait ? 2 : 4;
  const rows = 4 / columns;
  const width = columns * TRUMP_BUTTON.width + (columns - 1) * TRUMP_GAP;
  const seat = sideAvatar(L);
  const seatsBottom =
    L.tight || !portrait
      ? sideSeatTop(L, { tableTop, seatHeight: seat, headerBottom }) + seat + TRUMP_GAP
      : 0;
  const topFor = (height: number) => Math.max(L.trick.cy - height / 2, seatsBottom);
  const handTop = L.hand.cy - (L.cardH * handScale(L.profile)) / 2;
  const grid = (button: number) => rows * button + (rows - 1) * TRUMP_GAP;
  const fits = (h: number) => topFor(h) + h <= handTop - TRUMP_HAND_GAP;
  const caption = !L.tight || fits(TRUMP_CAPTION + grid(TRUMP_BUTTON.height));
  const buttonHeight =
    caption || fits(grid(TRUMP_BUTTON.height)) ? TRUMP_BUTTON.height : SHORT_TRUMP_BUTTON;
  const height = (caption ? TRUMP_CAPTION : 0) + grid(buttonHeight);
  return {
    columns,
    gap: TRUMP_GAP,
    caption,
    buttonHeight,
    left: L.trick.cx - width / 2,
    top: L.tight
      ? Math.max(
          northSeatBottom(L, tableTop),
          Math.min(topFor(height), handTop - TRUMP_HAND_GAP - height)
        )
      : topFor(height),
    width,
    height,
  };
}

/** Between the bid window and your hand: never less, on any phone. */
const BID_HAND_GAP = 18;
/**
 * Where the portrait bid window starts: `height` tall (Pass and a failed
 * bid's message included), its grid's centre `center` below its top. The
 * grid sits on the trick's centre, but the window never comes closer to
 * your hand than BID_HAND_GAP. On tight phones (PID-304) your seat under
 * the hand leaves less room below the trick, so the grid rises above the
 * centre there, never below it; North keeps clear by its own check.
 */
export function bidWindowTop(
  L: TableLayout,
  { tableTop, center, height }: { tableTop: number; center: number; height: number }
) {
  const handTop = L.hand.cy - (L.cardH * handScale(L.profile)) / 2;
  return Math.max(
    tableTop + BID_HAND_GAP,
    Math.min(L.trick.cy - center, handTop - BID_HAND_GAP - height)
  );
}

const TICKER_LINE_MAX = 168;
const TICKER_LINE_MIN = 72;
/** The chevron and the gap before it. */
const TICKER_CHEVRON = 16;
/**
 * The plaque's ticker, kept off North's fan. Portrait lines may reach half a
 * back into it, over the first back's edge only; landscape lines sit beside
 * the plaque, dropped below the fan where it hangs into the header row.
 * Null where the table leaves the ticker out (`showsTicker`), unless the
 * player's count help needs its resting line there anyway (`always`). Tight
 * phones leave it out even then: it crowded West's seat (PID-304), and the
 * hand's log opens from the score panel instead. So do landscape phones,
 * whose West seat sits under the plaque (PID-305).
 */
export function tickerPlacement(
  L: TableLayout,
  { tableTop, plaqueLeft, plaqueTop }: { tableTop: number; plaqueLeft: number; plaqueTop: number },
  always = false
): { lineMaxWidth: number; drop: number; wraps?: boolean } | null {
  if (L.tight || L.front || (!always && !showsTicker(L))) return null;
  const backW = northBackWidth(L.cardW, compactNorth(L));
  if (!L.profile.endsWith('portrait')) {
    const fanBottom = northFanTop(L, tableTop) + backW * CARD_RATIO;
    return { lineMaxWidth: TICKER_LINE_MAX, drop: Math.max(0, fanBottom + 4 - plaqueTop) };
  }
  const fanLeft = L.seats.north.x - northFanWidth(L.cardW, 6, compactNorth(L)) / 2;
  const room = fanLeft + backW / 2 - plaqueLeft - TICKER_CHEVRON;
  // Upright phones' bigger backs leave the lines less room (PID-333): a name
  // takes a row of its own rather than be cut short, as the bid line's does.
  return {
    lineMaxWidth: clamp(room, TICKER_LINE_MIN, TICKER_LINE_MAX),
    drop: 0,
    wraps: L.profile === 'phone-portrait',
  };
}
/**
 * Seat avatars, from the Table boards. Landscape phones draw them larger:
 * many players are older and read the table at arm's length (PID-217).
 */
export const AVATAR_SIZE: Record<Profile, number> = {
  'phone-portrait': 56,
  'phone-landscape': 52,
  'tablet-portrait': 64,
  'tablet-landscape': 64,
};
/** Between a landscape avatar and its name. */
export const seatNameGap = (profile: Profile) => (profile.startsWith('tablet') ? 14 : 10);
/**
 * Landscape phones: each side seat sits beside its backs, on the inner side,
 * West's at their top and East's at their foot, as Classic staggers them,
 * so neither runs into the scores or your seat; its name runs under it.
 */
export function landscapeSideSeatTop(L: TableLayout, rel: 'east' | 'west', seatHeight: number) {
  const half = sideStackReach(L.cardW) / 2;
  return rel === 'west' ? L.sides.cy - half + BADGE_RISE : L.sides.cy + half - seatHeight;
}
/**
 * Landscape phones: a side seat's name and line run under its avatar, this
 * wide where there is room, and never narrower than SIDE_SEAT_LEAST (a nav
 * bar's inset can take the rest, as on a TCL 5053Y).
 */
export const SIDE_SEAT_WIDTH = 108;
const SIDE_SEAT_LEAST = 76;
/** From a side stack's inner edge to its played card's centre, a full side seat between. */
const sideSeatReach = (cardH: number) => SIDE_SEAT_GAP + SIDE_SEAT_WIDTH + TRICK_GAP + cardH / 2;

/**
 * The centre of landscape South's seat: level with your hand, on landscape
 * phones never so low that its level chip leaves the table (PID-307).
 */
export const landscapeSouthY = (L: Pick<TableLayout, 'front' | 'hand' | 'bottom' | 'profile'>) =>
  L.front ? Math.min(L.hand.cy, L.bottom - LEVEL_HANG - 4 - AVATAR_SIZE[L.profile] / 2) : L.hand.cy;
/** Landscape South's avatar shares the scoreboard divider's axis, ~70pt in. */
export const LANDSCAPE_SOUTH_LEFT = 70;
/** The least of South's name a landscape hand leaves room for. */
export const SOUTH_NAME_MIN = 56;
/** A full hand, as dealt. */
const FULL_HAND = 9;
/** The table menu at the right end of the header row: its inset and touch target. */
export const MENU_SLOT = 12 + 44;
/** The least of North's landscape name the table leaves room for. */
export const NORTH_NAME_MIN = 80;
/** How far North's fan and seat may move left of the table's axis to make that room. */
const NORTH_SHIFT_MAX = 40;
/**
 * Between North's fan and its seat. Landscape phones keep the dealer chip,
 * 9pt out on the avatar's corner and its rim, TRICK_GAP clear of the fan (PID-307).
 */
const northSeatGap = (L: TableLayout) => (L.front ? TRICK_GAP + 10 : 16);
/** What the menu leaves landscape North's name, its fan on the table's axis. */
const northRoom = (L: TableLayout, insets: Insets, backs: number) =>
  L.width -
  insets.right -
  MENU_SLOT -
  8 -
  (L.width / 2 + northFanWidth(L.cardW, backs, compactNorth(L)) / 2 + northSeatGap(L)) -
  AVATAR_SIZE[L.profile] -
  seatNameGap(L.profile);
/**
 * Landscape North on the narrowest phones (640pt with a side inset): the fan
 * and seat move left of the table's axis by what the name still lacks of
 * NORTH_NAME_MIN.
 */
export const landscapeNorthShift = (L: TableLayout, insets: Insets, backs: number) =>
  clamp(NORTH_NAME_MIN - northRoom(L, insets, backs), 0, NORTH_SHIFT_MAX);
/** Where landscape North's seat starts: right of its fan of backs. */
export const landscapeNorthLeft = (L: TableLayout, insets: Insets, backs: number) =>
  L.width / 2 -
  landscapeNorthShift(L, insets, backs) +
  northFanWidth(L.cardW, backs, compactNorth(L)) / 2 +
  northSeatGap(L);
/**
 * How far a landscape name runs before it truncates. South's runs toward
 * your hand, North's toward the menu: each takes what those leave. South
 * never gets less than SOUTH_NAME_MIN (the hand makes way for it); North
 * never runs into the menu, and makes room for NORTH_NAME_MIN where it can
 * (`landscapeNorthShift`). On landscape phones East's and West's stop short
 * of North's widest pile in its front row.
 */
export function landscapeNameReach(
  L: TableLayout,
  rel: RelativePosition,
  {
    insets,
    southCards = FULL_HAND,
    northBacks = 6,
  }: { insets: Insets; southCards?: number; northBacks?: number }
): number {
  const most = L.profile.startsWith('tablet') ? 160 : 104;
  const seat = AVATAR_SIZE[L.profile] + seatNameGap(L.profile);
  const side = rel === 'east' || rel === 'west';
  const room =
    rel === 'south'
      ? handLeft(L, southCards) - (insets.left + LANDSCAPE_SOUTH_LEFT + seat) - 12
      : rel === 'north'
        ? L.width - insets.right - MENU_SLOT - 8 - landscapeNorthLeft(L, insets, northBacks) - seat
        : L.front
          ? L.width / 2 -
            (L.cardW * FRONT_PILE_SPAN) / 2 -
            TRICK_GAP -
            sideStackInner(L.cardW, rel === 'east' ? insets.right : insets.left) -
            SIDE_SEAT_GAP -
            seat
          : most;
  return clamp(room, rel === 'south' || (side && !L.front) ? SOUTH_NAME_MIN : 0, most);
}
/** A tight seat: the avatar alone, its name beside it, no level chip. */
export const TIGHT_AVATAR = 44;
/** East's and West's avatar. */
const sideAvatar = (L: Pick<TableLayout, 'tight' | 'profile'>) =>
  L.tight ? TIGHT_AVATAR : AVATAR_SIZE[L.profile];
/** Between your hand and your tight avatar: the turn ring's room. */
export const TIGHT_SOUTH_GAP = 6;
/** Your tight seat under the hand: the gap, the avatar, its short line and air above the home indicator. */
const TIGHT_SOUTH_SEAT = TIGHT_SOUTH_GAP + TIGHT_AVATAR + 4 + 14 + 8;
/** East's or West's tight seat: the avatar over its name and line, no level. */
const TIGHT_SIDE_SEAT = TIGHT_AVATAR + 4 + 16 + 14;
/**
 * Small phones leave the ticker out: the seats' status lines say the same,
 * and the table needs the room (Marcel, 2026-10-15). Landscape phones too.
 */
export function showsTicker(L: TableLayout): boolean {
  return !L.tight && !L.front;
}
/** Below this circle radius the trick reads as a heap: give it the seats' room. */
const MIN_COMFORT_R = 64;
const PILE_SCALE = 0.82;
/**
 * Upright phones' played cards, as tall as Classic's (PID-333): about 78pt
 * at 390×844, beside a hand of 88pt.
 */
const PHONE_PILE_SCALE = 0.89;
/**
 * Upright phones (PID-381): how much of each earlier card in a seat's pile
 * shows, as a share of a card's width: its rank and suit. A long pile closes
 * to PHONE_PILE_LEAST at the least.
 */
const PHONE_PILE_STEP = 0.26;
const PHONE_PILE_LEAST = 0.16;
/** Upright phones: a seat's earlier cards, behind its newest, as a share of its size. */
export const PILE_TRAIL_SCALE = 0.8;
/** Upright phones: between a pile and the next pile, or your hand. */
const PILE_GAP = 2;
/** Played cards shrink a little where the trick circle has to. */
const COMPACT_PILE_SCALE = 0.72;
const LANDSCAPE_PILE_SCALE = 0.8;

/**
 * Upright phones (PID-381): how much shows of each earlier card in a pile of
 * `count`, oldest first, where together they may show `room`. A long pile
 * closes on its oldest cards first, to PHONE_PILE_LEAST at the least; its
 * newest two earlier cards keep the full step.
 */
export function pileSpacing(count: number, room: number, cardW: number): number[] {
  const steps = Array.from({ length: Math.max(0, count - 1) }, () => cardW * PHONE_PILE_STEP);
  let over = steps.length * cardW * PHONE_PILE_STEP - room;
  for (let i = 0; i < steps.length - 2 && over > 0; i++) {
    const cut = Math.min(over, cardW * (PHONE_PILE_STEP - PHONE_PILE_LEAST));
    steps[i] -= cut;
    over -= cut;
  }
  return steps;
}

/**
 * Upright phones (PID-381): how far North's or your pile reaches either side
 * of its point of the circle, short of East's and West's earlier cards.
 */
const pileHalfSpan = (L: TableLayout) =>
  L.trick.across - (L.cardW * L.trick.pileScale * PILE_TRAIL_SCALE * CARD_RATIO) / 2 - PILE_GAP;

/**
 * Where card `index` of a seat's `count` played cards this hand lies. On
 * upright phones its newest `live` lie at full size (`trickOnCross`), the
 * earlier ones behind them a little smaller (PID-381); elsewhere `live` is
 * not used.
 */
export function playedCardTarget(
  L: TableLayout,
  rel: RelativePosition,
  index: number,
  count: number,
  live = count
) {
  const portrait = L.profile.endsWith('portrait');
  const pileScale = L.trick.pileScale;
  const spacing = Math.min(L.cardW * 0.38, portrait ? 24 : 32);
  const off = index - (count - 1) / 2;
  const upright = L.profile === 'phone-portrait';
  // Side cards face their owner on every table: the card's top edge points at
  // the table center (east top→left, west top→right), matching the seat rot
  // below (PID-388). East's index lies at the foot, West's at the top.
  const rot = rel === 'east' ? -Math.PI / 2 : rel === 'west' ? Math.PI / 2 : 0;
  // Landscape phones: the card lands on its seat's spot of the cross. More
  // than one card in a trick (a seat that kept seven trumps) overlaps along
  // the seat's axis, as in Classic: sideways at North and South, down the
  // column at the sides (PID-307).
  if (L.front) {
    const { x, y } = L.front[rel];
    if (rel === 'north' || rel === 'south')
      return { x: x + off * spacing, y, rot, scale: pileScale };
    return { x, y: sideColumn(L, rel, y, index, count, spacing), rot, scale: pileScale };
  }

  // Each pile center lands on a cardinal point of the trick circle. Multiple
  // cards spread along the tangent so the ring remains the visual ruler.
  const across = L.trick.across;
  // Upright phones (PID-381): a seat's newest cards lie at full size, its
  // earlier ones behind them a little smaller, each showing its rank and
  // suit. North's and yours run left, centred on their point of the circle,
  // short of the side piles' earlier cards; East's and West's hang down their
  // column from the trick's line, short of your hand: East's newest on top,
  // West's at the foot, so each earlier index shows (PID-388).
  if (upright) {
    const big = L.cardW * pileScale;
    const small = big * PILE_TRAIL_SCALE;
    const sideways = rel === 'east' || rel === 'west';
    // West's newest lies at the foot of its column, beside your pile's earlier
    // cards (PID-388): a long pile of yours steps right of it, as far as East's
    // earlier cards make room by keeping to its newest card's outer edge.
    const grow = ((big - small) * CARD_RATIO) / 2;
    const sideIn = pileHalfSpan(L);
    const room = sideways
      ? // Clear of a lifted card, its 3% growth and slight tilt included.
        L.hand.cy -
        L.cardH / 2 -
        handLift(L) -
        (L.cardH * 0.015 + 2.5) -
        PILE_GAP -
        L.trick.cy -
        big / 2
      : 2 * sideIn - big;
    const steps = pileSpacing(count, room, L.cardW);
    const width = (i: number) => (i >= count - live ? big : small);
    // From the newest card's centre back to this one's: each card's back
    // edge lies its step behind the next one's.
    let back = (width(count - 1) - width(index)) / 2;
    for (let i = index; i < count - 1; i++) back += steps[i];
    const shown = steps.reduce((sum, step) => sum + step, 0);
    // A side pile too long even at the least step rises above the line.
    const rise = Math.max(0, shown - room);
    return {
      x: sideways
        ? L.trick.cx + (rel === 'east' ? across + (width(index) < big ? grow : 0) : -across)
        : L.trick.cx +
          (rel === 'south' ? Math.max(0, (shown + width(count - 1)) / 2 - sideIn + grow) : 0) +
          shown / 2 -
          back,
      y: sideways
        ? L.trick.cy - rise + (rel === 'east' ? back : shown - back)
        : L.trick.cy + (rel === 'north' ? -L.trick.r : L.trick.r),
      rot,
      scale: index >= count - live ? pileScale : pileScale * PILE_TRAIL_SCALE,
    };
  }
  const x =
    rel === 'west'
      ? L.trick.cx - across
      : rel === 'east'
        ? L.trick.cx + across
        : L.trick.cx + off * spacing;
  // East's -90° rotation puts its rank edge at the bottom. Spread upward
  // so newer cards (drawn on top) leave that edge visible on older cards.
  const y =
    rel === 'north'
      ? L.trick.cy - L.trick.r
      : rel === 'south'
        ? L.trick.cy + L.trick.r
        : L.trick.cy + off * spacing * (rel === 'east' ? -1 : 1);
  return { x, y, rot, scale: pileScale };
}

/**
 * Landscape phones (PID-308): a seat's earlier cards this hand trail behind
 * its played card, smaller: sideways at North and South, up West's column
 * and down East's, toward each card's index (PID-388). `back` counts from the
 * card nearest it (1), of `count`.
 */
export const TRAIL_SCALE = 0.72;
const TRAIL_NEAR = 0.42;
const TRAIL_STEP = 0.26;
/** How far North's or your trail reaches left of its card's centre, five cards long. */
const trailReach = (cardW: number) =>
  cardW * (TRAIL_NEAR + 4 * TRAIL_STEP) + (cardW * TRAIL_SCALE) / 2;
export function trailSpot(L: TableLayout, rel: RelativePosition, back: number, count = 5) {
  const spot = playedCardTarget(L, rel, 0, 1);
  // A side card's index lies at the foot at East and at the top at West: the
  // trail steps toward it, closing up to stay in its column (PID-308).
  const side = rel === 'west' || rel === 'east';
  const up = rel === 'west';
  const reach =
    side && L.band
      ? (up ? spot.y - L.band.top : L.band.bottom - spot.y) - (L.cardW * TRAIL_SCALE) / 2
      : Infinity;
  const room = reach - L.cardW * TRAIL_NEAR;
  const step = Math.max(0, Math.min(L.cardW * TRAIL_STEP, room / Math.max(1, count - 1)));
  // Where even the nearest would leave the band, the trail closes up behind its card.
  const d = Math.max(0, Math.min(reach, L.cardW * TRAIL_NEAR + (back - 1) * step));
  return {
    ...spot,
    x: spot.x - (side ? 0 : d),
    y: spot.y + (!side ? 0 : up ? -d : d),
    scale: spot.scale * TRAIL_SCALE,
  };
}

/**
 * Which of a seat's tricks lies on the cross on landscape phones: its latest,
 * until that seat's next card takes the spot, so a card moves only when it must.
 * Your own card clears as soon as you can play, for your cards to lift into the
 * empty spot (PID-307, PID-308). A seat that is out has no next card, so its
 * last one clears when the next trick starts.
 */
export function trickOnCross(
  seatTricks: number[],
  liveTrick: number,
  yours: boolean,
  canPlay: boolean,
  out = false
) {
  if ((yours && canPlay) || out) return liveTrick;
  return Math.max(-1, ...seatTricks);
}

/** A card in a pile in front of a seat (thrown or killed): a played card's size on landscape phones. */
export const pileCardW = (L: TableLayout) =>
  L.front ? L.cardW : L.cardW * L.trick.pileScale * 0.82;
/** How wide North's or your front-row pile spreads at most, in faces. */
const FRONT_PILE_SPAN = 3.4;
/**
 * Where card `i` of a seat's pile of `n` lies: spread over its trick spot,
 * or on landscape phones on its spot of the cross, as in Classic: North's
 * and yours spread sideways, East's and West's down their column, closing
 * up to fit.
 */
export function pileSpot(L: TableLayout, rel: RelativePosition, i: number, n: number) {
  const w = pileCardW(L);
  const sideways = rel === 'east' || rel === 'west';
  if (!L.front) {
    const at = playedCardTarget(L, rel, 0, 1);
    // Upright phones: a big throw closes up to keep the trick's corners free
    // (PID-333), East's and West's between North's and yours, and those two
    // within the circle.
    const reach =
      L.profile === 'phone-portrait'
        ? L.trick.r - 6 - (sideways ? (w * CARD_RATIO) / 2 : 0)
        : Infinity;
    // There East's and West's seats sit just above their spot (PID-393): a
    // fan rises at most half a gap above it and closes up to keep its bottom.
    const rise = sideways && L.profile === 'phone-portrait' ? TRICK_GAP / 2 : Infinity;
    const span = Math.min(2 * reach - w, rise + reach - w / 2);
    const step = n > 1 ? Math.max(0, Math.min(w * 0.44, span / (n - 1))) : 0;
    const off = i * step - Math.min(rise, ((n - 1) * step) / 2);
    return sideways ? { x: at.x, y: at.y + off } : { x: at.x + off, y: at.y };
  }
  const at = L.front[rel];
  if (sideways) return { x: at.x, y: sideColumn(L, rel, at.y, i, n, w * 0.44) };
  const span = w * FRONT_PILE_SPAN;
  const step = n > 1 ? Math.min(w * 0.44, (span - w) / (n - 1)) : 0;
  return { x: at.x + (i - (n - 1) / 2) * step, y: at.y };
}

/**
 * Landscape phones: card `i` of `n` lying sideways down East's or West's
 * column, `step` apart at most, centred on `y` as far as the column's band
 * allows. Newer cards lie on top, lower at West; East's turn the other way,
 * their rank at the bottom, so East's newer cards lie higher.
 */
function sideColumn(
  L: TableLayout,
  rel: RelativePosition,
  y: number,
  i: number,
  n: number,
  step: number
) {
  const band = L.band ?? { top: -Infinity, bottom: Infinity };
  const fit = n > 1 ? Math.min(step, (band.bottom - band.top - L.cardW) / (n - 1)) : 0;
  const span = L.cardW + (n - 1) * fit;
  const top = clamp(y - span / 2, band.top, band.bottom - span);
  return top + L.cardW / 2 + (rel === 'east' ? n - 1 - i : i) * fit;
}

/** How far a playable (or previewed) hand card rises out of the row. */
export const handLift = (L: TableLayout) => Math.min(16, L.cardH * 0.14);

const HAND_STEP = 0.72;
/** Step between hand cards: a straight row, squeezed to fit the hand's width. */
export function handStep(L: TableLayout, n: number): number {
  const cardW = L.cardW * handScale(L.profile);
  return n > 1 ? Math.min(L.cardW * HAND_STEP, (L.hand.maxWidth - cardW) / (n - 1)) : 0;
}

/**
 * How large your hand is drawn. Landscape phones draw it the size of the
 * cards on the table, as Classic does (PID-305); landscape tablets a touch smaller.
 */
export function handScale(profile: Profile): number {
  return profile === 'tablet-landscape' ? 0.9 : 1;
}

/** Right edge of an n-card hand: talk's landscape corner starts past it (PID-328). */
export function handRight(L: TableLayout, n: number): number {
  return (
    handLeft(L, n) + (Math.max(1, n) - 1) * handStep(L, n) + L.cardW * handScale(L.profile) * 1.03
  );
}

/** Left edge of an n-card hand, a lifted (playable) card included. */
export function handLeft(L: TableLayout, n: number): number {
  const half = (Math.max(1, n) - 1) / 2;
  return L.hand.cx - half * handStep(L, n) - (L.cardW * handScale(L.profile) * 1.03) / 2;
}

export function pickProfile(w: number, h: number): Profile {
  // The lobby picks its layout here too (app/lobby.tsx).
  const tablet = Math.min(w, h) >= 600; // shortest-side breakpoint; browser window counts as tablet
  const landscape = w > h;
  return `${tablet ? 'tablet' : 'phone'}-${landscape ? 'landscape' : 'portrait'}` as Profile;
}

/**
 * Upright phones draw their cards as big as Classic's (PID-333): smaller
 * phones in proportion to their width, and the shortest by their height,
 * which the table runs out of first; never smaller than before.
 */
export function cardSize(width: number, height: number): number {
  if (pickProfile(width, height) === 'phone-portrait')
    return clamp(Math.max(width * 0.13, Math.min(width * 0.16, height * 0.09)), 54, 104);
  return clamp(Math.min(width, height) * 0.13, 54, 104); // CSS clamp(), in JS
}

export function computeLayout(
  width: number,
  height: number,
  insets: Insets,
  topReserve = 0,
  bottomReserve = 0
): TableLayout {
  const profile = pickProfile(width, height);
  const portrait = profile.endsWith('portrait');
  const shortest = Math.min(width, height);
  const cardW = cardSize(width, height);
  const cardH = cardW * CARD_RATIO;

  const cx = width / 2;
  const cy = height / 2;
  const tableTop = insets.top + topReserve;
  const tableBottom = height - insets.bottom - bottomReserve;

  // Portrait centers the trick in the band between North's seat and your
  // hand, so the played cards keep clear of both on every phone height. Where
  // the band is short (small phones) the circle and its cards shrink; where
  // it is not, the circle keeps its usual size. On the shortest phones even
  // that is not enough (`tight`): North's name moves beside a smaller avatar,
  // and yours keeps only the avatar and its short line.
  // Landscape keeps the legacy full-felt composition with floating chrome.
  const tabletPortrait = profile === 'tablet-portrait';
  const usualR = clamp(shortest * (portrait ? 0.19 : 0.18), 82, 190);
  const portraitBand = (tightSeats: boolean) => {
    // Your seat below the hand: avatar, level chip, name and status, or on a
    // tight phone the smaller avatar and its short line.
    const southSeat = tightSeats ? TIGHT_SOUTH_SEAT : tabletPortrait ? 140 : 120;
    const handY = tableBottom - southSeat - cardH * 0.5;
    const northBottom =
      tableTop +
      8 +
      northBackWidth(cardW) * CARD_RATIO +
      12 +
      (tightSeats ? TIGHT_AVATAR : NORTH_SEAT_STACK[tabletPortrait ? 'tablet' : 'phone']);
    return { handY, northBottom, band: Math.max(0, handY - cardH / 2 - northBottom) };
  };
  const fitR = (band: number, scale: number) => band / 2 - (cardH * scale) / 2 - 8;
  // Upright phones keep the circle clear of a lifted card of yours too: a
  // short band has none to spare for it (PID-304, PID-393).
  const lift = profile === 'phone-portrait' ? Math.min(16, cardH * 0.14) : 0;
  const roomy = portraitBand(false);
  const tight =
    portrait && !tabletPortrait && fitR(roomy.band, COMPACT_PILE_SCALE) - lift < MIN_COMFORT_R;
  const { handY: portraitHandY, northBottom, band } = portraitBand(tight);
  const usualPile = profile === 'phone-portrait' ? PHONE_PILE_SCALE : PILE_SCALE;
  const compact = portrait && fitR(band, usualPile) - lift < usualR;
  const handH = cardH * handScale(profile);
  // Landscape phones lay the table out as Classic does, one card size
  // (PID-305, PID-307): each hand along its edge, and the played cards on a
  // cross around the trump mark, TRICK_GAP clear of it, of North's row (its
  // backs, its seat and level chip) and of your hand. A card of yours lifts
  // only into your empty spot (`useCardSprites`). The cross sits as high as
  // North's row allows, your hand along the bottom edge, past it where the
  // table is short, but never showing less than its rank and suit; only then
  // (a status bar on a short phone) do the cross rise and North's backs
  // bleed past the top.
  const twoRows = profile === 'phone-landscape';
  const reach = (cardW * TRUMP_MARK) / 2 + TRICK_GAP + cardH / 2;
  const northRow = Math.max(
    tableTop + ROW_EDGE + sideBackWidth(cardW) * CARD_RATIO,
    tableTop + 8 + AVATAR_SIZE[profile] + LEVEL_HANG
  );
  const crossTop = northRow + TRICK_GAP + cardH / 2 + reach;
  // A playable card of yours grows 3% and every one keeps its slight tilt
  // and offset (`heldPose`, up to 0.7° and 1pt).
  const held = cardH * 0.015 + 2.5;
  const crossBottom = tableBottom - ROW_EDGE - cardH - held - TRICK_GAP - cardH / 2 - reach;
  const crossY = crossTop <= crossBottom ? (crossTop + crossBottom) / 2 : crossTop;
  const handTop = crossY + reach + cardH / 2 + TRICK_GAP + held;
  // Shown down to the screen's edge: a home indicator's strip still takes taps.
  // Up to `handShown` of it where the cross has room to rise; never less than
  // its rank and suit, even if the cross then rises past North's row.
  const shown = height - handTop;
  const rise = Math.max(
    0,
    Math.min(handShown(cardH) - shown, crossY - crossTop),
    handLeast(cardH) - shown
  );
  const handY = portrait
    ? portraitHandY
    : twoRows
      ? Math.max(tableBottom - ROW_EDGE - cardH / 2, handTop - rise + cardH / 2)
      : tableBottom - handH / 2 - cardH * 0.11;
  const trickCy = portrait ? northBottom + band / 2 : twoRows ? crossY - rise : height * 0.49;
  // Landscape: your played card lands above the hand. Short phones shrink the
  // circle and its cards until it does.
  const landscapeR = (scale: number) => handY - handH / 2 - 8 - (cardH * scale) / 2 - trickCy;
  const shortLandscape = !portrait && !twoRows && landscapeR(LANDSCAPE_PILE_SCALE) < usualR;
  // Upright phones close the circle in before their played cards shrink, and
  // shrink them only to keep TRICK_GAP from the trump mark, as landscape does.
  const pileScale = portrait
    ? profile === 'phone-portrait'
      ? clamp(
          (band / 2 - 8 - lift - (cardW * TRUMP_MARK) / 2 - TRICK_GAP) / cardH,
          COMPACT_PILE_SCALE,
          PHONE_PILE_SCALE
        )
      : compact
        ? COMPACT_PILE_SCALE
        : PILE_SCALE
    : twoRows
      ? 1
      : shortLandscape
        ? COMPACT_PILE_SCALE
        : LANDSCAPE_PILE_SCALE;
  const trickR = compact
    ? Math.max(32, Math.min(usualR, fitR(band, pileScale) - lift))
    : twoRows
      ? reach
      : shortLandscape
        ? Math.max(32, Math.min(usualR, landscapeR(pileScale)))
        : usualR;

  // Upright phones lay East's and West's played cards out past the circle
  // where they grew into it (PID-333): as far as the hand's widest points
  // between them ("−14 | 14", about 3.5 figures, PID-332) and a four-card pile
  // at North or yours need, as PID-333 spread it (0.22 of a card apart), short
  // of a folded hand beside their stacks.
  const halfPlayed = (cardH * pileScale) / 2;
  const across =
    profile === 'phone-portrait'
      ? Math.min(
          Math.max(
            trickR,
            handPointsSize({ cardH }) * 1.75 + TRICK_GAP / 2 + halfPlayed,
            (3 * 0.22 * cardW + cardW * pileScale) / 2 + TRICK_GAP / 2 + halfPlayed
          ),
          cx -
            Math.max(sideStackInner(cardW, insets.left), sideStackInner(cardW, insets.right)) -
            1.5 * TRICK_GAP -
            halfPlayed
        )
      : trickR;

  const northY = tableTop + cardH * (portrait ? 0.48 : 0.22) + 10;
  // iPads upright drop the side line only as far as a full stack still ends
  // above your hand (`sideStacks().lowestTop`).
  const portraitDrop = tabletPortrait
    ? clamp(
        handY - cardH / 2 - 12 - sideStackReach(cardW) / 2 - trickCy,
        0,
        cardH * PORTRAIT_SIDE_DROP
      )
    : 0;
  const sideCy = portrait ? trickCy + portraitDrop : trickCy + (twoRows ? 0 : LANDSCAPE_SIDE_DROP);
  // Upright phones (PID-393): East and West come down toward the trick's
  // line, so the four seats stand apart, North alone at the top. Each comes
  // as far as its seat (the avatar over its name and line, which a name
  // beside it would not leave room for) stays TRICK_GAP above the
  // top edge of its played cards, which hang down from the line beside it.
  // Its backs hang below it in the edge column, TRICK_GAP clear of a lifted
  // card of yours. A full stack short of room closes up to SIDE_STACK_LEAST;
  // only past that does the seat rise, as little as it must.
  const upright = profile === 'phone-portrait';
  const sideSize = sideAvatar({ tight, profile });
  const sideBelow = (tight ? TIGHT_SIDE_SEAT : NORTH_SEAT_STACK.phone) - sideSize / 2 + TRICK_GAP;
  const stackBottom = handY - cardH / 2 - Math.min(16, cardH * 0.14) - held - TRICK_GAP;
  const stackLeast = sideBackWidth(cardW) * (1 + 5 * SIDE_STACK_LEAST);
  const sideLow = Math.min(trickCy, trickCy - (cardW * pileScale) / 2 - sideBelow);
  const sideSeat = sideLow - Math.max(0, sideLow + sideBelow + stackLeast - stackBottom);
  const stackReach = Math.min(sideStackReach(cardW), stackBottom - sideSeat - sideBelow);
  // West's and East's spots: in toward the trump mark, just clear of the
  // trail North or you leave in front of you over a hand (PID-308), and of
  // their stacks.
  const sidePile = trailReach(cardW);
  const sideSpot = (edge: number) =>
    Math.max(
      cx - sidePile - TRICK_GAP - cardH / 2,
      sideStackInner(cardW, edge) + TRICK_GAP + cardH / 2
    );
  // Played cards leave from here; portrait keeps its historical screen-center origin.
  const sideY = portrait ? cy : sideCy;

  // Landscape: your seat sits left of your hand, its name running toward it.
  // The hand stays on the table's axis, or moves as little right of it as a
  // full hand needs to clear the seat; only past that does it squeeze.
  const handRoomLeft =
    insets.left +
    LANDSCAPE_SOUTH_LEFT +
    AVATAR_SIZE[profile] +
    seatNameGap(profile) +
    SOUTH_NAME_MIN +
    8;
  const handRoomRight = width - insets.right - 16;
  const fullHand = cardW * handScale(profile) + (FULL_HAND - 1) * cardW * HAND_STEP;
  const landscapeHandCx = Math.max(
    cx,
    handRoomLeft + Math.min(fullHand, handRoomRight - handRoomLeft) / 2
  );

  const seats: Record<RelativePosition, Seat> = {
    south: { x: cx, y: handY, rot: 0, hand: { x: cx, y: handY } },
    north: { x: cx, y: northY, rot: Math.PI, hand: { x: cx, y: northY } },
    east: {
      x: width - insets.right + cardW * 0.04,
      y: sideY,
      rot: -Math.PI / 2,
      hand: { x: width - insets.right + cardW * 0.04, y: sideY },
    },
    west: {
      x: insets.left - cardW * 0.04,
      y: sideY,
      rot: Math.PI / 2,
      hand: { x: insets.left - cardW * 0.04, y: sideY },
    },
  };
  // Landscape phones: a played card leaves from just inside its player's
  // hand, never from behind North's backs or a side stack (PID-307).
  if (twoRows) {
    const northBacksBottom = trickCy - reach - cardH / 2 - TRICK_GAP;
    seats.north.y = northBacksBottom + cardH / 2;
    seats.west.x = sideStackInner(cardW, insets.left) + cardH / 2;
    seats.east.x = width - sideStackInner(cardW, insets.right) - cardH / 2;
  }

  const L: TableLayout = {
    width,
    height,
    profile,
    cardW,
    cardH,
    felt: { cx, cy: trickCy },
    trick: { cx, cy: trickCy, r: trickR, pileScale, across },
    front: twoRows
      ? {
          north: { x: cx, y: trickCy - reach },
          south: { x: cx, y: trickCy + reach },
          // A nav bar's inset narrows a side: its cards come in, short of
          // North's and your widest pile, to leave its seat room (PID-308).
          west: {
            x: Math.min(
              cx - (cardW * FRONT_PILE_SPAN) / 2 - TRICK_GAP - cardH / 2,
              Math.max(
                sideSpot(insets.left),
                sideStackInner(cardW, insets.left) + sideSeatReach(cardH)
              )
            ),
            y: sideCy,
          },
          east: {
            x: Math.max(
              cx + (cardW * FRONT_PILE_SPAN) / 2 + TRICK_GAP + cardH / 2,
              Math.min(
                width - sideSpot(insets.right),
                width - sideStackInner(cardW, insets.right) - sideSeatReach(cardH)
              )
            ),
            y: sideCy,
          },
        }
      : undefined,
    tight,
    sides: upright
      ? { cy: sideSeat + sideBelow + stackReach / 2, seat: sideSeat, reach: stackReach }
      : { cy: sideCy },
    seats,
    top: tableTop,
    insets,
    bottom: tableBottom,
    hand: portrait
      ? { cx, cy: handY, maxWidth: width - insets.left - insets.right - 32 }
      : {
          cx: landscapeHandCx,
          cy: handY,
          maxWidth: 2 * Math.min(landscapeHandCx - handRoomLeft, handRoomRight - landscapeHandCx),
        },
  };
  // Where a side seat fits between its backs and its played cards, the backs
  // hang centred down their edge, as in Classic, and the played cards run down
  // a column between North's trail and yours (PID-308). Narrower tables hang
  // the backs under their seats (PID-307).
  if (twoRows && L.front) {
    const room = (spot: number, edge: number) =>
      spot - cardH / 2 - TRICK_GAP - sideStackInner(cardW, edge) - SIDE_SEAT_GAP;
    const least = Math.min(
      room(L.front.west.x, insets.left),
      room(width - L.front.east.x, insets.right)
    );
    L.sidesUnder = least >= SIDE_SEAT_LEAST;
    L.sideSeatWidth = Math.min(SIDE_SEAT_WIDTH, least);
    if (L.sidesUnder) {
      L.band = { top: trickCy - reach - cardH / 2, bottom: trickCy + reach + cardH / 2 };
      L.sides.cy = trickCy;
    } else {
      L.band = {
        top:
          sideSeatTop(L, { tableTop, seatHeight: 0, headerBottom: 0 }) +
          AVATAR_SIZE[profile] +
          LEVEL_HANG +
          TRICK_GAP,
        bottom: landscapeSouthY(L) - AVATAR_SIZE[profile] / 2 - TRICK_GAP,
      };
      // 2pt for a held back's slight tilt and offset (`heldPose`).
      L.sides.cy = L.band.top + 2 + sideStackReach(cardW) / 2;
    }
  }
  return L;
}
