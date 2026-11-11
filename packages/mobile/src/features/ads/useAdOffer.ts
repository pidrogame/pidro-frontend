import { useEffect, useRef, useState } from 'react';
import { adsApi } from '@/api/ads';
import { getMe } from '@/api/auth';
import { authStore } from '@/stores/auth';
import { adGate, adOutcome, type AdContext } from './adGate';
import {
  adsAvailable,
  ensureAdsConsent,
  loadRewarded,
  resetAds,
  showRewarded,
  startAds,
  type RewardedResult,
} from './ads';

export type AdSheetPhase = 'loading' | 'offer' | 'dismissed' | 'unavailable';
type Deal = () => Promise<void>;

const phases: AdSheetPhase[] = ['loading', 'offer', 'dismissed', 'unavailable'];

/** `?fixture=ad-offer` and friends open the sheet in that state. */
export function adSheetFixture(fixture?: string): AdSheetPhase | null {
  const phase = fixture?.startsWith('ad-') ? (fixture.slice(3) as AdSheetPhase) : null;
  return phase && phases.includes(phase) ? phase : null;
}

// Fresh from the server at each tap: a game or a purchase since the last read changes the answer.
async function refreshAds() {
  const before = authStore.getState();
  const me = await getMe().catch(() => null);
  const current = authStore.getState();
  if (!me || !current.user || !current.accessToken || current.user.id !== before.user?.id)
    return current.user;
  const user = { ...current.user, ads: me.ads, premium: me.premium };
  current.setSession({
    accessToken: current.accessToken,
    refreshToken: current.refreshToken ?? undefined,
    user,
  });
  return user;
}

/**
 * Before some solo games the server asks for a short ad (PID-120). `play` deals or opens the
 * sheet; the sheet gathers Google's consent first (PID-119), loads the ad while it shows, and
 * deals once the ad is watched or cannot play.
 */
export function useAdOffer(context: AdContext, fixture: AdSheetPhase | null = null) {
  const [phase, setPhase] = useState<AdSheetPhase | null>(fixture);
  const [ready, setReady] = useState(fixture !== null && fixture !== 'loading');
  const [busy, setBusy] = useState(fixture === 'unavailable');
  const deal = useRef<Deal>(async () => {});
  // Each open sheet is a session; anything still in flight from a closed one is dropped.
  const session = useRef(0);
  const dealing = useRef(false);

  // Another account, or none: an ad loaded for the last one is never shown.
  const userId = authStore((state) => state.user?.id);
  useEffect(
    () => () => {
      session.current += 1;
      resetAds();
    },
    [userId]
  );

  const finish = async (result: RewardedResult | 'closed', id: number) => {
    if (id !== session.current) return;
    const outcome = adOutcome(result);
    const reported = outcome.report ? adsApi[outcome.report]().catch(() => undefined) : null;
    if (result === 'closed') {
      session.current += 1;
      resetAds();
      setPhase(null);
      return;
    }
    if (!outcome.deal) {
      setPhase('dismissed');
      void load(id);
      return;
    }
    if (result === 'unavailable') setPhase((open) => open && 'unavailable');
    setBusy(true);
    // The credit must be on the server before the room is asked for.
    await reported;
    dealing.current = true;
    try {
      await deal.current();
    } finally {
      dealing.current = false;
      if (id === session.current) {
        session.current += 1;
        setPhase(null);
      }
      setBusy(false);
    }
  };

  const load = async (id: number) => {
    setReady(false);
    const loaded = (await startAds()) === 'started' ? await loadRewarded() : 'unavailable';
    if (id !== session.current) return;
    if (loaded === 'unavailable') return finish('unavailable', id);
    setReady(true);
  };

  const open = async (next: Deal) => {
    deal.current = next;
    const id = ++session.current;
    setBusy(true);
    // Before the sheet: on iOS Google's form cannot present over an open Modal.
    const consent = await ensureAdsConsent();
    if (id !== session.current) return;
    if (!consent) return finish('unavailable', id);
    setBusy(false);
    setReady(false);
    setPhase('loading');
    void load(id);
  };

  /** Tapping Play: deal, or offer the ad when the server says this game needs one. */
  const play = async (next: Deal) => {
    if (busy) return;
    setBusy(true);
    const user = context === 'solo' ? await refreshAds() : authStore.getState().user;
    setBusy(false);
    const gate = adGate({ ...user, adsAvailable: adsAvailable(), context });
    if (gate === 'offer') return open(next);
    if (!user?.ads?.eligible) resetAds();
    return next();
  };

  /** The server answered 402 AD_REQUIRED. False when it did so right after an ad: show an error. */
  const required = (next: Deal) => {
    if (dealing.current) return false;
    if (adsAvailable()) void open(next);
    else {
      deal.current = next;
      void finish('unavailable', ++session.current);
    }
    return true;
  };

  const watch = async () => {
    const id = session.current;
    setReady(false);
    return finish(await showRewarded(), id);
  };

  return {
    play,
    required,
    busy,
    sheet: {
      phase,
      ready,
      // Only while the cards are being dealt: the sheet opens with busy already false.
      dealing: busy,
      onWatch: () => void watch(),
      onClose: () => void finish('closed', session.current),
      // Premium bought from the sheet: ask again, and the server no longer wants an ad.
      onDeal: () => void play(deal.current),
    },
  };
}
