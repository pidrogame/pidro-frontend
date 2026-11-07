import { describe, expect, it } from 'bun:test';
import { whosePoints } from '../../src/features/game/points.ts';

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
