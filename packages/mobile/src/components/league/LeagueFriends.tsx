import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useGlobalSearchParams, useNavigation, useRouter } from 'expo-router';
import type { LeagueFriend } from '@pidro/shared';
import { friendsApi } from '@/api/friends';
import { FriendSheet } from '@/components/friends/FriendSheet';
import { PlayerSheet } from '@/components/profile/PlayerSheet';
import { PidroText } from '@/components/ui/PidroText';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { PidroBevel, PidroColors, PidroRadii, PidroSpacing } from '@/design/tokens';
import { leagueName } from '@/features/league';
import { roomHasUser } from '@/features/lobby/newTable';
import { friendSheetFixture } from '@/features/profileFixtures';
import { formatNumber, useTranslation } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import {
  addFriend,
  blockPlayer,
  refreshFriends,
  removeFriend,
  useFriendsStore,
} from '@/stores/friends';
import { useLobbyStore } from '@/stores/lobby';
import { LeagueCard } from './LeagueCard';
import { useLeague } from './LeagueHost';

export function LeagueFriends() {
  const { t } = useTranslation();
  const { data, refresh } = useLeague();
  const router = useRouter();
  const navigation = useNavigation();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const { fixture } = useGlobalSearchParams<{ fixture?: string }>();
  const preview = __DEV__ && fixture?.startsWith('league-');
  const friends = useFriendsStore((state) => state.friends);
  const [selected, setSelected] = useState<LeagueFriend | null>(null);
  const [profile, setProfile] = useState<LeagueFriend | null>(null);
  const friend = selected
    ? (friends.find(({ user_id }) => user_id === selected.user_id) ?? {
        user_id: selected.user_id,
        display_name: selected.username,
        avatar_url: selected.avatar.url,
        level: selected.level,
        prestige: selected.prestige,
      })
    : null;
  if (!data?.friends?.length) return null;
  const me = data.status === 'placed' ? data.room?.standings.find((standing) => standing.me) : null;
  const players = [
    ...data.friends.map((player) => ({ ...player, me: false })),
    ...(me && data.league ? [{ ...me, league: data.league }] : []),
  ].sort((a, b) => b.points - a.points || a.user_id.localeCompare(b.user_id));
  return (
    <View testID="league-friends" style={styles.section}>
      <PidroText role="eyebrow" tone="cyan">
        {t('league.friends.title')}
      </PidroText>
      {players.map((player) => (
        <PressableFX
          key={player.user_id}
          testID={`league-friend-${player.user_id}`}
          accessibilityRole="button"
          accessibilityLabel={`${player.username}${player.me ? ` (${t('league.you')})` : ''} · ${leagueName(player.league)} · ${formatNumber(player.points)}`}
          onPress={() => {
            if (player.me) setProfile(player);
            else {
              setSelected(player);
              if (!preview) void refreshFriends().catch(() => undefined);
            }
          }}
          style={[styles.row, player.me && styles.me]}>
          <PlayerAvatar
            size={44}
            uri={player.avatar.url}
            level={player.level}
            prestige={player.prestige}
          />
          <PidroText role="label" numberOfLines={1} style={[styles.name, player.me && styles.gold]}>
            {player.username}
          </PidroText>
          <LeagueCard league={player.league} size={26} />
          <PidroText role="label" style={player.me && styles.gold}>
            {formatNumber(player.points)}
          </PidroText>
        </PressableFX>
      ))}
      {friend ? (
        <FriendSheet
          player={friend}
          relation="friend"
          onClose={() => setSelected(null)}
          fixture={preview ? friendSheetFixture(friend) : undefined}
          onProfile={() => {
            setProfile(selected);
            setSelected(null);
          }}
          onAction={async (action) => {
            if (!preview) {
              if (action === 'play') {
                const { lobby, rooms } = useLobbyStore.getState();
                const userId = useAuthStore.getState().user?.id;
                if (
                  lobby.my_rejoinable.length ||
                  rooms.some((room) => room.status !== 'finished' && roomHasUser(room, userId))
                )
                  router.push('/lobby');
                else router.push({ pathname: '/new-table', params: { partner: friend.user_id } });
              } else if (action === 'join') {
                const token = useAuthStore.getState().accessToken;
                const { room } = await friendsApi.join(friend.user_id);
                if (
                  !active.current ||
                  !navigation.isFocused() ||
                  useAuthStore.getState().accessToken !== token
                )
                  return;
                useLobbyStore.getState().upsertLobbyRoom(room, 'my_rejoinable');
                router.push(`/game/${room.code}`);
              } else {
                await { accept: addFriend, remove: removeFriend, block: blockPlayer }[action](
                  friend.user_id
                );
                await refresh();
              }
            }
            setSelected(null);
          }}
        />
      ) : null}
      <PlayerSheet
        playerId={profile?.user_id ?? null}
        standing={profile ? { league: profile.league, place: profile.place } : undefined}
        onClose={() => setProfile(null)}
        fixture={
          preview && profile
            ? friendSheetFixture({
                ...profile,
                display_name: profile.username,
                avatar_url: profile.avatar.url,
              })
            : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { width: '100%', gap: PidroSpacing.xs, padding: PidroSpacing.sm },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.sm,
    paddingVertical: PidroSpacing.xs,
    paddingHorizontal: PidroSpacing.xs,
    borderRadius: PidroRadii.tight,
  },
  me: { backgroundColor: PidroColors.goldSoft },
  gold: { color: PidroBevel.textGold },
  name: { flex: 1, minWidth: 0 },
});
