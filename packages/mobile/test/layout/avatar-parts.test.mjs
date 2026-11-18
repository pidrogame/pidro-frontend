import { describe, expect, it } from 'bun:test';
import { setLocale } from '@pidro/shared';
import { avatarLabel, avatarParts, chipFor, lineBox, nameType } from '../../src/features/avatar';

describe('avatar parts by size', () => {
  it('matches the profile avatar on the board', () => {
    const parts = avatarParts(150);
    expect(parts.ring).toBe(6);
    expect(parts.pin).toMatchObject({ size: 48, right: -8, top: 2 });
    expect(parts.level).toMatchObject({ minWidth: 52, height: 28, fontSize: 15 });
    expect(parts.dealer).toMatchObject({ size: 49, left: -18, bottom: 5 });
    expect(parts.turn).toEqual({ radius: 88, stroke: 4 });
  });

  it('matches the table seat on the board', () => {
    const parts = avatarParts(56);
    expect(parts.ring).toBe(3);
    expect(parts.pin?.size).toBe(20);
    expect(parts.level).toMatchObject({ minWidth: 26, height: 18, fontSize: 10, bottom: -9 });
    // PID-450: the dealer coin 30 and the winning bid 28; the bot badge stays.
    expect(parts.dealer?.size).toBe(30);
    expect(parts.bid).toBe(28);
    expect(parts.badge).toBe(22);
    expect(parts.turn).toEqual({ radius: 34, stroke: 5 });
    expect(parts.gem).toBe(12);
  });

  it('keeps every other board size', () => {
    expect(avatarParts(104)).toMatchObject({
      ring: 5,
      pin: { size: 36 },
      level: { minWidth: 42, height: 24, fontSize: 13 },
    });
    expect(avatarParts(64)).toMatchObject({
      ring: 3.5,
      pin: { size: 24 },
      level: { minWidth: 30, height: 20, fontSize: 11 },
      dealer: { size: 34 },
      bid: 32,
    });
    expect(avatarParts(44)).toMatchObject({
      ring: 2.5,
      pin: { size: 17 },
      level: { minWidth: 22, height: 16, fontSize: 9 },
      dealer: { size: 26 },
      badge: 19,
    });
  });

  it('interpolates between board sizes instead of snapping to one', () => {
    const parts = avatarParts(48);
    expect(parts.ring).toBe(2.5);
    expect(parts.pin?.size).toBe(18);
    expect(parts.level?.minWidth).toBe(23);
    expect(parts.dealer?.size).toBe(27);
  });

  it('drops the level and dealer at 36 but keeps the pin', () => {
    const parts = avatarParts(36);
    expect(parts.ring).toBe(2);
    expect(parts.pin?.size).toBe(15);
    expect(parts.level).toBeNull();
    expect(parts.dealer).toBeNull();
  });

  it('gives a label beside a landscape seat the larger type, but not one below', () => {
    expect(avatarParts(52, { beside: true }).name.fontSize).toBe(16);
    expect(avatarParts(52, { beside: true }).status.fontSize).toBe(13);
    expect(avatarParts(56).name.fontSize).toBe(13);
    expect(avatarParts(44, { beside: true }).name.fontSize).toBe(13);
  });

  it('gives a seat at the table one size for name and line (PID-450)', () => {
    const type = (size, beside = false) => {
      const parts = avatarParts(size, { beside, seat: true });
      return [parts.name.fontSize, parts.status.fontSize, parts.name.fontWeight];
    };
    // Upright phones, the tight phone's seats beside their names, and iPads.
    expect(type(56)).toEqual([14, 14, '900']);
    expect(type(44, true)).toEqual([14, 14, '900']);
    expect(type(64)).toEqual([16, 16, '900']);
    // A landscape phone's name keeps 16 beside the seat; its line takes 14, never less.
    expect(type(52, true)).toEqual([16, 14, '900']);
    expect(avatarParts(56, { seat: true }).status.fontWeight).toBe('800');
    // Off the table nothing changes.
    expect(avatarParts(56).status.fontSize).toBe(11);
  });

  it('drops a long seat name to 14 at most, never below it', () => {
    const name = 'Alexandria the Long-Named Player';
    const landscape = avatarParts(52, { beside: true, seat: true });
    expect(nameType(landscape.name, name, 104, landscape.smallName).fontSize).toBe(14);
    const upright = avatarParts(56, { seat: true });
    expect(nameType(upright.name, name, 40, upright.smallName)).toBe(upright.name);
  });

  it('drops a name too long for its room one type step, never below the phone type', () => {
    const name = 'Alexandria the Long-Named Player';
    const large = avatarParts(52, { beside: true }).name;
    expect(nameType(large, name, 104)).toEqual({ fontSize: 13, lineHeight: 16 });
    expect(nameType(large, 'mfios1', 104)).toBe(large);
    expect(nameType(large, name, undefined)).toBe(large);
    const small = avatarParts(56).name;
    expect(nameType(small, name, 40)).toBe(small);
  });

  it('decides a seat name from its laid-out width where it has one (PID-466)', () => {
    const landscape = avatarParts(52, { beside: true, seat: true });
    // "Sincere Snowdrop", a 16-letter guest name: 16 × 0.5 per letter says 16pt fits in 130,
    // but laid out it is 135 wide at 16pt, so it drops to 14.
    expect(nameType(landscape.name, 'Sincere Snowdrop', 130, landscape.smallName)).toBe(
      landscape.name
    );
    expect(nameType(landscape.name, 'Sincere Snowdrop', 130, landscape.smallName, 135)).toBe(
      landscape.smallName
    );
    expect(nameType(landscape.name, 'Sincere Snowdrop', 140, landscape.smallName, 135)).toBe(
      landscape.name
    );
  });

  it('draws a seat label in a box a point wider than the line, rounded up, or not at all', () => {
    // Android's "Jaså…": a box a hair narrower than "Jaså." cuts its full stop.
    expect(lineBox(36.2)).toBe(38);
    expect(lineBox(36)).toBe(37);
    expect(lineBox(36.2, 38)).toBe(38);
    expect(lineBox(36.2, 37.9)).toBeNull();
  });

  it('is the ring alone at 24', () => {
    expect(avatarParts(24)).toMatchObject({
      ring: 1.5,
      pin: null,
      gem: null,
      level: null,
      dealer: null,
      turn: null,
    });
  });

  it('grows in proportion above the largest board size', () => {
    expect(avatarParts(300)).toMatchObject({ ring: 12, pin: { size: 96 }, dealer: { size: 98 } });
  });

  it('switches name and status to iPad type at 64', () => {
    expect(avatarParts(56).name).toEqual({ fontSize: 13, lineHeight: 16 });
    expect(avatarParts(64).status).toEqual({ fontSize: 13, lineHeight: 17 });
  });
});

