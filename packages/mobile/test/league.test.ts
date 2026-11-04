import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogs, setLocale, t, validateCatalogs, type LeagueState } from '@pidro/shared';
import {
  LEAGUES,
  closeTimeText,
  leagueBands,
  leagueLine,
  leagueMarkName,
  leagueName,
  nextLeague,
  ordinal,
  previousLeague,
} from '../src/features/league';

afterEach(() => setLocale('en'));

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

test('five card identities, translated full/short names and neighbours without wraparound', () => {
  assert.deepEqual(
    LEAGUES.map(({ id, rank, suit, red }) => [id, rank, suit, red]),
    [
      ['deuce', '2', '♣', false],
      ['ten', '10', '♦', true],
      ['jack', 'J', '♥', true],
      ['ace', 'A', '♠', false],
      ['pidro', '', '♠', false],
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
  assert.equal(leagueName('jack'), 'Jack league');
  assert.equal(leagueMarkName('jack'), 'Jack');
  assert.equal(
    t('league.ribbon_so_far', { league: leagueMarkName('jack') }),
    'Ribbon so far: Jack'
  );
  setLocale('sv');
  assert.equal(leagueName('jack'), 'Knektens liga');
  assert.equal(leagueMarkName('jack'), 'Knekten');
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
    assert.equal(
      leagueLine(placed),
      locale === 'en' ? '6th in Jack league' : '6:e i Knektens liga'
    );
    assert.equal(
      leagueLine({ ...placed, status: 'not_placed', me: null, room: null }),
      locale === 'en'
        ? 'Jack league · play a game to join'
        : 'Knektens liga · spela ett parti för att gå med'
    );
    for (const status of ['opted_out', 'guest', 'off'] as const)
      assert.equal(leagueLine({ ...placed, status }), null);
    assert.equal(leagueLine({ ...placed, league: null }), null);
    assert.equal(leagueLine({ ...placed, me: null }), null);
  }
});

describe('local closing clock, winter and summer', () => {
  for (const [zone, winter, summer] of [
    ['Europe/Helsinki', '21:00', '22:00'],
    ['Europe/Stockholm', '20:00', '21:00'],
    ['America/New_York', '14:00', '15:00'],
  ]) {
    test(zone, () => {
      assert.equal(
        closeTimeText('2026-11-08T19:00:00Z', new Date('2026-11-06T19:00:00Z'), zone),
        `Ends Sunday at ${winter} · 2 days left`
      );
      assert.equal(
        closeTimeText('2026-07-05T19:00:00Z', new Date('2026-07-03T19:00:00Z'), zone),
        `Ends Sunday at ${summer} · 2 days left`
      );
    });
  }
});

test('today uses local calendar dates, not UTC dates or rolling 24 hours', () => {
  const now = new Date('2026-11-08T21:30:00Z');
  const close = '2026-11-08T22:30:00Z';
  assert.equal(closeTimeText(close, now, 'Europe/Helsinki'), 'Ends Monday at 00:30 · 1 hour left');
  assert.equal(closeTimeText(close, now, 'Europe/Stockholm'), 'Ends today at 23:30 · 1 hour left');
  assert.equal(closeTimeText(close, now, 'America/New_York'), 'Ends today at 17:30 · 1 hour left');
  assert.equal(
    closeTimeText('2026-11-09T00:30:00Z', new Date('2026-11-08T23:30:00Z'), 'America/New_York'),
    'Ends today at 19:30 · 1 hour left'
  );
  assert.equal(
    closeTimeText('2026-07-05T21:30:00Z', new Date('2026-07-05T20:30:00Z'), 'Europe/Helsinki'),
    'Ends Monday at 00:30 · 1 hour left'
  );
  assert.equal(
    closeTimeText('2026-07-05T21:30:00Z', new Date('2026-07-05T20:30:00Z'), 'Europe/Stockholm'),
    'Ends today at 23:30 · 1 hour left'
  );
});

test('duration units, expiry, invalid dates and default device zone', () => {
  const close = '2026-11-08T19:00:00Z';
  for (const [now, duration] of [
    ['2026-11-07T19:00:00Z', '1 day left'],
    ['2026-11-08T17:00:00Z', '2 hours left'],
    ['2026-11-08T18:58:00Z', '2 minutes left'],
    ['2026-11-08T18:59:59Z', '1 minute left'],
    ['2026-11-08T19:00:00Z', 'week ended'],
    ['2026-11-08T19:01:00Z', 'week ended'],
  ])
    assert.ok(closeTimeText(close, new Date(now), 'Europe/Helsinki').endsWith(`· ${duration}`));
  assert.equal(closeTimeText('invalid'), '');
  assert.equal(closeTimeText(close, new Date('invalid')), '');
  const now = new Date('2026-11-08T18:00:00Z');
  assert.equal(
    closeTimeText(close, now),
    closeTimeText(close, now, Intl.DateTimeFormat().resolvedOptions().timeZone)
  );
});

test('Swedish close translates weekday, today, and all duration units', () => {
  setLocale('sv');
  const close = '2026-11-08T19:00:00Z';
  for (const [now, expected] of [
    ['2026-11-06T19:00:00Z', 'Slutar söndag kl. 21:00 · 2 dagar kvar'],
    ['2026-11-07T19:00:00Z', 'Slutar söndag kl. 21:00 · 1 dag kvar'],
    ['2026-11-08T17:00:00Z', 'Slutar i dag kl. 21:00 · 2 timmar kvar'],
    ['2026-11-08T18:00:00Z', 'Slutar i dag kl. 21:00 · 1 timme kvar'],
    ['2026-11-08T18:58:00Z', 'Slutar i dag kl. 21:00 · 2 minuter kvar'],
    ['2026-11-08T18:59:00Z', 'Slutar i dag kl. 21:00 · 1 minut kvar'],
  ])
    assert.equal(closeTimeText(close, new Date(now), 'Europe/Helsinki'), expected);
});

test('elapsed duration remains correct across DST transitions', () => {
  assert.equal(
    closeTimeText('2026-03-29T19:00:00Z', new Date('2026-03-28T19:00:00Z'), 'Europe/Helsinki'),
    'Ends Sunday at 22:00 · 1 day left'
  );
  assert.equal(
    closeTimeText('2026-10-25T19:00:00Z', new Date('2026-10-24T20:00:00Z'), 'Europe/Stockholm'),
    'Ends Sunday at 20:00 · 23 hours left'
  );
});

test('registered catalogs match keys, plural branches and placeholders without hardcoded intro bands', () => {
  assert.deepEqual(validateCatalogs(catalogs.en, catalogs.sv), []);
  for (const locale of ['en', 'sv'] as const) {
    setLocale(locale);
    assert.equal(t('league.title', { league: leagueName('jack') }), leagueName('jack'));
    assert.doesNotMatch(t('league.intro_move_body'), /\d/);
  }
});
