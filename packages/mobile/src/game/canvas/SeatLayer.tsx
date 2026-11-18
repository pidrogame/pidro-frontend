/**
 * RN seat furniture over the Skia canvas: each player is a `PlayerAvatar` with
 * their name and what they are doing (below it in portrait, beside it in
 * landscape), the dealer chip and winning bid on the avatar's corners, the turn light on it, and opponent
 * card-backs in the right orientation (North = upright fan, East/West =
 * landscape stacks along the edge). Positioned at the pure computeLayout()
 * seat coords so it lines up with the canvas cards/fly origins.
 * Only player identities handle presses; card backs leave gestures to the canvas.
 * Skia-free (only the pure layout module), safe to import anywhere.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Animated, {
  Easing,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import {
  Image,
  PixelRatio,
  Platform,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type ImageStyle,
  type LayoutChangeEvent,
  type LayoutRectangle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DEALER_SLIDE_MS,
  PLATE_REACH,
  PlayerAvatar,
  type DealerTrail,
  type PlayerAvatarProps,
} from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { StillLayer } from '@/components/ui/StillLayer';
import { PidroBevel, PidroColors, PidroLayout, PidroSpacing } from '@/design/tokens';
import { avatarLabel, avatarParts } from '@/features/avatar';
import { lineFit, seatLine, seatPlate, type SeatLine } from '@/features/game/seatLine';
import { whosePoints } from '@/features/game/points';
import type { Box, Clearance, SaidAt } from '@/features/game/talk';
import {
  AVATAR_SIZE,
  compactNorth,
  computeLayout,
  LANDSCAPE_SOUTH_LEFT,
  landscapeNameReach,
  landscapeSouthY,
  landscapeNorthLeft,
  landscapeNorthShift,
  northBackWidth,
  HELD_STYLE,
  heldPose,
  handStep,
  handScale,
  type HeldStyle,
  northFanTop,
  packSpot,
  packLayers,
  PACK_STEP,
  northFanStep,
  northFanWidth,
  handRight,
  sideStackStep,
  throwPile,
  seatNameGap,
  sideBackWidth,
  sideSeatTop,
  landscapeSideSeatTop,
  SIDE_SEAT_WIDTH,
  sideStackInner,
  SIDE_SEAT_GAP,
  sideStacks,
  southRow,
  TIGHT_AVATAR,
  TIGHT_SOUTH_GAP,
  TRICK_GAP,
  type RelativePosition,
} from './layout';
import { viewerOf } from './HandResult';
import { DREW_CHIP_H, DrewChip } from './DrewChip';
import { TABLE_HEADER, useTableSize } from './TableChrome';
import type { TableSeat } from './tableModel';
import {
  DEAL_PACKET_CARD_STAGGER_MS,
  DEAL_PACKET_TRAVEL_MS,
  FOLD_FLIGHT_MS,
  SECOND_DEAL_FLIGHT_MS,
  SECOND_DEAL_SWOOP_STAGGER_MS,
} from './animationTiming';
import type { SecondDealShow } from './useSecondDealPresentation';
import { bakedShadow } from './bakedBlur';
import { t, useTranslation } from '@/i18n';
import type { Card } from '@/types/game';
import { faceImage } from './cardTextures';

const REL: RelativePosition[] = ['north', 'east', 'south', 'west'];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const BACK: ImageSourcePropType =
  Platform.OS === 'web' ? { uri: '/cards/cardback.png' } : require('~/assets/images/cardback.png');

/** With `endsAt` and `durationMs` the turn light runs down on its own clock. */
export type SeatTurn = { progress: number; urgent: boolean; endsAt?: number; durationMs?: number };

function avatarFor(
  data: TableSeat,
  dealer: boolean,
  line: SeatLine | null,
  turn: SeatTurn | undefined,
  team: 'us' | 'them',
  nudge = 0
): Omit<PlayerAvatarProps, 'size'> {
  // Only a real bot has a persona, whatever status the room gave the seat first.
  const crew = data.seatStatus !== 'vacant' ? data.bot_persona : null;
  const away: PlayerAvatarProps['away'] =
    data.seatStatus === 'reconnecting'
      ? 'reconnecting'
      : data.seatStatus === 'bot_substitute' && !crew
        ? 'bot'
        : null;
  const kind: PlayerAvatarProps['kind'] =
    crew || data.seatStatus === 'permanent_bot'
      ? 'bot'
      : data.seatStatus === 'vacant'
        ? 'open'
        : 'player';
  const onTurn = data.isCurrentTurn && kind !== 'open';
  const plate = seatPlate(line, { onTurn, isYou: data.isYou });
  // Every line reads white (PID-450): a pass stays softer, the high bid gold.
  const tone = line?.tone === 'out' ? undefined : line?.tone;
  return {
    uri: data.avatar_url,
    // What you earned: one chip, and never on a bot. A bot sitting in for a
    // player keeps their chip, dimmed. The pin stays off the table (PID-338).
    level: kind === 'bot' ? null : data.level,
    prestige: kind === 'bot' ? null : data.prestige,
    dealer,
    turn: onTurn
      ? {
          progress: turn?.progress ?? 1,
          urgent: turn?.urgent ?? false,
          endsAt: turn?.endsAt,
          durationMs: turn?.durationMs,
          attention: data.isYou,
          nudge,
        }
      : null,
    away,
    kind,
    persona: crew,
    botProfile: data.bot_profile,
    name: kind === 'open' ? null : data.username,
    status: plate ? plate.text : (line?.text ?? null),
    plate: plate?.plate ?? null,
    pulse: line?.pulse ?? null,
    // Two against two at a glance: the name is in its team's colour.
    nameTone: team,
    statusTone: tone === 'now' && onTurn && turn?.urgent ? 'warning' : (tone ?? 'now'),
  };
}

type Props = {
  seats: Record<RelativePosition, TableSeat | null>;
  dealing?: boolean;
  dealerRel?: RelativePosition | null;
  topReserve?: number;
  bottomReserve?: number;
  statusByRel?: Partial<Record<RelativePosition, SeatLine | null>>;
  /** The game's first hand: your partner's seat says so when it has nothing else to say. */
  firstHand?: boolean;
  turnByRel?: Partial<Record<RelativePosition, SeatTurn>>;
  /** Counts your taps the table did not play: each lights the seat on turn once. */
  nudge?: number;
  onProfile?: Partial<Record<RelativePosition, () => void>>;
  /** A hand's result is showing: avatar and name only (PID-236). */
  quiet?: boolean;
  /** Level chips show; off from the deal until the hand ends (PID-334). */
  levels?: boolean;
  /** Cards in the dealer's pack beside them (PID-394). */
  pack?: number;
  /** The second deal playing out: the pack, what each seat threw. */
  secondDeal?: SecondDealShow;
  /** With count help: what each seat drew, on the corner of its hand (PID-452). */
  drew?: Partial<Record<RelativePosition, number>>;
  /** How every hand holds its cards. */
  held?: HeldStyle;
  bid?: { seat: RelativePosition | undefined; amount: number };
  /** What each seat just said (PID-114), drawn where its ring is. */
  said?: Partial<
    Record<RelativePosition, (at: SaidAt, ring: number, clear?: Clearance) => ReactNode>
  >;
};

