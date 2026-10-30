import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectChecks } from '../../scripts/ci-affected.mjs';
import { partitionCases, verifyCoverage } from '../../scripts/ui-shards.mjs';

describe('visual partitions', () => {
  const cases = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }));
  const costs = { a: 12, b: 10, c: 8, d: 6, e: 4, f: 2 };

  test('balances measured work and keeps original order within each partition', () => {
    const first = partitionCases(cases, '1/2', costs);
    const second = partitionCases(cases, '2/2', costs);
    expect(first.map(({ id }) => id)).toEqual(['a', 'd', 'e']);
    expect(second.map(({ id }) => id)).toEqual(['b', 'c', 'f']);
    expect([...first, ...second].map(({ id }) => id).sort()).toEqual(cases.map(({ id }) => id));
  });

  test('includes new cases without timing history exactly once', () => {
    const work = [...cases, { id: 'new-screen' }];
    const partitions = [1, 2, 3].flatMap((index) => partitionCases(work, `${index}/3`, costs));
    expect(partitions.map(({ id }) => id).sort()).toEqual(work.map(({ id }) => id).sort());
    expect(partitionCases(work, '', costs)).toEqual(work);
  });

  test.each(['0/5', '6/5', '1/0', '1', '1.5/5', '1/2/3'])(
    'rejects invalid partition %s',
    (value) => {
      expect(() => partitionCases(cases, value, costs)).toThrow('UI_PARTITION');
    }
  );
});

describe('visual coverage gate', () => {
  const expected = ['portrait/home', 'landscape/home'];
  const completed = expected.map((id) => ({ id, ms: 100 }));

  test('accepts the complete inventory', () => {
    expect(() => verifyCoverage(expected, completed)).not.toThrow();
  });

  test('rejects a missing, repeated or unexpected case', () => {
    expect(() => verifyCoverage(expected, completed.slice(0, 1))).toThrow('landscape/home');
    expect(() => verifyCoverage(expected, [...completed, completed[0]])).toThrow('Duplicate');
    expect(() => verifyCoverage(expected, [...completed, { id: 'unknown' }])).toThrow('Unexpected');
  });
});

test("the release test's partitions cover every unfiltered viewport/case exactly once", () => {
  const script = fileURLToPath(new URL('../../scripts/verify-ui-grammar.mjs', import.meta.url));
  const list = (partition) => {
    const result = spawnSync(process.execPath, [script, '--list'], {
      env: { ...process.env, UI_PARTITION: partition, UI_CASES: '', UI_VIEWPORTS: '' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout);
  };
  const expected = list('');
  const configured = selectChecks({ full: true, cases: [], ids: expected })
    .shards.map(({ partition }) => partition)
    .filter(Boolean);
  expect(configured).toEqual(Array.from({ length: 10 }, (_, index) => `${index + 1}/10`));
  const partitions = configured.map(list);
  expect(partitions.every((items) => items.length > 0)).toBe(true);
  expect(new Set(expected).size).toBe(expected.length);
  expect(partitions.flat().sort()).toEqual(expected.sort());
  // Eleven real child processes can exceed Bun's five-second default on a busy host.
}, 30_000);

test('the actual pixel comparison fails when captures are missing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pidro-missing-captures-'));
  try {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../../scripts/compare-ui-baselines.mjs', import.meta.url))],
      {
        env: { ...process.env, UI_SHOT_DIR: directory },
        encoding: 'utf8',
      }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing capture for');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a partial run compares only what it captured, and still catches drift there', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pidro-partial-captures-'));
  const baselines = fileURLToPath(new URL('../ui-baselines/portrait/', import.meta.url));
  const compare = () =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../../scripts/compare-ui-baselines.mjs', import.meta.url))],
      { env: { ...process.env, UI_SHOT_DIR: directory, UI_DIFF_PARTIAL: '1' }, encoding: 'utf8' }
    );
  try {
    mkdirSync(join(directory, 'portrait'));
    copyFileSync(join(baselines, 'home.png'), join(directory, 'portrait/home.png'));
    const same = compare();
    expect(same.status).toBe(0);
    expect(same.stdout).toContain('1 screens compared, 0 drifted');

    copyFileSync(join(baselines, 'settings.png'), join(directory, 'portrait/home.png'));
    const drifted = compare();
    expect(drifted.status).toBe(1);
    expect(drifted.stderr).toContain('portrait/home:');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
