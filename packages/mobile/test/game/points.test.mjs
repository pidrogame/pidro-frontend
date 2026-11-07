import { describe, expect, it } from 'bun:test';
import { mapAbsoluteToRelative } from '@pidro/shared';
import { scoreFaces, whosePoints } from '../../src/features/game/points.ts';

describe('whose points they were', () => {
  it('is ours when we or our partner took it', () => {
    expect(whosePoints('south', 'south')).toEqual({ side: 'ours', column: 'us' });
    expect(whosePoints('north', 'south')).toEqual({ side: 'ours', column: 'us' });
    expect(whosePoints('west', 'east')).toEqual({ side: 'ours', column: 'us' });
  });

  it('is theirs when either opponent took it, whichever team we sit on', () => {
    expect(whosePoints('east', 'south')).toEqual({ side: 'theirs', column: 'them' });
    expect(whosePoints('west', 'north')).toEqual({ side: 'theirs', column: 'them' });
    expect(whosePoints('north', 'east')).toEqual({ side: 'theirs', column: 'them' });
  });

  it('takes no side for a spectator, landing in the winning team’s column', () => {
    expect(whosePoints('north', null)).toEqual({ side: 'neutral', column: 'us' });
    expect(whosePoints('east', null)).toEqual({ side: 'neutral', column: 'them' });
  });
});

describe('the faces under each score column (PID-383)', () => {
  const NAMES = { north: 'Nora', east: 'Eli', south: 'Sam', west: 'Wynn' };
  // The table as the store hands it over: each seat where the viewer sees it.
  const table = (viewer) =>
    Object.fromEntries(
      Object.entries(NAMES).map(([abs, name]) => [
        mapAbsoluteToRelative(abs, viewer ?? 'south'),
        { absolutePosition: abs, name },
      ])
    );
  const names = ({ us, them }) => ({
    us: us.map((seat) => seat?.name),
    them: them.map((seat) => seat?.name),
  });

  // You, then your partner across; then whoever sits on your left (the next
  // seat round, clockwise from above), then the one on your right.
  const expected = {
    north: { us: ['Nora', 'Sam'], them: ['Eli', 'Wynn'] },
    east: { us: ['Eli', 'Wynn'], them: ['Sam', 'Nora'] },
    south: { us: ['Sam', 'Nora'], them: ['Wynn', 'Eli'] },
    west: { us: ['Wynn', 'Eli'], them: ['Nora', 'Sam'] },
  };
  for (const [you, faces] of Object.entries(expected)) {
    it(`puts you and your partner under US, sitting ${you}`, () => {
      expect(names(scoreFaces(table(you), you))).toEqual(faces);
    });
  }

  it('draws the one on your left on your left', () => {
    for (const you of Object.keys(expected)) {
      const [left, right] = scoreFaces(table(you), you).them;
      expect(mapAbsoluteToRelative(left.absolutePosition, you)).toBe('west');
      expect(mapAbsoluteToRelative(right.absolutePosition, you)).toBe('east');
    }
  });

  it('gives a spectator N/S then E/W, in the order of the labels', () => {
    expect(names(scoreFaces(table(null), null))).toEqual({
      us: ['Nora', 'Sam'],
      them: ['Eli', 'Wynn'],
    });
  });

  it('leaves a gap for a seat the table does not have', () => {
    const seats = { ...table('south'), north: null };
    expect(names(scoreFaces(seats, 'south')).us).toEqual(['Sam', undefined]);
    expect(names(scoreFaces(seats, null)).us).toEqual([undefined, 'Sam']);
  });
});
