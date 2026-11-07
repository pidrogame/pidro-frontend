import { expect, test } from 'bun:test';
import {
  FOREGROUND_PRESENTATION,
  handlePushResponse,
} from '../../src/features/push/handlePushResponse';

function tap(data) {
  const opened = [];
  handlePushResponse(
    { notification: { request: { content: { data } } } },
    {
      route: (path) => opened.push(['route', path]),
      url: async (url) => opened.push(['url', url]),
    }
  );
  return opened;
}

test('a tap opens an in-app path with the router and anything else with the system', () => {
  expect(tap({ url: '/play/kalle-42' })).toEqual([['route', '/play/kalle-42']]);
  expect(tap({ url: 'https://pidro.online/news/7' })).toEqual([
    ['url', 'https://pidro.online/news/7'],
  ]);
  // Another site without a scheme is not a path in the app.
  expect(tap({ url: '//evil.example/play' })).toEqual([['url', '//evil.example/play']]);
  expect(tap({ url: 'pidro-mobile-beta://friends' })).toEqual([
    ['url', 'pidro-mobile-beta://friends'],
  ]);
});

test('a notification without a link only opens the app', () => {
  for (const data of [undefined, {}, { url: '' }, { url: 42 }, { link: '/play/x' }]) {
    expect(tap(data)).toEqual([]);
  }
});

test('in the foreground a notification is a banner without sound or badge', () => {
  expect(FOREGROUND_PRESENTATION).toEqual({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  });
});
