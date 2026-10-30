import { describe, expect, test } from 'bun:test';
import { listGrammar, selectChecks, SMOKE } from '../../scripts/ci-affected.mjs';

const cases = listGrammar('--list-cases');
const ids = listGrammar('--list');
const base = '283e333c0000000000000000000000000000beef';
const select = (...files) => selectChecks({ base, files, cases, ids });
const casesOn = (prefix) =>
  cases.filter(({ path }) => path.startsWith(prefix)).map(({ name }) => name);

describe('what a push runs', () => {
  test('a table change runs the table, the lobby it shares code with, the smoke set and both e2e suites', () => {
    const run = select('packages/mobile/src/game/canvas/layout.ts');
    expect(run.full).toBe(false);
    expect(run.cases).toEqual(expect.arrayContaining([...casesOn('/table-dev'), ...SMOKE]));
    expect(run.cases).toEqual(expect.arrayContaining(['lobby-list', 'new-table-setup']));
    expect(run.cases).not.toContain('settings');
    expect(run.cases).not.toContain('classic-method');
    expect(run.cases).not.toContain('profile');
    expect(run.game).toBe(true);
    expect(run.accounts).toBe(true);
    expect(run.shards.map(({ shard }) => shard)).toEqual(
      expect.arrayContaining(['table-behavior', 'seats-and-game-over'])
    );
  });

  test('a lobby change runs the lobby and creation cases, the smoke set and both e2e suites', () => {
    const run = select('packages/mobile/app/lobby.tsx');
    expect(run.full).toBe(false);
    expect(run.cases).toEqual(
      expect.arrayContaining([...casesOn('/lobby'), 'new-table-setup', ...SMOKE])
    );
    expect(run.cases).not.toContain('table-bidding');
    expect(run.cases).not.toContain('register');
    expect(run.game).toBe(true);
    expect(run.accounts).toBe(true);
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
    expect(select('packages/mobile/src/game/canvas/layout.ts').shards).toHaveLength(10 + 3);
  });
});
