import type { AchievementCatalogEntry, FriendPlayer, ProfileIdentity } from '@pidro/shared';

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
