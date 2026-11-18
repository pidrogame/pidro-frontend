import { describe, expect, it } from 'bun:test';
import { cardUnder } from '../../src/features/game/handTap.ts';

// A hand of cards 60 wide on a 40 step: each card's left 20 lies under the next.
// Playable cards stand 20 higher than the rest.
const card = (i, raised) => ({ key: `c${i}`, x: 100 + i * 40, y: raised ? 480 : 500, w: 60, h: 84 });
const under = (playable, unplayable, x, y) => cardUnder(playable, unplayable, x, y)?.key ?? null;

describe('the hand card under a finger (PID-461)', () => {
  // Trumps first and raised (0 to 2), then the side cards dimmed (3, 4).
  const playable = [0, 1, 2].map((i) => card(i, true));
  const unplayable = [3, 4].map((i) => card(i, false));

  it('is the dimmed card where its rank lies over the raised card before it', () => {
    // Card 3's left strip, x 190 to 210, where card 2 also reaches (it ends at 210).
    expect(under(playable, unplayable, 195, 470)).toBe('c3');
  });

  it('is the raised card above the dimmed one, and on its own visible part', () => {
    // Above card 3's top edge (458) but on card 2, which reaches up to 438.
    expect(under(playable, unplayable, 200, 445)).toBe('c2');
    expect(under(playable, unplayable, 175, 470)).toBe('c2');
  });

  it('is the next card where raised cards overlap, as among cards at rest', () => {
    expect(under(playable, unplayable, 120, 480)).toBe('c1');
  });

  it('gives a near miss to a playable card before an unplayable one', () => {
    // 3 below card 2's bottom edge (522) and inside card 3: card 3 is hit.
    expect(under(playable, unplayable, 195, 525)).toBe('c3');
    // Left of the hand, near card 0 only.
    expect(under(playable, unplayable, 66, 480)).toBe('c0');
    // Right of card 2 and above card 3, near both: the playable card.
    expect(under(playable, unplayable, 212, 454)).toBe('c2');
    expect(under(playable, unplayable, 300, 480)).toBe(null);
  });

  it('keeps a playable card in the middle of dimmed ones reachable, and theirs readable', () => {
    const five = [card(2, true)];
    const rest = [0, 1, 3, 4].map((i) => card(i, false));
    expect(under(five, rest, 155, 470)).toBe('c2');
    expect(under(five, rest, 155, 450)).toBe('c2');
    expect(under(five, rest, 145, 470)).toBe('c1');
    expect(under(five, rest, 195, 470)).toBe('c3');
  });
});
