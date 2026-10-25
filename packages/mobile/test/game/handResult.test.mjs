import { describe, expect, it } from 'bun:test';
import {
  all14Team,
  celebratesAll14,
  handResultView,
  waitsForContinue,
} from '../../src/features/game/handResult.ts';

it('waits only for the server own-pace Continue gate, including old and partial payloads', () => {
  expect(waitsForContinue({ pace: 'own', awaiting_continue: true })).toBe(true);
  for (const state of [
    {},
    { pace: 'own' },
    { awaiting_continue: true },
    { pace: 'quick', awaiting_continue: true },
    { pace: 'own', awaiting_continue: false },
  ]) {
    expect(waitsForContinue(state)).toBe(false);
  }
});

const card = (rank, suit) => ({ rank, suit });
const scored = (rank, suit, points, position, team) => ({
  card: card(rank, suit),
  points,
  position,
  team,
});

// East bid 9 in hearts. E/W took A, J, both fives and the 2 (13); N/S the 10 (1).
const eastMade = {
  hand_number: 6,
  bidding_team: 'east_west',
  bidder: 'east',
  bid: 9,
  trump: 'hearts',
  captured: { north_south: 1, east_west: 13 },
  made: true,
  delta: { north_south: 1, east_west: 13 },
  scores: { north_south: 22, east_west: 47 },
  point_cards: [
    scored(14, 'hearts', 1, 'west', 'east_west'),
    scored(10, 'hearts', 1, 'north', 'north_south'),
    scored(11, 'hearts', 1, 'east', 'east_west'),
    scored(5, 'hearts', 5, 'east', 'east_west'),
    scored(5, 'diamonds', 5, 'west', 'east_west'),
    scored(2, 'hearts', 1, 'west', 'east_west'),
  ],
};

// West bid 12 in clubs and won 7; North took the 5 of clubs for N/S.
const westMissed = {
  hand_number: 9,
  bidding_team: 'east_west',
  bidder: 'west',
  bid: 12,
  trump: 'clubs',
  captured: { north_south: 7, east_west: 7 },
  made: false,
  delta: { north_south: 7, east_west: -12 },
  scores: { north_south: 48, east_west: 29 },
  point_cards: [
    scored(5, 'clubs', 5, 'north', 'north_south'),
    scored(5, 'spades', 5, 'east', 'east_west'),
    scored(14, 'clubs', 1, 'west', 'east_west'),
    scored(11, 'clubs', 1, 'south', 'north_south'),
    scored(10, 'clubs', 1, 'east', 'east_west'),
    scored(2, 'clubs', 1, 'south', 'north_south'),
  ],
};

