import { describe, expect, it } from 'bun:test';
import { setLocale } from '@pidro/shared';
import { fitStatus } from '../../src/features/avatar.ts';
import { cutLandsAt, CUT_ORDER } from '../../src/game/canvas/animationTiming.ts';
import {
  choosingTrumpLine,
  cutLine,
  dealingLine,
  lineFit,
  seatLine,
  seatPlate,
  teamLine,
} from '../../src/features/game/seatLine.ts';

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
    } finally {
      setLocale('en');
    }
  });
});

describe('a side seat in a narrow column (PID-450, PID-466)', () => {
  // What the seat shows: its line as the device laid it out `width` wide, in `room`. The
  // widths are Nunito 800 at 14pt in Chromium; Android sets the same words wider (PID-465).
  // 390 wide, a lit side plate leaves its line 82pt; 360 wide, 67. A short line is 40 wide.
  const shows = (line, width, room, shown = line.text, { short = 40, plated = false } = {}) =>
    fitStatus(
      shown,
      lineFit(shown, line, room),
      (text) => (text === shown ? width : short),
      plated
    );
  const wider = (width) => width * 1.1;
  const high = { text: 'Bid 14 · high', short: 'High 14', tone: 'high' };
  const thinking = (text) => ({ text, short: 'Playing…', tone: 'now' });

  it('decides from the line as laid out, not from how many letters it has', () => {
    // Gösta's line on the Android beta: 11 letters passed the old estimate (77pt), but it
    // is laid out 89pt wide even in Nunito, and its plate ran off the screen.
    expect(shows(thinking('Hm, kanske…'), 89, 82)).toBe('Playing…');
    expect(shows(thinking('Counting…'), 72, 82)).toBe('Counting…');
  });

  it('gives way where another face sets the line a tenth wider than Nunito', () => {
    const line = thinking('Let’s see…');
    expect(shows(line, 78, 82)).toBe('Let’s see…');
    expect(shows(line, wider(78), 82)).toBe('Playing…');
    // Its box is a point wider than the line, rounded up, so a line a hair short of the
    // room does not fit: Android would cut its last letter for "…" (PID-466).
    expect(shows(line, 81, 82)).toBe('Let’s see…');
    expect(shows(line, 81.2, 82)).toBe('Playing…');
    expect(shows(line, 82, 82)).toBe('Playing…');
  });

  it('says nothing more on a lit plate where not even the short line fits, never a cut word', () => {
    // Stig's "Så där ja." at 360 in a face a tenth wider: "Playing…" has no room either.
    const stig = thinking('Så där ja.');
    expect(shows(stig, 76, 67, undefined, { short: 66.4, plated: true })).toBeNull();
    expect(shows(stig, 76, 67, undefined, { short: 60, plated: true })).toBe('Playing…');
    // On the felt there is no plate to say it: the short line stands.
    expect(shows(stig, 76, 67, undefined, { short: 66.4 })).toBe('Playing…');
  });

  it('chooses trump in its short form where the line would be cut off, on the lit plate too', () => {
    const choosing = choosingTrumpLine();
    expect(choosing).toEqual({ text: 'Choosing trump…', short: 'Trump…', tone: 'now' });
    expect(shows(choosing, 118, 67)).toBe('Trump…');
    expect(seatPlate(choosing, { onTurn: true, isYou: false })?.text).toBe('Choosing trump…');
    // A bot's own line (PID-405) gives way to the same short form.
    expect(shows({ ...choosing, text: 'Hmm, which suit is it going to be…' }, 230, 67)).toBe(
      'Trump…'
    );
    // A tablet's side column has room for the whole line.
    expect(shows(choosing, 118, 134)).toBe('Choosing trump…');
  });

  it('keeps the high bid whole where it fits, and short where it would not', () => {
    expect(shows(high, 84, 93)).toBe('Bid 14 · high');
    expect(shows(high, 84, 67)).toBe('High 14');
  });

  it('says the card alone where a played card has no room, never a word cut short', () => {
    const plays = seatLine(seat({ lastPlayedCard: { card: { rank: 10, suit: 'hearts' } } }));
    // "Plays 10♥" is laid out 69pt wide; a lit plate at 360 leaves 67, and 82 at 390.
    expect(shows(plays, 69, 67)).toBe('10♥');
    expect(shows(plays, 69, 82)).toBe('Plays 10♥');
    expect(shows(plays, wider(69), 82)).toBe('Plays 10♥');
  });

  it('leaves lines without a short form, and plate text, as they are', () => {
    // Too wide and nothing shorter to say: the line stays itself, and its plate within the room.
    expect(lineFit('Plays A♣', { text: 'Plays A♣' }, 67)).toEqual({ room: 67, short: 'Plays A♣' });
    expect(shows({ text: 'Playing…', tone: 'now' }, 300, 67)).toBe('Playing…');
    expect(shows({ text: 'Bidding…', short: 'Bidding…' }, 300, 67)).toBe('Bidding…');
    // "Your turn" on your plate is not the line it stands for.
    expect(shows({ text: 'Playing…', short: 'Playing…' }, 300, 10, 'Your turn')).toBe('Your turn');
    expect(lineFit(null, high, 67)).toEqual({ room: 67, short: null });
    expect(fitStatus('Bid 14 · high', lineFit('Bid 14 · high', null, 67), () => 300)).toBe(
      'Bid 14 · high'
    );
  });

  it('says it in Swedish at a Swedish table', () => {
    setLocale('sv');
    try {
      const choosing = choosingTrumpLine();
      expect(choosing.text).toBe('Väljer trumf…');
      expect(shows(choosing, 93, 67)).toBe('Trumf…');
      // 390 wide: an unlit 101pt line fits it, but a lit plate reaching 13.5pt past
      // it each side leaves 82 to stay on screen.
      expect(shows(choosing, 93, 101)).toBe('Väljer trumf…');
      expect(shows(choosing, 93, 82)).toBe('Trumf…');
      expect(shows({ text: 'Bud 14 · högst', short: 'Högst 14' }, 97, 82)).toBe('Högst 14');
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

  it('times each seat’s card as the cut lays it down: North first, West last', () => {
    expect(CUT_ORDER).toEqual(['north', 'east', 'south', 'west']);
    expect(CUT_ORDER.map((_, order) => cutLandsAt(order, 1))).toEqual([520, 1140, 1760, 2380]);
    // A phone catching up plays the cut faster; one too far behind lays it down at once.
    expect(cutLandsAt(3, 0.5)).toBe(1190);
    expect(cutLandsAt(3, 0)).toBe(0);
  });
});
