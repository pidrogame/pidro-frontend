import { useCallback, useEffect, useRef } from 'react';
import type { Card, DealerRobPresentation } from '@/types/game';
import { blockedPlay } from '@/diagnostics/actions';

/** A tap this soon after the table settles was aimed at what was there before. */
export const PLAY_SETTLE_MS = 500;

/**
 * When a card tap may play. The server already counts your turn while the
 * table is still showing the dealer's rob or dealing your new hand, so a tap
 * meant to look closer (or to "acknowledge" the new hand) used to play the
 * card. Taps then do nothing, until the rob's own time is up and the hand
 * has been settled for a moment. Bounded by the presentation's length, so a
 * stale presentation can never lock the hand.
 */
export function playHoldUntil(
  now: number,
  presentation: Pick<DealerRobPresentation, 'started_at_ms' | 'ends_at_ms'> | null
): number {
  if (!presentation) return now + PLAY_SETTLE_MS;
  return now + Math.max(0, presentation.ends_at_ms - presentation.started_at_ms) + PLAY_SETTLE_MS;
}

export function usePlayGuard(
  play: (card: Card) => unknown,
  { presentation, handReady }: { presentation: DealerRobPresentation | null; handReady: boolean },
  onBlocked?: (reason: string) => void
): (card: Card) => void {
  const holdUntil = useRef(0);
  const ready = useRef(handReady);
  const robStart = presentation?.started_at_ms ?? null;
  const robEnd = presentation?.ends_at_ms ?? null;

  useEffect(() => {
    if (robStart == null || robEnd == null) return;
    holdUntil.current = Math.max(
      holdUntil.current,
      playHoldUntil(Date.now(), { started_at_ms: robStart, ends_at_ms: robEnd })
    );
  }, [robStart, robEnd]);

  useEffect(() => {
    ready.current = handReady;
    if (handReady) holdUntil.current = Math.max(holdUntil.current, playHoldUntil(Date.now(), null));
  }, [handReady]);

  return useCallback(
    (card: Card) => {
      if (!ready.current || Date.now() < holdUntil.current) {
        blockedPlay('pending');
        onBlocked?.('pending');
        return;
      }
      void play(card);
    },
    [play, onBlocked]
  );
}
