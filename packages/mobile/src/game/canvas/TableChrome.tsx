/**
 * Shared table chrome: the header contract plus reserve math used by both the
 * live table and the dev harness.
 * The header is one row inset from the safe top: the score plaque on the left,
 * the menu on the right. Portrait reserves it above the north seat; landscape
 * seats North inside the row, between the two (see the Table boards).
 */
import { Platform, StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';
import {
  type EdgeInsets,
  useSafeAreaFrame,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { PidroColors, PidroLayout, PidroSpacing } from '@/design/tokens';
import { SCORE_PLAQUE_HEIGHT } from './Scoreboard';
import { utilityDockReserve } from './layout';

/** Gap between the safe top and the header row, and the reserve's breathing room. */
export const HEADER_INSET = PidroSpacing.xs;

/**
 * Where the header row starts. The game hides the status bar, so a top inset
 * is only the notch or Dynamic Island band, which already leaves air below the
 * cutout: the row sits right on it, a step clear of North's cards. With no top
 * inset (landscape phones, iPad, web) it keeps HEADER_INSET from the edge.
 */
export function headerTop(insetTop: number): number {
  return insetTop > 0 ? insetTop : HEADER_INSET;
}
/** The header row's height from the safe top: the taller of the plaque and the menu. */
export const TABLE_HEADER = HEADER_INSET + Math.max(SCORE_PLAQUE_HEIGHT, PidroLayout.touchTarget);
// One shared portrait slot below the hand. It can host chat, an adaptive ad,
// or compact table details, but those modes should never stack vertically.
export { UTILITY_DOCK_RESERVE } from './layout';

/**
 * The size the table lays itself out in. Android draws the app edge to edge,
 * under the status and navigation bars, but before Android 11 its window
 * size leaves both bars out; with the insets taken off again, a TCL 5053Y
 * kept 72pt of felt empty under the hand (PID-304). There the table measures
 * the view it fills; elsewhere the window is that view.
 */
export function useTableSize(): { width: number; height: number } {
  const window = useWindowDimensions();
  const frame = useSafeAreaFrame();
  return Platform.OS === 'android' ? frame : window;
}

/**
 * The table's safe-area insets. The game hides the status bar, and a landscape
 * phone's cutout is at its side, yet Android 9 still reports the bar's height
 * at the top: a TCL 5053Y lost 27pt of felt to it (PID-307). Landscape phones
 * take no top inset.
 */
export function useTableInsets(): EdgeInsets {
  const insets = useSafeAreaInsets();
  const { width, height } = useTableSize();
  return width > height && Math.min(width, height) < 600 ? { ...insets, top: 0 } : insets;
}

export interface TableReserves {
  landscape: boolean;
  topReserve: number;
  bottomReserve: number;
  /** Where notices and the connection banner float: never over the header or a seat. */
  noticeSlot: ViewStyle;
}

export interface TableDockHeights {
  top?: number;
  bottom?: number;
}

export function useTableReserves({
  top = TABLE_HEADER,
  bottom,
}: TableDockHeights = {}): TableReserves {
  const { width, height } = useTableSize();
  bottom ??= utilityDockReserve(height);
  const insets = useTableInsets();
  const landscape = width > height;
  return {
    landscape,
    topReserve: landscape ? 0 : top,
    bottomReserve: landscape ? 0 : bottom,
    // Portrait: the dock under the hand. Landscape: the felt below the header
    // row, between the side seats, where North no longer sits.
    noticeSlot: landscape
      ? { top: insets.top + TABLE_HEADER + PidroSpacing.xs }
      : { bottom: insets.bottom, height: bottom, justifyContent: 'center' },
  };
}

/** Portrait-only dock frames. Their contents can own the heights passed above. */
export function TableChromeBars({ reserves }: { reserves: TableReserves }) {
  const insets = useTableInsets();
  if (reserves.landscape) return null;

  return (
    <>
      <View
        testID="table-utility-dock"
        pointerEvents="none"
        style={[styles.utilityDock, { height: insets.bottom + reserves.bottomReserve }]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  utilityDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 38,
    elevation: 38,
    backgroundColor: PidroColors.panel,
    borderTopWidth: 1,
    borderTopColor: PidroColors.border,
  },
});
