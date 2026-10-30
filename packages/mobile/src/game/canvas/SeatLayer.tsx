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
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
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
  Platform,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type ImageStyle,
} from 'react-native';
import {
  DEALER_SLIDE_MS,
  PlayerAvatar,
  type DealerTrail,
  type PlayerAvatarProps,
} from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { StillLayer } from '@/components/ui/StillLayer';
import { PidroBevel, PidroColors, PidroLayout, PidroSpacing } from '@/design/tokens';
import { avatarLabel, avatarParts, textFits } from '@/features/avatar';
import { seatLine, type SeatLine } from '@/features/game/seatLine';
import { whosePoints } from '@/features/game/points';
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
  type HeldStyle,
  northFanTop,
  packSpot,
  northFanStep,
  sideStackStep,
  pileCardW,
  pileSpot,
  seatNameGap,
  sideBackWidth,
  sideSeatTop,
  landscapeSideSeatTop,
  SIDE_SEAT_WIDTH,
  sideStackInner,
  SIDE_SEAT_GAP,
  sideStacks,
  TIGHT_AVATAR,
  TIGHT_SOUTH_GAP,
  type RelativePosition,
} from './layout';
import { viewerOf } from './HandResult';
import { TABLE_HEADER, useTableInsets, useTableSize } from './TableChrome';
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
import { getCardImage } from '@/utils/cardImages';

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
  team: 'us' | 'them'
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
  return {
    uri: data.avatar_url,
    level: data.level,
    pin: data.pin,
    dealer,
    turn: onTurn
      ? {
          progress: turn?.progress ?? 1,
          urgent: turn?.urgent ?? false,
          endsAt: turn?.endsAt,
          durationMs: turn?.durationMs,
          attention: data.isYou,
        }
      : null,
    away,
    kind,
    persona: crew,
    botProfile: data.bot_profile,
    name: kind === 'open' ? null : data.username,
    status: line?.text ?? null,
    pulse: line?.pulse ?? null,
    // Two against two at a glance: the name is in its team's colour.
    nameTone: team,
    statusTone:
      line?.tone === 'now' && onTurn && turn?.urgent
        ? 'warning'
        : kind === 'bot' && line?.tone !== 'high'
          ? 'quiet'
          : (line?.tone ?? 'default'),
  };
}

type Props = {
  seats: Record<RelativePosition, TableSeat | null>;
  dealing?: boolean;
  dealerRel?: RelativePosition | null;
  topReserve?: number;
  bottomReserve?: number;
  statusByRel?: Partial<Record<RelativePosition, SeatLine | null>>;
  turnByRel?: Partial<Record<RelativePosition, SeatTurn>>;
  onProfile?: Partial<Record<RelativePosition, () => void>>;
  /** A hand's result is showing: avatar and name only (PID-236). */
  quiet?: boolean;
  /** The second deal playing out: the pack, what each seat threw. */
  secondDeal?: SecondDealShow;
  /** Killed trumps, face up in front of the seat that killed them (PID-306). */
  killed?: Partial<Record<RelativePosition, Card[]>>;
  /** How every hand holds its cards. */
  held?: HeldStyle;
  bid?: { seat: RelativePosition | undefined; amount: number };
};