/** A box grown by `dx` each side and `dy` above and below. */
const grow = (box: Box, dx: number, dy: number): Box => ({
  x: box.x - dx,
  y: box.y - dy,
  width: box.width + 2 * dx,
  height: box.height + 2 * dy,
});

export function SeatLayer({
  seats,
  dealing = false,
  dealerRel,
  topReserve = 0,
  bottomReserve = 0,
  statusByRel,
  firstHand = false,
  turnByRel,
  nudge,
  onProfile,
  quiet = false,
  levels = true,
  pack: packCount = 0,
  secondDeal,
  drew,
  held = HELD_STYLE,
  bid,
  said,
}: Props) {
  useTranslation();
  const out = REL.map((rel) => !!seats[rel]?.out);
  const viewer = viewerOf(seats);
  const [previousOut, setPreviousOut] = useState(out);
  const [frames, setFrames] = useState<Record<string, LayoutRectangle>>({});
  const [folding, setFolding] = useState<RelativePosition[]>([]);
  if (out.some((cold, i) => cold !== previousOut[i])) {
    setPreviousOut(out);
    setFolding(REL.filter((_, i) => out[i] && !previousOut[i]));
  }
  // The dealer chip slides from the seat that last showed it to the next one
  // that does (a hand's result hides it in between); that seat draws live
  // meanwhile, or Android's still layer would clip the chip outside its box.
  // A new game's cut for dealer starts afresh: its first chip just stands.
  const dealerTrail = useRef<DealerTrail['current']>(null);
  const shownDealer = quiet ? null : (dealerRel ?? null);
  const [lastDealer, setLastDealer] = useState(shownDealer);
  const [sliding, setSliding] = useState<{ rel: RelativePosition; at: number } | null>(null);
  if (!dealerRel && lastDealer) setLastDealer(null);
  else if (shownDealer && shownDealer !== lastDealer) {
    setLastDealer(shownDealer);
    if (lastDealer) setSliding({ rel: shownDealer, at: (sliding?.at ?? 0) + 1 });
  }
  useEffect(() => {
    if (!dealerRel) dealerTrail.current = null;
  }, [dealerRel]);
  useEffect(() => {
    if (!sliding) return;
    const id = setTimeout(() => setSliding(null), DEALER_SLIDE_MS + 200);
    return () => clearTimeout(id);
  }, [sliding]);
  const { width, height } = useTableSize();
  const insets = useSafeAreaInsets();
  const { top, bottom, left, right } = insets;
  const L = useMemo(
    () => computeLayout(width, height, { top, bottom, left, right }, topReserve, bottomReserve),
    [width, height, top, bottom, left, right, topReserve, bottomReserve]
  );
  const portrait = L.profile.endsWith('portrait');
  // Tight phones: every name beside a smaller avatar, no level chips or pins,
  // and your avatar alone above your hand, with its short line when it has one.
  const tight = portrait && L.tight;
  const size = tight ? TIGHT_AVATAR : AVATAR_SIZE[L.profile];
  const tablet = L.profile.startsWith('tablet');
  const parts = avatarParts(size, { seat: true });
  // Portrait names sit in a fixed column so a long one truncates instead of
  // pushing the seat off its axis. North and south have the table's width to
  // themselves; east and west get what North's column leaves them, their
  // names kept a step off the screen edge. Landscape caps the label's reach
  // and leaves the turn light room, as the boards do.
  const gap = seatNameGap(L.profile);
  const centerColumn = tablet ? 200 : 156;
  const sideColumn = Math.min(
    tablet ? 150 : 112,
    (width - insets.left - insets.right - centerColumn) / 2 - PidroSpacing.xs
  );
  // The scoreboard divider is ~70pt from the safe-area edge. Reusing that
  // vertical axis gives the landscape table a deliberate left rail.
  const landscapeSouthLeft = insets.left + LANDSCAPE_SOUTH_LEFT;
  // Landscape South's name runs toward the hand and North's toward the menu:
  // each gets what those leave (`landscapeNameReach`).
  const northBacks = clamp(seats.north?.out ? 0 : (seats.north?.cardCount ?? 0), 0, 9);
  // On the narrowest phones North's fan and seat move left (`landscapeNorthShift`).
  const northShift = portrait ? 0 : landscapeNorthShift(L, insets, northBacks);
  const reach = (rel: RelativePosition) =>
    landscapeNameReach(L, rel, {
      insets,
      southCards: seats.south?.cardCount ?? 9,
      northBacks,
    });
  // Tight North's avatar stays on the table's axis, its name running right.
  // East and West sit low beside North's pile (PID-393): their names run
  // under them, as on every upright phone.
  const besideName = !portrait || tight;
  // Both deals' backs fly in from the pack beside the dealer (PID-394).
  const dealer = dealerRel ?? 'south';
  const from = packSpot(L, dealer);
  const packBackW = northBackWidth(L.cardW, compactNorth(L));
  const taken = secondDeal?.taken ?? 0;
  const tightNorthLeft = width / 2 - size / 2;
  const seatWidth = (rel: RelativePosition) =>
    tight && rel === 'north'
      ? { maxWidth: northRight - PidroSpacing.sm - tightNorthLeft, gap: PidroSpacing.xs }
      : portrait
        ? rel === 'north' || rel === 'south'
          ? { width: centerColumn }
          : { width: sideColumn, paddingHorizontal: PidroSpacing.xs }
        : {
            maxWidth: size + gap + reach(rel),
            gap,
          };
  // What an upright seat's line has room for (PID-466): a side seat's column, less what a lit
  // plate reaches past the line; North and you keep the centre column, whose plate stays well
  // inside the screen (PID-450). Tight North's line runs right of its avatar, the plate past it.
  const lineRoom = (rel: RelativePosition, plated: boolean) =>
    tight && rel === 'north'
      ? northRight -
        PidroSpacing.sm -
        tightNorthLeft -
        size -
        PidroSpacing.xs -
        (plated ? PLATE_REACH : 0)
      : rel === 'east' || rel === 'west'
        ? sideColumn - 2 * (plated ? PLATE_REACH : PidroSpacing.xs)
        : centerColumn;
  const tableTop = insets.top + topReserve;
  // Floating portrait scores no longer mask the fan behind a header band.
  const northBackTop = northFanTop(L, tableTop);
  const northSeatTop = portrait
    ? northBackTop + northBackWidth(L.cardW, compactNorth(L)) * (110 / 78) + PidroSpacing.sm
    : tableTop + 8;
  const stacks = sideStacks(L);
  const sideBackW = stacks.backW;
  const stackedSeat = tight
    ? size
    : size +
      (parts.level ? parts.level.height + parts.level.bottom + 3 : 4) +
      parts.name.lineHeight +
      parts.status.lineHeight;
  // East and west sit above their side stacks, name and status included, so a
  // full stack never runs under them (`sideSeatTop`): on upright phones low
  // beside the trick, their backs closing up under them where the hand leaves
  // less room (PID-393). Landscape drops the stacks below the trick's center
  // line (L.sides), opening a gap under the seat; on the shortest phones the
  // seats eat into that drop instead.
  const sideSeatPos = {
    top: sideSeatTop(L, {
      tableTop,
      seatHeight: portrait ? stackedSeat : size,
      headerBottom: insets.top + TABLE_HEADER + PidroSpacing.xs,
    }),
  };
  // East's pack lies at the end of tight North's row: the name stops short of it.
  // Under Android's bars East's seat, its turn ring and badges included, rises
  // beside that row (PID-470): the name stops short of that ring too. A long
  // name keeps half its room, the least there is to give: East cannot sit lower.
  const eastRing = parts.turn?.radius ?? size / 2;
  const northRight = Math.min(
    dealer === 'east' && (packCount > 0 || taken > 0)
      ? from.x - (packBackW * (110 / 78)) / 2
      : width - insets.right,
    sideSeatPos.top + size / 2 - eastRing < northSeatTop + size
      ? width - insets.right - sideColumn / 2 - eastRing
      : Infinity
  );
  const handTop = L.hand.cy - L.cardH / 2;
  const sideReach = stacks.maxHeight;
  const sideStackCy =
    L.profile === 'tablet-portrait'
      ? Math.max(
          L.sides.cy,
          Math.min(sideSeatPos.top + stackedSeat + PidroSpacing.sm, stacks.lowestTop) +
            sideReach / 2
        )
      : L.sides.cy;
  const sideInset = portrait ? 0 : 12;
  // Upright, an invitation coming or going moves North, East and West: one
  // calm glide (PID-470). The stacks glide by their top, so a stack of `n` sits
  // centred on its line as before.
  const sideBacks = (rel: 'east' | 'west') =>
    clamp(seats[rel]?.out ? 0 : (seats[rel]?.cardCount ?? 0), 0, 13);
  const stackTop = (rel: 'east' | 'west') => {
    const n = sideBacks(rel);
    return (
      sideStackCy - (sideBackW + Math.max(0, n - 1) * sideStackStep(L.cardW, n, sideReach)) / 2
    );
  };
  const glide = {
    northBacks: useGlide(portrait ? northBackTop : 0),
    northSeat: useGlide(portrait ? northSeatTop : 0),
    sideSeat: useGlide(portrait ? sideSeatPos.top : 0),
    eastBacks: useGlide(portrait ? stackTop('east') : 0),
    westBacks: useGlide(portrait ? stackTop('west') : 0),
  };
  // The rob: the rest of the pack slides to the dealer's backs, or your hand.
  const sideEdge = (rel: 'east' | 'west') => {
    const edge = rel === 'east' ? insets.right : insets.left;
    const inset = edge > 0 ? edge : -Math.min(L.cardW * 0.28, 18);
    const half = (sideBackW * (110 / 78)) / 2;
    return rel === 'west' ? inset + half : width - inset - half;
  };
  const dealerBacks =
    dealer === 'north'
      ? {
          x: width / 2 - northShift,
          y: northBackTop + (northBackWidth(L.cardW, compactNorth(L)) * (110 / 78)) / 2,
        }
      : dealer === 'south'
        ? { x: L.hand.cx, y: L.hand.cy }
        : { x: sideEdge(dealer), y: sideStackCy };

  const shown = (rel: RelativePosition, data: TableSeat) => {
    const line = quiet ? null : seatLine(data, statusByRel?.[rel], firstHand);
    // A spectator sees North–South as the first team.
    const team = whosePoints(data.absolutePosition, viewer).column;
    const seat = quiet
      ? {
          ...avatarFor(data, false, null, undefined, team),
          level: null,
          turn: null,
          plate: null,
        }
      : {
          ...avatarFor(data, dealerRel === rel, line, turnByRel?.[rel], team, nudge),
          ...(!levels && { level: null }),
        };
    // Your tight seat's line alone, under your avatar: your turn, or a short line when it has one.
    const tightLine =
      seat.plate === 'turn' && seat.status !== line?.text ? seat.status : (line?.short ?? null);
    return { line, team, seat, tightLine };
  };
  // What talk keeps clear of (PID-471), in this layer's points: each seat's ring, with its
  // turn light or dealer chip, and its name and line on their plate, from their own layouts.
  // Always measured, so a table that turns talk on later already knows where its seats are.
  const frame =
    (key: string) =>
    ({ nativeEvent: { layout } }: LayoutChangeEvent) =>
      setFrames((was) =>
        was[key] && (['x', 'y', 'width', 'height'] as const).every((k) => was[key][k] === layout[k])
          ? was
          : { ...was, [key]: layout }
      );
  const drawn = (rel: RelativePosition) => {
    const data = seats[rel];
    const [place, avatarAt, ringAt] = ['place', 'avatar', 'ring'].map((k) => frames[`${k}-${rel}`]);
    if (!data || !place || !avatarAt || !ringAt) return null;
    const { seat, tightLine } = shown(rel, data);
    // Upright, North's and the side seats' views glide to their tops (PID-470): their frames start at 0.
    const glided = !portrait
      ? 0
      : rel === 'north'
        ? northSeatTop
        : rel === 'east' || rel === 'west'
          ? sideSeatPos.top
          : 0;
    const x = place.x + avatarAt.x;
    const y = glided + place.y + avatarAt.y;
    const halo = Math.max(
      seat.turn && parts.turn ? parts.turn.radius + parts.turn.stroke - size / 2 : 0,
      seat.dealer && parts.dealer ? -parts.dealer.left : 0
    );
    const ring = { x: x + ringAt.x, y: y + ringAt.y, width: size, height: size };
    // Your tight seat drops its name and line when it has nothing to say: their last frame stays.
    const copyAt =
      tight && rel === 'south' && data.isYou && tightLine == null ? null : frames[`copy-${rel}`];
    const edge = seat.plate ? PLATE_REACH : 0;
    return {
      ring,
      lit: grow(ring, halo, halo),
      copy:
        copyAt && grow({ ...copyAt, x: x + copyAt.x, y: y + copyAt.y }, edge, seat.plate ? 6 : 0),
    };
  };
  // The cards: North's fan, the side stacks, your hand, the trick and the dealer's pack.
  const cards: Box[] = [
    ...(northBacks > 0
      ? [
          (() => {
            const fan = northFanWidth(L.cardW, northBacks, compactNorth(L));
            const backH = northBackWidth(L.cardW, compactNorth(L)) * (110 / 78);
            // The outer backs tilt out past the fan's width.
            return grow(
              { x: width / 2 - northShift - fan / 2, y: northBackTop, width: fan, height: backH },
              backH / 5,
              4
            );
          })(),
        ]
      : []),
    ...(['west', 'east'] as const).flatMap((rel) => {
      const n = seats[rel]?.out ? 0 : (seats[rel]?.cardCount ?? 0);
      if (n === 0) return [];
      const backsW = sideBackW * (110 / 78);
      const edge = (rel === 'east' ? insets.right : insets.left) || -Math.min(L.cardW * 0.28, 18);
      const tall = sideBackW + (n - 1) * sideStackStep(L.cardW, n, sideReach);
      return [
        grow(
          {
            x: rel === 'west' ? edge : width - edge - backsW,
            y: sideStackCy - tall / 2,
            width: backsW,
            height: tall,
          },
          4,
          4
        ),
      ];
    }),
    { x: 0, y: southRow(L).bottom, width, height },
    grow(
      { x: L.trick.cx, y: L.trick.cy, width: 0, height: 0 },
      L.trick.r + (L.cardW * L.trick.pileScale) / 2,
      L.trick.r + (L.cardH * L.trick.pileScale) / 2
    ),
    ...(packCount > 0 || taken > 0
      ? [grow({ x: from.x, y: from.y, width: 0, height: 0 }, packBackW, packBackW)]
      : []),
    // The screen's sides, inside the safe area.
    { x: -width, y: -height, width: width + insets.left, height: 3 * height },
    { x: width - insets.right, y: -height, width, height: 3 * height },
  ];
  // Upright only: landscape and its seats keep the places they had.
  const clearance = (rel: RelativePosition, instead: SaidAt[]): Clearance | undefined => {
    const own = portrait ? drawn(rel) : null;
    if (!own) return undefined;
    const boxes = [...cards];
    for (const other of REL) {
      const them = other === rel ? null : drawn(other);
      if (them) boxes.push(them.lit, ...(them.copy ? [them.copy] : []));
    }
    return { ring: own.ring, own: own.copy ?? null, boxes, instead };
  };

  return (
    <View style={[StyleSheet.absoluteFill, quiet && styles.quiet]} pointerEvents="box-none">
      {seats.south && !seats.south.isYou ? (
        <View
          testID="seat-south-cards"
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: L.hand.cy - (northBackWidth(L.cardW, compactNorth(L)) * (110 / 78)) / 2,
            alignItems: 'center',
          }}>
          <BacksFan
            count={seats.south.out ? 0 : (seats.south.cardCount ?? 0)}
            cardW={L.cardW}
            compact={compactNorth(L)}
            held={held}
            dealing={dealing}
            originX={from.x - width / 2}
            originY={from.y - L.hand.cy}
          />
        </View>
      ) : null}
      {packCount > 0 || taken > 0 ? (
        <Pack
          count={packCount || taken}
          backW={packBackW}
          cx={from.x}
          cy={from.y}
          sideways={from.sideways}
          to={packCount > 0 ? null : dealerBacks}
        />
      ) : null}
      {REL.map((rel) => {
        const folded = seats[rel]?.foldedCount ?? 0;
        const thrown = secondDeal?.thrown[rel] ?? folded;
        if (!seats[rel] || thrown === 0) return null;
        const foldingHand = !secondDeal && folded > 0;
        const throwing = foldingHand ? null : throwPile(L, rel, thrown);
        const backH = northBackWidth(L.cardW, compactNorth(L)) * (110 / 78);
        // Landscape phones throw from just inside the hand, never from behind
        // North's backs or a side stack (PID-307).
        const from =
          L.front && !foldingHand && rel !== 'south'
            ? L.seats[rel]
            : rel === 'north'
              ? {
                  x: width / 2 - northShift,
                  // Landscape's held fan bleeds offscreen; tuck its fold just below that edge.
                  y: (foldingHand ? Math.max(insets.top, northBackTop) : northBackTop) + backH / 2,
                }
              : rel === 'south'
                ? {
                    x: L.hand.cx,
                    // Landscape phones hold the hand past the bottom edge;
                    // its fold stays on the table, its tilt clear of the edge (PID-307).
                    y: L.front
                      ? Math.min(
                          L.hand.cy,
                          L.bottom - (L.cardW * L.trick.pileScale * 0.82 * (110 / 78)) / 2 - 1.5
                        )
                      : L.hand.cy,
                  }
                : {
                    // Landscape phones fold a side hand inside its stack's
                    // column, short of its front row (PID-305).
                    x: L.front
                      ? rel === 'west'
                        ? (insets.left + sideStackInner(L.cardW, insets.left)) / 2
                        : width - (insets.right + sideStackInner(L.cardW, insets.right)) / 2
                      : rel === 'west'
                        ? insets.left + sideBackW * 0.7
                        : width - insets.right - sideBackW * 0.7,
                    y: sideStackCy,
                  };
        // Faces in the canvas's art for them (PID-467): yours by your hand's size.
        const facePx =
          (rel === 'south' ? L.cardW * handScale(L.profile) : L.cardW * L.trick.pileScale) *
          PixelRatio.get();
        return (
          <ThrownPile
            key={`thrown-${rel}`}
            rel={rel}
            faces={foldingHand ? undefined : secondDeal?.faces?.[rel]}
            facePx={facePx}
            count={thrown}
            folded={foldingHand}
            animate={!foldingHand || folding.includes(rel)}
            fromStep={
              rel === 'south'
                ? handStep(L, thrown)
                : rel === 'north'
                  ? northFanStep(L.cardW, thrown, compactNorth(L))
                  : sideStackStep(L.cardW, thrown, sideReach)
            }
            from={from}
            // Cold hands fold where they were held; only second-deal throws cross the felt.
            at={throwing ? (i) => throwing.spots[i] : undefined}
            square={!!L.front}
            cardW={
              throwing
                ? throwing.w
                : (rel === 'south'
                    ? L.cardW * L.trick.pileScale
                    : rel === 'north'
                      ? northBackWidth(L.cardW, compactNorth(L))
                      : // Narrower on landscape phones, to fit the stack's column.
                        sideBackW * (L.front ? 0.85 : 1)) * 0.82
            }
          />
        );
      })}
      {REL.map((rel) => {
        const data = seats[rel];
        if (!data) return null;
        const { line, team, seat, tightLine } = shown(rel, data);
        const holds = !quiet && bid?.seat === rel ? bid.amount : null;
        // What the seat says aloud, its winning bid included.
        const spoken = { ...seat, bid: holds };
        const labelSide =
          besideName && !((L.sidesUnder || portrait) && (rel === 'east' || rel === 'west'))
            ? rel === 'east'
              ? 'left'
              : 'right'
            : 'below';
        const identity = (
          <PlayerAvatar
            testID={`seat-${rel}`}
            size={size}
            seat
            onCopyLayout={frame(`copy-${rel}`)}
            label={labelSide}
            bid={holds != null ? { amount: holds, tone: team } : null}
            dealerTrail={dealerTrail}
            nameRoom={
              // Tight North's name runs beside its avatar, up to the pack where East deals.
              tight && rel === 'north'
                ? lineRoom('north', false)
                : L.sidesUnder && (rel === 'east' || rel === 'west')
                  ? (L.sideSeatWidth ?? SIDE_SEAT_WIDTH)
                  : !portrait
                    ? reach(rel)
                    : rel === 'north' || rel === 'south'
                      ? centerColumn
                      : sideColumn - PidroSpacing.xs * 2
            }
            style={[
              tight && rel === 'south' && data.isYou
                ? // Room for "Your turn" on its plate.
                  { width: size * 2 }
                : L.sidesUnder && (rel === 'east' || rel === 'west')
                  ? { width: L.sideSeatWidth ?? SIDE_SEAT_WIDTH }
                  : seatWidth(rel),
              // Out without its plate (its last card still on the table): the seat sits back whole.
              data.out && seat.plate !== 'out' && styles.out,
            ]}
            {...seat}
            {...(tight && { level: null })}
            /* Tight, your own seat says only its short line; a spectator's South keeps its name. */
            {...(tight &&
              rel === 'south' &&
              !data.isYou && {
                label: 'below' as const,
                status: null,
                accessibilityLabel: avatarLabel({ ...spoken, level: null }),
              })}
            {...(tight &&
              rel === 'south' &&
              data.isYou && {
                label: 'below' as const,
                name: null,
                status: tightLine,
                accessibilityLabel: avatarLabel({ ...spoken, level: null }),
              })}
            {...(!portrait &&
              (rel === 'south' || rel === 'north') &&
              (line || seat.plate) && {
                // "Your turn" has no short form: where it won't fit, the lit plate says it.
                fit: {
                  room: reach(rel) - (seat.plate ? PLATE_REACH : 0),
                  short: line && seat.status === line.text ? (line.short ?? null) : null,
                },
              })}
            /* Upright, a line laid out too wide for its column says "High 14" or "Trump…", and a lit plate keeps whole on screen (PID-450, PID-466). */
            {...(portrait &&
              !(tight && rel === 'south' && data.isYou) && {
                fit: lineFit(seat.status ?? null, line, lineRoom(rel, !!seat.plate)),
              })}
            /* Landscape side seats give the line their name's room; their plates stay clear of the screen's edge (PID-450). */
            {...(!portrait &&
              (rel === 'east' || rel === 'west') && {
                fit: lineFit(
                  seat.status ?? null,
                  line,
                  L.sidesUnder ? (L.sideSeatWidth ?? SIDE_SEAT_WIDTH) : reach(rel)
                ),
              })}
          />
        );
        const pressable = onProfile?.[rel] ? (
          <PressableFX
            accessibilityRole="button"
            accessibilityLabel={`${t('friends.view_profile', {
              name: data.username ?? t('social.player'),
            })}, ${avatarLabel({ ...spoken, ...(tight && { level: null }) })}`}
            onPress={onProfile[rel]}
            style={{ minHeight: PidroLayout.touchTarget, minWidth: PidroLayout.touchTarget }}>
            {identity}
          </PressableFX>
        ) : (
          <View pointerEvents="none">{identity}</View>
        );
        // Drawn once on Android, its lights inside the bleed. A breathing seat stays live, and so
        // do quiet seats: a layer would fade as one image, unlike the views it holds.
        const still = (
          <StillLayer
            bleed={Math.ceil(size * 0.95)}
            live={quiet || !!seat.turn?.attention || sliding?.rel === rel}>
            {pressable}
          </StillLayer>
        );
        const talk = said?.[rel];
        // What the seat said lands at its ring, never over the cards or the
        // trick: side seats above, North and you beside it, landscape North below.
        // Where it lands first, then where it goes when its longest word will not fit there,
        // short of every seat and card (PID-471): side seats above their rings, then beside
        // them toward the trick; North and you beside, then the other side; landscape North below.
        const places: SaidAt[] =
          rel === 'east'
            ? ['aboveEnd', 'besideStart']
            : rel === 'west'
              ? ['aboveStart', 'besideEnd']
              : !portrait
                ? [rel === 'north' ? 'below' : 'aboveStart']
                : rel === 'north' && tight
                  ? ['besideStart', 'below']
                  : rel === 'north'
                    ? ['besideEnd', 'besideStart']
                    : ['besideEnd', 'besideStart', 'aboveStart'];
        const landing = talk ? talk(places[0], size, clearance(rel, places.slice(1))) : null;
        // Always this wrapper, so a landing never remounts the avatar.
        const avatar = (
          <View pointerEvents="box-none" onLayout={frame(`avatar-${rel}`)}>
            {still}
            <View
              pointerEvents="none"
              onLayout={frame(`ring-${rel}`)}
              style={[
                styles.ring,
                { width: size, height: size },
                // Not `left: '50%'`: this wrapper hugs its seat, and native layout takes the
                // percentage of the screen instead (web does not), landing far from the ring.
                labelSide === 'below' || (tight && rel === 'south')
                  ? { alignSelf: 'center' }
                  : labelSide === 'right'
                    ? { left: 0 }
                    : { right: 0 },
              ]}>
              {landing}
            </View>
          </View>
        );

        if (rel === 'south' && tight) {
          // Your avatar alone, centred in your seat row above your hand
          // (PID-464), its short line under it when there is one (your bid,
          // while the hand is bid); the label still speaks.
          return (
            <View
              key={rel}
              pointerEvents="box-none"
              onLayout={frame(`place-${rel}`)}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: southRow(L).top + TIGHT_SOUTH_GAP,
                alignItems: 'center',
              }}>
              {avatar}
            </View>
          );
        }
        if (rel === 'south') {
          // Upright, your seat stands on its row over your hand (PID-464).
          return (
            <View
              key={rel}
              pointerEvents="box-none"
              onLayout={frame(`place-${rel}`)}
              style={
                portrait
                  ? {
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: height - southRow(L).bottom,
                      alignItems: 'center',
                    }
                  : {
                      position: 'absolute',
                      left: landscapeSouthLeft,
                      top: landscapeSouthY(L) - size / 2,
                    }
              }>
              {avatar}
            </View>
          );
        }
        if (rel === 'north') {
          return (
            <View key={rel} style={StyleSheet.absoluteFill} pointerEvents="box-none">
              <Animated.View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, glide.northBacks]}>
                <View
                  testID="seat-north-cards"
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: portrait ? 0 : northBackTop,
                    left: 0,
                    right: 0,
                    alignItems: 'center',
                    transform: [{ translateX: -northShift }],
                  }}>
                  <BacksFan
                    count={data.out ? 0 : (data.cardCount ?? 0)}
                    cardW={L.cardW}
                    compact={compactNorth(L)}
                    held={held}
                    dealing={dealing}
                    originX={from.x - (width / 2 - northShift)}
                    originY={from.y - northBackTop}
                  />
                </View>
              </Animated.View>
              <Animated.View
                pointerEvents="box-none"
                style={[StyleSheet.absoluteFill, glide.northSeat]}>
                <View
                  pointerEvents="box-none"
                  onLayout={frame(`place-${rel}`)}
                  style={
                    tight
                      ? { position: 'absolute', top: 0, left: tightNorthLeft }
                      : portrait
                        ? {
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            alignItems: 'center',
                          }
                        : {
                            position: 'absolute',
                            top: northSeatTop,
                            left: landscapeNorthLeft(L, insets, northBacks),
                          }
                  }>
                  {avatar}
                </View>
              </Animated.View>
            </View>
          );
        }
        // East / west card-backs keep hugging the edges, their seats above them.
        // They bleed past a bare screen edge but never into an inset: in
        // landscape the Dynamic Island sits on one of these sides.
        // Landscape phones seat them at the inner top corner of their stack,
        // above their front row (PID-305).
        const edgeOffset = Math.min(L.cardW * 0.28, 18);
        const sideEdge = rel === 'east' ? insets.right : insets.left;
        const backsInset = sideEdge > 0 ? sideEdge : -edgeOffset;
        const seatEdge = L.front
          ? sideStackInner(L.cardW, sideEdge) + SIDE_SEAT_GAP
          : sideEdge + sideInset;
        const seatTop = L.sidesUnder
          ? { top: landscapeSideSeatTop(L, rel, stackedSeat) }
          : portrait
            ? { top: 0 }
            : sideSeatPos;
        const seatPos =
          rel === 'east' ? { ...seatTop, right: seatEdge } : { ...seatTop, left: seatEdge };
        const backsEdge = rel === 'east' ? { right: backsInset } : { left: backsInset };
        return (
          <View key={rel} style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <Animated.View
              pointerEvents="box-none"
              style={[StyleSheet.absoluteFill, glide.sideSeat]}>
              <View
                style={[{ position: 'absolute' }, seatPos]}
                pointerEvents="box-none"
                onLayout={frame(`place-${rel}`)}>
                {avatar}
              </View>
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, rel === 'east' ? glide.eastBacks : glide.westBacks]}>
              <View
                testID={`seat-${rel}-cards`}
                pointerEvents="none"
                style={[
                  {
                    position: 'absolute',
                    top: 0,
                    ...(!portrait && { height: sideStackCy * 2 }),
                    justifyContent: 'center' as const,
                    alignItems: 'center' as const,
                  },
                  backsEdge,
                ]}>
                <BacksStackV
                  seat={rel}
                  count={data.out ? 0 : (data.cardCount ?? 0)}
                  cardW={L.cardW}
                  reach={sideReach}
                  held={held}
                  dealing={dealing}
                  originX={
                    rel === 'west'
                      ? from.x - backsInset
                      : from.x - (width - backsInset - sideBackW * (110 / 78))
                  }
                  originDy={from.y - sideStackCy}
                />
              </View>
            </Animated.View>
          </View>
        );
      })}
      {REL.map((rel) => {
        const count = drew?.[rel];
        const n = seats[rel]?.cardCount ?? 0;
        if (count == null || !seats[rel] || n === 0) return null;
        // On the corner of the backs toward the table, clear of the seat's name and badges.
        const northBackH = northBackWidth(L.cardW, compactNorth(L)) * (110 / 78);
        const stackTop =
          sideStackCy - (sideBackW + (n - 1) * sideStackStep(L.cardW, n, sideReach)) / 2;
        const at =
          rel === 'north'
            ? {
                // Landscape North's seat sits right of its fan: the chip takes the left corner.
                x:
                  width / 2 -
                  northShift +
                  ((portrait ? 1 : -1) * northFanWidth(L.cardW, n, compactNorth(L))) / 2,
                y: northBackTop + northBackH,
              }
            : rel === 'south'
              ? { x: handRight(L, n), y: L.hand.cy - L.cardH / 2 }
              : {
                  // On the stack's inner corner, short of the pile's column beside it.
                  x:
                    rel === 'west'
                      ? sideStackInner(L.cardW, insets.left) - TRICK_GAP
                      : width - sideStackInner(L.cardW, insets.right) + TRICK_GAP,
                  y: stackTop + DREW_CHIP_H / 2,
                };
        return <DrewChip key={`drew-${rel}`} testID={`drew-${rel}`} count={count} {...at} />;
      })}
    </View>
  );
}

