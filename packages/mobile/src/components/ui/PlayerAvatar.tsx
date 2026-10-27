import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { DealerChip } from '@/components/game/DealerChip';
import { Avatar } from '@/components/ui/Avatar';
import { BotPersonaFace } from '@/components/ui/BotPersonaFace';
import { gradientBg } from '@/components/ui/Bevel';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { PidroBevel, PidroColors, PidroFonts } from '@/design/tokens';
import { isStillCapture } from '@/utils/stillCapture';
import { useTranslation } from '@/i18n';
import {
  avatarLabel,
  avatarParts,
  nameType,
  type AvatarAway,
  type AvatarKind,
  type AvatarPin,
} from '@/features/avatar';
import { roundGlow } from '@/features/roundGlow';
import { botPortrait, type BotPersona, type BotProfile } from '@pidro/shared';
import { useBotProfile } from '@/features/bots';

/**
 * A player, drawn the same way everywhere: the photo in a ring, with up to
 * five signals around it. The ring says whether they pay (glass, gold, or
 * gold with a gem for lifetime), the pin where they come from, the chip their
 * all-time level. At the table the turn light runs down as their timer, the
 * only light there; the name's colour says the team, and the dealer chip sits
 * beside the name (on the avatar only when there is no name). Smaller sizes
 * drop parts, never the ring (`avatarParts`). Read-only: wrap it in a
 * pressable to make it tappable.
 */
export type AvatarRing = 'glass' | 'gold' | 'lifetime';

