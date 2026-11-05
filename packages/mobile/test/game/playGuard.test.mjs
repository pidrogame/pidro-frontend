import { describe, expect, it } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { PLAY_SETTLE_MS, playHoldUntil, usePlayGuard } from '../../src/game/usePlayGuard.ts';
import { gameDiagnostics } from '../../src/diagnostics/buffer.ts';
import { cardTap } from '../../src/diagnostics/actions.ts';

describe('card play guard', () => {
  it('holds taps for a moment after the hand settles', () => {
    expect(playHoldUntil(1_000, null)).toBe(1_000 + PLAY_SETTLE_MS);
  });

  it("holds taps for the dealer's rob, bounded by its own length", () => {
    const rob = { started_at_ms: 50_000, ends_at_ms: 53_500 };
    expect(playHoldUntil(1_000, rob)).toBe(1_000 + 3_500 + PLAY_SETTLE_MS);
    expect(playHoldUntil(1_000, { started_at_ms: 9, ends_at_ms: 3 })).toBe(1_000 + PLAY_SETTLE_MS);
  });

  it('records a real unready-hand guard without reaching the play callback or storing the card', () => {
    gameDiagnostics.identify('guard-test', 'TEST');
    gameDiagnostics.observe({ game_instance_id: 'guard-instance', state_revision: 6 });
    let calls = 0;
    let play;
    let reason;
    function Hand() {
      play = usePlayGuard(
        () => calls++,
        { presentation: null, handReady: false },
        (blocked) => {
          reason = blocked;
        }
      );
      return null;
    }
    renderToString(createElement(Hand));
    cardTap(() => play({ rank: 14, suit: 'spades' }));
    const events = gameDiagnostics.snapshot().events.slice(1);
    expect(calls).toBe(0);
    expect(reason).toBe('pending');
    expect(events.map(({ type, code }) => [type, code])).toEqual([
      ['tap', 'pending'],
      ['blocked', 'pending'],
    ]);
    expect(events[0].action_id).toBe(events[1].action_id);
    expect(JSON.stringify(events)).not.toContain('spades');
    gameDiagnostics.identify(null, null);
  });
});