function BacksFan({
  count,
  cardW,
  dealing,
  originX = 0,
  originY,
  compact = false,
  held = HELD_STYLE,
}: {
  held?: HeldStyle;
  count: number;
  cardW: number;
  /** Landscape phones' smaller fan (`compactNorth`). */
  compact?: boolean;
  dealing: boolean;
  /** How far the felt's center sits right of the fan's own. */
  originX?: number;
  originY: number;
}) {
  const n = clamp(count, 0, 13);
  if (n === 0) return null;
  const w = northBackWidth(cardW, compact);
  const h = w * (110 / 78);
  const overlap = northFanStep(cardW, n, compact);
  const total = w + (n - 1) * overlap;
  return (
    <View style={{ width: total, height: h }}>
      {Array.from({ length: n }, (_, i) => (
        <FlyingBack
          key={i}
          source={BACK}
          index={i}
          dealing={dealing}
          x={i * overlap + heldPose(held, `north-x-${i}`, 0).dy}
          // North faces you: its fan turns the other way.
          y={heldPose(held, `north-${i}`, (n - 1) / 2 - i).dy}
          tilt={heldPose(held, `north-${i}`, (n - 1) / 2 - i).tilt}
          originX={total / 2 - w / 2 + originX}
          originY={originY - h / 2}
          w={w}
          h={h}
        />
      ))}
    </View>
  );
}

