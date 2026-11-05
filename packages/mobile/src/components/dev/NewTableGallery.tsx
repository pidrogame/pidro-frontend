import { useState } from 'react';
import type { FriendPlayer, Position, Room, Seat, SeatType } from '@pidro/shared';
import { NewTableScreen } from '@/components/lobby/NewTableScreen';
import { InviteLinkModal } from '@/components/invites/InviteLinkModal';
import { defaultSeats, type TableDraft } from '@/features/lobby/newTable';

const friends: FriendPlayer[] = [
  { user_id: 'maija', display_name: 'Maija', avatar_url: null, presence: 'online' },
  {
    user_id: 'pekka',
    display_name: 'Pekka',
    avatar_url: null,
    presence: 'at_table',
    table_company: 'bots',
  },
  { user_id: 'hanna', display_name: 'Hanna', avatar_url: null, presence: 'offline' },
  { user_id: 'mikko', display_name: 'Mikko', avatar_url: null, presence: 'offline' },
  { user_id: 'sanna', display_name: 'Sanna', avatar_url: null, presence: 'offline' },
  { user_id: 'erkki', display_name: 'Erkki', avatar_url: null, presence: 'offline' },
  { user_id: 'ville', display_name: 'Ville', avatar_url: null, presence: 'offline' },
  {
    user_id: 'nora',
    display_name: 'Nora',
    avatar_url: null,
    presence: 'at_table',
    table_company: 'people',
  },
];

/** The fixture's server: the seat becomes the entry, as `PUT /rooms/:code/seats/:position` does. */
function applySeat(seat: Seat, entry: SeatType): Seat {
  const empty = { ...seat, status: 'free' as const, player: null, held_for: null };
  if (entry === 'ai')
    return {
      ...empty,
      status: 'occupied',
      player: { id: `bot_${seat.position}`, username: 'Antti', is_bot: true, bot_persona: 'antti' },
      min_games: 0,
      password: false,
    };
  if (entry === 'open') return { ...empty, min_games: 0, password: false };
  if (entry.type === 'held')
    return { ...empty, held_for: friends.find((friend) => friend.user_id === entry.user_id) };
  return { ...empty, min_games: entry.min_games, password: !!entry.password };
}

export function NewTableGallery({ fixture = 'setup' }: { fixture?: string }) {
  const [ready, setReady] = useState<Position[]>(['east', 'west', 'south']);
  const [share, setShare] = useState(false);
  const live = fixture.startsWith('live-');
  const full =
    fixture === 'ready' || fixture === 'reconnecting' || fixture.startsWith('ready-error');
  const [opened, setOpened] = useState(
    live || full || ['opened', 'guest', 'declined'].includes(fixture)
  );
  const [declined, setDeclined] = useState(
    fixture === 'declined' ? { position: 'south' as const, user: friends[0] } : null
  );
  const draft: TableDraft = {
    seats:
      fixture === 'bots'
        ? { seat_2: 'ai', seat_3: 'ai', seat_4: 'ai' }
        : {
            ...defaultSeats,
            ...(fixture === 'partner' && { seat_3: { type: 'held', friend: friends[0] } }),
            ...(fixture === 'requirement' && { seat_2: { type: 'open', min_games: 100 } }),
            ...(fixture === 'password' && {
              seat_4: { type: 'open', min_games: 0, password: true },
            }),
          },
  };
  const [room, setRoom] = useState<Room>({
    code: 'NEWT',
    host_id: 'host',
    status: fixture === 'ready' ? 'ready' : 'waiting',
    seat_password: '4821',
    config: {
      name: null,
      rule_set: fixture === 'louisiana' ? 'louisiana' : 'finnish',
      solo: false,
      bot_difficulty: 'basic',
    },
    positions: {
      north: 'host',
      east: 'kalle',
      south: full ? 'maija' : null,
      west: full ? 'hanna' : null,
    },
    seats: (['north', 'east', 'south', 'west'] as const).map((position, seat_index) => ({
      position,
      seat_index,
      status: full || seat_index < 2 ? 'occupied' : 'free',
      connectionStatus:
        fixture === 'reconnecting' && position === 'east' ? 'reconnecting' : 'normal',
      player:
        full || seat_index < 2
          ? {
              id: ['host', 'kalle', 'maija', 'hanna'][seat_index],
              username: [
                'Bertil',
                fixture === 'reconnecting' ? 'Pedro1' : 'Kalle',
                'Maija',
                'Hanna',
              ][seat_index],
            }
          : null,
      held_for: position === 'south' && !full && fixture !== 'declined' ? friends[0] : null,
      password: position === 'west' && fixture !== 'ready',
    })),
  });
  return (
    <>
      <NewTableScreen
        key={opened ? 'opened' : fixture}
        room={opened ? room : undefined}
        initialDraft={draft}
        initialRuleSet={fixture === 'louisiana' ? 'louisiana' : 'finnish'}
        initialPicker={
          fixture === 'picker' || fixture === 'live-picker' || fixture === 'live-error'
            ? 'choices'
            : fixture === 'friends' || fixture === 'live-friends'
              ? 'friends'
              : undefined
        }
        initialSeat={fixture === 'live-friends' ? 'south' : live ? 'west' : undefined}
        onSetSeat={async (position, entry) => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          // Bot fails outright; anything else finds that someone sat down meanwhile.
          if (fixture === 'live-error' && entry === 'ai') throw new Error('offline');
          if (fixture === 'live-error') {
            setRoom((current) => ({
              ...current,
              seats: current.seats?.map((seat) =>
                seat.position === position
                  ? { ...seat, status: 'occupied', player: { id: 'eli', username: 'Eli' } }
                  : seat
              ),
            }));
            throw { response: { status: 422, data: { errors: [{ code: 'SEAT_NOT_VACANT' }] } } };
          }
          setRoom((current) => ({
            ...current,
            seats: current.seats?.map((seat) =>
              seat.position === position ? applySeat(seat, entry) : seat
            ),
          }));
        }}
        fixtureFriends={friends}
        youPlayerId={fixture === 'guest' ? 'kalle' : 'host'}
        canManage={fixture !== 'guest'}
        onLeave={() => {}}
        onSubmit={() => setOpened(true)}
        onOpenInvite={() => setShare(true)}
        declined={declined}
        onDismissDeclined={() => setDeclined(null)}
        readyPlayers={ready}
        readyDisabled={false}
        onReady={async () => {
          if (fixture.startsWith('ready-error'))
            throw { reason: fixture === 'ready-error' ? 'table_not_full' : 'unknown_failure' };
          setReady((current) => [...current, 'north']);
        }}
        onKickPlayer={(position) =>
          setRoom((current) => ({
            ...current,
            positions: { ...current.positions!, [position]: null },
            seats: current.seats?.map((seat) =>
              seat.position === position ? { ...seat, player: null, status: 'free' } : seat
            ),
          }))
        }
      />
      {share && (
        <InviteLinkModal
          roomCode={room.code}
          onClose={() => setShare(false)}
          fixture={{
            code: '7KQ4M2XB',
            state: 'open',
            url: 'https://www.pidro.online/j/7KQ4M2XB',
            share_text: '',
            seat_hint: null,
            label: null,
            expires_at: '2099-09-03T15:30:00Z',
          }}
        />
      )}
    </>
  );
}
