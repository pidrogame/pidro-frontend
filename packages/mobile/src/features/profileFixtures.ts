import type {
  Achievement,
  AchievementCatalogEntry,
  FriendLists,
  FriendPlayer,
  PlayerSheet,
  ProfileIdentity,
} from '@pidro/shared';

/** Fourteen medals, the first four earned: the shelf on `Status-Profile`. */
const MEDALS = [
  'Homerun',
  'Win Streak',
  'Partnership',
  'Full House',
  'Unstoppable',
  'Player',
  'The Winner',
  'Ace',
  'The Loser',
  'Forcer',
  'Grand Slam',
  'Comeback',
  'Shutout',
  'Marathon',
];
const catalog: AchievementCatalogEntry[] = MEDALS.map((name, index) => ({
  key: name.toLowerCase().replace(/\W+/g, '_'),
  name,
  description: name,
  tier: 1,
  earned: index < 4,
}));

/** Bengt, a Legend with four stars, as drawn on `Status-Profile`. */
const legend: ProfileIdentity = {
  user_id: 'ui-grammar-user',
  username: 'Bengt',
  display_name: 'Bengt',
  avatar_url: null,
  bio: null,
  games_played: 2076,
  first_seen_at: '2026-09-12T10:00:00Z',
  veteran: {
    level: 100,
    xp: 3_166_127,
    title: 'Legend',
    progress: 'max',
    prestige: 4,
    prestige_progress: [366_127, 500_000],
  },
  xp: { this_week: 1240, this_month: 2100 },
  record: { games: 40_612, wins: 22_337, losses: 18_275, win_rate: 0.55 },
  achievements: catalog.slice(0, 4).map(({ key, name, description, tier }, index) => ({
    key,
    name,
    description,
    tier,
    awarded_at: `2026-10-0${index + 1}T12:00:00Z`,
  })),
  achievements_catalog: catalog,
  classic: {
    name: 'Bengt64',
    games_played: 38_536,
    level: 61,
    member_since: '2011-05-14T08:30:00Z',
  },
};

/** Eighteen friends, two of them online. */
const friends: FriendPlayer[] = Array.from({ length: 18 }, (_, index) => ({
  user_id: `friend-${index}`,
  display_name: `Friend ${index + 1}`,
  avatar_url: null,
  presence: index < 2 ? 'online' : 'offline',
}));

/** `/profile?fixture=legend`: the profile from the board, with no server. */
export function profileFixture(
  value?: string
): { identity: ProfileIdentity; friends: FriendPlayer[] } | undefined {
  if (!__DEV__ || value !== 'legend') return;
  return { identity: legend, friends };
}

/** Kalle's seven medals, oldest first, the newest Homerun (`Tap a seat`, PID-406). */
const kalleMedals: Achievement[] = [
  ['ace', 'Ace', 'Took the ace of trumps in a trick.'],
  ['the_loser', 'The Loser', 'Lost a game. It happens to everyone.'],
  ['player', 'Player', 'Played a first game.'],
  ['winstreak', 'Win Streak', 'Won three games in a row.'],
  ['partnership', 'Partnership', 'Won ten games with the same partner.'],
  ['full_house', 'Full House', 'Played a game with three friends.'],
  ['homerun', 'Homerun', 'Bid 14 and made it.'],
].map(([key, name, description], index) => ({
  key,
  name,
  description,
  tier: 1,
  awarded_at: `2026-10-0${index + 1}T12:00:00Z`,
}));

/** Kalle at your table, as drawn on `Status-Player` (PID-340). */
const kalle: PlayerSheet = {
  user_id: 'p-east',
  username: 'Kalle',
  display_name: 'Kalle',
  avatar_url: null,
  bio: 'Sunday mornings, coffee and a good bid.',
  level: 100,
  prestige: 0,
  title: 'Legend',
  pin: 'classic',
  classic: { username: 'Kalle', member_since: '2014-03-02T09:00:00Z', games_played: 9_800 },
  record: { games: 10_420, win_rate: 0.53 },
  medals: 7,
  medal_list: kalleMedals,
  medal_total: 10,
  together: { games: 23, won_as_partners: 14, against_games: 9, against_won: 4 },
};

/** `sheet=kalle`: Kalle's sheet from the board, with no server. */
export function playerSheetFixture(value?: string): PlayerSheet | undefined {
  return __DEV__ && value === 'kalle' ? kalle : undefined;
}

/**
 * `sheet=kalle&relation=…` (PID-406): the friends lists for where you and
 * Kalle stand. A guest viewer is the guest sign-in, not a list.
 */
export function playerSheetLists(
  relation?: string
): Pick<FriendLists, 'friends' | 'added_you' | 'requested'> | undefined {
  if (!__DEV__ || !relation) return;
  const him: FriendPlayer = {
    user_id: kalle.user_id,
    display_name: kalle.username,
    avatar_url: null,
    presence: 'at_table',
  };
  return {
    friends: relation === 'friends' ? [him] : [],
    added_you: relation === 'asked' ? [him] : [],
    requested: relation === 'sent' ? [{ ...him, requested_at: '2026-11-08T09:00:00Z' }] : [],
  };
}

/** A fixture friend's sheet: what the friends list knows, and nothing more. */
export function friendSheetFixture(
  player: Pick<FriendPlayer, 'user_id' | 'display_name' | 'avatar_url' | 'level' | 'prestige'>
): PlayerSheet {
  return {
    user_id: player.user_id,
    username: player.display_name,
    display_name: player.display_name,
    avatar_url: player.avatar_url,
    bio: null,
    level: player.level ?? 1,
    prestige: player.prestige ?? 0,
    title: null,
    pin: null,
    classic: null,
    record: { games: 0, win_rate: 0 },
    medals: 0,
    together: { games: 0, won_as_partners: 0, against_games: 0, against_won: 0 },
  };
}