/**
 * Cubic in and out, its progress held to 0–1: a browser's first frame can
 * come before the glide starts, and the curve would run the seat backwards.
 */
function calm(t: number) {
  'worklet';
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (2 - 2 * x) ** 3 / 2;
}
const SEAT_GLIDE = { duration: 280, easing: calm };

/** A translate to `top`, gliding there from the last one; at once with Reduce Motion. */
function useGlide(top: number) {
  const reducedMotion = useReducedMotion();
  const y = useSharedValue(top);
  useEffect(() => {
    y.value = reducedMotion ? top : withTiming(top, SEAT_GLIDE);
  }, [top, reducedMotion, y]);
  return useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
}

function BacksStackV({
  seat,
  count,
  cardW,
  reach,
  dealing,
  originX,
  originDy = 0,
  held = HELD_STYLE,
}: {
  seat: RelativePosition;
  held?: HeldStyle;
  count: number;
  cardW: number;
  /** How tall a full stack may draw. */
  reach: number;
  dealing: boolean;
  originX: number;
  /** How far the felt's center sits below (+) or above (−) the stack's own. */
  originDy?: number;
}) {
  const n = clamp(count, 0, 13);
  if (n === 0) return null;
  const cw = sideBackWidth(cardW); // portrait back
  const ch = cw * (110 / 78);
  const visW = ch;
  const visH = cw;
  const overlap = sideStackStep(cardW, n, reach);
  return (
    <View style={{ width: visW, height: visH + (n - 1) * overlap }}>
      {Array.from({ length: n }, (_, i) => (
        <FlyingBack
          key={i}
          source={BACK}
          index={i}
          dealing={dealing}
          x={heldPose(held, `${seat}-${i}`, i - (n - 1) / 2).dy}
          y={i * overlap + heldPose(held, `${seat}-y-${i}`, 0).dy}
          tilt={heldPose(held, `${seat}-${i}`, i - (n - 1) / 2).tilt}
          originX={originX - visW / 2}
          originY={((n - 1) * overlap) / 2 + originDy}
          w={cw}
          h={ch}
          sideways
        />
      ))}
    </View>
  );
}

