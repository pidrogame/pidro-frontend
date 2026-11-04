import { StyleSheet, View } from 'react-native';
import type { LeagueId } from '@pidro/shared';
import { gradientBg } from '@/components/ui/Bevel';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { PidroBevel, PidroColors, PidroFonts, PidroRadii, PidroSpacing } from '@/design/tokens';
import { LEAGUES, leagueName } from '@/features/league';

export function LeagueCard({
  league,
  size = 40,
  lit = false,
  faded = false,
}: {
  league: LeagueId;
  size?: number;
  lit?: boolean;
  faded?: boolean;
}) {
  const card = LEAGUES.find(({ id }) => id === league)!;
  const pidro = league === 'pidro';
  return (
    <View
      accessible
      accessibilityLabel={leagueName(league)}
      style={[
        styles.card,
        { width: size, height: size * 1.4 },
        pidro && gradientBg(PidroBevel.goldRimGradient),
        lit && styles.lit,
        faded && styles.faded,
      ]}>
      {pidro ? (
        <Icon name="spade" size={size * 0.56} color={PidroBevel.woodDeep} />
      ) : (
        <>
          <PidroText
            style={[
              styles.rank,
              { fontSize: size * 0.56, lineHeight: size * 0.66 },
              card.red && styles.red,
            ]}>
            {card.rank}
          </PidroText>
          <PidroText
            style={[
              styles.suit,
              { fontSize: size * 0.43, lineHeight: size * 0.5 },
              card.red && styles.red,
            ]}>
            {card.suit}
          </PidroText>
        </>
      )}
    </View>
  );
}

export function LeagueStrip({ league }: { league: LeagueId | null }) {
  const current = LEAGUES.findIndex(({ id }) => id === league);
  return (
    <View testID="league-strip" style={styles.strip}>
      {LEAGUES.map(({ id }, index) => (
        <View key={id} style={styles.link}>
          {index > 0 ? <View style={[styles.rule, index > current && styles.faded]} /> : null}
          <LeagueCard
            league={id}
            size={26}
            lit={id === league}
            faded={current >= 0 && index > current}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexShrink: 0,
    borderRadius: PidroRadii.tight,
    borderWidth: 1,
    borderColor: PidroColors.leagueCardEdge,
    backgroundColor: PidroColors.leagueCardFace,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: PidroColors.pointCardShadow,
  },
  lit: {
    boxShadow: PidroColors.pointCardFiveGlow,
    borderColor: PidroBevel.textGold,
    borderWidth: 2,
  },
  faded: { opacity: 0.4 },
  rank: { fontFamily: PidroFonts.display, fontWeight: '400', color: PidroColors.leagueCardInk },
  suit: { color: PidroColors.leagueCardInk },
  red: { color: PidroColors.leagueCardRed },
  strip: { flexDirection: 'row', alignItems: 'center', paddingVertical: PidroSpacing.xxs },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rule: { width: 14, height: 2, backgroundColor: PidroColors.borderStrong, marginLeft: 6 },
});
