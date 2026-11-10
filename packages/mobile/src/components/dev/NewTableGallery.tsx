import { useState } from 'react';
import type { FriendPlayer, Position, Room, Seat, SeatType } from '@pidro/shared';
import { NewTableScreen } from '@/components/lobby/NewTableScreen';
import { InviteLinkModal } from '@/components/invites/InviteLinkModal';
import type { Said } from '@/features/game/talk';
import { BOT_CATALOGUE } from '@/features/lobby/fixtures';
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

const bot = (id: string) => BOT_CATALOGUE.find((profile) => profile.id === id)!;
const botPlayer = (position: string, id: string) => ({
  id: `bot_${position}`,
  username: bot(id).name,
  is_bot: true,
  bot_persona: id,
  bot_profile: bot(id),
});

/** The fixture's server: the seat becomes the entry, as `PUT /rooms/:code/seats/:position` does. */
function applySeat(seat: Seat, entry: SeatType): Seat {
  const empty = { ...seat, status: 'free' as const, player: null, held_for: null };
  if (entry === 'open') return { ...empty, min_games: 0, password: false };
  if (entry === 'ai' || entry.type === 'ai')
    return {
      ...empty,
      status: 'occupied',
      player: botPlayer(seat.position!, entry === 'ai' ? 'antti' : entry.persona),
      min_games: 0,
      password: false,
    };
  if (entry.type === 'held')
    return { ...empty, held_for: friends.find((friend) => friend.user_id === entry.user_id) };
  return { ...empty, min_games: entry.min_games, password: !!entry.password };
}

/** PID-418's boards: Kalle seated, Maija on her way, a 100+ seat open, and what was said. */
const kalle = (said: Omit<Said, 'seat' | 'userId'>): Said => ({
  seat: 'east',
  userId: 'kalle',
  ...said,
});
const TALK: Said[] = [
  kalle({ text: 'Moi! My brother wants the other seat, he’s on his way' }),
  { seat: 'north', userId: 'host', text: 'Great. Maija is coming too, she’s still on the bus' },
  kalle({ item: 'coin_thumb' }),
  kalle({ text: 'One game before sauna then' }),
];
const FULL_TALK: Said[] = [
  ...TALK,
  { seat: 'south', userId: 'maija', text: 'Made it! Hi Kalle' },
  { seat: 'west', userId: 'hanna', text: 'Sorry sorry. Let’s go' },
];

