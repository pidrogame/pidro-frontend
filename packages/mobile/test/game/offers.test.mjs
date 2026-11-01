import { describe, expect, it } from 'bun:test';
import {
  FRESH_PACE,
  answered,
  ignored,
  mayOffer,
  momentOffer,
  offered,
  replyOffer,
} from '../../src/features/game/offers.ts';

describe('what the band offers', () => {
  it('reads the three moments and nothing else', () => {
    expect(momentOffer('partner_trick')).toEqual({
      words: ['word_nice'],
      coins: ['coin_heart', 'coin_thumb'],
    });
    expect(momentOffer('start').words).toEqual(['word_hello', 'word_luck']);
    expect(momentOffer('start').coins).toEqual([]);
    expect(momentOffer('game_end')).toEqual({ words: ['word_game'], coins: ['coin_heart'] });
    expect(momentOffer('someone_slow')).toBeNull();
    expect(momentOffer(undefined)).toBeNull();
    expect(momentOffer('toString')).toBeNull();
  });

  it('answers praise with thanks, sorry with no worries, a greeting with itself', () => {
    const answer = (item) => replyOffer({ item })?.words[0];
    expect(answer('word_nice')).toBe('word_thanks');
    expect(answer('word_well')).toBe('word_thanks');
    expect(answer('word_bid')).toBe('word_thanks');
    expect(answer('word_sorry')).toBe('word_noworries');
    expect(answer('word_hello')).toBe('word_hello');
    expect(answer('word_luck')).toBe('word_luck');
    // Thanks and no worries close a conversation; faces and typed lines need no answer.
    expect(replyOffer({ item: 'word_thanks' })).toBeNull();
    expect(replyOffer({ item: 'word_noworries' })).toBeNull();
    expect(replyOffer({ item: 'coin_heart' })).toBeNull();
    expect(replyOffer({ text: 'Bra spelat' })).toBeNull();
  });
});

describe('how often the band offers', () => {
  const at = (trick, hand = 1, bidding = false) => ({ trick, hand, bidding });

  const thanks = replyOffer({ item: 'word_nice' });
  const hello = momentOffer('start');

  it('offers at most once a trick, and only greetings while bidding', () => {
    let pace = FRESH_PACE;
    expect(mayOffer(pace, at('1:0', 1, true), thanks)).toBe(false);
    expect(mayOffer(pace, at('1:0', 1, true), replyOffer({ item: 'word_luck' }))).toBe(true);
    expect(mayOffer(pace, at('1:0', 1, true), hello)).toBe(true);
    expect(mayOffer(pace, at('1:0'), thanks)).toBe(true);
    pace = offered(pace, '1:0');
    expect(mayOffer(pace, at('1:0'), thanks)).toBe(false);
    expect(mayOffer(pace, at('1:0', 1, true), hello)).toBe(false);
    expect(mayOffer(pace, at('1:1'), thanks)).toBe(true);
  });

  it('waits for the end of the hand after three ignored, then offers again', () => {
    let pace = FRESH_PACE;
    for (const trick of ['2:0', '2:1']) pace = ignored(offered(pace, trick), 2);
    expect(mayOffer(pace, at('2:2', 2), thanks)).toBe(true);
    pace = ignored(offered(pace, '2:2'), 2);
    expect(mayOffer(pace, at('2:3', 2), thanks)).toBe(false);
    expect(mayOffer(pace, at('2:8', 2), thanks)).toBe(false);
    expect(mayOffer(pace, at('3:0', 3), thanks)).toBe(true);
  });

  it('counts only offers ignored in a row', () => {
    let pace = FRESH_PACE;
    pace = ignored(offered(pace, '1:0'), 1);
    pace = ignored(offered(pace, '1:1'), 1);
    pace = answered(offered(pace, '1:2'));
    pace = ignored(offered(pace, '1:3'), 1);
    expect(mayOffer(pace, at('1:4'), thanks)).toBe(true);
  });
});
