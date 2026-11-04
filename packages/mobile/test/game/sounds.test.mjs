import { describe, expect, it } from 'bun:test';
import {
  SHUFFLE_COVERS_MS,
  TURN_REMINDER_MS,
  bidSound,
  cardPlayed,
  cardsHeard,
  cutSoundKey,
  gameOverSound,
  pageMayPlay,
  refillArrives,
  shuffleAtMs,
  shuffleCovered,
  yourPlayTurnStarted,
  yourTurnKey,
} from '../../src/features/game/sounds.ts';
import { makePlan } from '../../src/game/canvas/secondDealPlan.ts';

const card = (key) => ({ key, textureKey: key, card: { suit: 'spades', rank: 14 } });
const seats = (turn) =>
  Object.fromEntries(
    ['north', 'east', 'south', 'west'].map((rel) => [
      rel,
      { isYou: rel === 'south', isCurrentTurn: rel === turn, cardCount: 6 },
    ])
  );
const model = (phase, turn, overrides = {}) => ({
  phase,
  seats: seats(turn),
  yourHand: [card('clubs_5')],
  ...overrides,
});

describe('your turn', () => {
  it('sounds when a turn to play becomes yours, never in bidding', () => {
    expect(yourPlayTurnStarted(model('playing', 'west'), model('playing', 'south'))).toBe(true);
    expect(yourPlayTurnStarted(model('bidding', 'west'), model('bidding', 'south'))).toBe(false);
    expect(yourPlayTurnStarted(model('playing', 'south'), model('playing', 'south'))).toBe(false);
    expect(yourPlayTurnStarted(model('playing', 'south'), model('playing', 'west'))).toBe(false);
  });

  it('counts leading the first trick after declaring trump as a new turn to play', () => {
    expect(yourPlayTurnStarted(model('declaring', 'south'), model('playing', 'south'))).toBe(true);
  });

  it('stays silent on the first snapshot and while cards are still dealt', () => {
    expect(yourPlayTurnStarted(null, model('playing', 'south'))).toBe(false);
    expect(
      yourPlayTurnStarted(
        model('playing', 'west'),
        model('playing', 'south', { dealStage: 'dealing' })
      )
    ).toBe(false);
  });

  it('waits for a deal that plays unseen under Reduce Motion, as for one on screen', () => {
    const unseen = model('bidding', 'south', { dealUnseen: true });
    expect(yourTurnKey(unseen)).toBeNull();
    expect(yourPlayTurnStarted(model('playing', 'west'), { ...unseen, phase: 'playing' })).toBe(
      false
    );
  });

  it('stays silent when the hand that ended holds under its result with the turn on you', () => {
    const held = model('playing', 'south', { yourHand: [] });
    expect(yourPlayTurnStarted(model('playing', 'west'), held)).toBe(false);
    expect(yourTurnKey(held)).toBeNull();
  });

  it('keys each turn of yours, bidding or play, so the reminder starts over', () => {
    expect(TURN_REMINDER_MS).toBe(10_000);
    expect(yourTurnKey(model('bidding', 'south'))).toBe('bidding');
    expect(yourTurnKey(model('playing', 'south'))).toBe('playing');
    expect(yourTurnKey(model('bidding', 'west'))).toBeNull();
    expect(yourTurnKey(model('bidding', 'south', { dealStage: 'dealing' }))).toBeNull();
    // Winning the bid and then declaring is a new turn: the 10 s count again.
    expect(yourTurnKey(model('declaring', 'south'))).not.toBe(
      yourTurnKey(model('bidding', 'south'))
    );
  });
});

describe('bids and passes', () => {
  const bid = (position, amount) => ({ position, amount });

  it('plays the one that just showed', () => {
    expect(bidSound([], [bid('north', 6)])).toBe('bid');
    expect(bidSound([bid('north', 6)], [bid('north', 6), bid('east', 'pass')])).toBe('pass');
  });

  it('plays the last once when the deal ends and several show together', () => {
    expect(bidSound(undefined, [bid('north', 6), bid('east', 7), bid('south', 'pass')])).toBe(
      'pass'
    );
  });

  it('stays silent when nothing new shows, or a new hand clears the bids', () => {
    expect(bidSound([bid('north', 6)], [bid('north', 6)])).toBeNull();
    expect(bidSound([bid('north', 6), bid('east', 7)], [bid('north', 'pass')])).toBeNull();
    expect(bidSound([bid('north', 6)], undefined)).toBeNull();
  });
});

