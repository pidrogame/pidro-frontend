import { describe, expect, test } from 'bun:test';
import { listGrammar, selectChecks, SMOKE, tableJourneys } from '../../scripts/ci-affected.mjs';

const cases = listGrammar('--list-cases');
const ids = listGrammar('--list');
const base = '283e333c0000000000000000000000000000beef';
const journeys = tableJourneys();
const select = (...files) => selectChecks({ base, files, cases, ids, journeys });
const casesOn = (prefix) =>
  cases.filter(({ path }) => path.startsWith(prefix)).map(({ name }) => name);

describe('what a push runs', () => {
  test('a table change runs the table cases on one viewport per layout, the smoke set, Game e2e and the table journeys', () => {
    const run = select('packages/mobile/src/game/canvas/layout.ts');
    expect(run.full).toBe(false);
    expect(run.cases).toEqual(expect.arrayContaining([...casesOn('/table-dev'), ...SMOKE]));
    // The lobby it shares code with: its smoke screen, not every lobby case.
    expect(run.cases).not.toContain('lobby-open');
    expect(run.cases).not.toContain('new-table-setup');
    expect(run.cases).not.toContain('settings');
    expect(run.viewports).toEqual(
      expect.arrayContaining([
        'portrait',
        'compact-portrait',
        'small-landscape',
        'android-landscape',
        'tablet-landscape',
      ])
    );
    expect(run.viewports).not.toContain('landscape');
    expect(run.screens).toBeLessThan(ids.length / 4);
    expect(run.game).toBe(true);
    expect(run.accounts).toBe(true);
    expect(run.journeys).toEqual(
      expect.arrayContaining([
        'specs/leaving-a-table-goes-back-to-the-lobby.spec.ts',
        'specs/louisiana-table-shows-its-rules.spec.ts',
        'specs/invite-survives-sign-in.spec.ts',
      ])
    );
    expect(run.journeys).not.toContain('specs/sign-in.spec.ts');
    expect(run.shards.filter(({ partition }) => !partition).map(({ shard }) => shard)).toEqual([
      'table-behavior',
      'seats-and-game-over',
    ]);
  });

  test('a table change with anything else runs every viewport and every journey', () => {
    const run = select(
      'packages/mobile/src/game/canvas/layout.ts',
      'packages/mobile/app/lobby.tsx'
    );
    expect(run.viewports).toBeNull();
    expect(run.journeys).toBeNull();
    expect(run.cases).toEqual(expect.arrayContaining(['lobby-open', 'table-bidding']));
  });

  test('a table change with no table journeys found runs every journey', () => {
    const run = selectChecks({ base, files: ['packages/mobile/src/game/handLog.ts'], cases, ids });
    expect(run.accounts).toBe(true);
    expect(run.journeys).toBeNull();
  });

  test('a lobby change runs the lobby and creation cases, the smoke set and both e2e suites', () => {
    const run = select('packages/mobile/app/lobby.tsx');
    expect(run.full).toBe(false);
    expect(run.cases).toEqual(
      expect.arrayContaining([...casesOn('/lobby'), 'new-table-setup', ...SMOKE])
    );
    expect(run.cases).not.toContain('table-bidding');
    expect(run.cases).not.toContain('register');
    expect(run.viewports).toBeNull();
    expect(run.game).toBe(true);
    expect(run.accounts).toBe(true);
    expect(run.journeys).toBeNull();
    expect(run.shards.filter(({ partition }) => !partition)).toEqual([
      { shard: 'lobby-and-creation', partition: '' },
    ]);
  });

  test('docs, baselines and unit tests run nothing visual and no e2e', () => {
    const run = select(
      'docs/shipping.md',
      'packages/mobile/docs/FIXTURE-ROUTES.md',
      'packages/mobile/test/ui-baselines/portrait/home.png',
      'packages/mobile/test/game/bidding.test.mjs'
    );
    expect(run).toMatchObject({ full: false, cases: [], shards: [], game: false, accounts: false });
  });

  test.each([
    ['a design token', 'packages/mobile/src/design/tokens.ts'],
    ['the lockfile', 'bun.lock'],
    ['a path no rule claims', 'packages/mobile/src/somewhere/new.ts'],
    ['the workflow', '.github/workflows/frontend-ci.yml'],
  ])('%s runs everything', (_, file) => {
    const run = select('docs/shipping.md', file);
    expect(run.full).toBe(true);
    expect(run.cases).toBeNull();
    expect(run.game && run.accounts).toBe(true);
    expect(run.screens).toBe(ids.length);
  });

  test.each([['0000000000000000000000000000000000000000'], [''], [undefined]])(
    'no base commit (%p) runs everything',
    (before) => {
      const run = selectChecks({ base: before, files: [], cases, ids });
      expect(run.full).toBe(true);
    }
  );

  test('a diff that cannot be read runs everything', () => {
    expect(selectChecks({ base, files: null, cases, ids }).full).toBe(true);
  });

  test('shards hold about forty screens, at most ten', () => {
    const home = select('packages/mobile/app/(shell)/home.tsx');
    const matrix = home.shards.filter(({ partition }) => partition);
    expect(matrix.length).toBe(Math.ceil(home.screens / 40));
    expect(matrix.at(-1).partition).toBe(`${matrix.length}/${matrix.length}`);
    expect(select('packages/mobile/src/components/lobby/SeatRow.tsx').shards).toHaveLength(10 + 3);
  });
});