/**
 * The pack beside the dealer while they deal from it: thicker the more it
 * holds (`packLayers`). Each card sits a touch off square, fixed by its place
 * in the pack, so it looks handled rather than machine-stacked and never
 * wobbles between frames. `sideways` turns each back a quarter, as a side
 * stack's. Given `to`, the dealer takes it: one slide there.
 */
function Pack({
  count,
  backW,
  cx,
  cy,
  sideways,
  to,
}: {
  count: number;
  backW: number;
  cx: number;
  cy: number;
  sideways: boolean;
  to: { x: number; y: number } | null;
}) {
  const h = backW * (110 / 78);
  const [fw, fh] = sideways ? [h, backW] : [backW, h];
  const step = backW * PACK_STEP;
  const pose = (i: number) => heldPose('tilt', `pack-${i}`, 0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const opacity = useSharedValue(1);
  const toX = to?.x;
  const toY = to?.y;
  useEffect(() => {
    if (toX == null || toY == null) {
      tx.value = 0;
      ty.value = 0;
      opacity.value = 1;
      return;
    }
    const config = { duration: SECOND_DEAL_FLIGHT_MS, easing: Easing.inOut(Easing.cubic) };
    tx.value = withTiming(toX - cx, config);
    ty.value = withTiming(toY - cy, config);
    // It fades into the dealer's own backs as it reaches them.
    const fade = SECOND_DEAL_FLIGHT_MS * 0.4;
    opacity.value = withDelay(SECOND_DEAL_FLIGHT_MS - fade, withTiming(0, { duration: fade }));
  }, [toX, toY, cx, cy, tx, ty, opacity]);
  const motion = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));
  return (
    <Animated.View
      testID="dealer-pack"
      pointerEvents="none"
      accessibilityElementsHidden
      style={[{ position: 'absolute', left: cx - fw / 2, top: cy - fh / 2 }, motion]}>
      {Array.from({ length: packLayers(count) }, (_, i) => (
        <Back
          key={i}
          w={backW}
          h={h}
          style={{
            position: 'absolute',
            left: (fw - backW) / 2 + i * step * 0.55 + pose(i).dy * 1.2,
            top: (fh - h) / 2 - i * step,
            transform: [{ rotate: `${(sideways ? 90 : 0) + pose(i).tilt * 2.2}deg` }],
          }}
        />
      ))}
    </Animated.View>
  );
}

