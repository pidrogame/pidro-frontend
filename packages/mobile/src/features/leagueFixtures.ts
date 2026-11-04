import type { LeagueState, LeagueStanding } from '@pidro/shared';

export const LEAGUE_FIXTURE_NOW = new Date('2026-11-06T19:00:00Z');

/** Board data; the remainder makes the list a real room, not eight sample rows. */
const names = ['Mirja', 'Kalle', 'Sofia', 'Jussi', 'Lucky Moose', 'Bengt', 'Anna', 'Pekka'];
const points = [3120, 2410, 2050, 1770, 1505, 1240, 1190, 1020];
const standings: LeagueStanding[] = Array.from({ length: 30 }, (_, index) => ({
  place: index + 1,
  user_id: index === 5 ? 'ui-grammar-user' : `league-player-${index}`,
  username: names[index] ?? `Player ${index + 1}`,
  avatar: { url: null },
  level: index === 5 ? 100 : 44 - index,
  prestige: index === 5 ? 4 : 0,
  pin: index === 0 || index === 5 ? 'classic' : null,
  points: points[index] ?? 1000 - index * 20,
  me: index === 5,
}));

const placed: LeagueState = {
  status: 'placed',
  league: 'jack',
  week: { starts_at: '2026-11-01T19:00:00Z', closes_at: '2026-11-08T19:00:00Z' },
  room: { size: 30, promote: 5, demote: 5, standings },
  me: { place: 6, points: 1240 },
  last_week: null,
  pending_result: null,
  friends: [],
  ribbons: {
    current: {
      month: '2026-11',
      league: 'jack',
      star: false,
      star_possible: true,
      weeks_played: 1,
      weeks_total: 4,
      so_far: true,
    },
    past: [],
  },
  intro_seen: true,
  classic: true,
};

export function leagueFixture(value?: string): LeagueState | null {
  if (!__DEV__ || !value?.startsWith('league-')) return null;
  const state = value.slice(7);
  const data = structuredClone(placed);
  if (state === 'intro') data.intro_seen = false;
  if (state === '27') {
    data.me = { place: 27, points: 480 };
    data.room!.standings = data.room!.standings.map((row) => ({
      ...row,
      me: row.place === 27,
      username: row.place === 27 ? 'Bengt' : row.me ? 'Liisa' : row.username,
      user_id: row.place === 27 ? 'ui-grammar-user' : `league-player-${row.place}`,
    }));
  }
  if (state === 'deuce') {
    data.league = 'deuce';
    data.room!.promote = 10;
    data.room!.demote = 0;
  }
  if (state === 'pidro') {
    data.league = 'pidro';
    data.room!.promote = 0;
    data.room!.demote = 8;
  }
  if (state === 'small') {
    data.league = 'ace';
    data.room = {
      size: 4,
      promote: 1,
      demote: 1,
      standings: data.room!.standings.slice(0, 4).map((row) => ({
        ...row,
        me: row.place === 3,
        username: row.place === 3 ? 'Bengt' : row.username,
      })),
    };
    data.me = { place: 3, points: 2050 };
  }
  if (['not_placed', 'opted_out', 'guest', 'off'].includes(state)) {
    data.status = state as LeagueState['status'];
    data.room = null;
    data.me = null;
    data.ribbons = { current: null, past: [] };
    if (state === 'not_placed')
      data.last_week = { league: 'jack', place: 6, room_size: 30, points: 1240 };
    if (state === 'guest' || state === 'off') data.league = null;
    if (state === 'off') data.week = null;
  }
  return data;
}
