import { afterEach, describe, expect, it } from 'bun:test';
import { setLocale } from '@pidro/shared';
import {
  cutLine,
  dealingLine,
  seatLine,
  seatPlate,
  teamLine,
} from '../../src/features/game/seatLine.ts';

// Tests here switch to Swedish: every one ends in English, passed or failed, so the next file reads English.
afterEach(() => setLocale('en'));

const seat = (overrides) => ({
  seatStatus: 'bot_substitute',
  lastPlayedCard: null,
  out: false,
  isTeammate: false,
  ...overrides,
});
const kingOfHearts = { card: { rank: 13, suit: 'hearts' } };

describe('the line under a bot seat', () => {
  it('says what it played, like anyone', () => {
    expect(seatLine(seat({ lastPlayedCard: kingOfHearts }))).toEqual({
      text: 'Plays K♥',
      short: 'K♥',
    });
    expect(seatLine(seat({ lastPlayedCard: kingOfHearts }))).toEqual(
      seatLine(seat({ seatStatus: 'normal', lastPlayedCard: kingOfHearts }))
    );
  });

  it('says what the table says it is doing, without a short form', () => {
    const choosing = { text: 'Choosing trump', tone: 'now' };
    expect(seatLine(seat(), choosing)).toBe(choosing);
    expect(seatLine(seat(), null)).toBeNull();
  });

  it('still says out, reconnecting, or nothing for an empty seat', () => {
    expect(seatLine(seat({ out: true }))?.text).toBe('Out');
    expect(seatLine(seat({ seatStatus: 'reconnecting' }), { text: 'Playing…' })?.text).toBe(
      'Reconnecting…'
    );
    expect(seatLine(seat({ seatStatus: 'vacant' }), { text: 'Playing…' })).toBeNull();
  });
});

describe('your partner, in the first hand (PID-383)', () => {
  const partner = (overrides) => seat({ seatStatus: 'normal', isTeammate: true, ...overrides });
  const yourPartner = { text: 'Your partner', tone: 'quiet' };

  it('says so whenever the line would otherwise be empty', () => {
    expect(seatLine(partner(), null, true)).toEqual(yourPartner);
    expect(seatLine(partner(), undefined, true)).toEqual(yourPartner);
  });

  it('gives way the moment the seat has something to say', () => {
    const thinking = { text: 'One moment…', tone: 'now' };
    expect(seatLine(partner(), thinking, true)).toBe(thinking);
    expect(seatLine(partner(), { text: 'Dealing' }, true)).toEqual({ text: 'Dealing' });
    expect(seatLine(partner({ lastPlayedCard: kingOfHearts }), null, true)).toEqual({
      text: 'Plays K♥',
      short: 'K♥',
    });
    expect(seatLine(partner({ out: true }), null, true)?.text).toBe('Out');
    expect(seatLine(partner({ seatStatus: 'reconnecting' }), null, true)?.text).toBe(
      'Reconnecting…'
    );
  });

  it('is silent from the second hand on', () => {
    expect(seatLine(partner(), null, false)).toBeNull();
    expect(seatLine(partner())).toBeNull();
  });

  it('is never said of an opponent, or to a spectator, who has no partner', () => {
    expect(seatLine(seat({ seatStatus: 'normal', isTeammate: false }), null, true)).toBeNull();
    // A spectator's view model marks no seat as anyone's teammate.
    expect(seatLine(seat({ seatStatus: 'normal' }), null, true)).toBeNull();
  });

  it('is in Swedish at a Swedish table', () => {
    setLocale('sv');
    try {
      expect(seatLine(partner(), null, true)).toEqual({ text: 'Din partner', tone: 'quiet' });
    } finally {
      setLocale('en');
    }
  });
});

describe('what a seat’s sheet says about whose side they play on (PID-383)', () => {
  const at = (isTeammate, isOpponent) => ({ isTeammate, isOpponent });

  it('names your partner and an opponent', () => {
    expect(teamLine(at(true, false))).toBe('Your partner');
    expect(teamLine(at(false, true))).toBe('Plays against you');
  });

  it('says nothing on your own sheet or to a spectator', () => {
    // Your own seat is neither; a spectator sees every seat as neither.
    expect(teamLine(at(false, false))).toBeNull();
  });

  it('is in Swedish at a Swedish table', () => {
    setLocale('sv');
    try {
      expect(teamLine(at(true, false))).toBe('Din partner');
      expect(teamLine(at(false, true))).toBe('Spelar mot dig');
    } finally {
      setLocale('en');
    }
  });
});

