import { describe, expect, it } from 'bun:test';
import {
  canSwapBot,
  loneTrumpHolder,
  isReopenedTable,
  isSoloTable,
  reopenedNotice,
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

describe('the host swaps a bot for a person (PID-439)', () => {
  const human = (user_id, username) => ({ occupant_type: 'human', user_id, username });
  const bot = { occupant_type: 'bot', user_id: 'bot_1', username: 'Jocke' };
  const twoBots = {
    seats: { north: human('host', 'Nora'), east: bot, south: human('eli', 'Eli'), west: bot },
  };
  const people = {
    seats: {
      north: human('host', 'Nora'),
      east: human('kalle', 'Kalle'),
      south: human('eli', 'Eli'),
      west: human('mikko', 'Mikko'),
    },
  };
  const room = { host_id: 'host', config: { solo: false } };

  it('offers the link to the host of a table with a bot, and nobody else', () => {
    expect(canSwapBot(room, twoBots, 'host', 'player')).toBe(true);
    expect(canSwapBot(room, twoBots, 'eli', 'player')).toBe(false);
    expect(canSwapBot(room, twoBots, 'host', 'spectator')).toBe(false);
    expect(canSwapBot(room, people, 'host', 'player')).toBe(false);
    expect(canSwapBot({ host_id: null }, twoBots, '', 'player')).toBe(false);
    expect(canSwapBot(room, null, 'host', 'player')).toBe(false);
  });

  it('does not count a bot keeping a player\'s seat as a bot', () => {
    const keeping = { ...bot, has_reservation: true };
    const kept = { seats: { ...people.seats, east: keeping } };
    expect(canSwapBot(room, kept, 'host', 'player')).toBe(false);
    expect(canSwapBot(room, { seats: { ...kept.seats, west: bot } }, 'host', 'player')).toBe(true);
  });

  it('leaves it off a solo practice table, which nobody else can find', () => {
    expect(canSwapBot({ ...room, config: { solo: true } }, twoBots, 'host', 'player')).toBe(false);
    expect(canSwapBot({ host_id: 'host' }, twoBots, 'host', 'player')).toBe(true);
  });

  it('tells the others who is changing the seats and tells the host nothing', () => {
    const byHost = { ...twoBots, reopened_by: 'host' };
    expect(reopenedNotice(byHost, 'host', 'eli')).toEqual({
      key: 'table.reopenedByHost',
      variant: 'warning',
      seat: { name: 'Nora' },
    });
    expect(reopenedNotice(byHost, 'host', 'host')).toBeNull();
  });

  it('keeps "A player left" for a leave and for a server that does not say', () => {
    const left = { key: 'table.reopened', variant: 'warning' };
    expect(reopenedNotice({ ...twoBots, reopened_by: 'leave' }, 'host', 'eli')).toEqual(left);
    expect(reopenedNotice({ ...twoBots, reopened_by: 'leave' }, 'host', 'host')).toEqual(left);
    expect(reopenedNotice(twoBots, 'host', 'host')).toEqual(left);
    expect(reopenedNotice({ ...twoBots, reopened_by: null }, 'host', 'eli')).toEqual(left);
  });
});
