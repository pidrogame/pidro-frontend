import { describe, expect, it } from 'bun:test';
import { normalizeRoom, useGameStore } from '@pidro/shared';
import { buildTableModel } from '../../src/game/canvas/tableModel.ts';

const player = (absolutePosition, relativePosition) => ({
  absolutePosition,
  relativePosition,
  playerId: `player-${absolutePosition}`,
  username: absolutePosition,
  isYou: relativePosition === 'south',
  isTeammate: relativePosition === 'north',
  isOpponent: relativePosition === 'east' || relativePosition === 'west',
  isConnected: true,
  isCurrentTurn: false,
  seatStatus: 'normal',
});

const rotatedPlayers = [
  player('north', 'east'),
  player('east', 'south'),
  player('south', 'west'),
  player('west', 'north'),
];

const dealerSelectionCuts = {
  north: { suit: 'clubs', rank: 9 },
  east: { suit: 'spades', rank: 14 },
  south: { suit: 'hearts', rank: 5 },
  west: { suit: 'diamonds', rank: 7 },
};

const build = (overrides = {}) =>
  buildTableModel({
    phase: 'dealer_selection',
    trumpSuit: null,
    players: rotatedPlayers,
    yourHand: null,
    yourCardCount: null,
    dealerSelectionCuts,
    currentTrick: null,
    tricks: null,
    legalActions: [],
    currentTurnRelative: null,
    dealerRelative: null,
    canPlay: false,
    getCardCountForPlayer: () => null,
    ...overrides,
  });

describe('server play legality', () => {
  it('keeps a legal nontrump bright, an illegal trump blocked, and identifies the left five', () => {
    const nontrump = { suit: 'hearts', rank: 13 };
    const trump = { suit: 'spades', rank: 14 };
    const leftFive = { suit: 'clubs', rank: 5 };
    const model = build({
      phase: 'playing',
      trumpSuit: 'spades',
      yourHand: [nontrump, trump, leftFive],
      canPlay: true,
      legalActions: [
        { type: 'play_card', card: nontrump },
        { type: 'play_card', card: leftFive },
      ],
    });
    const cards = Object.fromEntries(model.yourHand.map((card) => [card.key, card]));
    expect(cards.hearts_13.isLegalPlay).toBe(true);
    expect(cards.hearts_13.isTrump).toBe(false);
    expect(cards.spades_14.isLegalPlay).toBe(false);
    expect(cards.spades_14.isTrump).toBe(true);
    expect(cards.clubs_5.isLegalPlay).toBe(true);
    expect(cards.clubs_5.isTrump).toBe(true);
    expect([...model.legalPlayKeys].sort()).toEqual(['clubs_5', 'hearts_13']);
  });
});

describe('deal order', () => {
  it('preserves server receive order separately from the sorted display, without mutating the hand', () => {
    const hand = Object.freeze([
      { suit: 'clubs', rank: 8 },
      { suit: 'spades', rank: 2 },
      { suit: 'hearts', rank: 12 },
      { suit: 'spades', rank: 14 },
    ]);
    const model = build({ phase: 'bidding', yourHand: hand });
    expect(model.dealtHand.map((card) => card.key)).toEqual([
      'clubs_8',
      'spades_2',
      'hearts_12',
      'spades_14',
    ]);
    expect(model.yourHand.map((card) => card.key)).toEqual([
      'spades_14',
      'spades_2',
      'hearts_12',
      'clubs_8',
    ]);
    expect(model.dealtHand.map((card) => card.card)).toEqual(hand);
  });
});

