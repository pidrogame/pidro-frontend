import type { ReactNode } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { ChairLock, OpenChair } from '@/components/lobby/OpenChair';
import { gradientBg } from '@/components/ui/Bevel';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { PidroBevel, PidroColors, PidroFonts, PidroLayout, PidroRadii } from '@/design/tokens';
import type { SeatRowWords, SeatToken } from '@/features/lobby/seatRow';
import { useTranslation } from '@/i18n';

/** Phone 70pt, phone landscape 64pt, iPad 80pt: the same row, three sizes. */
const SIZES = {
  phone: {
    height: 70,
    token: 48,
    gap: 14,
    padH: 12,
    radius: 14,
    name: 17,
    status: 14,
    halo: 5,
    badge: 22,
    badgeWidth: 22,
  },
  landscape: {
    height: 64,
    token: 44,
    gap: 12,
    padH: 12,
    radius: 14,
    name: 16,
    status: 13,
    halo: 5,
    badge: 20,
    badgeWidth: 22,
  },
  tablet: {
    height: 80,
    token: 56,
    gap: 16,
    padH: 16,
    radius: 16,
    name: 19,
    status: 15,
    halo: 6,
    badge: 22,
    badgeWidth: 26,
  },
};

function useRowSize() {
  const { width, height } = useWindowDimensions();
  if (Math.min(width, height) >= 700) return SIZES.tablet;
  return width > height && height < PidroLayout.compactHeight ? SIZES.landscape : SIZES.phone;
}

/** One seat on New table: token, name, one status line, chevron. The whole row is the target. */
export function SeatRow({
  row,
  onPress,
  testID,
  wrapFace = (face) => face,
}: {
  row: SeatRowWords;
  onPress?: () => void;
  testID?: string;
  /** The waiting room's talk moves and rings the face (PID-420). */
  wrapFace?: (face: ReactNode) => ReactNode;
}) {
  const size = useRowSize();
  const body = (
    <>
      {wrapFace(<SeatRowToken token={row.token} size={size} />)}
      <View style={styles.copy}>
        <PidroText
          numberOfLines={1}
          style={[
            styles.name,
            { fontSize: size.name, lineHeight: Math.round(size.name * 1.3) },
            TONES[row.nameTone],
          ]}>
          {row.name}
        </PidroText>
        <PidroText
          numberOfLines={2}
          style={[
            styles.status,
            { fontSize: size.status, lineHeight: Math.round(size.status * 1.3) },
            TONES[row.statusTone],
          ]}>
          {row.status}
        </PidroText>
      </View>
      {row.tappable ? (
        <Icon name="chevron-right" size={20} color={PidroColors.seatRowChevron} strokeWidth={2.4} />
      ) : null}
    </>
  );
  const frame = [
    styles.row,
    {
      minHeight: size.height,
      gap: size.gap,
      paddingHorizontal: size.padH,
      borderRadius: size.radius,
    },
  ];
  if (!row.tappable)
    return (
      <View testID={testID} accessible accessibilityLabel={row.label} style={[frame, styles.host]}>
        {body}
      </View>
    );
  return (
    <PressableFX
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={row.label}
      onPress={onPress}
      style={frame}
      pressedStyle={styles.pressed}>
      {body}
    </PressableFX>
  );
}

function SeatRowToken({ token, size }: { token: SeatToken; size: (typeof SIZES)['phone'] }) {
  const s = size.token;
  return (
    <View pointerEvents="none" style={{ width: s, height: s }}>
      {token.kind === 'open' ? (
        <>
          <OpenChair size={s} />
          {token.locked ? (
            <ChairLock style={{ minWidth: size.badgeWidth, height: size.badge }} />
          ) : token.badge ? (
            <View style={[styles.badge, { minWidth: size.badgeWidth, height: size.badge }]}>
              <PidroText style={styles.badgeText} maxFontSizeMultiplier={1}>
                {token.badge}
              </PidroText>
            </View>
          ) : null}
        </>
      ) : token.kind === 'bot' ? (
        <PlayerAvatar
          size={s}
          kind="bot"
          persona={token.persona}
          botProfile={token.botProfile}
          accessibilityLabel=""
        />
      ) : token.kind === 'friend' ? (
        <>
          <View
            style={[
              styles.halo,
              {
                left: -size.halo,
                top: -size.halo,
                width: s + size.halo * 2,
                height: s + size.halo * 2,
              },
            ]}
          />
          <PlayerAvatar size={s} uri={token.uri} accessibilityLabel="" style={styles.dimmed} />
        </>
      ) : (
        <PlayerAvatar
          size={s}
          uri={token.uri}
          level={token.level}
          prestige={token.prestige}
          accessibilityLabel=""
        />
      )}
    </View>
  );
}

