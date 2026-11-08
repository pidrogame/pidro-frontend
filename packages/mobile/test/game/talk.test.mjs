import { describe, expect, it } from 'bun:test';
import { catalogs } from '../../../shared/src/i18n/catalogs.ts';
import {
  TALK_LINES,
  land,
  landingMs,
  saidFrom,
  tailFit,
  talker,
  talkTable,
  twoLines,
  typingFor,
  unreadBy,
} from '../../src/features/game/talk.ts';

// PID-408: the contract's lines, as it lists them. Numbered by position; a coin takes no id.
const CONTRACT = {
  hello: {
    cheerful:
      "Hello, everyone. · Here we go. · Good luck, all. · Right, let's play. · Evening, all.",
    warm: "Hello, dear. · Lovely, a full table. · Good luck, everyone. · Nice to see you. · Coffee's on.",
    dry: "Hello. · Let's see what we get. · Deal them. · Evening. · Cards, then.",
    teasing:
      "Hello. Be gentle. · Oh, it's you. · Good luck. You'll need it. · Let's get this over with. · Shuffle well.",
  },
  bold_bid: {
    cheerful: 'Big bid. · Oh, confident. · Go on then. · Brave. · Interesting.',
    warm: "Oh my, that's high. · Good luck with it. · Brave bid. · Well now. · Let's see.",
    dry: "Hm. · Bold. · We'll see. · Noted. · Is that so.",
    teasing:
      "Bold. · Sure about that? · Good luck with that. · Write that down. · Somebody's confident.",
  },
  partner_points: {
    cheerful:
      "Nice one, partner. · That's the stuff. · Lovely trick. · Keep them coming. · Well played, partner. · [coin_thumb]",
    warm: "Well done, partner. · There we go. · Good, good. · That's how it's done. · Thank you, partner. · [coin_heart]",
    dry: "Good. · Noted. · That'll do. · Fine trick. · Acceptable.",
    teasing:
      "Finally. · I'll allow it. · Look at you. · Didn't see that coming. · Was that on purpose?",
  },
  five_caught: {
    cheerful: "Got the Five. · Yes, the Five. · Five for us. · What a catch. · That one's ours.",
    warm: 'Oh, the Five. · Thank you kindly. · That was lucky. · Five, lovely. · Well, well.',
    dry: "Five. · Thank you. · That'll help. · Caught. · Mm, the Five.",
    teasing:
      "Thanks for the Five. · I'll keep that. · Generous. · Was that a gift? · Much obliged. · [coin_ha]",
  },
  five_lost: {
    cheerful:
      'Ouch, the Five. · There goes five. · Oh no. · Well, that stings. · Fair catch. · [coin_oops]',
    warm: "Oh dear, the Five. · Never mind. · They had it waiting. · We'll manage. · Shame, that.",
    dry: "Five's gone. · Hm. · That's five. · Expensive. · Right.",
    teasing:
      "Who threw the Five? · Lovely. Five points. · I saw nothing. · We don't do that here. · Pretend it didn't happen.",
  },
  we_made: {
    cheerful: "Made it. · Home and dry. · That's the hand. · Textbook. · We did it.",
    warm: 'There, we made it. · Well played, both of us. · That went well. · A good hand. · Thank you, partner.',
    dry: "Made it. Next. · As planned. · That's one. · Fine. · Enough.",
    teasing: "Too easy. · As expected. · Never in doubt. · You're welcome. · Told you.",
  },
  we_set: {
    cheerful: 'Ah well. · Next hand. · They had the cards. · Happens. · On to the next.',
    warm: "Never mind, partner. · We'll get it back. · Bad luck, that. · Not our hand. · It happens, dear.",
    dry: 'Set. · Hm. · That was optimistic. · Moving on. · Noted.',
    teasing:
      "Partner, a word. · I had it covered. Mostly. · Well, that happened. · Not my bid. · We don't talk about that.",
  },
  they_set: {
    cheerful: "Ha, got them. · That's a set. · Nicely done. · Points for us. · Down they go.",
    warm: "Oh, bad luck there. · Hard luck. · That's a set. · Unlucky bid. · Next one's yours.",
    dry: "Set. · Ambitious. · That didn't work. · Hm, a set. · Thought so.",
    teasing:
      'Bold bid. Shame. · Thanks for the points. · Ouch. · That was brave. · Again? · [coin_ha]',
  },
  game_won: {
    cheerful:
      'Good game, all. · That was fun. · Well played, everyone. · Thanks for the game. · Same again?',
    warm: 'Good game, everyone. · Thank you for the game. · That was lovely. · Well played, all. · Come again soon. · [coin_heart]',
    dry: "Good game. · That's that. · Well played. · Done. · Thanks.",
    teasing:
      "Good game. Mostly. · Rematch? · Well, that was easy. · Better luck next time. · I'll be here.",
  },
  game_lost: {
    cheerful: 'Good game, well played. · You had us. · Deserved. · Nice one, all. · Next time.',
    warm: 'Well played, dear. · Good game, everyone. · You deserved that. · Lovely game. · Thank you.',
    dry: 'Good game. · Fair. · Well played. · Hm. Good game. · Yours.',
    teasing:
      "Beginner's luck. · I let you. · Rematch. Now. · Fine. Well played. · Don't get used to it.",
  },
  reply_hello: {
    cheerful: 'Hello! · Good luck to you. · Hi there.',
    warm: 'Hello, dear. · And to you. · Welcome.',
    dry: 'Hello. · Likewise. · Mm.',
    teasing: "Hello. Be gentle. · You'll need it. · We'll see about that.",
  },
  reply_thanks: {
    cheerful: 'Thanks! · Cheers. · Any time.',
    warm: 'Thank you, dear. · Kind of you. · Oh, thank you.',
    dry: 'Thanks. · Mm. · Noted.',
    teasing: 'I know. · Naturally. · Tell your friends.',
  },
  reply_sorry: {
    cheerful: 'No worries. · All good. · Forget it.',
    warm: "Not at all. · Don't you worry. · We're fine.",
    dry: 'Fine. · It happens. · Mm.',
    teasing: "Noted. · Forgiven. This once. · I'll remember that.",
  },
  reply_game: {
    cheerful: 'Good game! · Thanks, you too. · Fun one.',
    warm: 'Thank you, same to you. · Lovely game. · Thank you, dear.',
    dry: 'Good game. · Likewise. · Yes.',
    teasing: 'Yes, yes. · If you say so. · Good game. Mostly.',
  },
};
const CONTRACT_LINES = Object.entries(CONTRACT).flatMap(([moment, voices]) =>
  Object.entries(voices).flatMap(([voice, list]) =>
    list
      .split(' · ')
      .filter((text) => !text.startsWith('['))
      .map((text, i) => ({ id: `line_${voice}_${moment}_${i + 1}`, text }))
  )
);

