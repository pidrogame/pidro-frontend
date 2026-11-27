/**
 * A seat held for you, shown at the top of a game with bots (PID-258). Join
 * leaves this game and sits you in the held seat in one step; Not now tells
 * the host and the bots play on. Upright it sits under the score and the menu,
 * and the table makes room below it (`onHeight`), so it covers no seat.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SeatInvitation } from '@pidro/shared';
import { lobbyApi } from '@/api/lobby';
import { NoticeCard } from '@/components/friends/NoticeCard';
import { joinSeatInvitation } from '@/components/invites/SeatInvitations';
import { PidroSpacing } from '@/design/tokens';
import { tableInvitationLine } from '@/features/invites/tableInvitation';
import { computeLayout } from '@/game/canvas/layout';
import { TABLE_HEADER, headerTop, useTableSize } from '@/game/canvas/TableChrome';
import { useTranslation } from '@/i18n';
import { declineSeatInvitation } from '@/stores/friends';
import { useGameStore } from '@/stores/game';
import { apiErrorInfo, localizedError } from '@/utils/apiErrors';

export function TableInvitation({
  invitation,
  roomCode,
  onLeaving,
  onHeight,
  fixture = false,
}: {
  invitation: SeatInvitation;
  roomCode: string;
  /** True while this table is being left, false if it stays. */
  onLeaving?: (leaving: boolean) => void;
  /** The room it takes under the header; 0 once it has gone. */
  onHeight?: (height: number) => void;
  fixture?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // On its side a phone has no room above North's played card for two rows,
  // nor any above a bid, trump or hand window: the card waits for your choice.
  // Neither has a short upright phone once the table has made room for it.
  // An iPad on its side keeps the one row too, and the table makes room under it.
  const row = width > height;
  // A tight phone keeps it short: the side seats sit under it (PID-470).
  const table = useTableSize();
  const compact = computeLayout(table.width, table.height, insets, TABLE_HEADER).tight;
  const waits = row || (width < height && height < 700);
  const choosing = useGameStore((s) =>
    s.legalActions.some((action) => action.type !== 'play_card')
  );
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string>();
  const [hidden, setHidden] = useState(false);
  const name = invitation.host?.display_name || t('social.player');
  const shown = !hidden && !(waits && choosing && !loading);
  useEffect(() => {
    if (!shown) onHeight?.(0);
  }, [shown, onHeight]);
  useEffect(() => () => onHeight?.(0), [onHeight]);

  const join = async () => {
    if (busy.current || fixture) return;
    busy.current = true;
    setLoading(true);
    setError(undefined);
    onLeaving?.(true);
    try {
      await lobbyApi.leaveRoom(roomCode).catch((caught: unknown) => {
        if (apiErrorInfo(caught).code?.toUpperCase() !== 'NOT_IN_ROOM') throw caught;
      });
    } catch (caught) {
      // Still seated here: the bots play on and the invitation stays.
      onLeaving?.(false);
      setError(localizedError(caught, 'social.join_failed'));
      busy.current = false;
      setLoading(false);
      return;
    }
    // This game is over either way. Tables says the seat is gone, or still offers it.
    const joined = await joinSeatInvitation(invitation).catch(() => false);
    if (joined) router.replace(`/game/${invitation.code}`);
    else router.dismissTo('/lobby');
  };

  const decline = async () => {
    if (busy.current) return;
    if (fixture) return setHidden(true);
    busy.current = true;
    setDeclining(true);
    setError(undefined);
    try {
      await declineSeatInvitation(invitation);
    } catch {
      setError(t('seat_invitation.decline_failed'));
    } finally {
      busy.current = false;
      setDeclining(false);
    }
  };

  if (!shown) return null;
  return (
    <View
      pointerEvents="box-none"
      onLayout={(event) => onHeight?.(event.nativeEvent.layout.height)}
      style={[
        styles.slot,
        {
          // Sideways it keeps its place in the header row.
          top: width > height ? headerTop(insets.top) : insets.top + TABLE_HEADER,
          paddingLeft: insets.left + PidroSpacing.md,
          paddingRight: insets.right + PidroSpacing.md,
        },
      ]}>
      <NoticeCard
        testID="table-invitation"
        variant="seat"
        ring="gold"
        title={t('seat_invitation.waiting', { name })}
        body={tableInvitationLine(invitation, name)}
        avatarUrl={invitation.host?.avatar_url}
        primary={{
          label: t('friend_notice.join', { name }),
          loading,
          onPress: () => void join(),
        }}
        secondary={{
          label: t('friend_notice.not_now'),
          loading: declining,
          onPress: () => void decline(),
        }}
        footnote={error ?? t('friend_notice.ends_bot_game')}
        row={row}
        compact={compact}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 160,
    elevation: 160,
  },
});
