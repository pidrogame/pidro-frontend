import { describe, expect, it } from 'bun:test';
import { setLocale } from '@pidro/shared';
import {
  classicPinLine,
  levelProgress,
  monthName,
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
