import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/ship.mjs', import.meta.url));
const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function gate(checks, { wait = false, nextChecks } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'pidro-ship-'));
  directories.push(directory);
  const executable = (name, body) =>
    writeFileSync(join(directory, name), `#!${process.execPath}\n${body}`, { mode: 0o755 });

  executable(
    'git',
    `
    const args = process.argv.slice(2).join(' ');
    if (args === 'branch --show-current') console.log('main');
    if (args.startsWith('rev-parse ')) console.log('a'.repeat(40));
    if (args === 'log -1 --format=%s') console.log('Test release');
  `
  );
  executable(
    'gh',
    `
    const fs = require('node:fs');
    const marker = ${JSON.stringify(join(directory, 'polled'))};
    const checks = fs.existsSync(marker) ? ${JSON.stringify(nextChecks ?? checks)} : ${JSON.stringify(checks)};
    fs.writeFileSync(marker, '1');
    console.log(JSON.stringify(checks));
  `
  );
  executable('sleep', '');
  // A dry run must never reach EAS.
  executable('eas', 'process.exit(99);');

  const result = spawnSync(
    process.execPath,
    [script, 'ota', '--dry-run', ...(wait ? ['--wait'] : [])],
    {
      cwd: directory,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
      encoding: 'utf8',
      timeout: 5000,
    }
  );
  return { status: result.status, output: result.stdout + result.stderr };
}

const ready = { name: 'Frontend ready (full)', status: 'completed', conclusion: 'success' };

describe('shipping requires the complete regression result', () => {
  test('the old three green checks cannot release without account readiness', () => {
    const result = gate(
      ['Mobile quality', 'UI grammar', 'Game e2e'].map((name) => ({ ...ready, name }))
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain('Frontend ready');
  });

  test('a push that ran only what it touched cannot release', () => {
    const result = gate([{ ...ready, name: 'Frontend ready' }]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('Frontend ready (full)');
  });

  test('one green full run is enough when another on the same commit failed', () => {
    expect(gate([{ ...ready, conclusion: 'failure' }, ready]).status).toBe(0);
  });

  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out']) {
    test(`refuses a ${conclusion} readiness check`, () => {
      expect(gate([{ ...ready, conclusion }]).status).toBe(1);
    });
  }

  test('refuses pending checks without --wait', () => {
    expect(gate([{ ...ready, status: 'in_progress', conclusion: null }]).status).toBe(1);
  });

  test('prints the release command only after complete readiness', () => {
    const result = gate([ready]);
    expect(result.status).toBe(0);
    expect(result.output).toContain('eas update --channel production');
    expect(result.output).toContain('dry run');
  });

  test('--wait also waits for the aggregate check to appear', () => {
    expect(gate([], { wait: true, nextChecks: [ready] }).status).toBe(0);
  });
});
