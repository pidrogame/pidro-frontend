import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setLocale, t, type LeagueResult, type LeagueState } from '@pidro/shared';
import {
  LEAGUES,
  closeTimeText,
  leagueBands,
  leagueGameLine,
  leagueLine,
  leagueName,
  nextLeague,
  ordinal,
  placeArrow,
  previousLeague,
  ribbonHistory,
  ribbonMonth,
  shouldShowLeagueResult,
} from '../src/features/league';

afterEach(() => setLocale('en'));

test('ribbon month names are localized', () => {
  assert.equal(ribbonMonth('2026-10'), 'October');
  assert.equal(ribbonMonth('2026-10', true), 'Oct');
  setLocale('sv');
  assert.equal(ribbonMonth('2026-10'), 'oktober');
  assert.equal(ribbonMonth('2026-10', true), 'okt.');
});

test('ribbon history keeps the newest twelve in month order including current, without changing star eligibility', () => {
  const past = Array.from({ length: 14 }, (_, index) => ({
    month: new Date(Date.UTC(2025, index, 1)).toISOString().slice(0, 7),
    league: 'ace' as const,
    star: false,
    star_possible: false,
    weeks_played: 3,
    weeks_total: 4,
    so_far: false,
  })).reverse();
  const current = { ...past[0], month: '2026-03', so_far: true, star_possible: true };
  const history = ribbonHistory({ past, current });
  assert.equal(history.length, 12);
  assert.equal(history[0].month, '2025-04');
  assert.equal(history[11], current);
  assert.equal(history[10].star_possible, false);
  assert.equal(history[11].star_possible, true);
  assert.deepEqual(ribbonHistory({ past: [], current: null }), []);
});

const placed: LeagueState = {
  status: 'placed',
  league: 'jack',
  week: { starts_at: '2026-11-01T19:00:00Z', closes_at: '2026-11-08T19:00:00Z' },
  room: { size: 30, promote: 5, demote: 5, standings: [] },
  me: { place: 6, points: 1240 },
  last_week: null,
  pending_result: null,
  friends: [],
  ribbons: { current: null, past: [] },
  intro_seen: false,
  classic: true,
};

test('five card identities, translated bare names and neighbours without wraparound', () => {
  assert.deepEqual(
    LEAGUES.map(({ id, rank, suit, red }) => [id, rank, suit, red]),
    [
      ['deuce', '2', '♥', true],
      ['ten', '10', '♥', true],
      ['jack', 'J', '♥', true],
      ['ace', 'A', '♥', true],
      ['pidro', '5', '♥', true],
    ]
  );
  assert.deepEqual(
    LEAGUES.map(({ id }) => nextLeague(id)),
    ['ten', 'jack', 'ace', 'pidro', null]
  );
  assert.deepEqual(
    LEAGUES.map(({ id }) => previousLeague(id)),
    [null, 'deuce', 'ten', 'jack', 'ace']
  );
  for (const { id, labelKey } of LEAGUES) assert.equal(leagueName(id), t(labelKey));
  assert.deepEqual(
    LEAGUES.map(({ id }) => leagueName(id)),
    ['Deuce', 'Ten', 'Jack', 'Ace', 'Pidro']
  );
  setLocale('sv');
  assert.deepEqual(
    LEAGUES.map(({ id }) => leagueName(id)),
    ['Tvåa', 'Tia', 'Knekt', 'Ess', 'Pidro']
  );
});

describe('server-owned bands', () => {
  // Supplied counts, deliberately not a copy of a server band formula.
  const supplied = [
    { size: 1, promote: 0, demote: 0, promoteAfter: null, demoteFrom: null },
    { size: 4, promote: 1, demote: 1, promoteAfter: 1, demoteFrom: 4 },
    { size: 12, promote: 2, demote: 3, promoteAfter: 2, demoteFrom: 10 },
    { size: 30, promote: 4, demote: 6, promoteAfter: 4, demoteFrom: 25 },
    { size: 40, promote: 9, demote: 7, promoteAfter: 9, demoteFrom: 34 },
  ];
  for (const { id } of LEAGUES) {
    for (const { size, promote, demote, promoteAfter, demoteFrom } of supplied) {
      test(`${id}, ${size} members uses supplied counts, never league percentages`, () => {
        assert.deepEqual(leagueBands(id, { size, promote, demote }), { promoteAfter, demoteFrom });
      });
    }
  }
  test('zero bands are independently absent and server changes take effect', () => {
    assert.deepEqual(leagueBands('deuce', { size: 30, promote: 10, demote: 0 }), {
      promoteAfter: 10,
      demoteFrom: null,
    });
    assert.deepEqual(leagueBands('pidro', { size: 30, promote: 0, demote: 8 }), {
      promoteAfter: null,
      demoteFrom: 23,
    });
    assert.deepEqual(leagueBands('jack', { size: 30, promote: 1, demote: 2 }), {
      promoteAfter: 1,
      demoteFrom: 29,
    });
  });
});