export interface PlayerAvatarProps {
  size: number;
  uri?: string | null;
  ring?: AvatarRing;
  pin?: AvatarPin | null;
  level?: number | null;
  dealer?: boolean;
  /**
   * Which side the dealer chip takes. Below the avatar: that side of the name.
   * Beside it: the name's far end, or behind the avatar if that is the side asked.
   */
  dealerSide?: 'left' | 'right';
  /**
   * `progress` is the time left, 1 to 0; the arc runs clockwise from twelve.
   * `attention` is for your own turn: the light pings once and then breathes.
   * With `endsAt` and `durationMs` the arc runs down on its own clock, so
   * nothing around it re-renders while a timer runs.
   */
  turn?: {
    progress: number;
    urgent?: boolean;
    attention?: boolean;
    endsAt?: number;
    durationMs?: number;
  } | null;
  /** Upload percentage, 0–100. Dims the pending photo without table-turn signals. */
  photoProgress?: number | null;
  away?: AvatarAway | null;
  kind?: AvatarKind;
  /** A bot with a persona wears its face, with the robot badge on top. */
  persona?: BotPersona | null;
  botProfile?: BotProfile | null;
  name?: string | null;
  /** The width the name may take: a longer one drops a type step, then truncates. */
  nameRoom?: number;
  status?: string | null;
  /**
   * Names what the player just did (a bid). When it changes, the ring lights
   * up for a moment and the status swells once; reduced motion skips both.
   */
  pulse?: string | null;
  label?: 'below' | 'right' | 'left';
  /** At the table the name says the team: `us` is you and your partner. */
  nameTone?: 'default' | 'us' | 'them';
  statusTone?: 'default' | 'now' | 'quiet' | 'high' | 'warning' | 'danger';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Space between the name and the dealer chip beside it. */
const DEALER_GAP = 6;
const FACE_GRADIENT = `linear-gradient(180deg, ${PidroBevel.panelHi} 0%, ${PidroBevel.panelMid} 60%, ${PidroBevel.panelDeep} 100%)`;
const AWAY_OPACITY = 0.45;

export function PlayerAvatar({
  size,
  uri,
  ring = 'glass',
  pin = null,
  level = null,
  dealer = false,
  dealerSide = 'left',
  turn = null,
  photoProgress = null,
  away = null,
  kind = 'player',
  persona = null,
  botProfile = null,
  name,
  nameRoom,
  status,
  pulse = null,
  label = 'below',
  nameTone = 'default',
  statusTone = 'default',
  accessibilityLabel,
  style,
  testID,
}: PlayerAvatarProps) {
  const { t } = useTranslation();
  const parts = avatarParts(size, { beside: label !== 'below' });
  const crew = kind === 'bot' ? persona : null;
  const profile = useBotProfile(crew, botProfile);
  if (crew && name) name = profile?.name || name;
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const portrait = botPortrait(crew, profile, failedUri);
  const seated = kind !== 'open';
  const gold = ring !== 'glass' && kind === 'player';
  const chip = seated && level != null ? parts.level : null;
  const arc = turn && seated ? parts.turn : null;
  const spoken =
    accessibilityLabel ??
    (name || kind !== 'player'
      ? avatarLabel({ name, status, level, pin, dealer, turn, away, kind, persona: crew })
      : undefined);

  const hasLabel = !!(name || status);
  // A status alone (your tight seat) sits under the avatar; the chip stays on it.
  const named = !!name || kind === 'open';
  const acted = useActedPulse(pulse);
  const dealerChip =
    dealer && seated && parts.dealer ? <DealerChip size={parts.dealer.size} /> : null;

  const avatar = (
    <View style={{ width: size, height: size }}>
      <ActedLight size={size} acted={acted} />
      {turn && arc ? (
        <TurnLight size={size} arc={arc} urgent={turn.urgent} attention={turn.attention} />
      ) : null}

      {seated ? (
        <View
          style={[
            styles.ring,
            gradientBg(gold ? PidroBevel.goldRimGradient : PidroBevel.avatarGlassRingGradient),
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              padding: parts.ring,
              opacity: away || photoProgress != null ? AWAY_OPACITY : 1,
            },
          ]}>
          <View
            style={[
              styles.face,
              gradientBg(kind === 'bot' ? PidroBevel.glassFaceGradient : FACE_GRADIENT),
              {
                borderRadius: size / 2,
                borderWidth: parts.keyline,
                borderColor: gold ? PidroBevel.keyline : PidroBevel.panelDeep,
              },
            ]}>
            {kind === 'bot' && portrait.kind === 'builtin' ? (
              <BotPersonaFace persona={portrait.persona} />
            ) : kind === 'bot' && portrait.kind === 'remote' ? (
              <Image
                source={{ uri: portrait.uri }}
                style={styles.photo}
                resizeMode="cover"
                onError={() => setFailedUri(portrait.uri)}
              />
            ) : kind === 'bot' ? (
              <Icon name="bot" size={Math.round(size * 0.5)} color={PidroColors.text} />
            ) : (
              <Avatar uri={uri} style={styles.photo} resizeMode="cover" />
            )}
          </View>
        </View>
      ) : (
        <View style={[styles.open, { width: size, height: size, borderRadius: size / 2 }]}>
          <Icon name="plus" size={Math.round(size * 0.4)} color={PidroColors.cyanText} />
        </View>
      )}

      {turn?.attention && arc ? <TurnPing size={size} arc={arc} urgent={turn.urgent} /> : null}
      {turn && arc ? <TurnArc size={size} arc={arc} turn={turn} /> : null}
      {photoProgress != null && parts.turn ? (
        <TurnArc size={size} arc={parts.turn} turn={{ progress: photoProgress / 100 }} />
      ) : null}

      {ring === 'lifetime' && gold && parts.gem ? (
        <View
          style={[
            styles.gem,
            gradientBg(PidroBevel.avatarGemGradient),
            {
              width: parts.gem,
              height: parts.gem,
              left: (size - parts.gem) / 2,
              top: -parts.gem / 2,
            },
          ]}
        />
      ) : null}

      {pin && seated && parts.pin ? (
        <Coin
          testID={testID ? `${testID}-pin` : undefined}
          material={pin === 'classic' ? 'wood' : 'glass'}
          size={parts.pin.size}
          rim={parts.pin.rim}
          style={{ right: parts.pin.right, top: parts.pin.top }}>
          <Icon
            name="spade"
            size={parts.pin.glyph}
            color={pin === 'classic' ? PidroBevel.textGold : PidroColors.text}
          />
        </Coin>
      ) : null}

      {chip ? (
        <View pointerEvents="none" style={[styles.levelRow, { bottom: chip.bottom }]}>
          <View
            testID={testID ? `${testID}-level` : undefined}
            style={[
              styles.level,
              {
                minWidth: chip.minWidth,
                height: chip.height,
                paddingHorizontal: chip.padding,
                borderColor: gold ? PidroBevel.rim : PidroBevel.avatarGlassEdge,
                opacity: away ? AWAY_OPACITY : 1,
              },
            ]}>
            <PidroText
              style={[
                styles.levelText,
                {
                  fontSize: chip.fontSize,
                  lineHeight: chip.height - 3,
                  color: gold ? PidroBevel.textGold : PidroColors.text,
                },
              ]}
              numberOfLines={1}
              maxFontSizeMultiplier={1}>
              {level}
            </PidroText>
          </View>
        </View>
      ) : null}

      {dealerChip && parts.dealer && !named ? (
        <View
          style={[styles.badge, { left: parts.dealer.left, bottom: parts.dealer.bottom }]}
          pointerEvents="none">
          {dealerChip}
        </View>
      ) : null}

      {away && seated && parts.dealer ? <AwayBadge away={away} size={parts.dealer.size} /> : null}
      {crew && !away ? (
        <AwayBadge away="bot" size={parts.dealer?.size ?? Math.round(size * 0.42)} />
      ) : null}
    </View>
  );

