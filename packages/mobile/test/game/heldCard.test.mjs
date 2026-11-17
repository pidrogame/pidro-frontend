import { describe, expect, it } from 'bun:test';
import { retarget } from '../../src/features/game/heldCard.ts';

const inHand = 'hand:177.8:652.7:0:1.03:1';
const shifted = 'hand:150.2:652.7:0:1.03:1';
const onTable = 'played:201:553.4:0:0.89:1';

// Passes of the table over one sprite, keeping its target on record as the effect does.
function sprite(recorded) {
  return (signature, pressed, kind) => {
    const { move, record } = retarget({ recorded, signature, pressed, kind });
    if (record) recorded = signature;
    return move;
  };
}

describe('a finger on a card (PID-444)', () => {
  it('lets a card the play takes out of the hand go to the table on that pass', () => {
    const pass = sprite(inHand);
    expect(pass(onTable, true, 'played')).toBe(true);
    expect(pass(onTable, false, 'played')).toBe(false);
  });

  it('holds a hand card whose place changes, and moves it on the next pass once the finger is gone', () => {
    const pass = sprite(inHand);
    expect(pass(shifted, true, 'hand')).toBe(false);
    expect(pass(shifted, false, 'hand')).toBe(true);
    expect(pass(shifted, false, 'hand')).toBe(false);
  });

  it('moves nothing whose target is unchanged, finger or not', () => {
    for (const [signature, kind] of [
      [inHand, 'hand'],
      [onTable, 'played'],
    ])
      for (const pressed of [false, true])
        expect(sprite(signature)(signature, pressed, kind)).toBe(false);
  });

  it('moves a new sprite, which has nothing on record', () => {
    expect(sprite(undefined)(onTable, false, 'played')).toBe(true);
  });
});