test('English and Swedish ordinals include teens and hundreds', () => {
  const places = [1, 2, 3, 4, 6, 11, 12, 13, 21, 22, 23, 111, 112, 113, 121];
  assert.deepEqual(places.map(ordinal), [
    '1st',
    '2nd',
    '3rd',
    '4th',
    '6th',
    '11th',
    '12th',
    '13th',
    '21st',
    '22nd',
    '23rd',
    '111th',
    '112th',
    '113th',
    '121st',
  ]);
  setLocale('sv');
  assert.deepEqual(places.map(ordinal), [
    '1:a',
    '2:a',
    '3:e',
    '4:e',
    '6:e',
    '11:e',
    '12:e',
    '13:e',
    '21:a',
    '22:a',
    '23:e',
    '111:e',
    '112:e',
    '113:e',
    '121:a',
  ]);
});

test('public league line handles every server status in both languages', () => {
  for (const locale of ['en', 'sv'] as const) {
    setLocale(locale);
    assert.equal(leagueLine(placed), locale === 'en' ? '6th this week' : '6:e den här veckan');
    assert.equal(
      leagueLine({ ...placed, status: 'not_placed', me: null, room: null }),
      locale === 'en'
        ? 'Play a game with people to get on the board'
        : 'Spela ett parti med andra för att komma med på listan'
    );
    for (const status of ['opted_out', 'guest', 'off'] as const)
      assert.equal(leagueLine({ ...placed, status }), null);
    assert.equal(leagueLine({ ...placed, league: null }), null);
    assert.equal(leagueLine({ ...placed, me: null }), null);
  }
});

test('postgame placement shows points, movement or first placement in both languages', () => {
  for (const locale of ['en', 'sv'] as const) {
    setLocale(locale);
    const after = { ...placed, me: { place: 5, points: 1260 } };
    const line = locale === 'en' ? '+20 · 5th this week' : '+20 · 5:e den här veckan';
    assert.equal(leagueGameLine(placed, after, 20), `${line} ↑`);
    assert.equal(
      leagueGameLine({ ...placed, me: { place: 4, points: 1240 } }, after, 20),
      `${line} ↓`
    );
    assert.equal(leagueGameLine({ ...placed, me: { place: 5, points: 1240 } }, after, 20), line);
    assert.equal(
      leagueGameLine(
        { ...placed, status: 'not_placed', me: null, room: null },
        { ...after, me: { place: 12, points: 20 } },
        20
      ),
      locale === 'en'
        ? 'You’re on the board · 12th this week'
        : 'Du är med på listan · 12:e den här veckan'
    );
    assert.equal(leagueGameLine(null, after, 20), line, 'unknown baseline never invents movement');
    assert.equal(
      leagueGameLine({ ...placed, league: 'ten' }, after, 20),
      line,
      'different cards are not comparable places'
    );
    assert.equal(
      leagueGameLine(
        { ...placed, week: { ...placed.week!, starts_at: '2026-10-25T19:00:00Z' } },
        after,
        20
      ),
      line,
      'a new week is not a place drop'
    );
    for (const status of ['guest', 'off', 'opted_out'] as const) {
      assert.equal(leagueGameLine({ ...placed, status }, after, 20), null);
      assert.equal(leagueGameLine(placed, { ...after, status }, 20), null);
    }
    assert.equal(leagueGameLine(placed, { ...after, status: 'not_placed', me: null }, 20), null);
  }
  assert.equal(placeArrow(6, 5), ' ↑');
  assert.equal(placeArrow(6, 7), ' ↓');
  assert.equal(placeArrow(6, 6), '');
  assert.equal(placeArrow(null, 1), '');
});

