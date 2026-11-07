import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { useSeatDecisions } from '@pidro/shared';
import { TABLE_HEADER, useTableReserves } from '@/game/canvas/TableChrome';
import { readingTimeMs } from '@/features/game/readingTime';
import {
  enqueueTableNotice,
  tableNoticeText,
  type QueuedTableNotice,
  type TableNotice,
} from '@/game/tableNotices';
import { useTranslation } from '@/i18n';
import { localizedError } from '@pidro/shared';
import { PidroColors, PidroRadii, PidroSpacing } from '@/design/tokens';
import { isStillCapture } from '@/utils/stillCapture';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';

/** How long a notice lingers when nothing newer is waiting behind it. */
const NOTICE_LINGER_MS = 4500;

export function useTableNotices(roomCode: string) {
  const [notices, setNotices] = useState<QueuedTableNotice[]>([]);
  const addNotice = useCallback(
    (notice: TableNotice) => {
      setNotices((current) => enqueueTableNotice(current, notice, roomCode));
    },
    [roomCode]
  );
  const dismissNotice = useCallback(() => setNotices((current) => current.slice(1)), []);
  const clearNotices = useCallback(() => setNotices([]), []);
  const notice = notices[0]?.roomCode === roomCode ? notices[0] : null;
  const waiting = notices.length > 1;
  const shown = useRef<{ notice: QueuedTableNotice; at: number } | null>(null);
  useEffect(() => {
    // UI grammar holds the notice it caught; a tap still closes it.
    if (!notice || isStillCapture()) return;
    if (shown.current?.notice !== notice) shown.current = { notice, at: Date.now() };
    // Every notice gets its reading time; after that a newer one takes its place
    // rather than waiting out the linger.
    const read = readingTimeMs(tableNoticeText(notice));
    const hold = waiting ? read : Math.max(read, NOTICE_LINGER_MS);
    const timer = setTimeout(dismissNotice, shown.current.at + hold - Date.now());
    return () => clearTimeout(timer);
  }, [notice, waiting, dismissNotice]);
  return { notice, addNotice, dismissNotice, clearNotices };
}

/** Explicit review, not a blocking alert. Deferring never resolves a server decision. */
export function TableSeatDecision({
  decisions,
}: {
  decisions: ReturnType<typeof useSeatDecisions>;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const decision = decisions.decision;
  // Losing eligibility or starting your turn closes review without resolving it.
  if (expanded && !decision) setExpanded(false);
  if (!decisions.pendingCount) return null;
  return (
    <SafeAreaView pointerEvents="box-none" className="absolute inset-0 z-[150]">
      {/* The header row stays readable and reachable above the review. */}
      <View
        pointerEvents="box-none"
        className="flex-1 justify-center px-6 py-5"
        style={{ paddingTop: TABLE_HEADER }}>
        {expanded && decision ? (
          <ScrollView
            testID="seat-decision-card"
            className="max-h-full w-full max-w-md flex-grow-0 self-center rounded-2xl border border-amber-400/40 bg-amber-950"
            contentContainerClassName="p-6">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="flex-1 text-sm font-semibold text-amber-200">
                {t('game.pending', { count: decisions.pendingCount })}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('game.review_later')}
                accessibilityHint={t('game.review_hint')}
                onPress={() => setExpanded(false)}
                className="min-h-11 justify-center px-3">
                <Text className="font-semibold text-amber-100">{t('game.later')}</Text>
              </Pressable>
            </View>
            <Text className="mt-3 text-lg font-bold text-amber-100">
              {decision.playerNameRaw
                ? t('game.player_left', { name: decision.playerNameRaw })
                : t('game.unnamed_player_left')}
            </Text>
            <Text className="mt-1 text-sm text-amber-200 capitalize">
              {t('game.position_seat', { position: t(`table.position.${decision.position}`) })}
            </Text>
            {decisions.error && (
              <Text accessibilityLiveRegion="polite" className="mt-4 text-sm text-red-200">
                {localizedError(decisions.errorCause, 'game.seat_update_failed')}
              </Text>
            )}
            <View className="mt-6 gap-3">
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: decisions.busy, busy: decisions.busy }}
                disabled={decisions.busy}
                onPress={decisions.openSeat}
                className="min-h-12 items-center justify-center rounded-lg bg-amber-400 px-3 py-2 disabled:opacity-50">
                <Text className="text-center font-bold text-amber-950">
                  {t(decisions.busy ? 'game.updating_seat' : 'game.open_player')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: decisions.busy }}
                disabled={decisions.busy}
                onPress={decisions.keepBot}
                className="min-h-12 items-center justify-center rounded-lg border border-amber-400/40 px-3 py-2 disabled:opacity-50">
                <Text className="text-center font-bold text-amber-100">{t('game.keep_bot')}</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !decision, expanded: false }}
            disabled={!decision}
            onPress={() => setExpanded(true)}
            className="min-h-11 self-end rounded-xl border border-amber-400/40 bg-amber-950 px-3 py-3">
            <Text className="text-sm font-semibold text-amber-100">
              {t('game.review_seats', { count: decisions.pendingCount })}
            </Text>
            {!decision && <Text className="text-xs text-amber-200">{t('game.after_turn')}</Text>}
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

/**
 * Floats in the table's notice slot, or at `top` (the waiting room, below its
 * toolbar). It never moves the table or covers the header and seats.
 */
export function TableFeedback({
  notice,
  top,
  onDismiss,
}: {
  notice: TableNotice | null;
  top?: number;
  /** A tap closes the notice early. */
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const message = notice ? tableNoticeText(notice) : '';
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { landscape, noticeSlot } = useTableReserves();

  useEffect(() => {
    if (!notice || Platform.OS !== 'ios') return;
    AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
  }, [notice, message]);

  const noticeWidth = Math.min(360, width - insets.left - insets.right - 24);
  return (
    <View
      pointerEvents="box-none"
      style={[styles.noticeOverlay, top === undefined ? noticeSlot : { top }]}>
      {notice ? (
        <PressableFX
          testID="table-feedback"
          accessible={Platform.OS !== 'ios'}
          accessibilityRole="button"
          accessibilityLabel={message}
          accessibilityHint={t('game.notice_close_hint')}
          accessibilityLiveRegion="polite"
          aria-live="polite"
          aria-atomic
          onPress={onDismiss}
          style={[
            {
              width: noticeWidth,
              minHeight: landscape ? 44 : 52,
              justifyContent: 'center',
              paddingVertical: PidroSpacing.xs,
            },
            // Upright it floats over your seat (PID-393): on the panel the dock gave it.
            !landscape && top === undefined && styles.panel,
          ]}>
          <PidroText role="metadata" align="center" tone="default">
            {message}
          </PidroText>
        </PressableFX>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    paddingHorizontal: PidroSpacing.sm,
    borderRadius: PidroRadii.lg,
    backgroundColor: PidroColors.panel,
    borderWidth: 1,
    borderColor: PidroColors.border,
  },
  noticeOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 140,
    elevation: 140,
  },
});
