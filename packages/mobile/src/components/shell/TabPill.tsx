/**
 * The app shell's floating tab pill — Liquid-Glass style: a detached glass
 * bevel object inset from the screen edge, not chrome glued to it.
 * Portrait: horizontal pill, bottom-center. Landscape: vertical pill on the
 * right edge, under the right thumb. The gold Table anchor is the center
 * tab (home / your table); it wears a badge when a game is waiting.
 */
import { createContext, useContext } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PidroBevel, PidroColors } from '@/design/tokens';
import { PidroText } from '@/components/ui/PidroText';
import { CountBadge } from '@/components/ui/CountBadge';
import { PressableFX } from '@/components/ui/PressableFX';
import { STILL_LAYER } from '@/components/ui/StillLayer';
import { gradientBg } from '@/components/ui/Bevel';
import { useTranslation } from '@/i18n';
import { playSelectionHaptic } from '@/utils/haptics';

export type ShellTab = 'league' | 'stats' | 'table' | 'friends' | 'settings';

// Pill geometry, single source of truth for clearance math.
const PILL_THICKNESS = 65; // item 50 + face padding 12 + rim 2.5
const PILL_EDGE_GAP = 6; // pill inset beyond the safe area
/** Room around the pill for its shadows, inside the anchor. */
const PILL_BLEED = 40;
const CONTENT_GAP = 14; // breathing room between content and pill (portrait)
const CONTENT_GAP_RAIL = 22; // the rail deserves more air beside content

/**
 * The shell's update notice while it floats above the pill: how far up from
 * the screen bottom it reaches, and its own height. Zeros while it is hidden
 * or a screen has placed it elsewhere. The shell provides it to its screens.
 */
export const FloatingNotice = createContext({ reach: 0, height: 0 });

/**
 * Extra bottom inset for a scroll that already clears the pill or the bottom
 * safe area (guests, Home's invitations): the floating notice's height, so the
 * last row can scroll clear of it. 0 while it does not float.
 */
export function useNoticeInset() {
  const { height } = useContext(FloatingNotice);
  return height > 0 ? height + CONTENT_GAP : 0;
}

/**
 * How much space screens inside the shell must leave for the floating
 * pill — and for the update notice above it while it shows. Derived from
 * safe-area insets + pill geometry — never hardcode clearances in screens
 * (web has zero insets; devices do not). A fixed layout that the notice
 * floats over passes `{ notice: false }` so it never moves.
 */
export function usePillClearance({ notice = true }: { notice?: boolean } = {}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { reach } = useContext(FloatingNotice);
  const noticeBottom = notice && reach > 0 ? reach + CONTENT_GAP : 0;
  const landscape = width > height;
  if (landscape) {
    return {
      bottom: noticeBottom,
      right: Math.max(insets.right, 8) + PILL_EDGE_GAP + 2 + PILL_THICKNESS + CONTENT_GAP_RAIL,
    };
  }
  return {
    bottom: Math.max(
      Math.max(insets.bottom, 10) + PILL_EDGE_GAP + PILL_THICKNESS + CONTENT_GAP,
      noticeBottom
    ),
    right: 0,
  };
}

export interface TabPillProps {
  orientation: 'bottom' | 'rail';
  active: ShellTab;
  tableBadge?: boolean;
  invitationCount?: number;
  onSelect: (tab: ShellTab) => void;
  style?: StyleProp<ViewStyle>;
}

function SpadeIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={PidroBevel.textGold}>
      <Path d="M12 3c-2.8 3.6-7 6-7 9.6a3.5 3.5 0 0 0 6.1 2.3c-.3 2-1.2 3.6-2.6 5.1h7c-1.4-1.5-2.3-3.1-2.6-5.1a3.5 3.5 0 0 0 6.1-2.3C19 9 14.8 6.6 12 3z" />
    </Svg>
  );
}

const TAB_ICONS: Record<Exclude<ShellTab, 'table'>, keyof typeof Feather.glyphMap> = {
  league: 'award',
  stats: 'bar-chart-2',
  friends: 'users',
  settings: 'settings',
};

