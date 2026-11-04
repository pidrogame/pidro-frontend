import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { localizedError, type FriendResult } from '@pidro/shared';
import { friendsApi } from '@/api/friends';
import { ActionPill } from '@/components/ui/ActionPill';
import { PidroText } from '@/components/ui/PidroText';
import { canSearch, discoveryRowState, followFriendLists } from '@/features/friends';
import { addFriend, useFriendsStore } from '@/stores/friends';
import { useAuthStore } from '@/stores/auth';
import { useTranslation } from '@/i18n';
import { FriendRow } from './FriendRow';

/** Recent players and search share one discovery journey; mutations never refetch it. */
export function FriendDiscovery({
  query = '',
  preview,
  dayOnly = false,
  onStart,
  onSent,
}: {
  query?: string;
  preview?: FriendResult[];
  /** Recent rows say only when, as "Yesterday" on the empty Friends screen. */
  dayOnly?: boolean;
  onStart?: () => void;
  onSent: (name: string) => void;
}) {
  const { t } = useTranslation();
  const userId = useAuthStore((state) => state.user?.id);
  const friends = useFriendsStore((state) => state.friends);
  const addedYou = useFriendsStore((state) => state.added_you);
  const requested = useFriendsStore((state) => state.requested);
  const [users, setUsers] = useState<FriendResult[]>(preview ?? []);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(preview ? query.trim() : null);
  const [error, setError] = useState<{ cause: unknown; action: 'search' | 'add' } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(false);
  const inFlight = useRef<Promise<unknown>>(Promise.resolve());
  const scope = useRef({ active: true });
  const search = query.trim();
  const eligible = !search || canSearch(search);

  useEffect(() => {
    if (preview) return;
    const request = { active: true };
    scope.current = request;
    const timer = setTimeout(
      () => {
        setError(null);
        if (!eligible) return;
        // Serialize searches and discard answers for a query that is no longer visible.
        inFlight.current = inFlight.current.then(async () => {
          if (!request.active) return;
          try {
            const result = search ? await friendsApi.search(search) : await friendsApi.recent();
            if (request.active) {
              setUsers(result);
              setLoadedQuery(search);
            }
          } catch (cause) {
            if (request.active) setError({ cause, action: 'search' });
          }
        });
      },
      search ? 300 : 0
    );
    return () => {
      request.active = false;
      clearTimeout(timer);
    };
    // Fixtures are fixed for the route's lifetime and never contact the backend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, eligible, userId, attempt]);

  async function add(player: FriendResult) {
    if (busy.current) return;
    busy.current = true;
    setPending(player.user_id);
    setError(null);
    onStart?.();
    const current = scope.current;
    try {
      const mutation = preview ? Promise.resolve(undefined) : addFriend(player.user_id);
      // A query typed during this mutation must see its answer, not a stale relation.
      inFlight.current = inFlight.current.then(() => mutation).catch(() => undefined);
      const lists = await mutation;
      if (!current.active) return;
      const friend = preview
        ? player.relation === 'added_you'
        : lists?.friends.some((entry) => entry.user_id === player.user_id);
      const sent = preview || lists?.requested?.some((entry) => entry.user_id === player.user_id);
      if (!friend && !sent) return;
      setUsers((rows) =>
        rows.map((row) =>
          row.user_id === player.user_id ? { ...row, relation: friend ? 'friend' : 'added' } : row
        )
      );
      if (!friend) onSent(player.display_name);
    } catch (cause) {
      if (current.active) setError({ cause, action: 'add' });
    } finally {
      setPending(null);
      busy.current = false;
    }
  }

  const loading = !preview && loadedQuery !== search;
  const rows = followFriendLists(users, { friends, added_you: addedYou, requested });
  return (
    <View style={styles.section} testID="friend-discovery">
      <PidroText role="metadata" tone="cyan" accessibilityRole="header" style={styles.eyebrow}>
        {t(search ? 'friends.results' : 'friends.recent')}
      </PidroText>
      {!eligible ? (
        <PidroText role="body" tone="soft">
          {t('friends.query_short')}
        </PidroText>
      ) : loading && !error ? (
        <PidroText role="body" tone="soft">
          {t('profile.loading')}
        </PidroText>
      ) : null}
      {error ? (
        <View style={styles.section}>
          <PidroText role="body" tone="danger" accessibilityRole="alert">
            {localizedError(
              error.cause,
              error.action === 'add' ? 'friends.add_failed' : 'friends.search_failed'
            )}
          </PidroText>
          {error.action === 'search' ? (
            <ActionPill
              label={t('profile.retry')}
              onPress={() => setAttempt((value) => value + 1)}
            />
          ) : null}
        </View>
      ) : null}
      {eligible && !loading
        ? rows.map((player) => (
            <FriendRow
              key={player.user_id}
              name={player.display_name}
              avatarUrl={player.avatar_url}
              level={player.level}
              prestige={player.prestige}
              row={discoveryRowState(player, dayOnly ? 'day' : 'together')}
              trailing={
                player.relation === 'friend' ? (
                  'friends'
                ) : player.relation === 'added' ? (
                  'sent'
                ) : (
                  <ActionPill
                    label={t(player.relation === 'added_you' ? 'friends.accept' : 'friends.add')}
                    icon={player.relation === 'added_you' ? 'check' : 'person-plus'}
                    variant={player.relation === 'added_you' ? 'gold' : undefined}
                    accessibilityLabel={t(
                      player.relation === 'added_you'
                        ? 'friends.accept_player'
                        : 'friends.add_player',
                      { name: player.display_name }
                    )}
                    disabled={pending !== null}
                    loading={pending === player.user_id}
                    onPress={() => void add(player)}
                  />
                )
              }
            />
          ))
        : null}
      {eligible && !loading && !error && users.length === 0 ? (
        <PidroText role="body" tone="soft">
          {t(search ? 'friends.no_results' : 'friends.recent_empty')}
        </PidroText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  eyebrow: {
    paddingHorizontal: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '900',
    fontSize: 11,
  },
});