describe('a card leaving a hand', () => {
  const felt = (playedCards, trick = 0) => ({
    playedCards,
    lastTrick: trick ? { number: trick } : null,
  });
  // The table hears a state when its felt or its trick changes, as usePlayPresentation does.
  const sounds = (...states) => {
    const when = (state) =>
      `${Object.values(state.playedCards)
        .flat()
        .map((c) => c.textureKey)
        .sort()}@${state.lastTrick?.number ?? 0}`;
    let heard = cardsHeard(states[0]);
    return states.slice(1).filter((state, i) => {
      if (when(state) === when(states[i])) return false;
      const played = cardPlayed(heard, state);
      heard = cardsHeard(state, heard);
      return played;
    }).length;
  };

  it('sounds once per card: your tap shows it, the server confirming it is the same card', () => {
    const tapped = felt({ south: [card('spades_14')] });
    expect(sounds(felt({}), tapped)).toBe(1);
    expect(sounds(tapped, felt({ south: [card('spades_14')] }))).toBe(0);
    expect(sounds(tapped, felt({ ...tapped.playedCards, west: [card('hearts_2')] }))).toBe(1);
  });

  it('stays silent when a card confirmed after the timeout went back to your hand and comes out again', () => {
    const before = felt({ north: [card('a')] }, 2);
    const tapped = felt({ north: [card('a')], south: [card('spades_14')] }, 2);
    const confirmed = felt(
      { north: [card('a')], south: [{ ...card('spades_14'), key: 'trick-2-1-south-spades_14' }] },
      2
    );
    expect(sounds(before, tapped, before, confirmed)).toBe(1);
  });

  it('stays silent when that late confirmation also finishes the trick', () => {
    const three = { north: [card('a')], east: [card('b')], west: [card('c')] };
    const tapped = felt({ ...three, south: [card('spades_14')] }, 2);
    const taken = felt({ ...three, south: [card('spades_14')] }, 3);
    expect(sounds(felt(three, 2), tapped, felt(three, 2), taken)).toBe(1);
    // The next trick's lead still sounds.
    expect(
      sounds(felt(three, 2), tapped, felt(three, 2), taken, felt({ east: [card('e')] }, 3))
    ).toBe(2);
  });

  it('forgets a card that went back to your hand once its trick is over', () => {
    const tapped = felt({ south: [card('spades_14')] }, 2);
    // Back in your hand; the server plays another card for you and the trick ends.
    const other = felt({ south: [card('clubs_5')] }, 3);
    expect(
      sounds(
        felt({}, 2),
        tapped,
        felt({}, 2),
        other,
        felt({}, 3),
        felt({ south: [card('spades_14')] }, 3)
      )
    ).toBe(3);
  });

  it('sounds for the next hand’s lead after the result held the table empty, even with a card played last hand', () => {
    const lastTrick = {
      north: [card('hearts_14')],
      east: [card('b')],
      south: [card('c')],
      west: [card('d')],
    };
    // The result holds the hand that ended (its trick count) with its cards cleared; the next hand deals.
    expect(
      sounds(felt(lastTrick, 6), felt({}, 6), felt({}), felt({ north: [card('hearts_14')] }))
    ).toBe(1);
  });

  it('sounds for the next trick’s lead as the last one clears', () => {
    const trick = { north: [card('a')], east: [card('b')], south: [card('c')], west: [card('d')] };
    expect(sounds(felt(trick, 1), felt({ east: [card('e')] }, 1))).toBe(1);
    expect(sounds(felt(trick, 1), felt({}, 1))).toBe(0);
  });

  it('knows your card once the server renames it, even with the next seat’s card in the same update', () => {
    const tapped = felt({ south: [card('diamonds_13')] });
    const confirmed = { south: [{ ...card('diamonds_13'), key: 'trick-0-2-south-diamonds_13' }] };
    expect(sounds(tapped, felt(confirmed))).toBe(0);
    expect(sounds(tapped, felt({ ...confirmed, west: [card('diamonds_6')] }))).toBe(1);
  });

  it('stays silent when a reconnect brings several at once', () => {
    expect(sounds(felt({}), felt({ north: [card('a')], east: [card('b')] }))).toBe(0);
  });
});

