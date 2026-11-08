import { describe, expect, it } from 'bun:test';
import { setLocale } from '@pidro/shared';
import {
  classicPinLine,
  classicRecordLine,
  legendProgress,
  levelProgress,
  MORE,
  medalBox,
  medalShelf,
  monthName,
  presenceLine,
  seatTitle,
  sheetTitle,
  sinceYear,
  titleLine,
  togetherLines,
  veteranTitle,
  winRate,
  wornPin,
} from '../../src/features/profile';

describe('level progress', () => {
  it('counts what is left of the span to the next level', () => {
    const progress = levelProgress({ level: 44, progress: [3320, 7000] });
    expect(progress.caption).toBe(`${(3680).toLocaleString()} XP to Level 45`);
    expect(progress.fraction).toBeCloseTo(3320 / 7000);
  });

  it('fills the well at the top level and says so', () => {
    expect(levelProgress({ level: 100, progress: 'max' })).toEqual({
      fraction: 1,
      caption: 'Top level',
    });
  });

  it('shows an empty well when the server sent no progress', () => {
    expect(levelProgress({ level: 1 })).toEqual({ fraction: 0, caption: null });
    expect(levelProgress(undefined)).toEqual({ fraction: 0, caption: null });
  });
});

describe('win rate', () => {
  it('rounds the fraction to a whole percent', () => {
    expect(winRate(1131 / 2076)).toBe('54%');
    expect(winRate(0)).toBe('0%');
  });
});

describe('the Classic pin line', () => {
  it('reads like the board', () => {
    expect(classicPinLine({ level: 61, games_played: 1862, name: 'Bengt64' })).toBe(
      `Old Pidro · Level 61 · ${(1862).toLocaleString()} games as Bengt64`
    );
  });

  it('keeps the name when the games are unknown, and the games when the name is private', () => {
    expect(classicPinLine({ name: 'Gertrude' })).toBe('Played as Gertrude');
    expect(classicPinLine({ level: 3, games_played: 300 })).toBe('Old Pidro · Level 3 · 300 games');
  });

  it('never leaves the line empty', () => {
    expect(classicPinLine({})).toBe('Your games in the old Pidro app');
  });
});

describe('the pin a player wears', () => {
  it('is Classic for a Classic player until they choose No pin', () => {
    expect(wornPin(undefined, true)).toBe('classic');
    expect(wornPin('classic', true)).toBe('classic');
    expect(wornPin('none', true)).toBeNull();
  });

  it('is never Classic without a Classic account', () => {
    expect(wornPin('classic', false)).toBeNull();
    expect(wornPin(undefined, false)).toBeNull();
  });
});

it('retranslates profile helpers on invocation without changing identity or progression', () => {
  const classic = { level: 61, games_played: 1862, name: 'Bengt64' };
  const veteran = { level: 44, progress: [3320, 7000] };
  try {
    setLocale('sv');
    expect(classicPinLine(classic)).toBe('Gamla Pidro · Nivå 61 · 1 862 spel som Bengt64');
    expect(levelProgress(veteran)).toEqual({
      fraction: 3320 / 7000,
      caption: '3 680 XP till nivå 45',
    });
    expect(levelProgress({ level: 100, progress: 'max' }).caption).toBe('Högsta nivån');
    expect(monthName(new Date('2026-10-01T00:00:00Z'))).toBe('oktober');
    expect(winRate(0.54)).toBe('54 %');
    expect(veteranTitle('Master')).toBe('Mästare');
    expect(veteranTitle('Unknown future title')).toBeNull();
    setLocale('en');
    expect(veteranTitle('Unknown future title')).toBe('Unknown future title');
    expect(levelProgress(veteran).caption).toBe('3,680 XP to Level 45');
    expect(classicPinLine(classic)).toBe('Old Pidro · Level 61 · 1,862 games as Bengt64');
  } finally {
    setLocale('en');
  }
});

