import { expect, test } from 'bun:test';
import { settleFonts } from '../src/features/fonts.ts';

const fonts = { BreeSerif: 1, 'Nunito-Bold': 2, 'Nunito-Black': 3 };

/** expo-font's loader: a family in flight hands back its load; anything else starts a new one. */
function loader(inFlight) {
  const started = [];
  return {
    started,
    isLoading: (name) => name in inFlight,
    loadAsync: (name) => {
      if (name in inFlight) return inFlight[name].promise;
      started.push(name);
      return Promise.resolve();
    },
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => ((resolve = yes), (reject = no)));
  return { promise, resolve, reject };
}

test('after a failure it waits for the fonts still loading, and never loads the failed one again', async () => {
  // BreeSerif loaded, Nunito-Bold failed, Nunito-Black is still on its way.
  const black = deferred();
  const fonts$ = loader({ 'Nunito-Black': black });
  let settled = false;
  const settling = settleFonts(fonts, fonts$).then(() => (settled = true));

  await Promise.resolve();
  expect(settled).toBe(false);
  black.resolve();
  await settling;
  expect(settled).toBe(true);
  expect(fonts$.started).toEqual([]);
});

test('a second font failing on its way still lets the app start', async () => {
  const black = deferred();
  const settling = settleFonts(fonts, loader({ 'Nunito-Black': black }));
  const failure = new Error('Nunito-Black did not load');
  black.reject(failure);
  // It is handed back, so it is reported too: the first failure alone hides it.
  expect(await settling).toEqual([failure]);
});

test('with nothing left loading it settles at once and loads nothing', async () => {
  const fonts$ = loader({});
  expect(await settleFonts(fonts, fonts$)).toEqual([]);
  expect(fonts$.started).toEqual([]);
});