function TabItem({
  tab,
  active,
  onSelect,
  count = 0,
}: {
  tab: Exclude<ShellTab, 'table'>;
  active: boolean;
  onSelect: (tab: ShellTab) => void;
  count?: number;
}) {
  const { t } = useTranslation();
  return (
    <PressableFX
      accessibilityRole="button"
      accessibilityLabel={
        count > 0
          ? `${t(`shell.${tab}`)}, ${t('friend_notice.badge', { count })}`
          : t(`shell.${tab}`)
      }
      accessibilityState={{ selected: active }}
      onPress={() => {
        if (!active) playSelectionHaptic();
        onSelect(tab);
      }}
      style={[styles.item, active && styles.itemActive]}>
      <Feather
        name={TAB_ICONS[tab]}
        size={20}
        color={active ? '#ffffff' : 'rgba(207, 239, 255, 0.78)'}
      />
      <PidroText style={[styles.itemLabel, active && styles.itemLabelActive]}>
        {t(`shell.${tab}`)}
      </PidroText>
      {count > 0 ? (
        <View testID="friends-invitation-count" style={styles.countBadge}>
          <CountBadge count={count} size="sm" />
        </View>
      ) : null}
    </PressableFX>
  );
}

export function TabPill({
  orientation,
  active,
  tableBadge,
  invitationCount,
  onSelect,
  style,
}: TabPillProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const rail = orientation === 'rail';

  return (
    // Drawn once on Android, its shadows inside the padding; the anchor moves out as far.
    <View
      {...STILL_LAYER}
      pointerEvents="box-none"
      style={[
        rail
          ? [
              styles.railAnchor,
              { right: Math.max(insets.right, 8) + PILL_EDGE_GAP + 2 - PILL_BLEED },
            ]
          : [
              styles.bottomAnchor,
              { bottom: Math.max(insets.bottom, 10) + PILL_EDGE_GAP - PILL_BLEED },
            ],
        style,
      ]}>
      <View testID="tab-pill" style={[styles.pillRim, gradientBg(PidroBevel.glassRimGradient)]}>
        <View
          style={[
            styles.pillFace,
            rail ? styles.pillFaceRail : styles.pillFaceBottom,
            gradientBg('linear-gradient(180deg, rgba(16,54,93,0.9) 0%, rgba(8,34,62,0.92) 100%)'),
          ]}>
          <TabItem tab="league" active={active === 'league'} onSelect={onSelect} />
          <TabItem tab="stats" active={active === 'stats'} onSelect={onSelect} />

          <PressableFX
            accessibilityRole="button"
            accessibilityLabel={t(tableBadge ? 'shell.rejoinGame' : 'shell.table')}
            accessibilityState={{ selected: active === 'table' }}
            onPress={() => {
              if (!onSelect || (active === 'table' && !tableBadge)) return;
              playSelectionHaptic();
              onSelect('table');
            }}
            style={styles.item}>
            <View style={[styles.tableRing, gradientBg(PidroBevel.goldRimGradient)]}>
              <View
                style={[
                  styles.tableFace,
                  gradientBg(`linear-gradient(180deg, ${PidroBevel.woodHi}, ${PidroBevel.woodLo})`),
                ]}>
                <SpadeIcon />
              </View>
              {tableBadge ? <View style={styles.badge} /> : null}
            </View>
            {tableBadge ? (
              <PidroText style={[styles.itemLabel, styles.tableLabel]}>
                {t('shell.rejoin')}
              </PidroText>
            ) : null}
          </PressableFX>

          <TabItem
            tab="friends"
            active={active === 'friends'}
            count={invitationCount}
            onSelect={onSelect}
          />
          <TabItem tab="settings" active={active === 'settings'} onSelect={onSelect} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  countBadge: {
    position: 'absolute',
    right: 0,
    top: 0,
  },
  bottomAnchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingVertical: PILL_BLEED,
  },
  railAnchor: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: PILL_BLEED,
  },
  pillRim: {
    borderRadius: 33,
    padding: 1.25,
    boxShadow: '0px 8px 20px rgba(0,0,0,0.45), 0px 2px 6px rgba(0,0,0,0.3)',
  },
  pillFace: {
    borderRadius: 31.75,
    boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.22), inset 0px -2px 0px rgba(2,24,44,0.4)',
  },
  pillFaceBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 2,
  },
  pillFaceRail: {
    flexDirection: 'column',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 10,
    gap: 2,
  },
  item: {
    minWidth: 58,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: 24,
    paddingHorizontal: 6,
  },
  itemActive: {
    backgroundColor: 'rgba(140, 220, 255, 0.14)',
  },
  itemLabel: {
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '800',
    color: 'rgba(207, 239, 255, 0.65)',
  },
  itemLabelActive: {
    color: '#ffffff',
  },
  tableRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    padding: 2,
    boxShadow: '0px 3px 8px rgba(0,0,0,0.5)',
  },
  tableFace: {
    flex: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: PidroColors.success,
    borderWidth: 2,
    borderColor: 'rgba(8, 34, 62, 0.95)',
  },
  tableLabel: {
    color: PidroBevel.textGold,
    fontWeight: '900',
  },
});