test('countdown floors whole minutes, keeps both units, and clamps expiry in both languages', () => {
  const close = '2026-11-08T19:00:00Z';
  for (const [now, en, sv] of [
    ['2026-11-05T14:47:01Z', 'Ends in 3d 4h', 'Slutar om 3 d 4 h'],
    ['2026-11-08T14:47:01Z', 'Ends in 4h 12m', 'Slutar om 4 h 12 min'],
    ['2026-11-07T19:00:00Z', 'Ends in 1d 0h', 'Slutar om 1 d 0 h'],
    ['2026-11-07T19:00:01Z', 'Ends in 23h 59m', 'Slutar om 23 h 59 min'],
    ['2026-11-08T18:00:00Z', 'Ends in 1h 0m', 'Slutar om 1 h 0 min'],
    ['2026-11-08T18:58:01Z', 'Ends in 0h 1m', 'Slutar om 0 h 1 min'],
    ['2026-11-08T18:59:59Z', 'Ends in 0h 0m', 'Slutar om 0 h 0 min'],
    ['2026-11-08T19:00:00Z', 'Ends in 0h 0m', 'Slutar om 0 h 0 min'],
    ['2026-11-08T19:01:00Z', 'Ends in 0h 0m', 'Slutar om 0 h 0 min'],
  ]) {
    setLocale('en');
    assert.equal(closeTimeText(close, new Date(now)), en);
    setLocale('sv');
    assert.equal(closeTimeText(close, new Date(now)), sv);
  }
  assert.equal(closeTimeText('invalid'), '');
  assert.equal(closeTimeText(close, new Date('invalid')), '');
});

test('winter, summer and DST boundaries use actual elapsed time, not calendar days', () => {
  for (const [now, close, expected] of [
    // Helsinki, Stockholm and New York, in winter and summer.
    ['2026-01-08T20:00:00+02:00', '2026-01-11T21:00:00+02:00', 'Ends in 3d 1h'],
    ['2026-07-02T20:00:00+03:00', '2026-07-05T22:00:00+03:00', 'Ends in 3d 2h'],
    ['2026-01-08T20:00:00+01:00', '2026-01-11T21:00:00+01:00', 'Ends in 3d 1h'],
    ['2026-07-02T20:00:00+02:00', '2026-07-05T22:00:00+02:00', 'Ends in 3d 2h'],
    ['2026-01-08T20:00:00-05:00', '2026-01-11T21:00:00-05:00', 'Ends in 3d 1h'],
    ['2026-07-02T20:00:00-04:00', '2026-07-05T22:00:00-04:00', 'Ends in 3d 2h'],
    ['2026-03-28T20:00:00+02:00', '2026-03-29T20:00:00+03:00', 'Ends in 23h 0m'],
    ['2026-10-24T20:00:00+03:00', '2026-10-25T20:00:00+02:00', 'Ends in 1d 1h'],
    ['2026-03-07T20:00:00-05:00', '2026-03-08T20:00:00-04:00', 'Ends in 23h 0m'],
    ['2026-10-31T20:00:00-04:00', '2026-11-01T20:00:00-05:00', 'Ends in 1d 1h'],
  ]) {
    assert.equal(closeTimeText(close, new Date(now)), expected);
  }
});

test('only up and down results are shown; stayed and null are silent', () => {
  const result: LeagueResult = {
    id: 'result-1',
    week_starts_at: '2026-11-01T19:00:00Z',
    week_closes_at: '2026-11-08T19:00:00Z',
    old_league: 'jack',
    new_league: 'ace',
    move: 'up',
    place: 2,
    points: 1240,
    room_size: 30,
    ribbon: {
      month: '2026-11',
      league: 'ace',
      star: false,
      star_possible: true,
      weeks_played: 1,
      weeks_total: 5,
      so_far: true,
      changed: true,
    },
  };
  assert.equal(shouldShowLeagueResult(result), true);
  assert.equal(shouldShowLeagueResult({ ...result, move: 'down', new_league: 'ten' }), true);
  assert.equal(shouldShowLeagueResult({ ...result, move: 'stayed', new_league: 'jack' }), false);
  assert.equal(shouldShowLeagueResult(null), false);
});