  const below = label === 'below';
  // Beside the avatar the chip takes the far end of the name; asked for the
  // other side, it sits behind the avatar instead, without moving the seat.
  const rowChip = named && !below ? dealerChip : null;
  const chipBehind = (label === 'right') === (dealerSide === 'left');
  const levelClearance = chip ? chip.height + chip.bottom + 3 : 4;

  return (
    <View
      testID={testID}
      accessible={!!spoken}
      accessibilityRole={spoken ? 'image' : undefined}
      accessibilityLabel={spoken}
      style={[below ? styles.column : label === 'right' ? styles.row : styles.rowReverse, style]}>
      {avatar}
      {hasLabel ? (
        <View
          style={[
            styles.copy,
            below
              ? { marginTop: levelClearance, alignItems: 'center', maxWidth: '100%' }
              : { alignItems: label === 'right' ? 'flex-start' : 'flex-end' },
          ]}>
          {/* Capped to the copy's width beside the avatar too, or a long name runs on unclipped. */}
          <View style={below ? styles.copyBlock : styles.copyLine}>
            {named ? (
              <PidroText
                numberOfLines={1}
                style={[
                  styles.name,
                  nameType(parts.name, name, nameRoom),
                  { color: kind === 'open' ? PidroColors.cyanText : NAME_TONES[nameTone] },
                  away ? styles.awayName : null,
                ]}>
                {name || (kind === 'open' ? t('ui.openSeat') : '')}
              </PidroText>
            ) : null}
            <Animated.View style={[{ transformOrigin: SWELL_ORIGIN[label] }, acted.swell]}>
              <PidroText
                numberOfLines={1}
                style={[styles.status, parts.status, { color: STATUS_TONES[statusTone] }]}>
                {status || ' '}
              </PidroText>
            </Animated.View>
            {below && named && dealerChip && parts.dealer ? (
              <View
                pointerEvents="none"
                style={[
                  styles.besideName,
                  { marginTop: -parts.dealer.size / 2 },
                  dealerSide === 'right'
                    ? { right: -(parts.dealer.size + DEALER_GAP) }
                    : { left: -(parts.dealer.size + DEALER_GAP) },
                ]}>
                {dealerChip}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
      {rowChip && !chipBehind ? <View pointerEvents="none">{rowChip}</View> : null}
      {rowChip && chipBehind && parts.dealer ? (
        <View
          pointerEvents="none"
          style={[
            styles.besideName,
            { marginTop: -parts.dealer.size / 2 },
            label === 'right'
              ? { left: -(parts.dealer.size + DEALER_GAP) }
              : { right: -(parts.dealer.size + DEALER_GAP) },
          ]}>
          {rowChip}
        </View>
      ) : null}
    </View>
  );
}

const NAME_TONES = {
  default: PidroColors.text,
  us: PidroColors.teamUs,
  them: PidroColors.teamThem,
} as const;

const STATUS_TONES = {
  default: PidroColors.cyanText,
  now: PidroColors.text,
  quiet: PidroColors.textSoft,
  high: PidroColors.goldLight,
  warning: PidroColors.warning,
  danger: PidroColors.danger,
} as const;

/** A seat that just acted: up quickly, held long enough to find, then gone. */
const ACTED_IN_MS = 180;
const ACTED_HOLD_MS = 1100;
const ACTED_OUT_MS = 700;
const ACTED_SWELL = 0.14;
/** The status swells from the edge it is aligned to. */
const SWELL_ORIGIN = { below: 'center', right: 'left', left: 'right' } as const;

/** 0 at rest, 1 while the seat that just acted is lit; still under reduced motion. */
function useActedPulse(pulse: string | null) {
  const calm = useReducedMotion() || isStillCapture();
  const t = useSharedValue(0);
  const seen = useRef(pulse);

  useEffect(() => {
    // A line in between (reconnecting, dealing) is not a new action.
    if (!pulse || pulse === seen.current) return;
    seen.current = pulse;
    if (calm) return;
    t.set(
      withSequence(
        withTiming(1, { duration: ACTED_IN_MS, easing: Easing.out(Easing.quad) }),
        withDelay(
          ACTED_HOLD_MS,
          withTiming(0, { duration: ACTED_OUT_MS, easing: Easing.in(Easing.quad) })
        )
      )
    );
  }, [pulse, calm, t]);
  useEffect(() => () => cancelAnimation(t), [t]);

  const light = useAnimatedStyle(() => ({ opacity: t.value }));
  const swell = useAnimatedStyle(() => ({ transform: [{ scale: 1 + ACTED_SWELL * t.value }] }));
  return { light, swell };
}

/** The light behind a seat that just acted: the turn's shine, briefly. */
function ActedLight({ size, acted }: { size: number; acted: ReturnType<typeof useActedPulse> }) {
  const glow = useRoundGlow(
    size / 2,
    Math.round(size * 0.45),
    Math.round(size * 0.16),
    PidroColors.turnLightShine
  );
  return <Animated.View pointerEvents="none" style={[glowBox(size, glow), acted.light]} />;
}

/**
 * A shine as a drawn gradient rather than a blurred shadow: it looks the same,
 * and breathing scales it without blurring it again every frame.
 */
function useRoundGlow(radius: number, blur: number, spread: number, color: string) {
  return useMemo(() => roundGlow({ radius, blur, spread, color }), [radius, blur, spread, color]);
}

function glowBox(size: number, glow: ReturnType<typeof roundGlow>): ViewStyle {
  return {
    position: 'absolute',
    width: glow.extent * 2,
    height: glow.extent * 2,
    left: size / 2 - glow.extent,
    top: size / 2 - glow.extent,
    ...gradientBg(glow.backgroundImage),
  };
}

/** Strong ease-out: the ping leaves the ring fast and settles softly. */
const PING_EASE = Easing.bezier(0.23, 1, 0.32, 1);
const PING_MS = 650;
const PING_GAP_MS = 140;
/** One breath in or out; quicker when the timer runs low. */
const BREATH_MS = 1100;
const URGENT_BREATH_MS = 450;
/** Another player's shine, held still: present, but quieter than yours. */
const OTHER_SHINE = 0.55;

/**
 * The shine behind whoever is on turn: a soft glow just outside the timer
 * ring. Yours breathes for as long as the turn is yours; another player's
 * holds still and quieter, so only your turn moves on the table.
 */
function TurnLight({
  size,
  arc,
  urgent,
  attention,
}: {
  size: number;
  arc: { radius: number; stroke: number };
  urgent?: boolean;
  attention?: boolean;
}) {
  const calm = useReducedMotion() || isStillCapture();
  const breath = useSharedValue(1);
  const breathing = !!attention && !calm;

  useEffect(() => {
    if (!breathing) {
      breath.set(1);
      return;
    }
    breath.set(
      withRepeat(
        withTiming(0.35, {
          duration: urgent ? URGENT_BREATH_MS : BREATH_MS,
          easing: Easing.inOut(Easing.sin),
        }),
        -1,
        true
      )
    );
    return () => cancelAnimation(breath);
  }, [breathing, urgent, breath]);

  const motion = useAnimatedStyle(() => ({
    opacity: breath.value,
    transform: [{ scale: 0.96 + 0.06 * breath.value }],
  }));

  const box = (arc.radius + arc.stroke / 2) * 2;
  const glow = useRoundGlow(
    box / 2,
    Math.round(size * 0.42),
    Math.round(size * 0.14),
    urgent ? PidroColors.turnUrgentShine : PidroColors.turnLightShine
  );
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        glowBox(size, glow),
        { opacity: attention ? 1 : OTHER_SHINE },
        breathing ? motion : null,
      ]}
    />
  );
}

/**
 * Your turn starting: two rings leave the turn light and fade, a knock that
 * says "you" without words. Plays once per turn; reduced motion skips it.
 */
function TurnPing({
  size,
  arc,
  urgent,
}: {
  size: number;
  arc: { radius: number; stroke: number };
  urgent?: boolean;
}) {
  const calm = useReducedMotion() || isStillCapture();
  const t = useSharedValue(0);

  useEffect(() => {
    if (calm) return;
    const ping = withTiming(1, { duration: PING_MS, easing: PING_EASE });
    t.set(withSequence(ping, withTiming(0, { duration: 0 }), withDelay(PING_GAP_MS, ping)));
    return () => cancelAnimation(t);
  }, [calm, t]);

  const motion = useAnimatedStyle(() => ({
    opacity: t.value > 0 ? 0.9 * (1 - t.value) : 0,
    transform: [{ scale: 1 + 0.4 * t.value }],
  }));

  const box = (arc.radius + arc.stroke / 2) * 2;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ping,
        {
          width: box,
          height: box,
          left: (size - box) / 2,
          top: (size - box) / 2,
          borderWidth: arc.stroke,
          borderColor: urgent ? PidroColors.turnUrgent : PidroColors.turnLight,
        },
        motion,
      ]}
    />
  );
}

