import { expect, mock, test } from 'bun:test';

// The flow end to end over a mocked adapter and API: what the server hears, in what order,
// and whether the cards are dealt. Module mocks would leak, so it runs in a child.
test('the ad flow reports each outcome before it deals, and never blocks a game', async () => {
  if (!process.env.AD_OFFER_CHILD) {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, AD_OFFER_CHILD: '1' },
    });
    expect(child.stderr.toString()).not.toContain('(fail)');
    expect(child.exitCode).toBe(0);
    return;
  }
  const { JSDOM } = await import('jsdom');
  const { act, createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { create } = await import('zustand');
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    __DEV__: false,
  });

  const due = { eligible: true, next_game_needs_ad: true, games_until_ad: 0, free_games_left: 0 };
  let log = [];
  let me = { id: 'u1', username: 'bengt', ads: due, premium: false };
  let world;
  const reset = (change = {}) => {
    log = [];
    world = {
      available: true,
      consent: true,
      load: 'loaded',
      show: ['earned'],
      ...change,
    };
  };
  const auth = create((set) => ({
    user: { id: 'u1', username: 'bengt' },
    accessToken: 'token',
    refreshToken: null,
    setSession: ({ user }) => set({ user }),
  }));
  mock.module('@/stores/auth', () => ({ authStore: auth }));
  mock.module('@/api/auth', () => ({
    getMe: async () => {
      log.push('me');
      return me;
    },
  }));
  mock.module('@/api/ads', () => ({
    adsApi: Object.fromEntries(
      ['watched', 'unavailable', 'dismissed'].map((name) => [
        name,
        // Answers after a moment, like the network: a deal that does not wait shows up first.
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          log.push(`report:${name}`);
        },
      ])
    ),
  }));
  mock.module('../../src/features/ads/ads.ts', () => ({
    adsAvailable: () => world.available,
    ensureAdsConsent: async () => (log.push('consent'), world.consent),
    startAds: async () => (log.push('start'), 'started'),
    loadRewarded: () => (log.push('load'), world.load),
    showRewarded: async () => (log.push('show'), world.show.shift()),
    resetAds: () => log.push('reset'),
  }));
  const { useAdOffer } = await import('../../src/features/ads/useAdOffer.ts');

  let offer;
  const Harness = () => {
    offer = useAdOffer('solo');
    return null;
  };
  const root = createRoot(document.getElementById('root'));
  await act(() => root.render(h(Harness)));
  const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const deal = async () => void log.push('deal');
  const play = async () => {
    await act(async () => void offer.play(deal));
    await settle();
  };

  // Not eligible, or nothing due: straight to the cards, after a fresh /me.
  reset();
  me = { ...me, ads: { ...due, eligible: false } };
  await play();
  expect(log).toEqual(['me', 'reset', 'deal']);
  expect(auth.getState().user.ads.eligible).toBe(false);
  expect(offer.sheet.phase).toBeNull();

  // Premium: no offer even with an ad marked due.
  reset();
  me = { ...me, ads: due, premium: true };
  await play();
  expect(log).toEqual(['me', 'deal']);

  // Due: consent first (no sheet over Google's form), then the sheet while the ad loads.
  reset();
  me = { ...me, premium: false };
  await play();
  expect(log).toEqual(['me', 'consent', 'start', 'load']);
  expect(offer.sheet).toMatchObject({ phase: 'loading', ready: true, dealing: false });
  // Watched to the end: the credit reaches the server before the room is asked for.
  await act(async () => offer.sheet.onWatch());
  await settle();
  expect(log.slice(4)).toEqual(['show', 'report:watched', 'deal']);
  expect(offer.sheet.phase).toBeNull();

  // Closed early: nothing reported, the sheet stays and loads another; closing reports it.
  reset({ show: ['dismissed'] });
  await play();
  await act(async () => offer.sheet.onWatch());
  await settle();
  expect(offer.sheet.phase).toBe('dismissed');
  expect(log.slice(4)).toEqual(['show', 'start', 'load']);
  await act(async () => offer.sheet.onClose());
  await settle();
  expect(log.slice(7)).toEqual(['reset', 'report:dismissed']);
  expect(offer.sheet.phase).toBeNull();

  // No fill (or a 15 s timeout): reported as unavailable, then dealt without a tap.
  reset({ load: 'unavailable' });
  await play();
  expect(log).toEqual(['me', 'consent', 'start', 'load', 'report:unavailable', 'deal']);
  expect(offer.sheet.phase).toBeNull();

  // Consent refused: no sheet at all, and the game is dealt.
  reset({ consent: false });
  let phases = [];
  const watchPhase = () => phases.push(offer.sheet.phase);
  await act(async () => void offer.play(deal));
  watchPhase();
  await settle();
  expect(log).toEqual(['me', 'consent', 'report:unavailable', 'deal']);
  expect(phases).toEqual([null]);

  // The ad fails to show after a tap: unavailable, dealt.
  reset({ show: ['unavailable'] });
  await play();
  await act(async () => offer.sheet.onWatch());
  await settle();
  expect(log.slice(4)).toEqual(['show', 'report:unavailable', 'deal']);

  // Closing while the ad is still loading: no deal later, and the late ad is dropped.
  reset();
  let finishLoad;
  world.load = new Promise((resolve) => (finishLoad = resolve));
  await play();
  await act(async () => offer.sheet.onClose());
  await act(async () => finishLoad('loaded'));
  await settle();
  expect(log).toEqual(['me', 'consent', 'start', 'load', 'reset', 'report:dismissed']);
  expect(offer.sheet.phase).toBeNull();

  // 402 AD_REQUIRED (an old /me, a race): the sheet opens.
  reset();
  me = { ...me, ads: { ...due, next_game_needs_ad: false } };
  let refused = 0;
  const refusingDeal = async () => {
    log.push('deal');
    if (refused++ === 0) log.push(offer.required(refusingDeal) ? 'handled' : 'error');
  };
  await act(async () => void offer.play(refusingDeal));
  await settle();
  expect(log).toEqual(['me', 'deal', 'consent', 'handled', 'start', 'load']);
  expect(offer.sheet.phase).toBe('loading');
  await act(async () => offer.sheet.onClose());
  await settle();

  // A 402 right after an ad is an error, not a second sheet.
  reset();
  me = { ...me, ads: due };
  const alwaysRefused = async () => {
    log.push('deal');
    log.push(offer.required(alwaysRefused) ? 'handled' : 'error');
  };
  await act(async () => void offer.play(alwaysRefused));
  await settle();
  await act(async () => offer.sheet.onWatch());
  await settle();
  expect(log).toEqual([
    'me',
    'consent',
    'start',
    'load',
    'show',
    'report:watched',
    'deal',
    'error',
  ]);

  // No ads in this build (web, Expo Go) and the server still says 402: unavailable, dealt again.
  reset({ available: false });
  refused = 0;
  await act(async () => void offer.play(refusingDeal));
  await settle();
  expect(log).toEqual(['me', 'deal', 'handled', 'report:unavailable', 'deal']);
  expect(offer.sheet.phase).toBeNull();

  await act(() => root.render(null));
});
