import { afterEach, expect, test } from 'bun:test';
import { setLocale } from '@pidro/shared';
import { handHistoryRows } from '../../src/features/game/handHistory.ts';

afterEach(() => setLocale('en'));

const NAMES = { north: 'Kai', east: 'Eli', south: 'Antti', west: 'Nora' };
const players = Object.entries(NAMES).map(([absolutePosition, username]) => ({
  absolutePosition,
  username,
}));

const history = [
  {
    hand_number: 1,
    bidding_team: 'east_west',
    bidder: 'west',
    bid: 8,
    trump: 'clubs',
    made: true,
    captured: { north_south: 4, east_west: 10 },
    scores: { north_south: 4, east_west: 10 },
  },
  {
    hand_number: 2,
    bidding_team: 'north_south',
    bidder: 'north',
    bid: 9,
    made: false,
    captured: { north_south: 7, east_west: 7 },
    scores: { north_south: -5, east_west: 17 },
  },
];

test('a rejoined snapshot has every hand newest first, with server outcomes and totals', () => {
  const snapshot = JSON.parse(JSON.stringify({ hand_history: history }));
  expect(handHistoryRows(snapshot.hand_history, 'south', players)).toEqual([
    {
      number: 2,
      bidder: 'Kai',
      ours: true,
      bid: 9,
      trump: null,
      made: false,
      captured: [7, 7],
      totals: [-5, 17],
    },
    {
      number: 1,
      bidder: 'Nora',
      ours: false,
      bid: 8,
      trump: 'clubs',
      made: true,
      captured: [4, 10],
      totals: [4, 10],
    },
  ]);
  expect(handHistoryRows(snapshot.hand_history, 'east', players)[0]).toEqual({
    number: 2,
    bidder: 'Kai',
    ours: false,
    bid: 9,
    trump: null,
    made: false,
    captured: [7, 7],
    totals: [17, -5],
  });
  // A spectator reads the table's sides, N/S first, and still sees names.
  expect(handHistoryRows(history, null, players)).toEqual(
    handHistoryRows(history, 'north', players).map((row) => ({
      ...row,
      bidder: row.bidder === 'You' ? 'Kai' : row.bidder,
    }))
  );
  expect(snapshot.hand_history).toEqual(history);
  expect(handHistoryRows(undefined, 'south')).toEqual([]);
});

test('no eight-hand cap and repeated snapshots do not append duplicate hands', () => {
  const long = Array.from({ length: 12 }, (_, i) => ({ ...history[i % 2], hand_number: i + 1 }));
  const first = handHistoryRows(long, 'south');
  expect(first.map((row) => row.number)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  expect(handHistoryRows(long, 'south')).toEqual(first);
});

test('a bidder is named as the table shows them, never by the server compass seat', () => {
  // The viewer sits North on the server; the table turns them to the bottom, so their
  // partner (server South) sits at the top of their screen and East is on their left.
  const bid = (bidder) => [{ ...history[1], bidder }];
  expect(handHistoryRows(bid('south'), 'north', players)[0].bidder).toBe('Antti');
  expect(handHistoryRows(bid('north'), 'north', players)[0].bidder).toBe('You');
  const left = players.map((p) => ({
    ...p,
    username: p.absolutePosition === 'north' ? 'Kai' : null,
  }));
  expect(handHistoryRows(bid('south'), 'north', left)[0].bidder).toBe('North');
  expect(handHistoryRows(bid('east'), 'north', left)[0].bidder).toBe('West');
  expect(handHistoryRows(bid('west'), 'north', [])[0].bidder).toBe('East');
  // A spectator sees the server's seats as they are.
  expect(handHistoryRows(bid('east'), null, left)[0].bidder).toBe('East');
  setLocale('sv');
  expect(handHistoryRows(bid('south'), 'north', players)[0].bidder).toBe('Antti');
  expect(handHistoryRows(bid('north'), 'north', players)[0].bidder).toBe('Du');
  expect(handHistoryRows(bid('south'), 'north', left)[0].bidder).toBe('Nord');
});
