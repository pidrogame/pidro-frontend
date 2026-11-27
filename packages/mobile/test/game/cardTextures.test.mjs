import { describe, expect, test } from 'bun:test';

// Loads cardTextures on a mocked screen, in its own process so the native
// mocks never reach other tests, and reports what it decoded there and what
// `probe` (evaluated with the module as `t`) returns.
function onScreen(width, height, scale, probe = 'null') {
  const result = Bun.spawnSync(
    [
      process.execPath,
      '--loader',
      '.png:file',
      '-e',
      `
      import { mock } from 'bun:test';
      const decoded = [];
      mock.module('react-native', () => ({
        Platform: { OS: 'ios' },
        Dimensions: { get: () => ({ width: ${width}, height: ${height} }) },
        PixelRatio: { get: () => ${scale} },
      }));
      mock.module('@shopify/react-native-skia', () => ({
        loadData: async (source, factory) => {
          decoded.push(String(source));
          return factory(source);
        },
        Skia: { Image: { MakeImageFromEncoded: (source) => ({ source }) } },
      }));
      const t = await import('./src/game/canvas/cardTextures.ts');
      await t.preloadCardTextures();
      const faces = decoded.filter((s) => /(spades|hearts|diamonds|clubs)_\\d+/.test(s));
      console.log(JSON.stringify({
        faces: faces.length,
        larger: faces.filter((s) => s.includes('cards-2x/')).length,
        probe: ${probe},
      }));
      `,
    ],
    {
      cwd: `${import.meta.dir}/../..`,
      // Nothing from a developer's shell reaches the mocked screen.
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return JSON.parse(result.stdout.toString().trim().split('\n').pop());
}

const catmullRom = { B: 0, C: 0.5 };
const mitchell = { B: 1 / 3, C: 1 / 3 };
const queen = "{ suit: 'spades', rank: 12 }";
// Which file a face drawn beside the canvas (laid down, thrown) takes.
const art = (px) => `String(t.faceImage(${queen}, ${px})).split('/').slice(-2).join('/')`;

describe('card face art (PID-467)', () => {
  test('an iPhone at 3× loads both sets; a card takes the larger art from 168px at rest', () => {
    const iphone = onScreen(
      390,
      844,
      3,
      `[
        [168, 167.9, 187, 246, 268.7, 268.8, 300].map((px) => t.largeFaceSampling(true, px)),
        t.largeFaceSampling(false, 300),
        [${art(187)}, ${art(167)}],
      ]`
    );
    // A 62.4pt hand card is 187px upright.
    expect(iphone.faces).toBe(104);
    expect(iphone.larger).toBe(52);
    const [sampling, notLoaded, faces] = iphone.probe;
    // null is today's art: under 168px, and the trick's 167px on this iPhone.
    // From 0.8 of 336px (268.8) the tablet hand's Catmull-Rom; Mitchell below.
    expect(sampling).toEqual([
      mitchell,
      null,
      mitchell,
      mitchell,
      mitchell,
      catmullRom,
      catmullRom,
    ]);
    expect(notLoaded).toBeNull();
    // Your laid-down Q♠ at the hand's 187px; an opponent's at the trick's 167px.
    expect(faces).toEqual(['cards-2x/spades_12.png', 'cards/spades_12.png']);
  });

  test('tablets at 2× load both sets, upright and on their side', () => {
    // 300px upright (800×1280), 242px on its side (1024×768).
    expect(onScreen(800, 1280, 2).larger).toBe(52);
    expect(onScreen(1024, 768, 2).larger).toBe(52);
  });

  test("a 2× phone with small cards loads only today's set, and draws only today's art", () => {
    // 360×720 @2: 115px upright, 108px on its side.
    const small = onScreen(360, 720, 2, `[${art(300)}, t.largeFaces(720, 360, 2)]`);
    expect(small).toEqual({ faces: 52, larger: 0, probe: ['cards/spades_12.png', false] });
    expect(onScreen(375, 667, 2).larger).toBe(0);
  });

  test('the rule reads both orientations and the exact 168px line', () => {
    expect(
      onScreen(
        390,
        844,
        2,
        `[
          t.largeFaces(390, 844, 2), t.largeFaces(844, 390, 3),
          // A 1× tablet draws its 150pt hand card at 150px: today's art.
          t.largeFaces(800, 1280, 1),
          // 360×780 @3 (57.6pt): 172.8px, just over the line.
          t.largeFaces(360, 780, 3),
        ]`
      ).probe
    ).toEqual([false, true, false, true]);
  });
});
