import { POSITION_TO_INDEX, t, formatNumber } from '@pidro/shared';
import { seatName } from '@/features/seatName';
import type { LobbyCategories, LobbyCategoryKey, Position, Room } from '@pidro/shared';

const pairs: Position[][] = [
  ['north', 'south'],
  ['east', 'west'],
];

export function seatRequirementMessage(minGames: number, gamesPlayed: number): string {
  return t('social.requirement', {
    minimum: formatNumber(minGames),
    played: formatNumber(gamesPlayed),
  });
}

export function tableRow(room: Room, category: LobbyCategoryKey, gamesPlayed?: number) {
  const seats = pairs.flat().map((position) => {
    const seat = room.seats?.find((seat) =>
      seat.position ? seat.position === position : seat.seat_index === POSITION_TO_INDEX[position]
    );
    const player = seat?.player;
    const id = player?.id ?? seat?.player_id ?? room.positions?.[position];
    const occupied = !!id || seat?.status === 'occupied';
    const kind = occupied
      ? player?.is_bot || id?.startsWith('bot_')
        ? 'bot'
        : 'player'
      : seat?.held_for
        ? 'held'
        : category === 'substitute_needed'
          ? 'sub'
          : 'open';
    const minGames = kind === 'open' ? (seat?.min_games ?? 0) : 0;
    const password = kind === 'open' && !!seat?.password;
    return {
      position,
      id,
      kind,
      name:
        kind === 'held'
          ? seat!.held_for!.display_name
          : occupied
            ? seatName(player, t('social.player'), kind === 'bot')
            : kind === 'sub'
              ? t('social.sit_in')
              : t('social.open'),
      avatarUrl: kind === 'held' ? seat!.held_for!.avatar_url : player?.avatar_url,
      // The chip under a person's face; a bot and a held chair have none.
      level: kind === 'player' ? player?.level : null,
      prestige: kind === 'player' ? player?.prestige : null,
      persona: kind === 'bot' ? (player?.bot_persona ?? null) : null,
      botProfile: kind === 'bot' ? player?.bot_profile : null,
      minGames,
      password,
      requirementReason:
        kind === 'open' &&
        category === 'open_tables' &&
        room.status !== 'playing' &&
        gamesPlayed !== undefined &&
        gamesPlayed < minGames
          ? seatRequirementMessage(minGames, gamesPlayed)
          : undefined,
      canJoin:
        !occupied &&
        kind !== 'held' &&
        !room.locked &&
        (category === 'open_tables' || category === 'substitute_needed') &&
        (room.available_positions?.includes(position) ?? true),
    };
  });
  const host = room.host_id ? seats.find((seat) => seat.id === room.host_id)?.position : undefined;
  const ordered =
    host === 'east' || host === 'west' ? [...seats.slice(2), ...seats.slice(0, 2)] : seats;
  const open = seats.filter((seat) => seat.canJoin).length;
  const vacatedBy = room.seats?.find(
    (seat) => seat.status === 'free' && seat.vacated_by
  )?.vacated_by;
  return {
    seats: ordered,
    status:
      category === 'my_rejoinable'
        ? t('social.seat_waiting')
        : category === 'substitute_needed'
          ? room.game && vacatedBy
            ? t('social.left_hand', { name: vacatedBy, hand: formatNumber(room.game.hand) })
            : t('social.needs_sub')
          : category === 'spectatable'
            ? room.game
              ? t('social.hand_score', {
                  hand: formatNumber(room.game.hand),
                  ns: formatNumber(room.game.scores.north_south),
                  ew: formatNumber(room.game.scores.east_west),
                })
              : t('social.playing')
            : t('social.seats_open', { count: open, number: formatNumber(open) }),
    button:
      category === 'my_rejoinable'
        ? t('social.rejoin')
        : category === 'spectatable'
          ? t('social.watch')
          : null,
  };
}

export function filterPlayers(rooms: Room[], query: string): Room[] {
  const search = query.trim().toLocaleLowerCase();
  if (!search) return rooms;
  return rooms.filter((room) =>
    tableRow(room, 'open_tables').seats.some(
      (seat) => seat.kind === 'player' && seat.name.toLocaleLowerCase().includes(search)
    )
  );
}

export function lobbyCounts(lobby: LobbyCategories): string {
  const rooms = new Map(
    Object.values(lobby)
      .flat()
      .map((room) => [room.code, room])
  );
  const open = [...rooms.values()].filter((room) =>
    tableRow(room, 'open_tables').seats.some((seat) => seat.canJoin)
  ).length;
  return t('social.lobby_count', {
    tables: t('social.table_count', { count: rooms.size, number: formatNumber(rooms.size) }),
    open: formatNumber(open),
  });
}
