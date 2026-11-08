import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listGrammar, selectChecks, SMOKE } from '../../scripts/ci-affected.mjs';

const cases = listGrammar('--list-cases');
const ids = listGrammar('--list');
const base = '283e333c0000000000000000000000000000beef';
const tests = readdirSync(fileURLToPath(new URL('../', import.meta.url)), { recursive: true })
  .filter((name) => /\.test\.(mjs|ts|tsx)$/.test(name))
  .map((name) => `packages/mobile/test/${name}`);
const select = (...files) => selectChecks({ base, files, cases, ids, tests });

describe('bounded feature checks', () => {
  test('a table layout change checks representative states at two sizes, not every table or full journeys', () => {
    const run = select('packages/mobile/src/game/canvas/layout.ts');
    expect(run.full).toBe(false);
    expect(run.cases).toEqual(
      expect.arrayContaining([...SMOKE, 'table-bidding', 'table-game-over'])
    );
    expect(run.cases).not.toContain('table-status-b-cut');
    expect(run.cases).not.toContain('register');
    expect(run.viewports).toEqual(['portrait', 'landscape']);
    expect(run.screens).toBeLessThanOrEqual(run.cases.length * 2);
    expect(run.shards).toEqual([{ shard: 'matrix-1', partition: '1/1' }]);
    expect(run.game || run.accounts).toBe(false);
    expect(run.unitTests).toContain('packages/mobile/test/game/layout.test.mjs');
    expect(run.unitTests).not.toContain('packages/mobile/test/auth/loginSocial.test.mjs');
    expect(run.adopt).toContain('table-playing');
    expect(run.adopt).not.toContain('login');
  });

  test('non-layout game logic uses one size, lobby adds its own representative states', () => {
    expect(select('packages/mobile/src/features/game/layDown.ts').viewports).toEqual(['portrait']);
    const run = select('packages/mobile/app/lobby.tsx');
    expect(run.cases).toContain('new-table-ready');
    expect(run.cases).not.toContain('table-bidding');
    expect(run.game || run.accounts).toBe(false);
    expect(run.unitTests).toContain('packages/mobile/test/lobby/seatRow.test.mjs');
  });

  test('unit-only and docs-only changes do not start a screenshot or account sweep', () => {
    const run = select('docs/testing.md', 'packages/mobile/test/game/bidding.test.mjs');
    expect(run).toMatchObject({ full: false, cases: [], shards: [], game: false, accounts: false });
    expect(run.unitTests).toContain('packages/mobile/test/game/bidding.test.mjs');
    expect(run.unitTests).not.toContain('packages/mobile/test/game/layDown.test.mjs');
  });

  test.each([
    'packages/mobile/src/design/tokens.ts',
    'bun.lock',
    'packages/mobile/src/somewhere/new.ts',
    '.github/workflows/frontend-ci.yml',
  ])('%s never turns a feature push into a release run', (file) => {
    const run = select(file);
    expect(run.full).toBe(false);
    expect(run.cases).toEqual(expect.arrayContaining(SMOKE));
    expect(run.cases.length).toBeLessThanOrEqual(16);
    expect(run.game || run.accounts).toBe(false);
    expect(run.adopt).toEqual([]);
  });

  test.each([undefined, '', '0000000000000000000000000000000000000000'])(
    'missing base %p uses smoke, never a full-suite fallback',
    (before) => {
      const run = selectChecks({ base: before, files: [], cases, ids });
      expect(run.full).toBe(false);
      expect(run.cases).toEqual(expect.arrayContaining(SMOKE));
      expect(run.viewports).toEqual(['portrait']);
      expect(run.game || run.accounts).toBe(false);
    }
  );

  test('unreadable diff and broad multi-area changes remain bounded', () => {
    expect(selectChecks({ base, files: null, cases, ids }).full).toBe(false);
    const run = select(
      'packages/mobile/app/lobby.tsx',
      'packages/mobile/app/(shell)/home.tsx',
      'packages/mobile/app/(auth)/login.tsx',
      'packages/mobile/src/game/canvas/layout.ts'
    );
    expect(run.cases.length).toBeLessThanOrEqual(16);
    expect(run.screens).toBeLessThanOrEqual(32);
  });

  test('transitive source imports select tests outside an area, without selecting all tests', () => {
    const run = select('packages/mobile/src/features/league.ts');
    expect(run.unitTests).toContain('packages/mobile/test/league.test.ts');
    expect(run.unitTests).not.toContain('packages/mobile/test/auth/loginSocial.test.mjs');
  });
});

test('the explicit release retains all cases, sizes and behavioral suites with no auto-adoption', () => {
  const run = selectChecks({ base, files: [], cases, ids, full: true });
  expect(run.full).toBe(true);
  expect(run.cases).toBeNull();
  expect(run.unitTests).toBeNull();
  expect(run.viewports).toEqual([]);
  expect(run.screens).toBe(ids.length);
  expect(run.game && run.accounts).toBe(true);
  expect(run.shards.filter(({ partition }) => !partition).map(({ shard }) => shard)).toEqual([
    'table-behavior',
    'lobby-and-creation',
    'seats-and-game-over',
  ]);
  expect(run.adopt).toEqual([]);
});

test('the real CLI passes the same narrowed inventory to capture and coverage commands', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pidro-selection-'));
  try {
    const output = join(directory, 'output');
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../../scripts/ci-affected.mjs', import.meta.url)), base],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: join(directory, 'summary'),
        },
      }
    );
    expect(result.status).toBe(0);
    const values = Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const index = line.indexOf('=');
          return [line.slice(0, index), line.slice(index + 1)];
        })
    );
    expect(values).toMatchObject({
      full: 'false',
      game: 'false',
      accounts: 'false',
      ui_viewports: 'portrait',
    });
    expect(JSON.parse(values.unit_tests).length).toBeGreaterThan(0);
    const list = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../../scripts/verify-ui-grammar.mjs', import.meta.url)), '--list'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          UI_CASES: values.ui_cases,
          UI_VIEWPORTS: values.ui_viewports,
          UI_PARTITION: '',
        },
      }
    );
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual(
      expect.arrayContaining(['portrait/home', 'portrait/login'])
    );
    expect(JSON.parse(list.stdout).every((id) => id.startsWith('portrait/'))).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 20_000);
