import { describe, expect, it } from 'bun:test';
import {
  loneTrumpHolder,
  isReopenedTable,
  isSoloTable,
} from '../../src/features/game/tableHelp.ts';

describe('out of trumps', () => {
  const cold = (eliminated) => ({ hand: 0, eliminated });

  it('names the one player left holding trumps', () => {
    expect(
      loneTrumpHolder({ north: cold(true), east: cold(false), south: cold(true), west: cold(true) })
    ).toBe('east');
  });

  it('is nobody while two still hold trumps, or before the server says', () => {
    expect(
      loneTrumpHolder({
        north: cold(true),
        east: cold(false),
        south: cold(false),
        west: cold(true),
      })
    ).toBeNull();
    expect(loneTrumpHolder({ north: {}, east: {}, south: {}, west: {} })).toBeNull();
    expect(loneTrumpHolder(null)).toBeNull();
  });
});

describe('table pace', () => {
  it('sends the preference only for the sole seated human, never a spectator or unknown table', () => {
    const seats = {
      north: { occupant_type: 'bot' },
      south: { occupant_type: 'human' },
      east: { occupant_type: 'bot' },
      west: { occupant_type: 'bot' },
    };
    expect(isSoloTable({ seats }, 'south')).toBe(true);
    expect(isSoloTable({ seats }, null)).toBe(false);
    expect(isSoloTable({ seats }, 'north')).toBe(false);
    expect(isSoloTable(null, 'south')).toBe(false);
    expect(isSoloTable({ seats: { ...seats, east: { occupant_type: 'vacant' } } }, 'south')).toBe(
      false
    );
    expect(isSoloTable({ seats: { ...seats, east: { occupant_type: 'human' } } }, 'south')).toBe(
      false
    );
  });
});

describe('a finished table reopened (PID-442)', () => {
  it('is a game behind a waiting table, never the ready a rematch passes through', () => {
    expect(isReopenedTable({ status: 'waiting' }, true)).toBe(true);
    expect(isReopenedTable({ status: 'ready' }, true)).toBe(false);
    expect(isReopenedTable({ status: 'waiting' }, false)).toBe(false);
    expect(isReopenedTable({ status: 'finished' }, true)).toBe(false);
    expect(isReopenedTable(null, true)).toBe(false);
  });
});