describe('the end-of-hand panel', () => {
  for (const team of ['north_south', 'east_west']) {
    for (const defense of [false, true]) {
      it(`celebrates ${team}'s ${defense ? 'defense' : 'bidding'} sweep from every seat`, () => {
        const other = team === 'north_south' ? 'east_west' : 'north_south';
        const biddingTeam = defense ? other : team;
        const hand = {
          ...eastMade,
          bidding_team: biddingTeam,
          bidder: biddingTeam === 'north_south' ? 'north' : 'east',
          captured: { [team]: 14, [other]: 0 },
          made: !defense,
          point_cards: eastMade.point_cards.map((pointCard) => ({ ...pointCard, team })),
        };
        expect(all14Team(hand)).toBe(team);
        for (const viewer of ['north', 'east', 'south', 'west', null]) {
          const ourSeats = team === 'north_south' ? ['north', 'south'] : ['east', 'west'];
          expect(celebratesAll14(hand, viewer)).toBe(ourSeats.includes(viewer));
          const view = handResultView(hand, viewer, 'ROOM');
          expect(view).toMatchObject({
            all14: team,
            loud: true,
            headline: { key: 'game.all_14' },
            bidder: hand.bidder,
            bid: 9,
            won: defense ? 0 : 14,
          });
          expect(view.outcome.endsWith(defense ? 'missed' : 'made')).toBe(true);
          const winner = view.trays.find((tray) => tray.team === team);
          expect(winner.points).toBe(14);
          expect(winner.cards).toHaveLength(6);
          expect(winner.cards.reduce((sum, card) => sum + card.points, 0)).toBe(14);
          expect(view.trays.find((tray) => tray.team === other).cards).toEqual([]);
        }
        const { point_cards: _, ...older } = hand;
        expect(all14Team(older)).toBe(team);
        const view = handResultView(older, 'south', 'ROOM');
        expect(view.headline).toEqual({ key: 'game.all_14' });
        expect(view.trays.every((tray) => tray.cards.length === 0)).toBe(true);
      });
    }
  }

  it('requires exactly 14 captured, not a bid or delta of 14', () => {
    for (const captured of [13, 15]) {
      for (const team of ['north_south', 'east_west']) {
        const hand = {
          ...eastMade,
          bid: 14,
          made: false,
          captured: { north_south: 0, east_west: 0, [team]: captured },
          delta: { north_south: 14, east_west: -14 },
        };
        expect(all14Team(hand)).toBeNull();
        for (const viewer of ['north', 'east', 'south', 'west', null]) {
          expect(celebratesAll14(hand, viewer)).toBe(false);
        }
        const view = handResultView(hand, 'east', 'ROOM');
        expect(view.headline.key).not.toBe('game.all_14');
        expect(view.headline.n).toBe(14 - hand.captured.east_west);
        expect(view.all14).toBeNull();
      }
    }
  });

  it('stamps our made bid in gold, our cards in the first tray, in play order', () => {
    const view = handResultView(eastMade, 'west', 'ROOM');
    expect(view.outcome).toBe('we-made');
    expect(view.loud).toBe(true);
    expect(view.headline).toEqual({ key: 'game.we_got_it' });
    expect(view).toMatchObject({ bidder: 'east', bid: 9, trump: 'hearts', won: 13, pidro: null });
    expect(view.trays[0]).toEqual({
      team: 'east_west',
      side: 'ours',
      points: 13,
      cards: [
        { card: card(14, 'hearts'), points: 1 },
        { card: card(11, 'hearts'), points: 1 },
        { card: card(5, 'hearts'), points: 5 },
        { card: card(5, 'diamonds'), points: 5 },
        { card: card(2, 'hearts'), points: 1 },
      ],
    });
    expect(view.trays[1]).toEqual({
      team: 'north_south',
      side: 'theirs',
      points: 1,
      cards: [{ card: card(10, 'hearts'), points: 1 }],
    });
    expect(view.closeMs).toBe(6000);
  });

  it('says quietly by how much we missed, and stays as long', () => {
    const view = handResultView(westMissed, 'east', 'ROOM');
    expect(view.outcome).toBe('we-missed');
    expect(view.loud).toBe(false);
    expect(view.headline).toEqual({ key: 'game.we_missed_by', n: 5 });
    // Their five is not ours to point at.
    expect(view.pidro).toBeNull();
    expect(view.closeMs).toBe(6000);
  });

  it('keeps their made bid quiet, and says it was theirs', () => {
    const view = handResultView(eastMade, 'south', 'ROOM');
    expect(view.outcome).toBe('they-made');
    expect(view.loud).toBe(false);
    expect(view.headline).toEqual({ key: 'game.they_got_it' });
    expect(view.trays.map((tray) => [tray.team, tray.side, tray.points])).toEqual([
      ['north_south', 'ours', 1],
      ['east_west', 'theirs', 13],
    ]);
    expect(view.closeMs).toBe(6000);
  });

  it('names who took their Pidro when they missed', () => {
    const view = handResultView(westMissed, 'south', 'ROOM');
    expect(view.outcome).toBe('they-missed');
    expect(view.loud).toBe(false);
    expect(view.headline).toEqual({ key: 'game.they_missed_by', n: 5 });
    expect(view.pidro).toBe('north');
    expect(view.trays[0].cards.map((c) => c.points)).toEqual([5, 1, 1]);
    expect(view.closeMs).toBe(6000);
  });

  it('takes no side for a spectator: N/S first, nobody loud, no Pidro line', () => {
    const made = handResultView(eastMade, null, 'ROOM');
    expect(made.outcome).toBe('made');
    expect(made.loud).toBe(false);
    expect(made.headline).toEqual({ key: 'game.team_got_it' });
    expect(made.trays.map((tray) => [tray.team, tray.side])).toEqual([
      ['north_south', 'neutral'],
      ['east_west', 'neutral'],
    ]);
    const missed = handResultView(westMissed, null, 'ROOM');
    expect(missed.outcome).toBe('missed');
    expect(missed.pidro).toBeNull();
    expect(missed.headline).toEqual({ key: 'game.team_missed_by', n: 5 });
    expect(missed.closeMs).toBe(6000);
  });

  it('shows empty trays for a server that sends no point cards', () => {
    const { point_cards: _, ...older } = eastMade;
    const view = handResultView(older, 'north', 'ROOM');
    expect(view.trays.map((tray) => [tray.points, tray.cards])).toEqual([
      [1, []],
      [13, []],
    ]);
  });

  it('rotates by room and hand, agrees with our partner, and never loses the missed amount', () => {
    const made = [];
    const missed = [];
    for (let hand_number = 1; hand_number <= 100; hand_number++) {
      const hand = { ...eastMade, hand_number };
      const view = handResultView(hand, 'east', 'ROOM');
      expect(view.headline).toEqual(handResultView(hand, 'west', 'ROOM').headline);
      expect(view.headline).toEqual(handResultView(hand, 'east', 'ROOM').headline);
      made.push(view.headline.key);
      const miss = handResultView({ ...westMissed, hand_number }, 'east', 'ROOM').headline;
      expect(miss.n).toBe(5);
      missed.push(miss.key);
    }
    expect(new Set(made)).toEqual(
      new Set(['game.we_made_it', 'game.we_got_it', 'game.thats_ours'])
    );
    expect(new Set(missed)).toEqual(
      new Set(['game.we_missed_by', 'game.we_short_by', 'game.we_needed_more'])
    );
    expect(made).not.toEqual(
      Array.from(
        { length: 100 },
        (_, i) => handResultView({ ...eastMade, hand_number: i + 1 }, 'east', 'OTHER').headline.key
      )
    );
  });
});
