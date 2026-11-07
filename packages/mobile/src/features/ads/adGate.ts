import type { AdsState } from '@pidro/shared';
import type { RewardedResult } from './ads';

/** Where the player is when they tap Play: before a solo game, at an online table, or mid-game. */
export type AdContext = 'solo' | 'online' | 'mid-game';

/** The server says when; this only refuses to offer anywhere it must not. */
export function adGate({
  ads,
  premium,
  adsAvailable,
  context,
}: {
  ads?: AdsState;
  premium?: boolean;
  adsAvailable: boolean;
  context: AdContext;
}): 'deal' | 'offer' {
  if (premium || !adsAvailable || context !== 'solo') return 'deal';
  return ads?.eligible && ads.next_game_needs_ad ? 'offer' : 'deal';
}

/** What the server hears about an ad, and whether the cards are dealt. */
export function adOutcome(result: RewardedResult | 'closed'): {
  report: 'watched' | 'unavailable' | 'dismissed' | null;
  deal: boolean;
} {
  switch (result) {
    case 'earned':
      return { report: 'watched', deal: true };
    // An ad that cannot play never blocks a game.
    case 'unavailable':
      return { report: 'unavailable', deal: true };
    case 'dismissed':
      return { report: null, deal: false };
    case 'closed':
      return { report: 'dismissed', deal: false };
  }
}