export function SeatLayer({
  seats,
  dealing = false,
  dealerRel,
  topReserve = 0,
  bottomReserve = 0,
  statusByRel,
  turnByRel,
  onProfile,
  quiet = false,
  secondDeal,
  killed,
  held = HELD_STYLE,
  bid,
}: Props) {
  useTranslation();
  const out = REL.map((rel) => !!seats[rel]?.out);
  const viewer = viewerOf(seats);
  const [previousOut, setPreviousOut] = useState(out);
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
  const insets = useTableInsets();
  const { top, bottom, left, right } = insets;
  const L = useMemo(
    () => computeLayout(width, height, { top, bottom, left, right }, topReserve, bottomReserve),
    [width, height, top, bottom, left, right, topReserve, bottomReserve]
  );
  const portrait = L.profile.endsWith('portrait');
  // Tight phones: every name beside a smaller avatar, no level chips or pins,
  // and your avatar alone under your hand, with its short line when it has one.
  const tight = portrait && L.tight;
  const size = tight ? TIGHT_AVATAR : AVATAR_SIZE[L.profile];
  const tablet = L.profile.startsWith('tablet');
  const parts = avatarParts(size);
  // Where a landscape line would run into the hand (yours) or the menu
  // (North's), the seat says its short line instead, as your tight seat does.
  const besideStatus = avatarParts(size, { beside: true }).status.fontSize;
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
  const besideName = !portrait || tight;
  // Tight North's avatar stays on the table's axis, its name running right;
  // East and West run toward each other, each up to the middle.
  const tightNorthLeft = width / 2 - size / 2;
  const seatWidth = (rel: RelativePosition) =>
    tight
      ? {
          maxWidth:
            rel === 'north'
              ? width - insets.right - PidroSpacing.sm - tightNorthLeft
              : (width - insets.left - insets.right) / 2 - PidroSpacing.xs * 2,
          gap: PidroSpacing.xs,
        }
      : portrait
        ? rel === 'north' || rel === 'south'
          ? { width: centerColumn }
          : { width: sideColumn, paddingHorizontal: PidroSpacing.xs }
        : {
            maxWidth: size + gap + reach(rel),
            gap,
          };
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
  // full stack never runs under them (`sideSeatTop`). Tight West shares its
  // column with the plaque's ticker, and side names run toward North's: both
  // side seats start below the ticker and North's row. Landscape drops the
  // stacks below the trick's center line (L.sides), opening a gap under the
  // seat; on the shortest phones the seats eat into that drop instead.
  const sideSeatPos = {
    top: sideSeatTop(L, {
      tableTop,
      seatHeight: portrait ? stackedSeat : size,
      headerBottom: insets.top + TABLE_HEADER + PidroSpacing.xs,
    }),
  };
  // On the shortest phones your seat under the hand leaves a full side stack
  // no room below its seat: its backs close up to fit (PID-304).
  const handTop = L.hand.cy - L.cardH / 2;
  const sideReach = tight
    ? Math.min(stacks.maxHeight, handTop - 12 - (sideSeatPos.top + stackedSeat + PidroSpacing.sm))
    : stacks.maxHeight;
  const sideStackCy = portrait
    ? Math.max(
        L.sides.cy,
        Math.min(
          sideSeatPos.top + stackedSeat + PidroSpacing.sm,
          Math.max(stacks.top, handTop - 12 - sideReach)
        ) +
          sideReach / 2
      )
    : L.sides.cy;
  // Tight side seats keep their dealer chip, on the avatar's outer corner, on screen.
  const sideInset = tight ? PidroSpacing.sm : portrait ? 0 : 12;
  // New backs fly in from the pack in the second deal, from the middle in the first.
  const pack = packSpot(L);
  const from = secondDeal ? pack : { x: L.felt.cx, y: L.felt.cy };

  return (
    <View style={[StyleSheet.absoluteFill, quiet && styles.quiet]} pointerEvents="box-none">
      {secondDeal && secondDeal.pack > 0 ? (
        <Pack
          count={secondDeal.pack}
          backW={northBackWidth(L.cardW, compactNorth(L))}
          cx={pack.x}
          cy={pack.y}
        />
      ) : null}
      {REL.map((rel) => {
        const folded = seats[rel]?.foldedCount ?? 0;
        const thrown = secondDeal?.thrown[rel] ?? folded;
        const kills = killed?.[rel] ?? [];
        if (!seats[rel] || (thrown === 0 && kills.length === 0)) return null;
        const foldingHand = !secondDeal && folded > 0;
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
        return (
          <Fragment key={`thrown-${rel}`}>
            {kills.length > 0 ? (
              <ThrownPile
                rel={rel}
                testID={`killed-${rel}`}
                count={kills.length}
                faces={kills}
                from={from}
                at={(i) => pileSpot(L, rel, i, kills.length)}
                cardW={pileCardW(L)}
                square={!!L.front}
              />
            ) : null}
            {thrown > 0 ? (
              <ThrownPile
                rel={rel}
                faces={foldingHand ? undefined : secondDeal?.faces?.[rel]}
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
                at={foldingHand ? undefined : (i) => pileSpot(L, rel, i, thrown)}
                square={!!L.front}
                cardW={
                  foldingHand
                    ? (rel === 'south'
                        ? L.cardW * L.trick.pileScale
                        : rel === 'north'
                          ? northBackWidth(L.cardW, compactNorth(L))
                          : // Narrower on landscape phones, to fit the stack's column.
                            sideBackW * (L.front ? 0.85 : 1)) * 0.82
                    : pileCardW(L)
                }
              />
            ) : null}
          </Fragment>
        );
      })}
      {REL.map((rel) => {
        const data = seats[rel];
        if (!data) return null;
        const line = quiet ? null : seatLine(data, statusByRel?.[rel]);
        // A spectator sees North–South as the first team.
        const team = whosePoints(data.absolutePosition, viewer).column;
        const seat = quiet
          ? { ...avatarFor(data, false, null, undefined, team), level: null, pin: null, turn: null }
          : avatarFor(data, dealerRel === rel, line, turnByRel?.[rel], team);
        const holds = !quiet && bid?.seat === rel ? bid.amount : null;
        // What the seat says aloud, its winning bid included.
        const spoken = { ...seat, bid: holds };
        const identity = (
          <PlayerAvatar
            testID={`seat-${rel}`}
            size={size}
            label={
              besideName && !(L.sidesUnder && (rel === 'east' || rel === 'west'))
                ? rel === 'east'
                  ? 'left'
                  : 'right'
                : 'below'
            }
            bid={holds != null ? { amount: holds, tone: team } : null}
            dealerTrail={dealerTrail}
            nameRoom={
              L.sidesUnder && (rel === 'east' || rel === 'west')
                ? SIDE_SEAT_WIDTH
                : !portrait
                  ? reach(rel)
                  : rel === 'north' || rel === 'south'
                    ? centerColumn
                    : sideColumn - PidroSpacing.xs * 2
            }
            style={[
              tight && rel === 'south'
                ? { width: size + PidroSpacing.xs * 2 }
                : L.sidesUnder && (rel === 'east' || rel === 'west')
                  ? { width: SIDE_SEAT_WIDTH }
                  : seatWidth(rel),
              data.out && styles.out,
            ]}
            {...seat}
            {...(tight && { level: null, pin: null })}
            {...(tight &&
              rel === 'south' && {
                label: 'below' as const,
                name: null,
                status: line?.short ?? null,
                accessibilityLabel: avatarLabel({ ...spoken, level: null, pin: null }),
              })}
            {...(!portrait &&
              (rel === 'south' || rel === 'north') &&
              line &&
              !textFits(line.text, besideStatus, reach(rel)) && {
                status: line.short ?? null,
                accessibilityLabel: avatarLabel(spoken),
              })}
          />
        );
        const pressable = onProfile?.[rel] ? (
          <PressableFX
            accessibilityRole="button"
            accessibilityLabel={`${t('friends.view_profile', {
              name: data.username ?? t('social.player'),
            })}, ${avatarLabel({ ...spoken, ...(tight && { level: null, pin: null }) })}`}
            onPress={onProfile[rel]}
            style={{ minHeight: PidroLayout.touchTarget, minWidth: PidroLayout.touchTarget }}>
            {identity}
          </PressableFX>
        ) : (
          <View pointerEvents="none">{identity}</View>
        );
        // Drawn once on Android, its lights inside the bleed. A breathing seat stays live, and so
        // do quiet seats: a layer would fade as one image, unlike the views it holds.
        const avatar = (
          <StillLayer
            bleed={Math.ceil(size * 0.95)}
            live={quiet || !!seat.turn?.attention || sliding?.rel === rel}>
            {pressable}
          </StillLayer>
        );

        if (rel === 'south' && tight) {
          // Your avatar alone, centred under your hand, its short line under
          // it when there is one (your bid, while the hand is bid); the label
          // still speaks.
          return (
            <View
              key={rel}
              pointerEvents="box-none"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: L.hand.cy + L.cardH / 2 + TIGHT_SOUTH_GAP,
                alignItems: 'center',
              }}>
              {avatar}
            </View>
          );
        }
        if (rel === 'south') {
          const southBottom = insets.bottom + bottomReserve + 8;
          return (
            <View
              key={rel}
              pointerEvents="box-none"
              style={
                portrait
                  ? {
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: southBottom,
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
              <View
                testID="seat-north-cards"
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: northBackTop,
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
                  originX={secondDeal ? from.x - (width / 2 - northShift) : northShift}
                  originY={(secondDeal ? from.y : L.trick.cy) - northBackTop}
                />
              </View>
              <View
                pointerEvents="box-none"
                style={
                  tight
                    ? { position: 'absolute', top: northSeatTop, left: tightNorthLeft }
                    : portrait
                      ? {
                          position: 'absolute',
                          top: northSeatTop,
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
          : sideSeatPos;
        const seatPos =
          rel === 'east' ? { ...seatTop, right: seatEdge } : { ...seatTop, left: seatEdge };
        const backsEdge = rel === 'east' ? { right: backsInset } : { left: backsInset };
        return (
          <View key={rel} style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <View style={[{ position: 'absolute' }, seatPos]} pointerEvents="box-none">
              {avatar}
            </View>
            <View
              testID={`seat-${rel}-cards`}
              pointerEvents="none"
              style={[
                {
                  position: 'absolute',
                  top: 0,
                  height: sideStackCy * 2,
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
          </View>
        );
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
 * The pack while the dealer deals from it: thicker the more it holds. Each
 * card sits a touch off square, fixed by its place in the pack, so it looks
 * handled rather than machine-stacked and never wobbles between frames.
 */
function Pack({ count, backW, cx, cy }: { count: number; backW: number; cx: number; cy: number }) {
  const h = backW * (110 / 78);
  const layers = Math.min(count, 16);
  const pose = (i: number) => heldPose('tilt', `pack-${i}`, 0);
  return (
    <View
      testID="second-deal-pack"
      pointerEvents="none"
      accessibilityElementsHidden
      style={{ position: 'absolute', left: cx - backW / 2, top: cy - h / 2 }}>
      {Array.from({ length: layers }, (_, i) => (
        <Back
          key={i}
          w={backW}
          h={h}
          style={{
            position: 'absolute',
            left: i * 0.6 + pose(i).dy * 1.2,
            top: -i * 1.1,
            transform: [{ rotate: `${pose(i).tilt * 2.2}deg` }],
          }}
        />
      ))}
    </View>
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
  testID,
  square = false,
}: {
  rel: RelativePosition;
  count: number;
  /** Landscape phones lay a pile square, as Classic does, to keep its gaps (PID-307). */
  square?: boolean;
  /** Face up: the thrower's own, or killed trumps (PID-306). */
  faces?: Card[];
  testID?: string;
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
      testID={testID ?? (folded ? `seat-${rel}-folded` : `second-deal-thrown-${rel}`)}
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
            card={faces?.[i]}
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
  card,
}: {
  card?: Card;
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
      {card ? (
        <Image
          testID="thrown-face"
          source={getCardImage(card)}
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
