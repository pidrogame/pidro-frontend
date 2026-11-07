import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/ci-ready.mjs', import.meta.url));
const results = (selection = {}) => ({
  select: {
    result: 'success',
    outputs: { full: 'false', ui: 'true', game: 'true', accounts: 'true', ...selection },
  },
  quality: { result: 'success' },
  'integration-backend': { result: 'success' },
  'ui-grammar': { result: 'success' },
  'game-e2e': { result: 'success' },
  'account-e2e': { result: 'success' },
});
const gate = (needs) =>
  spawnSync('node', [script], {
    env: { ...process.env, RESULTS: JSON.stringify(needs) },
    encoding: 'utf8',
  });

describe('Frontend ready command', () => {
  test('accepts an affected run and the complete release run', () => {
    expect(gate(results()).status).toBe(0);
    const full = gate(results({ full: 'true' }));
    expect(full.status).toBe(0);
    expect(full.stdout).toContain('Frontend ready (full): all selected checks passed');
  });

  test('accepts explicit docs-only skips, without a backend lookup', () => {
    const needs = results({ ui: 'false', game: 'false', accounts: 'false' });
    for (const job of ['integration-backend', 'ui-grammar', 'game-e2e']) {
      needs[job].result = 'skipped';
    }
    expect(gate(needs).status).toBe(0);
    // The account aggregate and quality must still run on a docs-only change.
    for (const job of ['account-e2e', 'quality']) {
      const incomplete = structuredClone(needs);
      incomplete[job].result = 'skipped';
      expect(gate(incomplete).status).toBe(1);
    }
  });

  for (const job of Object.keys(results())) {
    test.each(['failure', 'cancelled', 'skipped', undefined])(
      `rejects ${job} result %p when selected`,
      (result) => {
        const needs = results();
        if (result === undefined) delete needs[job];
        else needs[job].result = result;
        expect(gate(needs).status).toBe(1);
      }
    );
  }

  for (const key of ['full', 'ui', 'game', 'accounts']) {
    test.each([undefined, '', 'unknown', true])(`rejects invalid ${key} output %p`, (value) => {
      expect(gate(results({ [key]: value })).status).toBe(1);
    });
  }

  test.each(['ui', 'game', 'accounts'])('a full run cannot omit %s', (key) => {
    expect(gate(results({ full: 'true', [key]: 'false' })).status).toBe(1);
  });

  test('an unselected check that ran and failed cannot be hidden', () => {
    const needs = results({ ui: 'false', game: 'false', accounts: 'false' });
    needs['ui-grammar'].result = 'failure';
    expect(gate(needs).status).toBe(1);
  });
});