/** A seat's token alone at 44 dp, for the folded strip of the waiting room's talk (PID-418). */
export const SeatFace = ({ token }: { token: SeatToken }) => (
  <SeatRowToken token={token} size={SIZES.landscape} />
);

/** A group of seats under its title: "Us" in gold, "Them" in cyan. */
export function TeamSection({
  team,
  children,
  style,
}: {
  team: 'yours' | 'opponents';
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const title = t(team === 'yours' ? 'game.your_team' : 'game.opponents');
  return (
    <View accessibilityLabel={title} style={[styles.section, style]}>
      <PidroText
        role="eyebrow"
        tone="cyan"
        style={[styles.eyebrow, team === 'yours' && TONES.gold]}>
        {title}
      </PidroText>
      {children}
    </View>
  );
}

/**
 * The gold "vs" between the teams. Stacked on a phone it rides a line that
 * fades in from each side; between columns and on iPad it is the word alone.
 */
export function VsDivider({ between = 'rows' }: { between?: 'rows' | 'columns' }) {
  const { t } = useTranslation();
  const tablet = useRowSize() === SIZES.tablet;
  const word = (
    <PidroText style={[styles.vs, tablet && styles.vsTablet]} maxFontSizeMultiplier={1.3}>
      {t('social.vs')}
    </PidroText>
  );
  // iPad keeps the word alone even when stacked.
  if (between === 'columns' || tablet)
    return (
      <View aria-hidden style={styles.vsColumn}>
        {word}
      </View>
    );
  return (
    <View aria-hidden style={styles.vsRow}>
      <View style={[styles.vsLine, gradientBg(PidroColors.vsLineGradient)]} />
      {word}
      <View style={[styles.vsLine, styles.flip, gradientBg(PidroColors.vsLineGradient)]} />
    </View>
  );
}

const TONES = StyleSheet.create({
  gold: { color: PidroBevel.textGold },
  cyan: { color: PidroColors.cyanText },
  default: { color: PidroColors.text },
  soft: { color: PidroColors.textSoft },
  ready: { color: PidroColors.success },
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: PidroColors.border,
    backgroundColor: PidroColors.panelSoft,
  },
  host: { backgroundColor: PidroColors.seatRowHost },
  pressed: { borderColor: PidroColors.borderStrong },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: PidroFonts.ui, fontWeight: '800' },
  status: { fontFamily: PidroFonts.ui, fontWeight: '700' },
  badge: {
    position: 'absolute',
    right: -5,
    bottom: -4,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: PidroRadii.full,
    borderWidth: 1.5,
    borderColor: PidroBevel.avatarGlassEdge,
    backgroundColor: PidroBevel.panelDeep,
  },
  badgeText: { fontSize: 9, lineHeight: 12, fontWeight: '900' },
  halo: {
    position: 'absolute',
    borderRadius: PidroRadii.full,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: PidroBevel.rim,
  },
  dimmed: { opacity: 0.6 },
  section: { gap: 8 },
  eyebrow: { paddingHorizontal: 4 },
  vsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8 },
  vsColumn: { alignSelf: 'center' },
  vsLine: { flex: 1, height: 1 },
  flip: { transform: [{ scaleX: -1 }] },
  vs: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    fontSize: 18,
    lineHeight: 22,
    color: PidroBevel.textGold,
    ...PidroBevel.labelShadow,
  },
  vsTablet: { fontSize: 22, lineHeight: 26 },
});