/**
 * Second-deal throws spread in front of their seat to be counted (`at`
 * places each card), then clear. Cold hands collapse into a small face-down
 * stack in their own hand area.
 */
function ThrownPile({
  rel,
  count,
  from,
  at,
  cardW,
  folded = false,
  animate = true,
  fromStep = 0,
  faces,
  facePx = 0,
  square = false,
}: {
  rel: RelativePosition;
  count: number;
  /** Landscape phones lay a pile square, as Classic does, to keep its gaps (PID-307). */
  square?: boolean;
  /** Face up: the thrower's own, or killed trumps (PID-306). */
  faces?: Card[];
  /** The size in device px the canvas draws these faces at, for their art. */
  facePx?: number;
  from: { x: number; y: number };
  at?: (i: number) => { x: number; y: number };
  cardW: number;
  folded?: boolean;
  animate?: boolean;
  fromStep?: number;
}) {
  const reducedMotion = useReducedMotion();
  // Joining an already-cold table shows the pile without replaying a fold.
  const [moving] = useState(animate && !reducedMotion);
  const cardH = cardW * (110 / 78);
  const sideways = rel === 'east' || rel === 'west';
  return (
    <Animated.View
      testID={folded ? `seat-${rel}-folded` : `second-deal-thrown-${rel}`}
      accessibilityElementsHidden
      pointerEvents="none"
      exiting={folded ? undefined : FadeOut.duration(SECOND_DEAL_FLIGHT_MS)}
      style={StyleSheet.absoluteFill}>
      {Array.from({ length: count }, (_, i) => {
        const off = (i - (count - 1) / 2) * cardW * 0.1;
        const heldOff = (i - (count - 1) / 2) * fromStep;
        const spot = at?.(i) ?? {
          x: from.x + (sideways ? 0 : off),
          y: from.y + (sideways ? off : 0),
        };
        return (
          <ThrownBack
            key={i}
            from={
              folded
                ? {
                    x: from.x + (sideways ? 0 : heldOff),
                    y: from.y + (sideways ? heldOff : 0),
                  }
                : from
            }
            x={spot.x}
            y={spot.y}
            w={cardW}
            h={cardH}
            // A thrown card never lands quite square.
            // Faces lie as played cards do, their tops toward the middle.
            rot={
              (rel === 'east' && faces ? -90 : sideways ? 90 : 0) +
              (square && !folded ? 0 : ((i * 37) % 7) - 3)
            }
            delay={folded ? 0 : i * SECOND_DEAL_SWOOP_STAGGER_MS}
            duration={folded ? FOLD_FLIGHT_MS : SECOND_DEAL_FLIGHT_MS}
            moving={moving}
            folded={folded}
            face={faces?.[i] && faceImage(faces[i], facePx)}
          />
        );
      })}
    </Animated.View>
  );
}

