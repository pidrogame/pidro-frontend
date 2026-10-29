import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SUIT_SYMBOLS, type Position, type ServerHandSummary } from '@pidro/shared';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { TextLink } from '@/components/ui/TextLink';
import { PidroColors, PidroSpacing } from '@/design/tokens';
import { handHistoryRows } from '@/features/game/handHistory';
import { TableUtilityWindow } from '@/game/canvas/TableUtilityWindow';
import { formatNumber, useTranslation } from '@/i18n';

/**
 * Both entry points read the same server ledger; pages keep every size bounded.
 * `onOpenLog`: where the table has no ticker to open this hand's log (tight
 * phones with count help, PID-304), the panel opens it.
 */
export function HandHistory({
  history,
  viewer,
  onClose,
  onOpenLog,
}: {
  history: readonly ServerHandSummary[] | null | undefined;
  viewer: Position | null;
  onClose: () => void;
  onOpenLog?: () => void;
}) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const rows = handHistoryRows(history, viewer);
  const pageSize = Math.max(
    1,
    Math.min(8, Math.floor((height - insets.top - insets.bottom - 210) / 58))
  );
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const labels = viewer ? [t('game.us'), t('game.them')] : [t('game.ns_short'), t('game.ew_short')];
  const pair = (values: number[]) => values.map((value) => formatNumber(value)).join('–');
  return (
    <TableUtilityWindow title={t('game.every_hand')} open onClose={onClose}>
      <View testID="hand-history" style={styles.list}>
        {onOpenLog ? (
          <TextLink
            testID="hand-history-this-hand"
            label={t('game.this_hand_link')}
            accessibilityLabel={t('game.this_hand')}
            accessibilityRole="button"
            onPress={onOpenLog}
            style={styles.link}
          />
        ) : null}
        <PidroText role="metadata" tone="soft">
          {t('game.history_order', { first: labels[0], second: labels[1] })}
        </PidroText>
        <View style={styles.row}>
          <PidroText role="metadata" style={styles.number}>
            #
          </PidroText>
          <PidroText role="metadata" style={styles.bid}>
            {t('game.bids')}
          </PidroText>
          <PidroText role="metadata" style={styles.figures}>
            {t('game.history_points')}
          </PidroText>
          <PidroText role="metadata" style={styles.figures}>
            {t('game.history_total')}
          </PidroText>
        </View>
        {!rows.length ? <PidroText role="body">{t('game.no_scores')}</PidroText> : null}
        {rows.slice(current * pageSize, (current + 1) * pageSize).map((row) => (
          <View
            key={row.number}
            testID={`history-hand-${row.number}`}
            style={[styles.row, styles.hand]}>
            <PidroText role="metadata" tone="soft" style={styles.number}>
              {formatNumber(row.number)}
            </PidroText>
            <View style={styles.bid}>
              <PidroText role="label">{`${labels[row.ours ? 0 : 1]} ${row.bid}${row.trump ? ` ${SUIT_SYMBOLS[row.trump]}` : ''}`}</PidroText>
              <PidroText
                role="metadata"
                tone="soft">{`${t(`table.position.${row.bidder}`)} · ${t(row.made ? 'game.history_made' : 'game.history_missed')}`}</PidroText>
            </View>
            <PidroText role="label" style={styles.figures}>
              {pair(row.captured)}
            </PidroText>
            <PidroText role="label" style={styles.figures}>
              {pair(row.totals)}
            </PidroText>
          </View>
        ))}
        {pages > 1 ? (
          <View style={styles.paging}>
            <BevelButton
              material="glass"
              size="sm"
              label={t('game.history_newer')}
              disabled={current === 0}
              onPress={() => setPage(current - 1)}
            />
            <PidroText role="metadata">
              {current + 1} / {pages}
            </PidroText>
            <BevelButton
              material="glass"
              size="sm"
              label={t('game.history_older')}
              disabled={current === pages - 1}
              onPress={() => setPage(current + 1)}
            />
          </View>
        ) : null}
      </View>
    </TableUtilityWindow>
  );
}

const styles = StyleSheet.create({
  list: { gap: PidroSpacing.xs },
  link: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: PidroSpacing.xxs },
  hand: { minHeight: 50, borderTopWidth: 1, borderTopColor: PidroColors.border },
  number: { width: 22 },
  bid: { flex: 1, minWidth: 0 },
  figures: { width: 60, textAlign: 'right', fontVariant: ['tabular-nums'] },
  paging: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: PidroSpacing.xs,
  },
});
