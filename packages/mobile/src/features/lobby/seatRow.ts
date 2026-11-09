import { t, formatNumber } from '@pidro/shared';
import type { BotPersona, BotProfile, FriendPlayer, HeldPlayer, Player } from '@pidro/shared';
import { botLine } from '@/features/lobby/newTable';
import { seatName } from '@/features/seatName';

/**
 * One seat on New table, as the server describes it. Before the table opens
 * the seats are the host's plan; after, the server fills in who is there.
 */
export type SeatView = {
  team: 'you' | 'partner' | 'opponent';
  opened: boolean;
  type: 'open' | 'ai' | 'held';
  min_games?: number;
  /** The table's password, when the seat asks for one. */
  password?: string | null;
  passwordRequired?: boolean;
  host?: boolean;
  ready?: boolean;
  connectionStatus?: string | null;
  editable?: boolean;
  held_for?: HeldPlayer | null;
  presence?: FriendPlayer['presence'] | null;
  player?: (Pick<Player, 'username'> & Partial<Player>) | null;
  /** The character the host chose for a bot seat before opening; none is whoever turns up. */
  bot?: BotProfile | null;
};

export type SeatToken =
  | { kind: 'open'; badge: string | null; locked: boolean }
  | { kind: 'bot'; persona: BotPersona | null; botProfile?: BotProfile | null }
  | { kind: 'friend'; uri: string | null }
  | { kind: 'player'; uri: string | null; level?: number | null; prestige?: number | null };

export type SeatRowWords = {
  token: SeatToken;
  name: string;
  status: string;
  nameTone: 'gold' | 'cyan' | 'default';
  statusTone: 'gold' | 'ready' | 'soft';
  /** The host's own row is the only one that does not open the seat picker. */
  tappable: boolean;
  label: string;
};

/** What a seat row says, in words and token. The server decides the seat; this only names it. */
export function seatRow(seat: SeatView): SeatRowWords {
  const you = seat.team === 'you';
  const words = describe(seat);
  return {
    ...words,
    // Open seats are cyan; names on your team are gold.
    nameTone: words.token.kind === 'open' ? 'cyan' : seat.team === 'opponent' ? 'default' : 'gold',
    tappable: !you && seat.editable !== false,
    label:
      seat.editable === false
        ? `${words.name}, ${words.status}`
        : you
          ? t('social.host_you')
          : t('seat_row.label', {
              seat: t(seat.team === 'partner' ? 'social.partner' : 'social.opponent'),
              name: words.name,
              status: words.status,
            }),
  };
}

function describe(seat: SeatView): Omit<SeatRowWords, 'nameTone' | 'tappable' | 'label'> {
  const { player, held_for, password } = seat;
  const reconnecting = seat.connectionStatus === 'reconnecting';
  if (seat.team === 'you')
    return {
      token: {
        kind: 'player',
        uri: player?.avatar_url ?? null,
        level: player?.level,
        prestige: player?.prestige,
      },
      name: t('social.you'),
      status: t(
        reconnecting
          ? 'game.reconnecting'
          : seat.host !== false
            ? 'social.host'
            : seat.ready
              ? 'seat_row.ready'
              : 'game.not_ready'
      ),
      statusTone: reconnecting
        ? 'soft'
        : seat.host !== false
          ? 'gold'
          : seat.ready
            ? 'ready'
            : 'soft',
    };
  if (player) {
    const bot = !!player.is_bot || player.id?.startsWith('bot_');
    return {
      token: bot
        ? {
            kind: 'bot',
            persona: player.bot_persona ?? null,
            ...(player.bot_profile ? { botProfile: player.bot_profile } : {}),
          }
        : {
            kind: 'player',
            uri: player.avatar_url ?? null,
            level: player.level,
            prestige: player.prestige,
          },
      name: seatName(player, t('social.player'), bot),
      status: t(
        reconnecting
          ? 'game.reconnecting'
          : seat.ready === false
            ? 'game.not_ready'
            : 'seat_row.ready'
      ),
      statusTone: reconnecting || seat.ready === false ? 'soft' : 'ready',
    };
  }
  if (seat.type === 'ai' && seat.bot) {
    const line = botLine(seat.bot, true);
    return {
      token: { kind: 'bot', persona: seat.bot.id, botProfile: seat.bot },
      name: seat.bot.name,
      status: line.text,
      statusTone: line.odds ? 'gold' : 'soft',
    };
  }
  if (seat.type === 'ai')
    return {
      token: { kind: 'bot', persona: null },
      name: t('picker.anyone'),
      status: t('seat_row.whoever'),
      statusTone: 'soft',
    };
  if (seat.type === 'held' && held_for)
    return {
      token: { kind: 'friend', uri: held_for.avatar_url },
      name: held_for.display_name,
      status: !seat.opened
        ? t('seat_row.invited_later')
        : seat.presence && seat.presence !== 'offline'
          ? t('seat_row.invited_online')
          : t('seat_row.invited_offline'),
      statusTone: 'gold',
    };
  const games = seat.min_games ?? 0;
  const locked = !!password || !!seat.passwordRequired;
  return {
    token: {
      kind: 'open',
      badge: locked
        ? null
        : games >= 1000
          ? `${formatNumber(games / 1000)}k`
          : games > 0
            ? formatNumber(games)
            : null,
      locked,
    },
    name: t('seat_row.open'),
    status: seat.opened
      ? password
        ? t('seat_row.waiting_password', { code: password })
        : t('seat_row.waiting')
      : locked
        ? password
          ? t('seat_row.password', { code: password })
          : t('new_table.password')
        : games > 0
          ? t('seat_row.games', { number: formatNumber(games, { useGrouping: false }) })
          : t('seat_row.anyone'),
    statusTone: locked ? 'gold' : 'soft',
  };
}
