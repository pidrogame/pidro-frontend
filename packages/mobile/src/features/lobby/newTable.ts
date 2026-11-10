import {
  t,
  type BotProfile,
  type CreateRoomRequest,
  type FriendPlayer,
  type Room,
  type RuleSet,
  type Seat,
  type SeatType,
  type TranslationKey,
} from '@pidro/shared';
import { seatName } from '@/features/seatName';
import { apiErrorInfo, localizedError } from '@/utils/apiErrors';
import type { PickerFriend } from './friendPicker';

export type SeatKey = 'seat_2' | 'seat_3' | 'seat_4';
export type DraftSeat =
  Exclude<SeatType, { type: 'held'; user_id: string }> | { type: 'held'; friend: FriendPlayer };
export type TableDraft = { seats: Record<SeatKey, DraftSeat> };

export const defaultSeats: TableDraft['seats'] = { seat_2: 'open', seat_3: 'open', seat_4: 'open' };

export function roomHasUser(room: Room, userId?: string | null): boolean {
  if (!userId) return false;
  if (room.player_ids?.includes(userId)) return true;
  if (room.positions && Object.values(room.positions).includes(userId)) return true;
  return (
    room.seats?.some((seat) => seat.player?.id === userId || seat.player_id === userId) ?? false
  );
}

/** One row of the seat picker. A friend is chosen on the friend list; the rest are entries. */
export type SeatChoice = 'friend' | 'ai' | 'open' | '100' | '1000' | 'password';

/**
 * The entry a choice stands for, the same before opening (into the draft) and after (to the
 * server). A bot seat names who sits there, or plain `'ai'` for whoever turns up.
 */
export function seatEntry(
  choice: Exclude<SeatChoice, 'friend'>,
  persona?: string | null
): Exclude<DraftSeat, { type: 'held' }> {
  if (choice === 'ai' && persona) return { type: 'ai', persona };
  if (choice === 'ai' || choice === 'open') return choice;
  return choice === 'password'
    ? { type: 'open', min_games: 0, password: true }
    : { type: 'open', min_games: choice === '1000' ? 1000 : 100 };
}

/** The choice a seat is on: the draft's before opening, the server's after. */
export function seatChoice(seat: DraftSeat | Seat | undefined): SeatChoice {
  if (!seat || seat === 'open') return 'open';
  if (seat === 'ai') return 'ai';
  if ('type' in seat)
    return seat.type === 'ai'
      ? 'ai'
      : seat.type === 'held'
        ? 'friend'
        : seat.password
          ? 'password'
          : seat.min_games
            ? (String(seat.min_games) as SeatChoice)
            : 'open';
  if (seat.held_for) return 'friend';
  // The picker opens only on a seat without a person, so a player there is a bot.
  if (seat.player) return 'ai';
  if (seat.password) return 'password';
  return seat.min_games === 1000 ? '1000' : seat.min_games === 100 ? '100' : 'open';
}

/** Who sits in a bot seat: the draft's chosen character, or the server's seated one. */
export function seatPersona(seat: DraftSeat | Seat | undefined): string | null {
  if (!seat || typeof seat === 'string') return null;
  if ('type' in seat) return seat.type === 'ai' ? seat.persona : null;
  return seat.player && !seatedHuman(seat) ? (seat.player.bot_persona ?? null) : null;
}

/**
 * The bot picker's two groups: the rule set's own regulars, then everyone at home anywhere.
 * A character already at another seat of this table, or no longer offered, is left out; the
 * one in this seat stays, with the club if it is not a regular here.
 */
export function botChoices(
  profiles: readonly BotProfile[],
  ruleSet: RuleSet,
  seated: string[],
  current?: string | null
) {
  const home = ruleSet === 'louisiana' ? 'louisiana' : 'finland';
  const free = profiles.filter(
    (bot) => bot.id === current || (bot.enabled !== false && !seated.includes(bot.id))
  );
  return {
    regulars: free.filter((bot) => bot.home === home),
    club: free.filter(
      (bot) =>
        bot.home !== home &&
        (bot.id === current || (bot.home !== 'finland' && bot.home !== 'louisiana'))
    ),
  };
}

/**
 * A character's meta line: "Korsholm · steady", the town being its description up to the full
 * stop, or the gold "Plays the odds" for one that searches. `short` leaves the tempo off it.
 */