describe('dealer selection table model', () => {
  it('carries authoritative lifecycle status through seat rotation', () => {
    const players = rotatedPlayers.map((p, index) => ({
      ...p,
      seatStatus: ['reconnecting', 'bot_substitute', 'permanent_bot', 'vacant'][index],
    }));
    const model = build({ players });
    expect(model.seats.east.seatStatus).toBe('reconnecting');
    expect(model.seats.south.seatStatus).toBe('bot_substitute');
    expect(model.seats.west.seatStatus).toBe('permanent_bot');
    expect(model.seats.north.seatStatus).toBe('vacant');
  });

  it('maps absolute server seats to viewer-relative cut cards', () => {
    const model = build({ dealerRelative: 'south' });

    expect(model.dealerRelative).toBe('south');
    expect(model.dealerCuts.east).toMatchObject({
      key: 'dealer-cut-east-clubs_9',
      card: dealerSelectionCuts.north,
    });
    expect(model.dealerCuts.south).toMatchObject({
      key: 'dealer-cut-south-spades_14',
      card: dealerSelectionCuts.east,
    });
    expect(model.dealerCuts.west).toMatchObject({
      key: 'dealer-cut-west-hearts_5',
      card: dealerSelectionCuts.south,
    });
    expect(model.dealerCuts.north).toMatchObject({
      key: 'dealer-cut-north-diamonds_7',
      card: dealerSelectionCuts.west,
    });
  });

  it('hides dealer cuts outside the dealer-selection phase', () => {
    expect(build({ phase: 'bidding' }).dealerCuts).toEqual({});
  });

  it('ignores cuts that do not map to a visible player', () => {
    const model = build({ players: rotatedPlayers.slice(0, 3) });

    expect(model.dealerCuts.north).toBeUndefined();
    expect(Object.keys(model.dealerCuts)).toHaveLength(3);
  });
});

describe('dealer second deal privacy', () => {
  // At a real table everyone sees the dealer take the pack: the pool's size
  // is public, only its cards are the dealer's.
  it("shows the dealer's pool count while they pick, like every other count", () => {
    const counts = { north: 6, east: 17, south: 6, west: 7 };
    const model = build({
      phase: 'second_deal',
      dealerRelative: 'south',
      getCardCountForPlayer: (position) => counts[position],
    });

    expect(model.seats.south.cardCount).toBe(17);
    expect(model.seats.east.cardCount).toBe(6);
  });

  it('moves the dealer private pool into the selector instead of duplicating it on the table', () => {
    const model = build({
      phase: 'second_deal',
      dealerRelative: 'south',
      yourHand: [
        { suit: 'spades', rank: 14 },
        { suit: 'hearts', rank: 13 },
        { suit: 'clubs', rank: 12 },
        { suit: 'diamonds', rank: 11 },
        { suit: 'spades', rank: 10 },
        { suit: 'hearts', rank: 9 },
        { suit: 'clubs', rank: 8 },
      ],
      yourCardCount: 7,
    });

    expect(model.yourHand).toEqual([]);
    expect(model.dealtHand).toEqual([]);
    expect(model.yourCardCount).toBeNull();
  });

  it('restores the dealer count after the private selection phase', () => {
    const model = build({
      phase: 'playing',
      dealerRelative: 'south',
      getCardCountForPlayer: () => 6,
    });

    expect(model.seats.south.cardCount).toBe(6);
  });
});

describe('table seat identities', () => {
  it('shows four distinct names for the iPad arrangement after a shuffled REST room snapshot', () => {
    useGameStore.getState().reset();
    try {
      useGameStore.getState().initFromRoom({
        room: normalizeRoom({
          code: 'D9MK',
          status: 'playing',
          seats: {
            east: { user_id: 'android1', username: 'mfand1' },
            north: { user_id: 'ios1', username: 'mfios1' },
            south: { user_id: 'ios2', username: 'mfios2' },
            west: { user_id: 'web1', username: 'mfweb1' },
          },
        }),
        youPlayerId: 'ios2',
      });
      const { playerMeta } = useGameStore.getState();
      const players = Object.entries(playerMeta).map(([position, meta]) => ({
        ...player(position, position),
        ...meta,
        avatar_url: position === 'south' ? 'https://cdn.example/avatar.jpg' : null,
      }));
      const model = build({ phase: 'bidding', players });
      expect(
        Object.fromEntries(Object.entries(model.seats).map(([pos, seat]) => [pos, seat.username]))
      ).toEqual({ north: 'mfios1', east: 'mfand1', south: 'mfios2', west: 'mfweb1' });
      expect(model.seats.south.avatar_url).toBe('https://cdn.example/avatar.jpg');
    } finally {
      useGameStore.getState().reset();
    }
  });
});

