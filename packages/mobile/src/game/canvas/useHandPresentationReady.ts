import { useEffect, useState } from 'react';
import type { CardTextures } from './cardTextures';
import type { TableCard } from './tableModel';
import {
  DEAL_ACTION_REVEAL_BUFFER_MS,
  dealAnimationDurationMs,
  HAND_PRESENTATION_TIMEOUT_MS,
} from './animationTiming';

/**
 * Coordinates action overlays with the visual hand. A live empty-to-dealt
 * transition waits for the staggered deal to finish, while a reconnect that
 * mounts with an existing hand is immediately eligible once its faces load.
 */
export function useHandPresentationReady(
  hand: TableCard[],
  textures: CardTextures,
  active = true
): boolean {
  const [presentation, setPresentation] = useState(() => ({
    active,
    hasHand: hand.length > 0,
    dealCardCount: hand.length,
    dealSettled: hand.length > 0,
    fallbackReady: false,
  }));
  const hasHand = hand.length > 0;

  if (presentation.active !== active) {
    setPresentation({
      active,
      hasHand,
      dealCardCount: hand.length,
      dealSettled: !active || hasHand,
      fallbackReady: false,
    });
  } else if (presentation.hasHand !== hasHand) {
    setPresentation({
      ...presentation,
      hasHand,
      dealCardCount: hand.length,
      dealSettled: !presentation.active || presentation.fallbackReady,
    });
  }

  useEffect(() => {
    if (!presentation.active || !presentation.hasHand || presentation.dealSettled) return;

    const timer = setTimeout(
      () => {
        setPresentation((current) =>
          current.active && current.hasHand && current.dealCardCount === presentation.dealCardCount
            ? { ...current, dealSettled: true }
            : current
        );
      },
      dealAnimationDurationMs(presentation.dealCardCount) + DEAL_ACTION_REVEAL_BUFFER_MS
    );
    return () => clearTimeout(timer);
  }, [presentation]);

  useEffect(() => {
    if (!presentation.active || presentation.fallbackReady) return;

    const timer = setTimeout(() => {
      setPresentation((current) =>
        current.active &&
        current.hasHand === presentation.hasHand &&
        current.dealCardCount === presentation.dealCardCount
          ? { ...current, fallbackReady: true }
          : current
      );
    }, HAND_PRESENTATION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [
    presentation.active,
    presentation.dealCardCount,
    presentation.fallbackReady,
    presentation.hasHand,
  ]);

  // Where the larger faces load (PID-467), your hand waits for them too.
  const facesReady =
    hand.length > 0 &&
    hand.every(
      (card) =>
        textures.get(card.textureKey) != null &&
        (!textures.large || textures.get(card.textureKey, true) != null)
    );
  return (
    !active ||
    (presentation.active === active &&
      (presentation.fallbackReady || (presentation.dealSettled && facesReady)))
  );
}
