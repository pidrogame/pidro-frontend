import { describe, expect, it } from 'bun:test';
import { tableBack } from '../../src/features/game/tableBack';

describe("Android's Back on a game's route", () => {
  it('asks before a player leaves a game or a waiting table', () => {
    expect(tableBack('table', true)).toBe('ask');
    expect(tableBack('waiting', true)).toBe('ask');
  });

  it('asks while the game loads or comes back, and when it could not come back', () => {
    expect(tableBack('joining', true)).toBe('ask');
    expect(tableBack('restoring', true)).toBe('ask');
    expect(tableBack('restore_failed', true)).toBe('ask');
  });

  it('goes home without asking once the game is over', () => {
    expect(tableBack('over', true)).toBe('home');
  });

  it('lets a spectator leave without asking, on every screen', () => {
    for (const screen of ['joining', 'restoring', 'restore_failed', 'waiting', 'table', 'over'])
      expect(tableBack(screen, false)).toBe('leave');
  });

  it('leaves without asking when there is no seat to lose', () => {
    for (const screen of ['join_failed', 'not_found', 'away']) {
      expect(tableBack(screen, true)).toBe('leave');
      expect(tableBack(screen, false)).toBe('leave');
    }
  });
});
