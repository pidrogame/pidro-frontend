import { useCallback, useEffect, useRef, useState } from 'react';
import { Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  localizedError,
  normalizeFriendSlug,
  type FriendLists,
  type FriendPlayer,
} from '@pidro/shared';
import { friendsApi } from '@/api/friends';
import { profileApi } from '@/api/profile';
import { useLobbyChannel } from '@/channels/hooks/useLobbyChannel';
import { AuthSheet } from '@/components/auth/AuthSheet';
import { FriendDiscovery } from '@/components/friends/FriendDiscovery';
import { FriendRow } from '@/components/friends/FriendRow';
import { FriendSheet } from '@/components/friends/FriendSheet';
import { InfoCard } from '@/components/friends/InfoCard';
import { PlayerProfileModal } from '@/components/profile/PlayerProfileModal';
import { useNoticeInset, usePillClearance } from '@/components/shell/TabPill';
import { ActionPill } from '@/components/ui/ActionPill';
import { BackButton } from '@/components/ui/BackButton';
import { BevelButton } from '@/components/ui/BevelButton';
import { CountBadge } from '@/components/ui/CountBadge';
import { DismissButton } from '@/components/ui/DismissButton';
import { PidroText } from '@/components/ui/PidroText';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { Toast } from '@/components/ui/Toast';
import { PidroBevel, PidroFonts, PidroSpacing } from '@/design/tokens';
import {
  APP_INSTALL_URL,
  classicFriendsMessage,
  friendAction,
  friendLinkMessage,
  friendRowState,
  friendSections,
  friendsMeta,
  linkProfileAction,
} from '@/features/friends';
import { discoveryFixture, friendsFixture, linkProfileFixture } from '@/features/friends/fixtures';
import { roomHasUser } from '@/features/lobby/newTable';
import { useAuthStore } from '@/stores/auth';
import {
  addFriend,
  blockPlayer,
  ignoreFriend,
  refreshFriends,
  removeFriend,
  unignoreFriend,
  useFriendsStore,
} from '@/stores/friends';
import { useLobbyStore } from '@/stores/lobby';
import { useTranslation } from '@/i18n';

function LiveFriends() {
  useLobbyChannel();
  useFocusEffect(
    useCallback(() => {
      void refreshFriends().catch(() => undefined);
    }, [])
  );
  return null;
}