describe('the year a player started', () => {
  it('is the Classic year for a Classic player, else the account year', () => {
    const first_seen_at = '2026-09-12T10:00:00Z';
    expect(sinceYear({ classic: { member_since: '2011-05-14T08:30:00Z' }, first_seen_at })).toBe(
      2011
    );
    // Classic without a date: no year, rather than this year.
    expect(sinceYear({ classic: { name: 'Bengt64' }, first_seen_at })).toBeNull();
    expect(sinceYear({ classic: null, first_seen_at })).toBe(2026);
    expect(sinceYear({ classic: null, first_seen_at: null })).toBeNull();
  });
});

describe('the title line', () => {
  it('names the stars in gold from level 100, and the title below it', () => {
    expect(titleLine({ level: 100, title: 'Legend', prestige: 4 })).toEqual({
      text: 'Legend ★4',
      legend: true,
    });
    expect(titleLine({ level: 100, title: 'Legend', prestige: 0 })).toEqual({
      text: 'Legend',
      legend: true,
    });
    expect(titleLine({ level: 44, title: 'Mainstay', prestige: 0 })).toEqual({
      text: 'Mainstay',
      legend: false,
    });
  });
});

describe('the next Legend star', () => {
  it('counts toward the star after the ones you hold', () => {
    const next = legendProgress({ level: 100, prestige: 4, prestige_progress: [366127, 500000] });
    expect(next.next).toBe('Next: Legend ★5');
    expect(next.caption).toBe(`${(133873).toLocaleString()} XP to go`);
    expect(next.fraction).toBeCloseTo(366127 / 500000);
    // At 100 with no star yet, the first star is next.
    expect(legendProgress({ level: 100, prestige: 0, prestige_progress: [0, 500000] }).next).toBe(
      'Next: Legend ★1'
    );
  });

  it('is nothing below level 100, where the level bar stays', () => {
    expect(legendProgress({ level: 99, prestige: 0, prestige_progress: null })).toBeNull();
    expect(legendProgress(undefined)).toBeNull();
  });
});

describe('the medals shelf', () => {
  const medal = (key, earned) => ({ key, name: key, description: '', tier: 1, earned });
  const catalog = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((key) =>
    medal(key, ['c', 'f'].includes(key))
  );
  const earned = ['f', 'c'].map((key) => ({
    key,
    name: key,
    description: '',
    tier: 1,
    awarded_at: '',
  }));

  it('puts earned medals first, in the order earned, then fills with locked ones', () => {
    const shelf = medalShelf(earned, catalog);
    expect(shelf.medals.map(({ key, earned }) => `${key}${earned ? '+' : ''}`)).toEqual([
      'f+',
      'c+',
      'a',
      'b',
      'd',
    ]);
    expect(shelf.total).toBe(7);
  });

  it('shows what there is when fewer than five exist', () => {
    expect(medalShelf([], catalog.slice(0, 2)).medals.map((m) => m.key)).toEqual(['a', 'b']);
    expect(medalShelf(undefined, undefined)).toEqual({ medals: [], total: 0 });
  });
});

it('reads the Classic row like the board', () => {
  expect(classicRecordLine({ name: 'Bengt64', level: 61, games_played: 38536 })).toBe(
    `Bengt64 · level 61 there · ${(38536).toLocaleString()} games, counted in your record above`
  );
  expect(classicRecordLine({ level: 3 })).toBe('level 3 there');
});

