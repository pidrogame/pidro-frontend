import type { LeagueState, LeagueStanding } from '@pidro/shared';
import samplePlaced from './leagueSamples/placed.json';
import sampleNotPlaced from './leagueSamples/not_placed.json';
import sampleHidden from './leagueSamples/opted_out.json';
import sampleGuest from './leagueSamples/guest.json';
import sampleOff from './leagueSamples/off.json';
import sampleUp from './leagueSamples/pending_up.json';
import sampleStayed from './leagueSamples/pending_stayed.json';
import sampleDown from './leagueSamples/pending_down.json';

const samples = {
  placed: samplePlaced,
  not_placed: sampleNotPlaced,
  opted_out: sampleHidden,
  guest: sampleGuest,
  off: sampleOff,
  pending_up: sampleUp,
  pending_stayed: sampleStayed,
  pending_down: sampleDown,
};

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
  ...(samplePlaced as LeagueState),
  room: { ...samplePlaced.room, standings },
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
  if (state.startsWith('sample-'))
    return structuredClone(samples[state.slice(7) as keyof typeof samples]) as LeagueState;
  const data = structuredClone(placed);
  if (state === 'profile') {
    data.me!.points = 2700;
    data.room!.standings.find((row) => row.me)!.points = 2700;
  }
  if (state.startsWith('result-')) {
    const move = state.slice(7) as 'up' | 'stayed' | 'down';
    const next = move === 'up' ? 'ace' : move === 'down' ? 'ten' : 'jack';
    data.league = next;
    data.pending_result = {
      id: `fixture-${move}`,
      week_starts_at: '2026-10-11T19:00:00Z',
      week_closes_at: '2026-10-18T19:00:00Z',
      old_league: 'jack',
      new_league: next,
      move,
      place: move === 'up' ? 5 : move === 'down' ? 27 : 6,
      room_size: 30,
      points: 2630,
      ribbon: {
        month: '2026-10',
        league: move === 'up' ? 'ace' : 'jack',
        changed: move === 'up',
        star: false,
        star_possible: move === 'up',
        weeks_played: 3,
        weeks_total: 4,
        so_far: true,
      },
    };
  }
  if (state === 'ribbons') {
    data.ribbons.past = Array.from({ length: 11 }, (_, index) => ({
      month: new Date(Date.UTC(2025, 11 + index, 1)).toISOString().slice(0, 7),
      league: (['deuce', 'ten', 'jack', 'ace', 'pidro'] as const)[index % 5],
      star: index % 3 === 0,
      star_possible: false,
      weeks_played: index % 3 === 0 ? 4 : 2,
      weeks_total: 4,
      so_far: false,
    }));
  }
  if (state === 'friends' || state === 'friends-not_placed') {
    data.friends = [
      {
        user_id: 'friend-mirja',
        username: 'Mirja',
        avatar: { url: null },
        level: 44,
        prestige: 0,
        league: 'ace',
        place: 3,
      },
      {
        user_id: 'friend-kalle',
        username: 'Kalle',
        avatar: { url: null },
        level: 43,
        prestige: 0,
        league: 'ten',
        place: 12,
      },
    ];
    if (state === 'friends-not_placed') {
      data.status = 'not_placed';
      data.room = null;
      data.me = null;
    }
  }
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