describe('table talk', () => {
  it('reads a word or a typed line, and drops what it cannot show', () => {
    expect(saidFrom({ seat: 'north', user_id: 'u1', item: 'word_nice' })).toEqual({
      seat: 'north',
      userId: 'u1',
      item: 'word_nice',
    });
    expect(saidFrom({ seat: 'east', user_id: 'u2', text: '  Bra spelat  ' })).toEqual({
      seat: 'east',
      userId: 'u2',
      text: 'Bra spelat',
    });
    // An item a newer server added is not shown as text.
    expect(saidFrom({ seat: 'east', user_id: 'u2', item: 'word_taunt' })).toBeNull();
    expect(saidFrom({ seat: 'middle', user_id: 'u2', item: 'word_nice' })).toBeNull();
    expect(saidFrom({ seat: 'east', item: 'word_nice' })).toBeNull();
    expect(saidFrom({ seat: 'east', user_id: 'u2', text: '   ' })).toBeNull();
  });

  // PID-408: a bot's line arrives where a person's word does, from `bot:<persona>`.
  it('reads a bot line or coin, and drops a line the contract does not list', () => {
    expect(
      saidFrom({ seat: 'east', user_id: 'bot:antti', item: 'line_teasing_five_caught_1' })
    ).toEqual({ seat: 'east', userId: 'bot:antti', item: 'line_teasing_five_caught_1' });
    expect(saidFrom({ seat: 'west', user_id: 'bot:gun', item: 'coin_heart' })).toEqual({
      seat: 'west',
      userId: 'bot:gun',
      item: 'coin_heart',
    });
    // One past a list's end, a voice nobody has, a moment nobody detects, no number.
    expect(
      saidFrom({ seat: 'east', user_id: 'bot:antti', item: 'line_teasing_hello_6' })
    ).toBeNull();
    expect(
      saidFrom({ seat: 'east', user_id: 'bot:antti', item: 'line_teasing_reply_game_4' })
    ).toBeNull();
    expect(
      saidFrom({ seat: 'east', user_id: 'bot:antti', item: 'line_grumpy_hello_1' })
    ).toBeNull();
    expect(
      saidFrom({ seat: 'east', user_id: 'bot:antti', item: 'line_teasing_trump_1' })
    ).toBeNull();
    expect(
      saidFrom({ seat: 'east', user_id: 'bot:antti', item: 'line_teasing_hello_0' })
    ).toBeNull();
    expect(saidFrom({ seat: 'east', user_id: 'bot:antti', item: 'line_teasing_hello' })).toBeNull();
    expect(saidFrom({ seat: 'east', user_id: 42, item: 'line_teasing_hello_1' })).toBeNull();
    expect(saidFrom({ seat: 'middle', user_id: 'bot:antti', item: 'line_dry_hello_1' })).toBeNull();
  });

  it('knows every line the contract lists, in its English, and nothing else', () => {
    expect(CONTRACT_LINES).toHaveLength(248);
    expect([...TALK_LINES].sort()).toEqual(CONTRACT_LINES.map(({ id }) => id).sort());
    for (const { id, text } of CONTRACT_LINES) {
      expect(saidFrom({ seat: 'north', user_id: 'bot:x', item: id })?.item).toBe(id);
      expect([id, catalogs.en[`talk.${id}`]]).toEqual([id, text]);
      // Swedish has its own words for every line, short enough for the seat's card.
      expect(catalogs.sv[`talk.${id}`]?.length ?? 0).toBeGreaterThan(0);
      expect([id, catalogs.sv[`talk.${id}`].length <= 26]).toEqual([id, true]);
    }
    const lines = (locale) =>
      Object.keys(catalogs[locale]).filter((key) => key.startsWith('talk.line_'));
    expect(lines('en')).toHaveLength(248);
    expect(lines('sv').sort()).toEqual(lines('en').sort());
  });

  // Quiet on a face hushes what that seat says: a person by account, a bot by persona.
  it('hushes a bot by the id its lines arrive with, and a person by their account', () => {
    const antti = saidFrom({ seat: 'north', user_id: 'bot:antti', item: 'line_teasing_hello_2' });
    expect(talker({ bot_persona: 'antti', playerId: null })).toBe(antti.userId);
    expect(talker({ bot_persona: 'antti', playerId: 'b-north' })).toBe('bot:antti');
    expect(talker({ bot_persona: null, playerId: 'p-west' })).toBe('p-west');
    // A seat a bot only holds for someone (no persona) has nothing to hush by.
    expect(talker({ bot_persona: null, playerId: null })).toBeNull();
  });

  it('counts the same coin again, and starts over for anything else', () => {
    const heart = { seat: 'south', userId: 'u', item: 'coin_heart' };
    const twice = land(land(undefined, heart, 1), heart, 2);
    expect(twice.count).toBe(2);
    expect(land(twice, heart, 3).count).toBe(3);
    expect(land(twice, { ...heart, item: 'coin_thumb' }, 3).count).toBe(1);
    // The same word twice is a word, not ×2.
    const nice = { ...heart, item: 'word_nice' };
    expect(land(land(undefined, nice, 1), nice, 2).count).toBe(1);
  });

  it('holds a word three seconds and a typed line longer, by length', () => {
    expect(landingMs({})).toBe(3_000);
    expect(landingMs({ text: 'x'.repeat(40) })).toBeGreaterThan(3_000);
    expect(landingMs({ text: 'x'.repeat(80) })).toBeGreaterThan(
      landingMs({ text: 'x'.repeat(40) })
    );
  });

  // PID-408: talk opens wherever someone else sits, bot or person; typing needs another person.
  it('talks wherever another seat is taken, and says whether a person sits there', () => {
    const seats = (...types) =>
      Object.fromEntries(
        ['north', 'east', 'south', 'west'].map((p, i) => [p, { occupant_type: types[i] }])
      );
    expect(talkTable(seats('human', 'bot', 'bot', 'bot'))).toBe('bots');
    expect(talkTable(seats('human', 'vacant', 'vacant', 'bot'))).toBe('bots');
    expect(talkTable(seats('human', 'vacant', 'human', 'bot'))).toBe('people');
    expect(talkTable(seats('human', 'vacant', 'vacant', 'vacant'))).toBeNull();
    expect(talkTable(seats('bot', 'bot', 'bot', 'bot'))).toBeNull();
    // Before the first readiness snapshot nothing talks.
    expect(talkTable(null)).toBeNull();
  });

  it('a seat a bot took leaves a bot table, though the readiness list still says human', () => {
    const list = {
      north: { occupant_type: 'human' },
      east: { occupant_type: 'human' },
      south: { occupant_type: 'vacant' },
      west: { occupant_type: 'vacant' },
    };
    const live = (a, b, c = 'permanent_bot') => ({
      north: { status: a },
      east: { status: b },
      south: { status: c },
      west: { status: 'vacant' },
    });
    expect(talkTable(list, live('normal', 'bot_substitute'))).toBe('bots');
    expect(talkTable(list, live('normal', 'reconnecting'))).toBe('people');
    expect(talkTable(list, live('normal', 'normal'))).toBe('people');
    expect(talkTable(list, live('normal', 'vacant', 'vacant'))).toBeNull();
  });

  it('lets adults type, asks guests to make an account, and tells a teen nothing', () => {
    expect(typingFor(true, false)).toBe('type');
    expect(typingFor(false, true)).toBe('guest');
    // A 13 to 17 has an account and does not read typed talk.
    expect(typingFor(false, false)).toBeNull();
    // The server's word wins over what the client believes about guests.
    expect(typingFor(true, true)).toBe('type');
    expect(typingFor(undefined, false)).toBeNull();
  });

  it('names the people seated with you who will not see typing, never bots or you', () => {
    const seats = {
      north: { occupant_type: 'human', reads_typed: true },
      east: { occupant_type: 'human', reads_typed: false },
      south: { occupant_type: 'human', reads_typed: false },
      west: { occupant_type: 'bot' },
    };
    expect(unreadBy(seats, 'south')).toEqual(['east']);
    expect(unreadBy(seats, 'east')).toEqual(['south']);
    expect(unreadBy({ ...seats, east: { occupant_type: 'vacant' } }, 'south')).toEqual([]);
    expect(unreadBy(null, 'south')).toEqual([]);
  });

  // PID-396: an upright bubble's tail says the offered word in the largest size its room holds.
  it('fits the offered word to the tail: body, then small, then two lines, else the bubble alone', () => {
    const nice = { body: 99, small: 87, two: 56 };
    expect(tailFit(99, nice)).toBe('body');
    expect(tailFit(98.5, nice)).toBe('small');
    expect(tailFit(87, nice)).toBe('small');
    expect(tailFit(86.5, nice)).toBe('two');
    expect(tailFit(56, nice)).toBe('two');
    // Too wide in every size: Thanks! on a 360pt phone.
    expect(tailFit(70, { body: 83, small: 72, two: 72 })).toBeNull();
    // Under 56pt even a word that would fit is left out.
    expect(tailFit(55.5, { body: 40, small: 36, two: 36 })).toBeNull();
  });

  it('breaks a word in two at the space nearest its middle', () => {
    expect(twoLines('Nice trick!')).toBe('Nice\ntrick!');
    expect(twoLines('ab cd efghijk lm')).toBe('ab cd\nefghijk lm');
    expect(twoLines('Thanks!')).toBe('Thanks!');
  });
});