export default function FriendsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const {
    fixture,
    player: linkSlug,
    from,
  } = useLocalSearchParams<{
    fixture?: string;
    player?: string;
    from?: string;
  }>();
  const preview = friendsFixture(fixture);
  const [previewLists, setPreviewLists] = useState<FriendLists>();
  const store = useFriendsStore();
  const user = useAuthStore((state) => state.user);
  const guest = Boolean(user?.guest);
  const clearance = usePillClearance();
  const noticeInset = useNoticeInset();
  const [accountOpen, setAccountOpen] = useState(guest);
  const [selected, onOpen] = useState<FriendPlayer | null>(() =>
    fixture?.startsWith('sheet-') && preview ? (preview.friends[0] ?? preview.added_you[0]) : null
  );
  const [fullProfile, setFullProfile] = useState<FriendPlayer | null>(null);
  // Someone's own link, opened while signed in: their profile with Add.
  const linkPreview = linkProfileFixture(fixture);
  const [linked, setLinked] = useState<string | null>(linkPreview?.user_id ?? null);
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);
  const [hidden, setHidden] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<unknown>(null);
  const [shareError, setShareError] = useState(false);
  const [linkShareError, setLinkShareError] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const dismissSent = useCallback(() => setSent(null), []);
  const [toast, setToast] = useState<{ kind: 'hidden' | 'cancelled'; player: FriendPlayer } | null>(
    null
  );
  const dismissToast = useCallback(() => setToast(null), []);
  const lists = preview ? (previewLists ?? preview) : store;
  const sections = friendSections({
    ...lists,
    added_you: lists.added_you.filter((p) => p.user_id !== hidden),
  });
  const classicMessage = classicFriendsMessage(lists);
  const loading = preview ? fixture === 'loading' : store.isLoading && !pending;
  const error = joinError ?? (preview ? fixture === 'error' : store.error);
  const empty = discovering || (sections.length === 0 && !loading && !error);
  const tight = empty && !landscape && height < 700;

  useFocusEffect(
    useCallback(() => {
      setDiscovering(false);
      setSent(null);
    }, [])
  );

  useEffect(() => {
    const slug = normalizeFriendSlug(linkSlug ?? '');
    if (!slug || preview) return;
    let active = true;
    profileApi
      .getPlayerBySlug(slug)
      .then((player) => {
        if (active) setLinked(player.user_id);
      })
      .catch(() => undefined)
      // Cleared once answered: clearing it earlier reruns this effect and drops the answer.
      .finally(() => {
        if (active) router.setParams({ player: undefined });
      });
    return () => {
      active = false;
    };
    // The fixture never changes for the route's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkSlug]);

  const classicCard = classicMessage ? (
    <View testID="friends-classic-count">
      <InfoCard
        title={classicMessage}
        body={t('friends.classic_body')}
        action={{
          label: t('friends.tell_classic'),
          icon: 'share',
          onPress: async () => {
            setShareError(false);
            try {
              await Share.share({
                message: t('friends.share_app_message', { url: APP_INSTALL_URL }),
              });
            } catch {
              setShareError(true);
            }
          },
        }}
      />
      {shareError ? (
        <PidroText role="body" tone="danger" accessibilityRole="alert">
          {t('invite.host.shareError')}
        </PidroText>
      ) : null}
    </View>
  ) : null;
  const linkCard = (
    <View testID="friends-link-card">
      <InfoCard
        title={t('friends.not_on_pidro')}
        body={t('friends.not_on_pidro_body')}
        action={{
          label: t('friends.send_link'),
          icon: 'link',
          onPress: async () => {
            setLinkShareError(false);
            try {
              await Share.share({ message: friendLinkMessage(user?.share_slug).message });
            } catch {
              setLinkShareError(true);
            }
          },
        }}
      />
      {linkShareError ? (
        <PidroText role="body" tone="danger" accessibilityRole="alert">
          {t('invite.host.shareError')}
        </PidroText>
      ) : null}
    </View>
  );
  const selectedPlayer = selected
    ? ([...lists.friends, ...lists.added_you, ...(lists.requested ?? [])].find(
        (player) => player.user_id === selected.user_id
      ) ?? selected)
    : null;
  const selectedRelation = lists.added_you.some((player) => player.user_id === selected?.user_id)
    ? 'added_you'
    : lists.friends.some((player) => player.user_id === selected?.user_id)
      ? 'friend'
      : 'added';

  function play(player: FriendPlayer) {
    if (preview) return;
    const { lobby, rooms } = useLobbyStore.getState();
    const userId = useAuthStore.getState().user?.id;
    if (
      lobby.my_rejoinable.length ||
      rooms.some((room) => room.status !== 'finished' && roomHasUser(room, userId))
    )
      router.push('/lobby');
    else router.push({ pathname: '/new-table', params: { partner: player.user_id } });
  }

  async function act(
    action: 'accept' | 'ignore' | 'undo' | 'cancel' | 'join',
    player: FriendPlayer,
    inSheet = false
  ) {
    if (busy.current) return false;
    busy.current = true;
    setPending(player.user_id);
    setJoinError(null);
    setToast(null);
    if (action === 'ignore') setHidden(player.user_id);
    try {
      if (preview) {
        if (action === 'join') return true;
        setPreviewLists({
          ...lists,
          friends: action === 'accept' ? [...lists.friends, player] : lists.friends,
          added_you:
            action === 'undo'
              ? [player, ...lists.added_you]
              : lists.added_you.filter((p) => p.user_id !== player.user_id),
          requested:
            action === 'cancel'
              ? lists.requested?.filter((p) => p.user_id !== player.user_id)
              : lists.requested,
          requests_waiting:
            (lists.requests_waiting ?? lists.added_you.length) +
            (action === 'undo' ? 1 : action === 'accept' || action === 'ignore' ? -1 : 0),
        });
      } else if (action === 'join') {
        const { room } = await friendsApi.join(player.user_id);
        useLobbyStore.getState().upsertLobbyRoom(room, 'my_rejoinable');
        router.push(`/game/${room.code}`);
      } else {
        const mutate = {
          accept: addFriend,
          ignore: ignoreFriend,
          undo: unignoreFriend,
          cancel: removeFriend,
        }[action];
        await mutate(player.user_id);
      }
      if (action === 'ignore' || action === 'cancel')
        setToast({ kind: action === 'ignore' ? 'hidden' : 'cancelled', player });
      return true;
    } catch (cause) {
      if (action === 'join') {
        if (!inSheet) setJoinError(cause);
        await refreshFriends().catch(() => undefined);
      }
      if (inSheet) throw cause;
      // List mutations report their error through the store and keep the last answer.
    } finally {
      setHidden(null);
      setPending(null);
      busy.current = false;
    }
  }

  return (
    <View style={styles.root}>
      <ScreenShell
        scroll
        compact={!empty || !landscape}
        testID="friends-screen"
        contentStyle={[
          styles.content,
          // Empty on a small phone: a tighter rhythm keeps the board's one screen.
          tight && styles.tight,
          {
            paddingBottom: (tight ? 0 : PidroSpacing.md) + (guest ? noticeInset : clearance.bottom),
            paddingRight: PidroSpacing.md + (guest ? 0 : clearance.right),
          },
        ]}>
        {!guest && !preview ? <LiveFriends /> : null}
        <View style={styles.header}>
          {from === 'profile' ? (
            <BackButton testID="friends-profile-back" onPress={() => router.replace('/profile')} />
          ) : null}
          <View style={styles.heading}>
            <PidroText role="display" accessibilityRole="header" style={styles.title}>
              {t('social.friends')}
            </PidroText>
            {!guest && !empty ? (
              <PidroText role="metadata" tone="soft">
                {friendsMeta(lists)}
              </PidroText>
            ) : null}
          </View>
          {!guest ? (
            <ActionPill
              label={t('friends.add')}
              icon="person-plus"
              accessibilityLabel={t('friends.add_friend')}
              onPress={() => router.push('/friends-add')}
            />
          ) : null}
        </View>
        {guest ? (
          <BevelButton label={t('auth.sheet_save_title')} onPress={() => setAccountOpen(true)} />
        ) : (
          <>
            {error ? (
              <>
                <PidroText role="body" tone="danger" accessibilityRole="alert">
                  {localizedError(error, joinError ? 'social.seat_error' : 'friends.update_failed')}
                </PidroText>
                <ActionPill
                  label={t('profile.retry')}
                  onPress={() => {
                    setJoinError(null);
                    if (!preview) void refreshFriends().catch(() => undefined);
                  }}
                />
              </>
            ) : null}
            {loading && !discovering ? (
              <PidroText role="body" tone="soft">
                {t('profile.loading')}
              </PidroText>
            ) : null}
            {!discovering &&
              sections.map((section) => (
                <View key={section.key} style={styles.section} testID={`friends-${section.key}`}>
                  <View style={styles.sectionTitle}>
                    <PidroText
                      role="metadata"
                      tone={section.key === 'requests' ? 'gold' : 'cyan'}
                      accessibilityRole="header"
                      style={styles.eyebrow}>
                      {section.title}
                    </PidroText>
                    {section.key === 'requests' ? (
                      <CountBadge count={lists.requests_waiting ?? lists.added_you.length} />
                    ) : null}
                  </View>
                  {section.players.map((player) => {
                    const action = friendAction(player);
                    return (
                      <FriendRow
                        key={player.user_id}
                        name={player.display_name}
                        avatarUrl={player.avatar_url}
                        row={friendRowState(player, section.relation)}
                        onPress={() => onOpen(player)}
                        trailing={
                          section.key === 'requests' ? (
                            <>
                              <ActionPill
                                label={t('friends.accept')}
                                icon="check"
                                variant="gold"
                                accessibilityLabel={t('friends.accept_player', {
                                  name: player.display_name,
                                })}
                                disabled={pending !== null}
                                onPress={() => void act('accept', player)}
                              />
                              <DismissButton
                                accessibilityLabel={t('friends.ignore_player', {
                                  name: player.display_name,
                                })}
                                disabled={pending !== null}
                                onPress={() => void act('ignore', player)}
                              />
                            </>
                          ) : section.key === 'sent' ? (
                            <DismissButton
                              accessibilityLabel={t('friends.cancel_request', {
                                name: player.display_name,
                              })}
                              disabled={pending !== null}
                              onPress={() => void act('cancel', player)}
                            />
                          ) : section.key === 'offline' ? (
                            'chevron'
                          ) : action ? (
                            <ActionPill
                              label={t(action === 'join' ? 'friends.join' : 'friends.play')}
                              icon={action === 'join' ? 'enter' : 'cards'}
                              accessibilityLabel={t(
                                action === 'join' ? 'friends.join_player' : 'friends.play_player',
                                { name: player.display_name }
                              )}
                              disabled={pending !== null}
                              loading={pending === player.user_id}
                              onPress={() => {
                                if (action === 'join') void act('join', player);
                                else play(player);
                              }}
                            />
                          ) : undefined
                        }
                      />
                    );
                  })}
                </View>
              ))}
            {empty ? (
              <View style={[styles.section, landscape && styles.emptyLandscape]}>
                <View style={[styles.content, landscape && styles.column]}>
                  <PidroText role="body" tone="soft">
                    {t('friends.empty_help')}
                  </PidroText>
                  {landscape ? classicCard : null}
                </View>
                <View style={landscape && styles.column}>
                  <FriendDiscovery
                    preview={preview ? discoveryFixture('empty') : undefined}
                    dayOnly
                    onStart={() => setDiscovering(true)}
                    onSent={setSent}
                  />
                </View>
              </View>
            ) : null}
            {!empty || !landscape ? classicCard : null}
            {/* Empty, the board ends with the Classic card; Add a friend has the link. */}
            {!empty ? linkCard : null}
            {selectedPlayer ? (
              <FriendSheet
                key={selectedPlayer.user_id}
                player={selectedPlayer}
                relation={selectedRelation}
                onClose={() => onOpen(null)}
                onProfile={() => {
                  setFullProfile(selectedPlayer);
                  onOpen(null);
                }}
                fixture={
                  preview
                    ? {
                        ...selectedPlayer,
                        username: selectedPlayer.display_name,
                        bio: null,
                        classic: null,
                        veteran: { level: 31 },
                      }
                    : undefined
                }
                initialConfirm={
                  fixture === 'sheet-remove'
                    ? 'remove'
                    : fixture === 'sheet-block'
                      ? 'block'
                      : undefined
                }
                onAction={async (action) => {
                  if (action === 'play') play(selectedPlayer);
                  else if (action === 'join' || action === 'accept') {
                    if (!(await act(action, selectedPlayer, true))) return;
                  } else if (!preview)
                    await (action === 'remove' ? removeFriend : blockPlayer)(
                      selectedPlayer.user_id
                    );
                  else
                    setPreviewLists({
                      ...lists,
                      friends: lists.friends.filter(
                        (player) => player.user_id !== selectedPlayer.user_id
                      ),
                      added_you: lists.added_you.filter(
                        (player) => player.user_id !== selectedPlayer.user_id
                      ),
                    });
                  onOpen(null);
                }}
              />
            ) : null}
            <PlayerProfileModal
              playerId={linked}
              add={linked ? linkProfileAction(lists, linked, user?.id) : null}
              onClose={() => setLinked(null)}
              fixture={
                linkPreview
                  ? { ...linkPreview, username: linkPreview.display_name, bio: null, classic: null }
                  : undefined
              }
            />
            <PlayerProfileModal
              playerId={fullProfile?.user_id ?? null}
              hideActions
              onClose={() => setFullProfile(null)}
              fixture={
                preview && fullProfile
                  ? { ...fullProfile, username: fullProfile.display_name, bio: null, classic: null }
                  : undefined
              }
            />
          </>
        )}
        <AuthSheet
          isOpen={accountOpen}
          onClose={() => {
            setAccountOpen(false);
            if (guest) router.replace(from === 'profile' ? '/profile' : '/home');
          }}
          onSaved={() => setAccountOpen(false)}
          onClaimClassic={() => {
            setAccountOpen(false);
            router.push({ pathname: '/(auth)/claim-classic', params: { from: 'friends' } });
          }}
        />
      </ScreenShell>
      {sent ? (
        <Toast
          key={sent}
          message={t('friends.sent_toast', { name: sent })}
          onDismiss={dismissSent}
        />
      ) : null}
      {toast ? (
        <Toast
          key={`${toast.kind}-${toast.player.user_id}`}
          message={t(toast.kind === 'hidden' ? 'friends.hidden' : 'friends.cancelled', {
            name: toast.player.display_name,
          })}
          action={
            toast.kind === 'hidden'
              ? { label: t('friends.undo'), onPress: () => void act('undo', toast.player) }
              : undefined
          }
          onDismiss={dismissToast}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 18 },
  tight: { gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  heading: { flex: 1, gap: 1 },
  title: {
    fontFamily: PidroFonts.display,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '400',
    color: PidroBevel.textGold,
    ...PidroBevel.labelShadow,
  },
  eyebrow: { textTransform: 'uppercase', letterSpacing: 1, fontWeight: '900', fontSize: 11 },
  section: { gap: 8 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  emptyLandscape: { flexDirection: 'row', gap: 20 },
  column: { flex: 1, minWidth: 0 },
});