describe('the plate under a seat (PID-450)', () => {
  const playing = { text: 'Playing…', tone: 'now' };

  it('lights the seat on turn with its own line, and yours with "Your turn"', () => {
    expect(seatPlate(playing, { onTurn: true, isYou: false })).toEqual({
      plate: 'turn',
      text: 'Playing…',
    });
    expect(seatPlate(playing, { onTurn: true, isYou: true })).toEqual({
      plate: 'turn',
      text: 'Your turn',
    });
    // A seat on turn with nothing to say yet is still lit, its name alone on the plate.
    expect(seatPlate(null, { onTurn: true, isYou: false })).toEqual({ plate: 'turn', text: null });
  });

  it('leaves every seat off turn unlit, whatever it last said', () => {
    expect(seatPlate(playing, { onTurn: false, isYou: false })).toBeNull();
    expect(seatPlate({ text: 'Bid 7' }, { onTurn: false, isYou: true })).toBeNull();
    expect(seatPlate(null, { onTurn: false, isYou: false })).toBeNull();
  });

  it('keeps "Takes the rest" on your plate, where it says more than your turn (PID-364)', () => {
    const rest = { text: 'Takes the rest', short: 'All yours', tone: 'now' };
    expect(seatPlate(rest, { onTurn: true, isYou: true })).toEqual({
      plate: 'turn',
      text: 'Takes the rest',
    });
  });

  it('keeps the bidding winner off the plate while their bid is held', () => {
    expect(seatPlate({ text: 'Bid 9', tone: 'high' }, { onTurn: true, isYou: true })).toBeNull();
  });

  it('puts a seat out of trumps on the navy plate, and lights it once as it goes out', () => {
    const out = seatLine(seat({ out: true }));
    expect(out).toMatchObject({ text: 'Out', tone: 'out', pulse: 'out' });
    expect(seatPlate(out, { onTurn: false, isYou: false })).toEqual({ plate: 'out', text: 'Out' });
  });

  it('says “Out of trumps” on your own plate, “Out” on everyone else’s (PID-485)', () => {
    const yours = seatLine(seat({ out: true, isYou: true }));
    expect(yours).toMatchObject({ text: 'Out of trumps', short: 'Out of trumps', tone: 'out' });
    expect(seatPlate(yours, { onTurn: false, isYou: true })).toEqual({
      plate: 'out',
      text: 'Out of trumps',
    });
    expect(seatLine(seat({ out: true, isYou: false, isTeammate: true }), null, true)?.text).toBe(
      'Out'
    );
    // Your last card still on the table says what it was, as anyone's does.
    expect(seatLine(seat({ out: true, isYou: true, lastPlayedCard: kingOfHearts }))?.text).toBe(
      'Plays K♥'
    );
  });

  it('keeps a seat out until the hand ends, whatever the table says of it meanwhile', () => {
    // The trick it did not play in, the turn passing on, a Pidro taken: still Out.
    for (const meanwhile of [playing, { text: 'Won the trick' }, null]) {
      expect(seatLine(seat({ out: true }), meanwhile)?.tone).toBe('out');
    }
    // The table model clears `out` with the hand: the seat speaks again.
    expect(seatLine(seat({ out: false }), playing)).toBe(playing);
  });

  it('says it in Swedish at a Swedish table', () => {
    setLocale('sv');
    try {
      expect(seatPlate(playing, { onTurn: true, isYou: true })?.text).toBe('Din tur');
      expect(seatLine(seat({ out: true }))?.text).toBe('Ute');
      expect(seatLine(seat({ out: true, isYou: true }))?.text).toBe('Slut på trumf');
    } finally {
      setLocale('en');
    }
  });
});

describe('while the cards move (PID-466)', () => {
  it('lets only the dealer say it is dealing', () => {
    setLocale('en');
    expect(dealingLine(true)).toEqual({ text: 'Dealing' });
    expect(dealingLine(false)).toBeNull();
    setLocale('sv');
    expect(dealingLine(true)).toEqual({ text: 'Delar ut' });
  });

  it('says what a seat cut once its card is up, and nothing before', () => {
    setLocale('en');
    expect(cutLine('K♥', false)).toBeNull();
    expect(cutLine('K♥', true)).toEqual({ text: 'Draws K♥' });
    expect(cutLine(null, true)).toBeNull();
    setLocale('sv');
    expect(cutLine('K♥', true)).toEqual({ text: 'Drar K♥' });
  });
});