describe('avatar label', () => {
  it('switches accessible sentences live, preserving the player’s name and geometry', () => {
    const parts = avatarParts(64);
    try {
      setLocale('sv');
      expect(avatarLabel({ name: 'Rookie', dealer: true, level: 18, turn: { urgent: true } })).toBe(
        'Rookie, givare, nivå 18, spelarens tur, tiden håller på att ta slut'
      );
      expect(avatarLabel({ kind: 'open' })).toBe('Ledig plats');
      expect(avatarLabel({ name: 'Jussi', away: 'bot' })).toBe('Jussi, en bot spelar');
      expect(avatarLabel({ name: 'Bengt', pin: 'classic' })).toBe('Bengt, Gamla Pidro');
      expect(avatarParts(64)).toEqual(parts);
      setLocale('en');
      expect(avatarLabel({ kind: 'open' })).toBe('Open seat');
      expect(avatarLabel({ name: 'Bengt', pin: 'classic' })).toBe('Bengt, Old Pidro');
    } finally {
      setLocale('en');
    }
  });

  it('says the seat in one sentence', () => {
    expect(
      avatarLabel({
        name: 'Kalle',
        dealer: true,
        bid: 7,
        level: 18,
        pin: 'founding_tester',
        status: 'Plays nine of hearts',
      })
    ).toBe('Kalle, dealer, bid 7, level 18, Founding Tester, plays nine of hearts');
  });

  it('names the turn and an urgent turn', () => {
    expect(avatarLabel({ name: 'Mikko', turn: {} })).toBe('Mikko, their turn');
    expect(avatarLabel({ name: 'Mikko', turn: { urgent: true } })).toBe(
      'Mikko, their turn, almost out of time'
    );
  });

  it('says why a seat is away when no status says it', () => {
    expect(avatarLabel({ name: 'Jussi', away: 'reconnecting' })).toBe('Jussi, reconnecting');
    expect(avatarLabel({ name: 'Jussi', away: 'bot', status: 'Bot is playing' })).toBe(
      'Jussi, bot is playing'
    );
  });

  it('names a bot seat and an open seat with no name', () => {
    expect(avatarLabel({ kind: 'bot', status: 'Bid 7' })).toBe('Bot, bid 7');
    expect(avatarLabel({ kind: 'open' })).toBe('Open seat');
  });

  it('keeps level 0', () => {
    expect(avatarLabel({ name: 'New', level: 0 })).toBe('New, level 0');
  });
});

describe('the chip under the face (PID-338)', () => {
  it('shows the level, plain, up to 99', () => {
    for (const level of [1, 12, 99])
      expect(chipFor({ level, prestige: 0 })).toEqual({ text: String(level), legend: false });
  });

  it('turns gold at 100 before the first star', () => {
    expect(chipFor({ level: 100, prestige: 0 })).toEqual({ text: '100', legend: true });
    expect(chipFor({ level: 100 })).toEqual({ text: '100', legend: true });
  });

  it('shows the stars once a Legend has them', () => {
    for (const prestige of [1, 4, 8, 12])
      expect(chipFor({ level: 100, prestige })).toEqual({ text: `★${prestige}`, legend: true });
  });

  it('shows nothing without a level', () => {
    expect(chipFor({ level: null, prestige: 4 })).toBeNull();
    expect(chipFor({})).toBeNull();
  });

  it('says what the chip says', () => {
    expect(avatarLabel({ name: 'Mikko', level: 44 })).toBe('Mikko, level 44');
    expect(avatarLabel({ name: 'Kalle', level: 100, prestige: 0 })).toBe(
      'Kalle, Legend, level 100'
    );
    expect(avatarLabel({ name: 'Bengt', level: 100, prestige: 4 })).toBe('Bengt, Legend, 4 stars');
    expect(avatarLabel({ name: 'Ilse', level: 100, prestige: 1 })).toBe('Ilse, Legend, 1 star');
  });
});
