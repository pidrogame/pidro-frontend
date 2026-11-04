/**
 * The persistent app shell: five top-level tabs behind one floating glass
 * pill (Liquid-Glass style — detached, inset, content behind it). Tab
 * switches replace in place; the game, lobby and join flows push OVER the
 * shell full-screen, so the pill never competes with the table.
 */
import { Slot, useGlobalSearchParams, usePathname, useRouter, useIsFocused } from 'expo-router';
import { friendNoticeId } from '@pidro/shared';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FixtureInsets } from '@/components/dev/FixtureInsets';
import { Background } from '@/components/ui/Background';
import {
  FloatingNotice,
  TabPill,
  usePillClearance,
  type ShellTab,
} from '@/components/shell/TabPill';
import { UpdateNotice, UpdateNoticeHost } from '@/components/shell/UpdateNotice';
import { FriendNoticeHost, useShellFriendNotice } from '@/components/shell/FriendNoticeHost';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { LeagueHost } from '@/components/league/LeagueHost';
import { LeagueResult } from '@/components/league/LeagueResult';
import { PidroSpacing } from '@/design/tokens';
import { useAuthStore } from '@/stores/auth';
import { useWaitingCount } from '@/hooks/useWaitingCount';
import { onlineCount } from '@/features/friends/waitingCount';
import { newsFixture } from '@/features/news';
import { useFriendsStore } from '@/stores/friends';
import { useLobbyStore } from '@/stores/lobby';
import { gameRoute } from '@/navigation/gameRoute';
import { useLobbyChannel } from '@/channels/hooks/useLobbyChannel';

const TAB_ROUTES: Record<ShellTab, string> = {
  league: '/league',
  stats: '/profile',
  table: '/home',
  friends: '/friends',
  settings: '/settings',
};

function activeTabForPath(pathname: string): ShellTab {
  if (pathname.startsWith('/league')) return 'league';
  if (pathname.startsWith('/profile') || pathname.startsWith('/blocked-players')) return 'stats';
  if (pathname.startsWith('/friends')) return 'friends';
  if (pathname.startsWith('/settings')) return 'settings';
  return 'table';
}

export default function ShellLayout() {
  // Dev fixtures: `?fixture=update-notice` forces the notice, `?safeArea=` fakes insets.
  const params = useGlobalSearchParams<{ fixture?: string; safeArea?: string }>();
  return (
    <FixtureInsets preset={__DEV__ ? params.safeArea : undefined}>
      <LeagueHost>
        <Shell
          forceUpdateNotice={__DEV__ && params.fixture === 'update-notice'}
          fixture={__DEV__ ? params.fixture : undefined}
        />
        <LeagueResult />
      </LeagueHost>
    </FixtureInsets>
  );
}

function Shell({ forceUpdateNotice, fixture }: { forceUpdateNotice: boolean; fixture?: string }) {
  useLobbyChannel();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const router = useRouter();
  const pathname = usePathname();
  const { from } = useGlobalSearchParams<{ from?: string }>();
  const active = activeTabForPath(pathname);
  const reduceMotion = useReducedMotion();
  const focused = useIsFocused();
  const guest = useAuthStore((state) => Boolean(state.user?.guest));
  const invitationCount = useWaitingCount(fixture);
  const friendsOnline = useFriendsStore((state) => onlineCount(state.friends));
  const online = newsFixture(fixture)?.online ?? friendsOnline;
  const friend = useShellFriendNotice(focused && !guest, fixture);
  const rejoinable = useLobbyStore((state) => state.lobby.my_rejoinable);
  const waitingGame = rejoinable.length > 0 ? rejoinable[0] : null;
  const insets = useSafeAreaInsets();
  const pillClearance = usePillClearance();
  // The notice floats just above the bottom pill, or above the safe area beside the rail.
  const noticeBottom = Math.max(guest ? 0 : pillClearance.bottom, insets.bottom + PidroSpacing.xs);
  const [noticeHeight, setNoticeHeight] = useState(0);
  const [friendHeight, setFriendHeight] = useState(0);
  // A screen with an UpdateNoticeSlot shows the notice itself; it then never floats here.
  // Slots claim it as they mount, so float only after that, or Home flashes a copy.
  const [noticePlaced, setNoticePlaced] = useState(false);
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- runs after the slots' claims
  useEffect(() => setMounted(true), []);
  const { visible, restarting, restart, dismiss } = useAppUpdate({
    // The game pushes over the shell; never offer a restart from under the table.
    inGame: pathname.startsWith('/game'),
    forced: forceUpdateNotice,
  });
  const host = useMemo(
    () => ({
      notice:
        visible && !friend.notice ? { restarting, onRestart: restart, onDismiss: dismiss } : null,
      setPlaced: setNoticePlaced,
    }),
    [visible, restarting, restart, dismiss, friend.notice]
  );
  const floating = !friend.notice && visible && mounted && !noticePlaced;
  const noticeHeightShown = friend.notice ? friendHeight : floating ? noticeHeight : 0;

  const handleSelect = (tab: ShellTab) => {
    if (tab === 'table') {
      // The Table anchor is the way back — to your live game when one is
      // waiting, to home otherwise.
      if (waitingGame?.code) {
        router.push(gameRoute(waitingGame.code));
        return;
      }
      if (active !== 'table') router.replace('/home');
      return;
    }
    if (tab !== active || (tab === 'friends' && from === 'profile'))
      router.replace(TAB_ROUTES[tab] as never);
  };

  return (
    <Background>
      {/* The notice floats over the screen; screens learn how far up it reaches, or place it. */}
      <UpdateNoticeHost.Provider value={host}>
        <FloatingNotice.Provider
          value={{
            reach: noticeHeightShown > 0 ? noticeBottom + noticeHeightShown : 0,
            height: noticeHeightShown,
          }}>
          {/* 160ms opacity-only cross-fade on tab switch: cheap on old GPUs,
              skipped under Reduce Motion. The pill stays outside the fade. */}
          <Animated.View
            key={active}
            style={styles.root}
            entering={reduceMotion ? undefined : FadeIn.duration(140)}>
            <Slot />
          </Animated.View>
        </FloatingNotice.Provider>
      </UpdateNoticeHost.Provider>
      {friend.notice ? (
        <FriendNoticeHost
          key={friendNoticeId(friend.notice)}
          notice={friend.notice}
          dismiss={friend.dismiss}
          fixture={friend.fixture}
          style={{
            bottom: noticeBottom,
            paddingLeft: insets.left + PidroSpacing.md,
            paddingRight: Math.max(insets.right + PidroSpacing.md, pillClearance.right),
          }}
          onHeight={setFriendHeight}
        />
      ) : null}
      {floating ? (
        <UpdateNotice
          restarting={restarting}
          onRestart={restart}
          onDismiss={dismiss}
          style={{
            bottom: noticeBottom,
            paddingLeft: insets.left + PidroSpacing.md,
            paddingRight: Math.max(insets.right + PidroSpacing.md, guest ? 0 : pillClearance.right),
          }}
          onHeight={setNoticeHeight}
        />
      ) : null}
      {!guest ? (
        <TabPill
          orientation={landscape ? 'rail' : 'bottom'}
          active={active}
          tableBadge={Boolean(waitingGame)}
          invitationCount={invitationCount}
          onlineCount={online}
          onSelect={handleSelect}
        />
      ) : null}
    </Background>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
