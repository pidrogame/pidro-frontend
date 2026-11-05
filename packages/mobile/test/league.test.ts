import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogs,
  setLocale,
  t,
  validateCatalogs,
  type LeagueResult,
  type LeagueState,
} from '@pidro/shared';
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
  shouldPinLeagueRow,
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

test('own row pins at either partial edge, unpins only when fully visible, and yields in a starved slot', () => {
  for (const [y, offset, viewport, expected] of [
    [300, 0, 350, true],
    [294, 0, 350, false],
    [293.5, 0, 350, false],
    [294.5, 0, 350, true],
    [99.5, 100, 350, true],
    [100, 100, 350, false],
    [450, 100, 350, true],
    [20, 0, 60, false],
    [20, 0, 61, true],
  ] as const)
    assert.equal(shouldPinLeagueRow({ y, height: 56 }, offset, viewport, 60), expected);
  assert.equal(shouldPinLeagueRow({ y: 235, height: 56 }, 0, 350, 60, true), true);
  assert.equal(shouldPinLeagueRow({ y: 234, height: 56 }, 0, 350, 60, true), false);
  assert.equal(shouldPinLeagueRow({ y: 999, height: 0 }, 0, 350, 4), false);
});

test('a fully visible friends copy hides the pin, but a partial or unmeasured copy does not', () => {
  const standing = { y: 300, height: 56 };
  for (const pinned of [false, true]) {
    const bottom = 750 - (pinned ? 60 : 0);
    for (const [y, height, expected] of [
      [400, 56, false],
      [399, 56, true],
      [bottom - 56, 56, false],
      [bottom - 55, 56, true],
      [500, 0, true],
    ] as const)
      assert.equal(shouldPinLeagueRow(standing, 400, 350, 60, pinned, { y, height }), expected);
  }
  assert.equal(
    shouldPinLeagueRow({ y: 400, height: 56 }, 400, 350, 60, true, { y: 800, height: 56 }),
    false
  );
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

test('minimal copy translates actions, rules and results without obsolete keys', () => {
  assert.deepEqual(validateCatalogs(catalogs.en, catalogs.sv), []);
  const copy = [
    ['league.move_up', '↑ Move up', '↑ Flytta upp'],
    ['league.move_down', '↓ Move down', '↓ Flytta ner'],
    ['league.rules.title', 'League', 'Liga'],
    [
      'league.rules.points',
      'Every game you play with other people earns points. Games with only bots don’t count.',
      'Varje parti du spelar med andra ger poäng. Partier med bara botar räknas inte.',
    ],
    [
      'league.rules.players',
      'Each week you’re up against about 30 players at your level.',
      'Varje vecka möter du ungefär 30 spelare på din nivå.',
    ],
    [
      'league.rules.move',
      'On Sunday evening the top players move up a card and the bottom ones move down.',
      'På söndag kväll flyttar de bästa spelarna upp ett kort och de sista flyttar ner.',
    ],
    [
      'league.rules.profile',
      'Your best card each month shows on your profile.',
      'Ditt bästa kort varje månad visas på din profil.',
    ],
    ['league.result.up', 'You moved up!', 'Du flyttade upp!'],
    ['league.result.down', 'You moved down', 'Du flyttade ner'],
    ['league.result.continue', 'Continue', 'Fortsätt'],
    ['league.guest', 'Register to get on the board', 'Registrera dig för att komma med på listan'],
    ['league.register', 'Create an account', 'Skapa ett konto'],
    ['league.opted_out', 'You’re hidden from leagues.', 'Du är dold i ligorna.'],
    ['league.join_again', 'Join again', 'Gå med igen'],
    ['league.loading', 'Loading…', 'Laddar…'],
    [
      'league.failed',
      'Couldn’t load the standings. Try again.',
      'Det gick inte att ladda ställningen. Försök igen.',
    ],
    [
      'league.settings.help',
      'You won’t show up in anyone’s standings.',
      'Du syns inte på någon annans topplista.',
    ],
    [
      'league.settings.midweek',
      'If you’ve played this week, your current place counts.',
      'Om du har spelat den här veckan räknas din nuvarande plats.',
    ],
    [
      'league.settings.error',
      'Couldn’t change the setting. Try again.',
      'Det gick inte att ändra inställningen. Försök igen.',
    ],
  ] as const;
  for (const locale of ['en', 'sv'] as const) {
    setLocale(locale);
    for (const [key, en, sv] of copy) assert.equal(t(key), locale === 'en' ? en : sv);
    assert.equal(
      t('league.result.place', { place: ordinal(2), size: 30 }),
      locale === 'en' ? '2nd of 30' : '2:a av 30'
    );
    const keys = Object.keys(catalogs[locale]).filter((key) => key.startsWith('league.'));
    assert.deepEqual(keys.filter((key) => key.startsWith('league.rules.')).sort(), [
      'league.rules.move',
      'league.rules.players',
      'league.rules.points',
      'league.rules.profile',
      'league.rules.title',
    ]);
    assert.deepEqual(keys.filter((key) => key.startsWith('league.result.')).sort(), [
      'league.result.continue',
      'league.result.down',
      'league.result.place',
      'league.result.up',
    ]);
    for (const key of keys) {
      assert.doesNotMatch(
        key,
        /^league\.(intro|mark\.|footer\.|title$|room$|promote|demote|last_week$|ribbon_so_far$|got_it$|line\.not_placed$|friends\.empty$|settings\.title$|ribbons\.(weeks|best|star|history|no_race|empty)$)/
      );
      assert.doesNotMatch(String(catalogs[locale][key as keyof typeof catalogs.en]), /grupp/i);
    }
  }
});
