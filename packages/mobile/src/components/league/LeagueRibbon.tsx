import { useId, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Polygon, Stop } from 'react-native-svg';
import type { LeagueRibbon as Ribbon } from '@pidro/shared';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import { TextLink } from '@/components/ui/TextLink';
import {
  PidroBevel,
  PidroColors,
  PidroFonts,
  PidroLeagueRibbons,
  PidroSpacing,
} from '@/design/tokens';
import { leagueMarkName, LEAGUES, ribbonHistory, ribbonMonth } from '@/features/league';
import { useTranslation } from '@/i18n';
import { useLeague } from './LeagueHost';

export function LeagueRibbon({
  ribbon,
  size = 40,
  faded = false,
}: {
  ribbon: Ribbon;
  size?: number;
  faded?: boolean;
}) {
  const { t } = useTranslation();
  const gradient = useId();
  const colors = PidroLeagueRibbons[ribbon.league];
  const ink = ribbon.league === 'pidro' ? PidroBevel.woodDeep : PidroColors.text;
  return (
    <View
      testID="league-ribbon"
      accessible
      accessibilityLabel={t(ribbon.star ? 'league.ribbons.label_star' : 'league.ribbons.label', {
        month: ribbonMonth(ribbon.month),
        league: leagueMarkName(ribbon.league),
      })}
      style={[styles.ribbon, { width: size, height: size * 1.5 }, faded && styles.faded]}>
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 40 60" width={size} height={size * 1.5}>
        <Defs>
          <LinearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors[0]} />
            <Stop offset="1" stopColor={colors[1]} />
          </LinearGradient>
        </Defs>
        <Polygon points="0,0 40,0 40,60 20,48 0,60" fill={`url(#${gradient})`} />
      </Svg>
      <PidroText style={[styles.month, { color: ink }]}>
        {ribbonMonth(ribbon.month, true).replace('.', '').toUpperCase()}
      </PidroText>
      <PidroText
        style={[styles.mark, { color: ink, fontSize: size * 0.5, lineHeight: size * 0.6 }]}>
        {ribbon.league === 'pidro' ? '5' : LEAGUES.find(({ id }) => id === ribbon.league)!.rank}
      </PidroText>
      {ribbon.star ? (
        <View testID="league-ribbon-star">
          <Icon name="star" size={size * 0.27} color={ink} />
        </View>
      ) : null}
    </View>
  );
}

export function LeagueWeekDots({ ribbon }: { ribbon: Ribbon }) {
  const { t } = useTranslation();
  return (
    <View
      accessible
      accessibilityLabel={t('league.ribbons.weeks', {
        played: ribbon.weeks_played,
        total: ribbon.weeks_total,
      })}
      style={styles.dots}>
      {Array.from({ length: ribbon.weeks_total }, (_, index) => (
        <View key={index} style={[styles.dot, index < ribbon.weeks_played && styles.played]} />
      ))}
    </View>
  );
}

export function LeagueRibbonShelf() {
  const { t } = useTranslation();
  const { data } = useLeague();
  const { width, height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const ribbons = data ? ribbonHistory(data.ribbons) : [];
  if (!ribbons.length) return null;
  const wide = width > height;
  return (
    <>
      <PressableFX
        testID="profile-ribbons"
        accessibilityRole="button"
        accessibilityLabel={t('league.ribbons.title')}
        onPress={() => setOpen(true)}
        style={styles.shelf}>
        <PidroText role="eyebrow" tone="cyan">
          {t('league.ribbons.title')}
        </PidroText>
        <View style={styles.shelfRow}>
          {ribbons.map((ribbon) => (
            <LeagueRibbon key={ribbon.month} ribbon={ribbon} size={28} faded={ribbon.so_far} />
          ))}
        </View>
        {data?.ribbons.current ? (
          <PidroText role="metadata" tone="muted">
            {t('league.ribbons.so_far', { month: ribbonMonth(data.ribbons.current.month) })}
          </PidroText>
        ) : null}
      </PressableFX>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={t('league.ribbons.title')}
        supportedOrientations={['portrait', 'landscape']}>
        <View testID="league-ribbons" style={[styles.history, wide && styles.wideHistory]}>
          {ribbons.map((ribbon) => (
            <View
              key={ribbon.month}
              style={[styles.historyMonth, { width: wide ? '16.66%' : '25%' }]}>
              <LeagueRibbon ribbon={ribbon} size={38} faded={ribbon.so_far} />
              <PidroText role="metadata" tone="soft" align="center">
                {ribbonMonth(ribbon.month)}
              </PidroText>
            </View>
          ))}
        </View>
        <TextLink label={t('league.result.close')} onPress={() => setOpen(false)} />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  ribbon: { flexShrink: 0, alignItems: 'center', paddingTop: 4 },
  faded: { opacity: 0.55 },
  month: { fontFamily: PidroFonts.ui, fontWeight: '900', fontSize: 9, lineHeight: 12 },
  mark: { fontFamily: PidroFonts.display, fontWeight: '400' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: PidroColors.borderStrong,
  },
  played: { backgroundColor: PidroColors.gold, borderColor: PidroColors.goldLight },
  shelf: { gap: PidroSpacing.xs, minHeight: 44, padding: PidroSpacing.sm },
  shelfRow: { flexDirection: 'row', flexWrap: 'wrap', gap: PidroSpacing.xs },
  history: { flexDirection: 'row', flexWrap: 'wrap', rowGap: PidroSpacing.sm, width: '100%' },
  wideHistory: { maxWidth: 480 },
  historyMonth: { alignItems: 'center', gap: 4, paddingHorizontal: 2 },
});