export function botLine(bot: BotProfile, short = false): { text: string; odds: boolean } {
  const tempo =
    bot.tempo === 'quick' || bot.tempo === 'steady' || bot.tempo === 'slow'
      ? t(`bots.tempo_${bot.tempo}`)
      : '';
  const odds = bot.strategy === 'search';
  const stop = bot.description.indexOf('.');
  const lead = odds
    ? `★ ${t('picker.plays_odds')}`
    : stop > 0
      ? bot.description.slice(0, stop)
      : '';
  return { text: [lead, odds && short ? '' : tempo].filter(Boolean).join(' · '), odds };
}

/** A person sits there. Only those seats are not the picker's: the host may only ask them to leave. */
export function seatedHuman(seat?: Seat): boolean {
  return !!seat?.player && !seat.player.is_bot && !seat.player.id?.startsWith('bot_');
}

/**
 * Whether the waiting room offers talk to `you` (PID-420). Typed words follow the
 * server's `talk_table?/2` in game_channel.ex: never at a game against bots, a solo
 * table or bots in the other three seats; open while a second person sits or a seat
 * is still open, held or invited. Keep the two together. The server still takes faces
 * from bots' company; the room offers none there, since only bots would see them.
 */
export function talkOpens(room: Room, you: string): boolean {
  if (room.config?.solo) return false;
  return (room.seats ?? []).some(
    (seat) => seat.player?.id !== you && (!seat.player || seatedHuman(seat))
  );
}

/** What the picker says when the server refused a seat change, in the picker's own words. */
export function seatError(error: unknown): string {
  const code = apiErrorInfo(error).code?.toUpperCase();
  if (code === 'ALREADY_SEATED') return t('new_table.friend_seated');
  if (code === 'SEAT_NOT_VACANT') return t('new_table.seat_filled');
  // The host is at this table, so the friend is the one playing elsewhere.
  if (code === 'ALREADY_IN_ROOM') return t('new_table.friend_busy');
  if (code === 'PERSONA_SEATED') return t('new_table.persona_seated');
  if (code === 'UNKNOWN_PERSONA') return t('new_table.persona_unknown');
  return localizedError(error, 'new_table.seat_error');
}

/**
 * What a refused Open the table says. Asked again after the host's own table was ruled
 * out, ALREADY_IN_ROOM means a friend held here is playing with others.
 */
export function createFailure(
  error: unknown,
  request: CreateRoomRequest
): { error?: unknown; key: TranslationKey } {
  const code = apiErrorInfo(error).code?.toUpperCase();
  if (code === 'ACCOUNT_REQUIRED') return { error, key: 'social.account_error' };
  if (code === 'PERSONA_SEATED') return { key: 'new_table.persona_seated' };
  if (code === 'UNKNOWN_PERSONA') return { key: 'new_table.persona_unknown' };
  const holds = Object.values(request.seats ?? {}).some(
    (seat) => typeof seat === 'object' && seat.type === 'held'
  );
  if (code === 'ALREADY_IN_ROOM' && holds) return { key: 'new_table.held_friend_busy' };
  return { error, key: 'social.create_error' };
}

export function chooseSeat(draft: TableDraft, seat: SeatKey, choice: DraftSeat): TableDraft {
  return { seats: { ...draft.seats, [seat]: choice } };
}

export function chooseFriend(draft: TableDraft, seat: SeatKey, friend: FriendPlayer): TableDraft {
  return chooseSeat(draft, seat, { type: 'held', friend });
}

export function assignedFriendIds(draft: TableDraft, current: SeatKey): string[] {
  return Object.entries(draft.seats).flatMap(([key, seat]) =>
    key !== current && typeof seat === 'object' && seat.type === 'held' ? [seat.friend.user_id] : []
  );
}

export function isPractice(draft: TableDraft): boolean {
  return Object.values(draft.seats).every((seat) => seatChoice(seat) === 'ai');
}

export function tableFooter(draft: TableDraft): string {
  if (isPractice(draft)) return t('new_table.practice');
  const seats = Object.values(draft.seats);
  const open = seats.some(
    (seat) => seat === 'open' || (typeof seat === 'object' && seat.type === 'open')
  );
  if (!open) return t('new_table.invite_only_help');
  const names = seats.flatMap((seat) =>
    typeof seat === 'object' && seat.type === 'held' ? [seat.friend.display_name] : []
  );
  return [
    t('new_table.listed_help'),
    ...names.map((name) => t('new_table.invitation', { name })),
  ].join(' ');
}

