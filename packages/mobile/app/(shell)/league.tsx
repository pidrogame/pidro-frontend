import { useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { LeagueStanding } from '@pidro/shared';
import { AuthSheet } from '@/components/auth/AuthSheet';
import { LeagueCard, LeagueStrip } from '@/components/league/LeagueCard';
import { useLeague } from '@/components/league/LeagueHost';
import { LeagueIntro } from '@/components/league/LeagueIntro';
import { LeagueFriends } from '@/components/league/LeagueFriends';
import { PlayerSheet } from '@/components/profile/PlayerSheet';
import { usePillClearance } from '@/components/shell/TabPill';
import { PidroText } from '@/components/ui/PidroText';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { Surface } from '@/components/ui/Surface';
import { TextLink } from '@/components/ui/TextLink';
import { PidroBevel, PidroColors, PidroFonts, PidroRadii, PidroSpacing } from '@/design/tokens';
import {
  closeTimeText,
  leagueBands,
  leagueName,
  nextLeague,
  ordinal,
  previousLeague,
} from '@/features/league';
import { LEAGUE_FIXTURE_NOW } from '@/features/leagueFixtures';
import { formatNumber, useTranslation } from '@/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';

export default function LeagueScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data, error, busy, refresh, setHidden } = useLeague();
  const { fixture } = useLocalSearchParams<{ fixture?: string }>();
  const { width, height } = useWindowDimensions();
  const wide = width > height;
  const clearance = usePillClearance();
  const [selected, setSelected] = useState<string | null>(null);
  const [register, setRegister] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [viewport, setViewport] = useState(0);
  const [offset, setOffset] = useState(0);
  const [ownBox, setOwnBox] = useState({ y: 0, height: 0 });
  const room = data?.room;
  const league = data?.league;
  const up = league ? nextLeague(league) : null;
  const down = league ? previousLeague(league) : null;
  const bands = league && room ? leagueBands(league, room) : null;
  const own = room?.standings.find((row) => row.me);
  const pinned =
    own && ownBox.height > 0 && (ownBox.y < offset || ownBox.y + ownBox.height > offset + viewport);
  const footer =
    down && bands?.demoteFrom && room
      ? t(room.demote === 1 ? 'league.demote_one' : 'league.demote', {
          from: bands.demoteFrom,
          to: room.size,
          league: leagueName(down),
        })
      : null;

  return (
    <ScreenShell
      testID="league-screen"
      contentStyle={[
        styles.shell,
        {
          paddingBottom: clearance.bottom + PidroSpacing.md,
          paddingRight: clearance.right + PidroSpacing.md,
        },
      ]}>
      <View style={[styles.layout, wide && styles.columns]}>
        <View testID="league-summary" style={[styles.summary, wide && styles.side]}>
          {data?.status === 'off' ? (
            <PidroText role="body" tone="soft">
              {t('league.off')}
            </PidroText>
          ) : (
            <>
              {league ? (
                <View style={styles.header}>
                  <LeagueCard league={league} lit />
                  <View style={styles.copy}>
                    <PidroText
                      role="display"
                      tone="gold"
                      style={styles.title}
                      accessibilityRole="header">
                      {t('league.title', { league: leagueName(league) })}
                    </PidroText>
                    {data?.week ? (
                      <PidroText role="metadata" tone="soft">
                        {closeTimeText(
                          data.week.closes_at,
                          __DEV__ && fixture?.startsWith('league-')
                            ? LEAGUE_FIXTURE_NOW
                            : new Date()
                        )}
                      </PidroText>
                    ) : null}
                  </View>
                </View>
              ) : null}
              {data ? <LeagueStrip league={league ?? null} /> : null}
              {room && league ? (
                <PidroText role="metadata" tone="soft">
                  {t('league.room', { size: room.size, league: leagueName(league) })}
                  {up && room.promote > 0
                    ? ` ${t(room.promote === 1 ? 'league.promote_one' : 'league.promote', { count: room.promote, league: leagueName(up) })}`
                    : ''}
                </PidroText>
              ) : null}
            </>
          )}
        </View>
        {room ? (
          <Surface testID="league-standings" variant="window" style={styles.standings}>
            <View style={styles.list}>
              <ScrollView
                testID="league-list"
                style={styles.list}
                contentContainerStyle={styles.rows}
                onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
                onScroll={(event) => setOffset(event.nativeEvent.contentOffset.y)}
                scrollEventThrottle={16}>
                {room.standings.map((row) => (
                  <View
                    key={row.user_id}
                    onLayout={row.me ? (event) => setOwnBox(event.nativeEvent.layout) : undefined}>
                    <StandingRow row={row} onPress={() => setSelected(row.user_id)} />
                    {row.place === bands?.promoteAfter && up ? (
                      <View testID="league-up-divider" style={styles.divider}>
                        <PidroText role="metadata" tone="gold">
                          {t('league.move_up', { league: leagueName(up) })}
                        </PidroText>
                      </View>
                    ) : null}
                  </View>
                ))}
                <LeagueFriends />
              </ScrollView>
              {pinned ? (
                <View testID="league-pinned" style={styles.pinned}>
                  <StandingRow row={own} onPress={() => setSelected(own.user_id)} />
                </View>
              ) : null}
            </View>
            {footer ? (
              <PidroText
                testID="league-demotion"
                role="metadata"
                tone="soft"
                align="center"
                style={styles.footer}>
                {footer}
              </PidroText>
            ) : null}
          </Surface>
        ) : data?.status !== 'off' ? (
          <ScrollView
            testID="league-empty"
            style={styles.list}
            contentContainerStyle={styles.empty}>
            <PidroText role="body" tone="soft">
              {t(
                !data
                  ? error
                    ? 'league.failed'
                    : 'league.loading'
                  : data.status === 'guest'
                    ? 'league.guest'
                    : data.status === 'opted_out'
                      ? 'league.opted_out'
                      : 'league.not_placed'
              )}
            </PidroText>
            {data?.last_week && data.status === 'not_placed' ? (
              <PidroText role="metadata" tone="soft">
                {t('league.last_week', {
                  place: ordinal(data.last_week.place),
                  league: leagueName(data.last_week.league),
                })}
              </PidroText>
            ) : null}
            {data?.status === 'guest' ? (
              <TextLink label={t('league.register')} onPress={() => setRegister(true)} />
            ) : null}
            {data?.status === 'opted_out' ? (
              <TextLink
                label={t('league.join_again')}
                disabled={busy}
                onPress={() => {
                  setActionError(false);
                  void setHidden(false).catch(() => setActionError(true));
                }}
              />
            ) : null}
            {!data && error ? (
              <TextLink label={t('league.retry')} onPress={() => void refresh()} />
            ) : null}
            {actionError ? (
              <PidroText accessibilityRole="alert" tone="danger">
                {t('league.failed')}
              </PidroText>
            ) : null}
            <LeagueFriends />
          </ScrollView>
        ) : null}
      </View>
      <PlayerSheet playerId={selected} onClose={() => setSelected(null)} />
      <AuthSheet
        isOpen={register}
        reason="save"
        onClose={() => setRegister(false)}
        onClaimClassic={(name) => {
          setRegister(false);
          router.push({ pathname: '/(auth)/claim-classic', params: { name } });
        }}
      />
      <LeagueIntro />
    </ScreenShell>
  );
}