describe('trick signals from the server (PID-218)', () => {
  // Viewer is East (rendered south); North sits on the viewer's right (east).
  const ace = { suit: 'spades', rank: 14 };
  const five = { suit: 'spades', rank: 5 };
  const king = { suit: 'spades', rank: 13 };
  // The winning card lights only with "Help me keep count" on (PID-230).
  const counting = (overrides) => build({ countHelp: true, ...overrides });

  it('lights the card the server says is winning, with what the trick holds', () => {
    const model = counting({
      phase: 'playing',
      trumpSuit: 'spades',
      currentTrick: [
        { player: 'north', card: five },
        { player: 'east', card: ace },
      ],
      trickDetails: { winning: { position: 'east', card: ace }, points: 6, two_of_trump: null },
    });
    expect(model.winningKey).toBe(model.currentTrick.south.key);
    expect(model.trickPoints).toBe(6);
    expect(model.lastTrick).toBeNull();
    expect(model.yourTeam).toBe('east_west');
  });

  it("keeps a finished trick's winner lit until the next card, and reports the trick taken", () => {
    const tricks = [
      {
        cards: [
          { player: 'north', card: five },
          { player: 'east', card: king },
          { player: 'south', card: ace },
        ],
        winner: 'south',
        points: 6,
        two_of_trump: { position: 'north', points: 1 },
      },
    ];
    const done = counting({ phase: 'playing', trumpSuit: 'spades', tricks, currentTrick: [] });
    expect(done.winningKey).toBe(done.playedCards.west[0].key);
    expect(done.trickPoints).toBeNull();
    expect(done.lastTrick).toEqual({
      number: 1,
      winner: 'west',
      points: 6,
      twoOfTrump: { holder: 'east', points: 1 },
      plays: [
        { holder: 'east', card: five },
        { holder: 'south', card: king },
        { holder: 'west', card: ace },
      ],
    });

    const next = counting({
      phase: 'playing',
      trumpSuit: 'spades',
      tricks,
      currentTrick: [{ player: 'south', card: { suit: 'spades', rank: 10 } }],
      trickDetails: {
        winning: { position: 'south', card: { suit: 'spades', rank: 10 } },
        points: 1,
      },
    });
    expect(next.winningKey).toBe(next.currentTrick.west.key);
  });

  it('shows nothing it cannot match: an older server, or a winner whose card is not on the table', () => {
    const older = counting({
      phase: 'playing',
      trumpSuit: 'spades',
      currentTrick: [{ player: 'east', card: ace }],
    });
    expect(older.winningKey).toBeNull();
    expect(older.trickPoints).toBeNull();

    const mismatch = counting({
      phase: 'playing',
      trumpSuit: 'spades',
      currentTrick: [{ player: 'east', card: ace }],
      trickDetails: { winning: { position: 'east', card: king }, points: 1 },
    });
    expect(mismatch.winningKey).toBeNull();
  });

  it('lights no winning card with count help off, the default', () => {
    const playing = {
      phase: 'playing',
      trumpSuit: 'spades',
      currentTrick: [{ player: 'east', card: ace }],
      trickDetails: { winning: { position: 'east', card: ace }, points: 1 },
    };
    expect(build(playing).winningKey).toBeNull();
    expect(build({ ...playing, countHelp: false }).winningKey).toBeNull();
    expect(counting(playing).winningKey).toBe(counting(playing).currentTrick.south.key);
    // What the trick holds is still the server's, help or not.
    expect(build(playing).trickPoints).toBe(1);

    const done = {
      phase: 'playing',
      trumpSuit: 'spades',
      currentTrick: [],
      tricks: [
        { cards: [{ player: 'east', card: ace }], winner: 'east', points: 1, two_of_trump: null },
      ],
    };
    expect(build(done).winningKey).toBeNull();
    expect(build(done).lastTrick?.winner).toBe('south');
    expect(counting(done).winningKey).toBe(counting(done).playedCards.south[0].key);
  });
});