export function NewTableGallery({ fixture = 'setup' }: { fixture?: string }) {
  // `talk*` (PID-418): `talk-opened` before anyone came, `talk-full` all four ready,
  // `talk-typing` the field focused, `talk-guest` / `talk-teen` who cannot type,
  // `talk-filtered` refuses what is typed; `talk-bots` (PID-420) has bots in the other three
  // seats, so nobody reads talk until a seat opens.
  const talking = fixture.startsWith('talk');
  const bots = fixture === 'talk-bots';
  const [ready, setReady] = useState<Position[]>(
    fixture === 'talk-full'
      ? ['east', 'west', 'south']
      : talking
        ? ['east']
        : ['east', 'west', 'south']
  );
  const [lines, setLines] = useState<Said[]>(
    fixture === 'talk-full' ? FULL_TALK : talking && fixture !== 'talk-opened' && !bots ? TALK : []
  );
  const kalleAway = fixture === 'talk-opened';
  const [share, setShare] = useState(false);
  const live = fixture.startsWith('live-');
  const louisiana = fixture.endsWith('louisiana');
  // `characters`: Antti and Gun chosen, the last bot seat anyone; `bot-picker*` open on Partner.
  const characters = fixture === 'characters' || fixture === 'bot-picker';
  const full =
    fixture === 'ready' ||
    fixture === 'reconnecting' ||
    fixture.startsWith('ready-error') ||
    fixture === 'talk-full';
  const [opened, setOpened] = useState(
    live || full || talking || ['opened', 'guest', 'declined'].includes(fixture)
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
            ...(characters && {
              seat_2: { type: 'ai', persona: 'antti' },
              seat_3: { type: 'ai', persona: 'gun' },
              seat_4: 'ai',
            }),
            ...(fixture === 'bot-picker-louisiana' && {
              seat_2: { type: 'ai', persona: 'celeste' },
              seat_3: 'ai',
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
      rule_set: louisiana ? 'louisiana' : 'finnish',
      solo: false,
      bot_difficulty: 'basic',
    },
    positions: {
      north: 'host',
      east: bots ? 'bot_east' : kalleAway ? null : 'kalle',
      south: full ? 'maija' : bots ? 'bot_south' : null,
      west: full ? 'hanna' : fixture === 'live-bots' || bots ? 'bot_west' : null,
    },
    seats: (['north', 'east', 'south', 'west'] as const).map((position, seat_index) => ({
      position,
      seat_index,
      status: full || (seat_index < 2 && !(kalleAway && seat_index === 1)) ? 'occupied' : 'free',
      connectionStatus:
        fixture === 'reconnecting' && position === 'east' ? 'reconnecting' : 'normal',
      player:
        full || (seat_index < 2 && !(kalleAway && seat_index === 1))
          ? {
              id: ['host', 'kalle', 'maija', 'hanna'][seat_index],
              username: [
                'Bertil',
                fixture === 'reconnecting' ? 'Pedro1' : 'Kalle',
                'Maija',
                fixture === 'talk-full' ? 'Ville' : 'Hanna',
              ][seat_index],
            }
          : null,
      held_for: position === 'south' && !full && fixture !== 'declined' ? friends[0] : null,
      password: position === 'west' && fixture !== 'ready' && !talking,
      ...(talking && position === 'west' && { min_games: 100 }),
      // `live-bots`: Gun sits West; Stig has left the club since the catalogue loaded.
      ...(fixture === 'live-bots' &&
        position === 'west' && {
          status: 'occupied' as const,
          player: botPlayer('west', 'gun'),
          password: false,
        }),
      ...(bots &&
        position !== 'north' && {
          status: 'occupied' as const,
          player: botPlayer(position, ['antti', 'gun', 'jocke'][seat_index - 1]),
          held_for: null,
          min_games: 0,
        }),
    })),
  });
  return (
    <>
      <NewTableScreen
        key={opened ? 'opened' : fixture}
        room={opened ? room : undefined}
        initialDraft={draft}
        initialRuleSet={louisiana ? 'louisiana' : 'finnish'}
        initialPicker={
          fixture === 'picker' || fixture === 'live-picker' || fixture === 'live-error'
            ? 'choices'
            : fixture === 'friends' || fixture === 'live-friends'
              ? 'friends'
              : fixture.startsWith('bot-picker')
                ? 'bots'
                : undefined
        }
        initialSeat={
          fixture === 'live-friends' ? 'south' : live ? 'west' : characters ? 'south' : undefined
        }
        onSetSeat={async (position, entry) => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          // Bot fails outright; anything else finds that someone sat down meanwhile.
          if (fixture === 'live-error' && entry === 'ai') throw new Error('offline');
          if (fixture === 'live-bots' && typeof entry === 'object' && entry.type === 'ai')
            if (entry.persona === 'stig')
              throw { response: { status: 422, data: { errors: [{ code: 'UNKNOWN_PERSONA' }] } } };
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
        fixtureBots={BOT_CATALOGUE}
        youPlayerId={fixture === 'guest' ? 'kalle' : 'host'}
        canManage={fixture !== 'guest'}
        onLeave={() => {}}
        onSubmit={() => setOpened(true)}
        onOpenInvite={() => setShare(true)}
        declined={declined}
        onDismissDeclined={() => setDeclined(null)}
        initialTyping={fixture === 'talk-typing'}
        talk={
          talking
            ? {
                lines,
                typing:
                  fixture === 'talk-guest' ? 'guest' : fixture === 'talk-teen' ? null : 'type',
                heard:
                  fixture === 'talk-opened' || bots
                    ? []
                    : fixture === 'talk-full'
                      ? [
                          { at: 4, text: 'Maija sat down' },
                          { at: 5, text: 'Ville sat down' },
                        ]
                      : [{ at: 0, text: 'Kalle sat down' }],
                draft: fixture === 'talk-typing' ? 'Perfect, I’ll heat it' : undefined,
                // The fixture's server echoes what it takes, as the channel's `talk` push does.
                send: async (item) =>
                  setLines((current) => [...current, { seat: 'north', userId: 'host', item }]),
                say: async (text) => {
                  await new Promise((resolve) => setTimeout(resolve, 200));
                  if (fixture === 'talk-filtered') throw { error: 'filtered' };
                  setLines((current) => [...current, { seat: 'north', userId: 'host', text }]);
                  // PID-420: at `talk`, Kalle answers with a thumb, a line from someone else.
                  if (fixture === 'talk')
                    setTimeout(
                      () => setLines((current) => [...current, kalle({ item: 'coin_thumb' })]),
                      1200
                    );
                },
              }
            : undefined
        }
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