function StandingRow({ row, onPress }: { row: LeagueStanding; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <PressableFX
      testID={`league-row-${row.place}`}
      accessibilityRole="button"
      accessibilityLabel={`${row.place}. ${row.username}${row.me ? ` (${t('league.you')})` : ''}, ${formatNumber(row.points)} XP`}
      onPress={onPress}
      style={[styles.row, row.me && styles.me]}>
      <PidroText role="label" style={[styles.place, row.me && styles.gold]}>
        {row.place}
      </PidroText>
      <PlayerAvatar size={44} uri={row.avatar.url} level={row.level} prestige={row.prestige} />
      <PidroText role="label" numberOfLines={1} style={[styles.name, row.me && styles.gold]}>
        {row.username}
        {row.me ? ` (${t('league.you')})` : ''}
      </PidroText>
      <PidroText role="label" style={row.me && styles.gold}>
        {formatNumber(row.points)}
      </PidroText>
    </PressableFX>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, minHeight: 0 },
  layout: { flex: 1, minHeight: 0, gap: 14, width: '100%', maxWidth: 1000, alignSelf: 'center' },
  columns: { flexDirection: 'row', gap: PidroSpacing.lg },
  summary: { gap: PidroSpacing.sm, paddingHorizontal: PidroSpacing.xxs },
  side: { width: '38%', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontFamily: PidroFonts.display, fontWeight: '400', lineHeight: 42 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  standings: { flex: 1, minHeight: 0, padding: 6 },
  list: { flex: 1, minHeight: 0 },
  rows: { gap: 2, paddingBottom: 58 },
  row: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: PidroRadii.surface,
    borderWidth: 1,
    borderColor: PidroColors.panelStrong,
  },
  me: { backgroundColor: PidroColors.chosenBg, borderColor: PidroBevel.rim },
  place: { width: 22, fontVariant: ['tabular-nums'] },
  name: { flex: 1, minWidth: 0 },
  gold: { color: PidroBevel.textGold },
  divider: {
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: PidroBevel.rim,
    marginTop: 2,
  },
  footer: { paddingVertical: PidroSpacing.sm, paddingHorizontal: 4 },
  pinned: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
    backgroundColor: PidroColors.panelStrong,
  },
  empty: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: PidroSpacing.md },
});