describe('out of trumps (PID-269)', () => {
  // Viewer is East (rendered south). West (rendered north) and the viewer have gone cold.
  const players = (revealed) => ({
    north: { hand: 2 },
    east: { hand: [], eliminated: true, revealed_cards: revealed },
    south: { hand: 3 },
    west: { hand: 0, eliminated: true, revealed_cards: [{ suit: 'clubs', rank: 9 }] },
  });

  it('keeps only folded counts from legacy faces, including your own rotated seat', () => {
    const model = build({
      phase: 'playing',
      trumpSuit: 'spades',
      yourHand: [],
      serverPlayers: players([{ suit: 'hearts', rank: 13 }]),
    });
    expect(model.seats.north.out).toBe(true);
    expect(model.seats.north.foldedCount).toBe(1);
    expect(model.seats.north).not.toHaveProperty('revealedCards');
    expect(model.seats.east.out).toBe(false);
    expect(model.seats.west.foldedCount).toBe(0);
    expect(model.seats.south.out).toBe(true);
    expect(model.seats.south.foldedCount).toBe(1);
    expect(model.yourHand).toEqual([]);
  });

  it('uses count-only payloads, with explicit zero winning over old faces', () => {
    const model = build({
      phase: 'playing',
      yourHand: [{ suit: 'hearts', rank: 13 }],
      serverPlayers: {
        north: { hand: 2, folded_count: 4 },
        east: { hand: [], eliminated: true, folded_count: 2 },
        south: { hand: 0, eliminated: true, folded_count: 3 },
        west: { ...players([]).west, folded_count: 0 },
      },
    });
    expect(['north', 'east', 'south', 'west'].map((rel) => model.seats[rel].foldedCount)).toEqual([
      0, 0, 2, 3,
    ]);
    expect(model.yourHand).toEqual([]);
    expect(model.dealtHand).toEqual([]);
    for (const seat of Object.values(model.seats)) expect(seat).not.toHaveProperty('revealedCards');
  });

  it('is only a thing while the hand is played', () => {
    const model = build({ phase: 'bidding', serverPlayers: players([]) });
    expect(model.seats.north.out).toBe(false);
    expect(model.seats.north.foldedCount).toBe(0);
    const nextHand = build({ phase: 'playing', serverPlayers: { west: { hand: 6 } } });
    expect(nextHand.seats.north.foldedCount).toBe(0);
    expect(nextHand.seats.north.out).toBe(false);
  });
});

describe('second deal counts', () => {
  // Rotated: absolute west sits at relative north, absolute south at west.
  const serverPlayers = {
    north: { hand: 6, kept_count: 1, drawn_count: 5 },
    east: { hand: [], kept_count: 2, drawn_count: 4 },
    south: { hand: 6, kept_count: 4, drawn_count: 2 },
    west: { hand: 6, kept_count: 3, drawn_count: 3 },
  };

  it('gives every seat what it kept and drew once the hand is played', () => {
    const model = build({ phase: 'playing', dealerRelative: 'west', serverPlayers });
    expect(model.seats.east.secondDeal).toEqual({ kept: 1, drawn: 5 });
    expect(model.seats.north.secondDeal).toEqual({ kept: 3, drawn: 3 });
    expect(model.seats.west.secondDeal).toEqual({ kept: 4, drawn: 2 });
  });

  it('shows what the dealer kept while they pick, and what they drew once picked', () => {
    const picking = {
      ...serverPlayers,
      south: { hand: 8, kept_count: 4, drawn_count: null },
    };
    const model = build({ phase: 'second_deal', dealerRelative: 'west', serverPlayers: picking });
    expect(model.seats.west.secondDeal).toEqual({ kept: 4, drawn: null });
    expect(model.seats.east.secondDeal).toEqual({ kept: 1, drawn: 5 });
  });

  it('says nothing before the discard, or when an older server sends no counts', () => {
    expect(build({ phase: 'bidding', serverPlayers }).seats.east.secondDeal).toBeNull();
    expect(
      build({ phase: 'playing', serverPlayers: { north: { hand: 6 } } }).seats.east.secondDeal
    ).toBeNull();
  });
});

describe('thrown and killed cards (PID-306)', () => {
  // Rotated: absolute north sits at relative east, absolute south at west.
  const serverPlayers = {
    north: { hand: 6, kept_count: 7, drawn_count: 0, discarded_count: 2 },
    east: { hand: [], kept_count: 2, drawn_count: 4, discarded_count: 7 },
    south: { hand: 6, kept_count: 4, drawn_count: 2, discarded_count: 5 },
    west: { hand: 6, kept_count: 3, drawn_count: 3, discarded_count: 6 },
  };
  const queen = { suit: 'spades', rank: 12 };

  it('counts every throw and puts killed trumps in front of the seat that killed them', () => {
    const model = build({
      phase: 'playing',
      dealerRelative: 'west',
      serverPlayers,
      killedCards: { north: [queen], south: [] },
    });
    expect(model.seats.east.discarded).toBe(2);
    expect(model.seats.west.discarded).toBe(5);
    expect(model.killed).toEqual({ east: [queen] });
  });

  it('shows no kill outside play, and nothing from an older server', () => {
    const killedCards = { north: [queen] };
    expect(build({ phase: 'second_deal', serverPlayers, killedCards }).killed).toEqual({});
    const old = build({ phase: 'playing', serverPlayers: { north: { hand: 6, kept_count: 1 } } });
    expect(old.killed).toEqual({});
    expect(old.seats.east.discarded).toBeNull();
  });
});
