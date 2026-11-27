import { describe, expect, it } from 'bun:test';
import { setLocale } from '@pidro/shared';
import { avatarLabel, avatarParts, chipFor } from '../../src/features/avatar';

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