describe('the player sheet', () => {
  const since2014 = { username: 'Kalle', member_since: '2014-03-02T09:00:00Z' };

  it('gives a Legend their stars, or the title with the level', () => {
    expect(sheetTitle({ level: 100, prestige: 4, title: 'Legend' })).toEqual({
      text: 'Legend ★4',
      legend: true,
    });
    expect(sheetTitle({ level: 100, prestige: 0, title: 'Legend' })).toEqual({
      text: 'Legend · Level 100',
      legend: true,
    });
    expect(sheetTitle({ level: 99, prestige: 0, title: 'Grandmaster' })).toEqual({
      text: 'Grandmaster · Level 99',
      legend: false,
    });
    expect(sheetTitle({ level: 7, prestige: 0, title: null }).text).toBe('Level 7');
    setLocale('sv');
    try {
      expect(sheetTitle({ level: 100, prestige: 0, title: 'Legend' }).text).toBe(
        'Legend · Nivå 100'
      );
    } finally {
      setLocale('en');
    }
  });

  it('says where they are, then since when they play Old Pidro', () => {
    expect(presenceLine('table', since2014)).toBe('At your table · Old Pidro since 2014');
    expect(presenceLine('online', since2014)).toBe('Online now · Old Pidro since 2014');
    expect(presenceLine('offline', null)).toBe('Not online');
    expect(presenceLine(undefined, since2014)).toBe('Old Pidro since 2014');
    expect(presenceLine(undefined, { username: 'Kalle', member_since: null })).toBeNull();
  });

  it('at the table, says the title and the seat, and leaves the level to the avatar', () => {
    const kalle = { level: 100, title: 'Legend' };
    expect(seatTitle(kalle, 'Plays against you')).toEqual({
      text: 'Legend · Plays against you',
      legend: true,
    });
    expect(seatTitle({ level: 12, title: 'Apprentice' }, 'Your partner').text).toBe(
      'Apprentice · Your partner'
    );
    expect(seatTitle({ level: 7, title: null }, null)).toEqual({ text: 'Level 7', legend: false });
  });

  it('shows the four newest medals first, says the newest, and names the rest', () => {
    // Earned oldest first, as the server sends them.
    const list = [
      'Ace',
      'Forcer',
      'The Loser',
      'Win Streak',
      'Partnership',
      'Full House',
      'Homerun',
    ].map((name, index) => ({
      key: name.toLowerCase().replace(/\W+/g, '_'),
      name,
      description: `${name} done.`,
      tier: 1,
      awarded_at: `2026-10-0${index + 1}T12:00:00Z`,
    }));
    const box = medalBox(list);
    expect(box.coins.map((medal) => medal.name)).toEqual([
      'Homerun',
      'Full House',
      'Partnership',
      'Win Streak',
    ]);
    expect(box.more.map((medal) => medal.name)).toEqual(['The Loser', 'Forcer', 'Ace']);
    expect(box.line).toBe('Newest: Homerun. Homerun done.');
    expect(medalBox(list, 'partnership').line).toBe('Partnership: Partnership done.');
    expect(medalBox(list, MORE).line).toBe('Also earned: The Loser, Forcer and Ace.');
    // A key that is not on a coin, such as one in the rest, says the newest.
    expect(medalBox(list, 'ace').line).toBe('Newest: Homerun. Homerun done.');
    // Four or fewer: no "+N", and one is the newest.
    expect(medalBox(list.slice(0, 4)).more).toEqual([]);
    expect(medalBox(list.slice(0, 1), MORE).line).toBe('Newest: Ace. Ace done.');
    expect(medalBox([])).toBeNull();
    expect(medalBox(undefined)).toBeNull();
    setLocale('sv');
    try {
      expect(medalBox(list.slice(0, 6), MORE).line).toBe('Har också fått: Forcer och Ace.');
    } finally {
      setLocale('en');
    }
  });

  it('counts the two of you, wins before games against each other', () => {
    expect(
      togetherLines({ games: 23, won_as_partners: 14, against_games: 9, against_won: 4 })
    ).toEqual({
      title: 'You two: 23 games together',
      detail: '14 won as partners · 4 of 9 against each other',
    });
    expect(
      togetherLines({ games: 1, won_as_partners: 0, against_games: 1, against_won: 1 })?.title
    ).toBe('You two: 1 game together');
    expect(
      togetherLines({ games: 0, won_as_partners: 0, against_games: 0, against_won: 0 })
    ).toBeNull();
  });
});
