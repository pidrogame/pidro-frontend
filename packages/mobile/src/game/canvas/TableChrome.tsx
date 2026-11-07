/**
 * Shared table chrome: the header contract plus reserve math used by both the
 * live table and the dev harness.
 * The header is one row inset from the safe top: the score plaque on the left,
 * the menu on the right. Portrait reserves it above the north seat; landscape
 * seats North inside the row, between the two (see the Table boards).
 */
import { Platform, useWindowDimensions, type ViewStyle } from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PidroLayout, PidroSpacing } from '@/design/tokens';
import { SCORE_PLAQUE_HEIGHT } from './Scoreboard';

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

export interface TableReserves {
  landscape: boolean;
  topReserve: number;
  /** Nothing docks under the hand any more (PID-393): the felt runs to the edge. */
  bottomReserve: number;
  /** Where notices and the connection banner float: never over the header or a seat. */
  noticeSlot: ViewStyle;
}

export function useTableReserves({ top = TABLE_HEADER }: { top?: number } = {}): TableReserves {
  const { width, height } = useTableSize();
  const insets = useSafeAreaInsets();
  const landscape = width > height;
  return {
    landscape,
    topReserve: landscape ? 0 : top,
    bottomReserve: 0,
    // Portrait: floating at the bottom, over your seat, only while it shows.
    // Landscape: the felt below the header row, between the side seats, where
    // North no longer sits.
    noticeSlot: landscape
      ? { top: insets.top + TABLE_HEADER + PidroSpacing.xs }
      : { bottom: insets.bottom + PidroSpacing.xs },
  };
}