function ThrownBack({
  from,
  x,
  y,
  w,
  h,
  rot,
  delay,
  duration,
  moving,
  folded,
  face,
}: {
  face?: ImageSourcePropType;
  duration: number;
  moving: boolean;
  folded: boolean;
  delay: number;
  from: { x: number; y: number };
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
}) {
  const tx = useSharedValue((moving ? from.x : x) - w / 2);
  const ty = useSharedValue((moving ? from.y : y) - h / 2);
  const turn = useSharedValue(rot - (moving && !folded ? 25 : 0));
  useEffect(() => {
    const config = { duration: moving ? duration : 0, easing: Easing.out(Easing.cubic) };
    tx.value = withDelay(delay, withTiming(x - w / 2, config));
    ty.value = withDelay(delay, withTiming(y - h / 2, config));
    turn.value = withDelay(delay, withTiming(rot, config));
  }, [x, y, w, h, rot, delay, duration, moving, tx, ty, turn]);
  const motion = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { rotate: `${turn.value}deg` }],
  }));
  return (
    <Animated.View style={[{ position: 'absolute', width: w, height: h }, motion]}>
      {face ? (
        <Image
          testID="thrown-face"
          source={face}
          // Android fades an image in over 300 ms by default (PID-469).
          fadeDuration={0}
          accessibilityIgnoresInvertColors
          style={{ width: w, height: h, borderRadius: BACK_RADIUS }}
        />
      ) : (
        <Back w={w} h={h} />
      )}
    </Animated.View>
  );
}