describe('the cut', () => {
  const cut = (key) => ({ key, textureKey: key.split('-').at(-1) });

  it('is keyed by its cards, so a rotation or resize never plays it again', () => {
    const cuts = { north: cut('dealer-cut-north-hearts_4'), east: cut('dealer-cut-east-spades_9') };
    // Same cards, given in a different order, as a new layout may.
    const rotated = { east: cuts.east, north: cuts.north };
    expect(cutSoundKey(rotated)).toBe(cutSoundKey(cuts));
    expect(cutSoundKey({ ...cuts, south: cut('dealer-cut-south-clubs_2') })).not.toBe(
      cutSoundKey(cuts)
    );
    expect(cutSoundKey({})).toBeNull();
  });
});

describe('web before the first tap', () => {
  it('plays only once the page has had a tap or key', () => {
    expect(pageMayPlay({ hasBeenActive: false }, false)).toBe(false);
    expect(pageMayPlay({ hasBeenActive: true }, false)).toBe(true);
  });

  it('falls back to its own tap listener where the browser has no userActivation', () => {
    expect(pageMayPlay(undefined, false)).toBe(false);
    expect(pageMayPlay(undefined, true)).toBe(true);
  });
});

describe('the second deal', () => {
  const seat = (kept, drawn) => ({
    secondDeal: kept == null ? null : { kept, drawn },
    cardCount: 6,
  });
  const arrivals = (seatsByRel) => {
    const { frames } = makePlan(
      { phase: 'playing', dealerRelative: 'north', yourHand: [], seats: seatsByRel },
      null
    );
    return frames.slice(1).filter((frame, i) => refillArrives(frames[i], frame)).length;
  };

  it('sounds once per player given cards, and once as the dealer takes the rest', () => {
    // East draws 3, you 2, West none; the dealer takes the other 11.
    expect(
      arrivals({ north: seat(null), east: seat(3, 3), south: seat(4, 2), west: seat(6, 0) })
    ).toBe(3);
  });

  it('stays at one per player when the pack runs out on the last card dealt', () => {
    // 6 + 6 + 4 empties the pack: nothing left for the dealer to take.
    expect(
      arrivals({ north: seat(null), east: seat(0, 6), south: seat(0, 6), west: seat(2, 4) })
    ).toBe(3);
  });
});

describe('the shuffle', () => {
  it('starts 1.5 s before the deal, so it ends with the first packet in the air', () => {
    expect(shuffleAtMs(3_000)).toBe(1_500);
  });

  it('starts at once when the deal is closer than that, and never before the cut lands', () => {
    expect(shuffleAtMs(900)).toBe(0);
    expect(shuffleAtMs(3_000, 1_668)).toBe(1_668);
  });

  it('is not started again by the deal it already leads into', () => {
    expect(shuffleCovered(0, 1_500)).toBe(true);
    expect(shuffleCovered(0, SHUFFLE_COVERS_MS)).toBe(false);
    expect(shuffleCovered(-Infinity, 0)).toBe(false);
  });
});

describe('the game’s end', () => {
  it('is heard from the viewer’s side; spectators and a tie hear nothing', () => {
    expect(gameOverSound({ spectator: false, tied: false, won: true })).toBe('won');
    expect(gameOverSound({ spectator: false, tied: false, won: false })).toBe('lost');
    expect(gameOverSound({ spectator: true, tied: false, won: false })).toBeNull();
    expect(gameOverSound({ spectator: false, tied: true, won: false })).toBeNull();
  });
});