function TurnArc({
  size,
  arc,
  turn,
}: {
  size: number;
  arc: { radius: number; stroke: number };
  turn: { progress: number; urgent?: boolean; endsAt?: number; durationMs?: number };
}) {
  const { radius, stroke } = arc;
  const box = Math.ceil((radius + stroke) * 2);
  const center = box / 2;
  const length = 2 * Math.PI * radius;
  const left = Math.min(1, Math.max(0, useTimeLeft(turn)));
  return (
    <View
      pointerEvents="none"
      style={[
        styles.arc,
        { width: box, height: box, left: (size - box) / 2, top: (size - box) / 2 },
      ]}>
      <Svg width={box} height={box}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={turn.urgent ? PidroColors.turnUrgentTrack : PidroColors.turnLightTrack}
          strokeWidth={stroke}
        />
        {left > 0 ? (
          <Circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={turn.urgent ? PidroColors.turnUrgent : PidroColors.turnLight}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${left * length} ${length}`}
            transform={`rotate(-90 ${center} ${center})`}
          />
        ) : null}
      </Svg>
    </View>
  );
}

/** The share of the turn left, read again every 200ms while a timer runs. */
function useTimeLeft({
  progress,
  endsAt,
  durationMs,
}: {
  progress: number;
  endsAt?: number;
  durationMs?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt || !durationMs) return;
    const id = setInterval(() => {
      const next = Date.now();
      setNow(next);
      if (next >= endsAt) clearInterval(id);
    }, 200);
    return () => clearInterval(id);
  }, [endsAt, durationMs]);
  return endsAt && durationMs ? Math.min(progress, (endsAt - now) / durationMs) : progress;
}

/** A struck coin: the pin, and the glass bot badge. Placed absolutely unless `style` says otherwise. */
export function Coin({
  material,
  size,
  rim,
  style,
  children,
  testID,
}: {
  material: 'wood' | 'glass';
  size: number;
  rim: number;
  style: ViewStyle;
  children: ReactNode;
  testID?: string;
}) {
  const wood = material === 'wood';
  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={[
        styles.coin,
        gradientBg(wood ? PidroBevel.goldRimGradient : PidroBevel.avatarGlassRingGradient),
        { width: size, height: size, borderRadius: size / 2, padding: rim },
        style,
      ]}>
      <View
        style={[
          styles.coinFace,
          gradientBg(wood ? PidroBevel.woodFaceGradient : PidroBevel.glassFaceGradient),
          wood ? styles.coinKeyline : null,
        ]}>
        {children}
      </View>
    </View>
  );
}

function AwayBadge({ away, size }: { away: AvatarAway; size: number }) {
  const place = { right: -4, bottom: -2 };
  if (away === 'bot') {
    return (
      <Coin material="glass" size={size + 2} rim={1.5} style={place}>
        <Icon name="bot" size={Math.round(size * 0.58)} color={PidroColors.text} />
      </Coin>
    );
  }
  return (
    <View
      pointerEvents="none"
      style={[
        styles.offline,
        gradientBg(`linear-gradient(${PidroColors.dangerBg}, ${PidroColors.dangerBg})`),
        { width: size, height: size, borderRadius: size / 2 },
        place,
      ]}>
      <Icon
        name="offline"
        size={Math.round(size * 0.55)}
        color={PidroColors.danger}
        strokeWidth={2.6}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  ring: {
    boxShadow: '0px 4px 10px rgba(0,0,0,0.45)',
  },
  face: {
    flex: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  open: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: PidroColors.cyanBorderStrong,
    backgroundColor: PidroColors.panel,
  },
  arc: {
    position: 'absolute',
  },
  ping: {
    position: 'absolute',
    borderRadius: 999,
  },
  gem: {
    position: 'absolute',
    borderRadius: 2,
    borderWidth: 1.5,
    borderColor: PidroBevel.rim,
    transform: [{ rotate: '45deg' }],
    boxShadow: `0px 0px 0px 1.5px ${PidroBevel.panelDeep}, 0px 0px 10px ${PidroBevel.avatarGemGlow}`,
  },
  coin: {
    position: 'absolute',
    boxShadow: `0px 0px 0px 2px ${PidroBevel.panelDeep}, 0px 3px 6px rgba(0,0,0,0.5)`,
  },
  coinFace: {
    flex: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinKeyline: {
    borderWidth: 1,
    borderColor: PidroBevel.keyline,
  },
  levelRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  level: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1.5,
    backgroundColor: PidroBevel.panelDeep,
  },
  levelText: {
    fontFamily: PidroFonts.ui,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  badge: {
    position: 'absolute',
  },
  offline: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: PidroColors.dangerBorder,
    backgroundColor: PidroBevel.panelDeep,
    boxShadow: '0px 2px 4px rgba(0,0,0,0.5)',
  },
  copy: {
    flexShrink: 1,
    minWidth: 0,
  },
  copyBlock: {
    alignItems: 'center',
    maxWidth: '100%',
  },
  copyLine: {
    maxWidth: '100%',
  },
  besideName: {
    position: 'absolute',
    top: '50%',
  },
  name: {
    fontFamily: PidroFonts.ui,
    fontWeight: '800',
    ...PidroBevel.feltLabelShadow,
  },
  awayName: {
    opacity: 0.7,
  },
  status: {
    fontFamily: PidroFonts.ui,
    fontWeight: '700',
    ...PidroBevel.feltLabelShadow,
  },
});
