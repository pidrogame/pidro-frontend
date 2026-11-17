import { describe, expect, it } from 'bun:test';
import { tableBack } from '../../src/features/game/tableBack';

describe("Android's Back at a table", () => {
  it('asks before a player leaves a game or a waiting table', () => {
    expect(tableBack({ watching: false, over: false })).toBe('ask');
  });

  it('goes home without asking once the game is over', () => {
    expect(tableBack({ watching: false, over: true })).toBe('home');
  });

  it('lets a spectator leave without asking, during the game or after it', () => {
    expect(tableBack({ watching: true, over: false })).toBe('leave');
    expect(tableBack({ watching: true, over: true })).toBe('leave');
  });
});