function FlyingBack({
  source,
  index,
  dealing,
  x,
  y,
  originX,
  originY,
  w,
  h,
  sideways = false,
  tilt = 0,
}: {
  source: ImageSourcePropType;
  index: number;
  dealing: boolean;
  /** Degrees off square, as a hand holds it. */
  tilt?: number;
  x: number;
  y: number;
  originX: number;
  originY: number;
  w: number;
  h: number;
  sideways?: boolean;
}) {
  const first = useRef(true);
  const tx = useSharedValue(dealing ? originX : x);
  const ty = useSharedValue(dealing ? originY : y);
  const opacity = useSharedValue(dealing ? 0 : 1);
  const scale = useSharedValue(dealing ? 0.85 : 1);
  useEffect(() => {
    const delay = first.current && dealing ? (index % 3) * DEAL_PACKET_CARD_STAGGER_MS : 0;
    const config = { duration: DEAL_PACKET_TRAVEL_MS, easing: Easing.out(Easing.back(1.15)) };
    tx.value = withDelay(delay, withTiming(x, config));
    ty.value = withDelay(delay, withTiming(y, config));
    opacity.value = withDelay(delay, withTiming(1, { duration: 70 }));
    scale.value = withDelay(delay, withTiming(1, config));
    first.current = false;
  }, [x, y, dealing, index, tx, ty, opacity, scale]);
  const motion = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: sideways ? h : w,
          height: sideways ? w : h,
          alignItems: 'center',
          justifyContent: 'center',
        },
        motion,
      ]}>
      <Back
        source={source}
        w={w}
        h={h}
        style={{ transform: [{ rotate: `${(sideways ? 90 : 0) + tilt}deg` }] }}
      />
    </Animated.View>
  );
}

/**
 * A card back on its shadow. The shadow is blurred once per size: a blurred
 * `boxShadow` under a tilted or moving card blurs again every frame. Web never
 * drew one (react-native-web drops an Image's `boxShadow`), and still does not.
 */
function Back({
  w,
  h,
  source = BACK,
  style,
}: {
  w: number;
  h: number;
  source?: ImageSourcePropType;
  style?: ImageStyle;
}) {
  const shadow =
    Platform.OS === 'web'
      ? null
      : bakedShadow({ x: 0, y: 1, width: w, height: h, r: BACK_RADIUS }, 1.5, BACK_SHADOW);
  const back = <Image source={source} style={[styles.back, { width: w, height: h }, style]} />;
  if (!shadow) return back;
  return (
    <View style={[{ width: w, height: h }, style]}>
      <Image
        source={{ uri: shadow.uri }}
        fadeDuration={0}
        style={{
          position: 'absolute',
          left: shadow.x,
          top: shadow.y,
          width: shadow.width,
          height: shadow.height,
        }}
      />
      <Image source={source} style={[styles.back, { width: w, height: h }]} />
    </View>
  );
}

const BACK_RADIUS = 4;
const BACK_SHADOW = 'rgba(0,0,0,0.55)';

const styles = StyleSheet.create({
  ring: { position: 'absolute', top: 0, zIndex: 30 },
  out: { opacity: 0.6 },
  // Under the hand result's scrim the seats fade back further, as on the board.
  quiet: { opacity: 0.8 },
  // A solid light edge on a solid card, and a shadow under it, so
  // overlapping backs read as separate cards: nothing shows through.
  back: {
    borderRadius: BACK_RADIUS,
    borderWidth: 1.5,
    borderColor: PidroColors.text,
    backgroundColor: PidroBevel.panelMid,
    overflow: 'hidden',
  },
});