export function newTableRequest(ruleSet: RuleSet, draft: TableDraft): CreateRoomRequest {
  const entry = (key: SeatKey): SeatType => {
    const seat = draft.seats[key];
    return typeof seat === 'object' && seat.type === 'held'
      ? { type: 'held', user_id: seat.friend.user_id }
      : seat;
  };
  return {
    rule_set: ruleSet,
    seats: { seat_2: entry('seat_2'), seat_3: entry('seat_3'), seat_4: entry('seat_4') },
  };
}

/** Only the host's own table is "Your table"; everyone else sees whose it is. */
export function tableTitle(room: Room, you: string): string {
  if (room.host_id === you) return t('social.your_table');
  const host = room.seats?.find((seat) => seat.player?.id === room.host_id)?.player;
  return host
    ? t('new_table.hosts_table', { name: seatName(host, t('social.player')) })
    : (room.name ?? room.code);
}

export function tableHeader(room: Room): string {
  const listed = room.seats?.some(
    (seat) => !seat.player && !seat.held_for && seat.status === 'free'
  );
  const quick =
    room.seats?.length === 4 &&
    room.seats.every(
      (seat) => seat.player && (seat.player.id === room.host_id || !seatedHuman(seat))
    );
  return t(quick ? 'new_table.quick_game' : listed ? 'new_table.listed' : 'new_table.invite_only', {
    rules: t(`social.${room.config?.rule_set ?? 'finnish'}`),
  });
}

export function waitingFooter(room: Room, canManage: boolean, readyCount: number) {
  const full = (['north', 'east', 'south', 'west'] as const).every(
    (position) => !!room.positions?.[position]
  );
  const dropped =
    room.seats?.filter((seat) => seatedHuman(seat) && seat.connectionStatus === 'reconnecting') ??
    [];
  if (dropped.length)
    return {
      full,
      ready: false,
      // News, not the standing line: the waiting room's talk keeps it (PID-418).
      news: true,
      line:
        t('game.waiting_for', {
          name: dropped.map((seat) => seatName(seat.player, t('social.player'))).join(', '),
        }) + '…',
    };
  if (full) return { full, ready: true, line: t('game.ready_count', { count: readyCount }) };
  const names =
    room.seats?.flatMap((seat) => (seat.held_for ? [seat.held_for.display_name] : [])) ?? [];
  const waiting = names.length
    ? t('new_table.waiting_for', { names: names.join(', ') })
    : t('new_table.waiting_players');
  return {
    full,
    ready: false,
    line: canManage ? `${waiting} ${t('new_table.change_seat')}` : waiting,
  };
}

/**
 * Who sat down or left between two snapshots of the room, as the quiet lines of the
 * waiting room's talk (PID-418). People only: a bot is the host's choice, not news.
 * `mute` is who goes unannounced: you, and whoever the host removed.
 */
export function seatChanges(before: Room, after: Room, mute: string[]): string[] {
  const person = (seat?: Seat) =>
    seatedHuman(seat) && !mute.includes(seat!.player!.id) ? seat!.player! : null;
  return (after.seats ?? []).flatMap((seat) => {
    const left = person(before.seats?.find((was) => was.position === seat.position));
    const came = person(seat);
    if (left?.id === came?.id) return [];
    return [
      ...(left ? [t('waiting_talk.left', { name: seatName(left, t('social.player')) })] : []),
      ...(came ? [t('waiting_talk.sat_down', { name: seatName(came, t('social.player')) })] : []),
    ];
  });
}

export function pickerFriends(
  friends: FriendPlayer[],
  selectedId?: string,
  unavailableIds: string[] = []
): PickerFriend[] {
  return friends.map((friend) => {
    const busy = friend.presence === 'at_table' && friend.table_company !== 'bots';
    return {
      id: friend.user_id,
      name: friend.display_name,
      avatarUrl: friend.avatar_url,
      section: busy ? 'busy' : friend.presence === 'offline' ? 'offline' : 'online',
      availability: unavailableIds.includes(friend.user_id)
        ? 'taken'
        : selectedId === friend.user_id
          ? 'selected'
          : busy
            ? 'others'
            : friend.table_company === 'bots' && friend.presence === 'at_table'
              ? 'bots'
              : friend.presence === 'offline'
                ? 'offline'
                : 'online',
    };
  });
}
