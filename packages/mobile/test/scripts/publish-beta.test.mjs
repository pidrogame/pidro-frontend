import { describe, expect, test } from 'bun:test';
import { notPublishedLines, platformPlan } from '../../scripts/publish-beta.mjs';

// main's history, oldest first; `side` is a commit on another branch.
const HISTORY = ['a000000', 'b000000', 'c000000', 'd000000', 'e000000'];
const SHA = 'e000000';
const isAncestor = (commit, of) =>
  HISTORY.includes(commit) && HISTORY.indexOf(commit) <= HISTORY.indexOf(of);
const RUNTIMES = { ios: 'f1a6ios', android: 'f1a6android' };
const HANDOVER = [
  { platform: 'IOS', appVersion: '3.3.0', appBuildVersion: '14' },
  { platform: 'ANDROID', appVersion: '3.3.0', appBuildVersion: '11' },
].map((build) => ({
  ...build,
  channel: 'beta',
  runtime: { version: '3.3.0' },
  gitCommitHash: 'a000000',
}));

/** Answers like `eas-cli <args> --json`; builds and updates newest first. */
function fakeEas({ builds = [], updates = [] }) {
  return (...args) => {
    const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
    if (args[0] === 'fingerprint:generate') {
      expect(flag('--environment')).toBe('production');
      return { hash: RUNTIMES[flag('--platform')] };
    }
    if (args[0] === 'update:list')
      return {
        currentPage: updates
          .filter(({ runtimeVersion }) => runtimeVersion === flag('--runtime-version'))
          .map(({ group, runtimeVersion, commit }) => ({
            group,
            runtimeVersion,
            message: `"Vaasa-Boudreaux · A change (${commit})" (2 hours ago by Marcel)`,
          })),
      };
    if (args[0] === 'update:view')
      return updates
        .filter(({ group }) => group === args[1])
        .map(({ commit }) => ({ gitCommitHash: commit }));
    if (args[0] === 'build:list')
      return builds
        .filter(
          (build) =>
            build.platform === flag('--platform').toUpperCase() &&
            build.channel === flag('--channel') &&
            (!flag('--runtime-version') || build.runtime.version === flag('--runtime-version'))
        )
        .slice(0, Number(flag('--limit')));
    throw new Error(`unexpected eas ${args.join(' ')}`);
  };
}

const build = (platform, commit, number, channel = 'beta') => ({
  platform: platform.toUpperCase(),
  channel,
  appVersion: '3.3.0',
  appBuildVersion: number,
  runtime: { version: RUNTIMES[platform] },
  gitCommitHash: commit,
});

function plan(platform, { builds, updates, verdict = 'ota', reasons = [] }) {
  const checked = [];
  const result = platformPlan(platform, SHA, {
    eas: fakeEas({ builds, updates }),
    isAncestor,
    checkCommits: (base, head) => {
      checked.push([base, head]);
      return { verdict, reasons };
    },
  });
  return { ...result, checked };
}

describe('the beta update follows each platform’s fingerprint', () => {
  test('the handover: builds on runtime 3.3.0 carry no fingerprint, so both need a store build', () => {
    const plans = ['ios', 'android'].map((platform) =>
      plan(platform, { builds: HANDOVER, verdict: 'build', reasons: ['app.json native fields'] })
    );
    expect(plans.map(({ action, runtime }) => [action, runtime])).toEqual([
      ['build', RUNTIMES.ios],
      ['build', RUNTIMES.android],
    ]);
    expect(plans[0].last.appBuildVersion).toBe('14');
    expect(plans[1].last.appBuildVersion).toBe('11');
    // ota-check explains against the last build's commit.
    expect(plans[0].checked).toEqual([['a000000', SHA]]);
    const text = notPublishedLines(plans).join('\n');
    expect(text).toContain('**New store build needed** (both)');
    expect(text).toContain(`runtime \`${RUNTIMES.ios}\``);
    expect(text).toContain(`runtime \`${RUNTIMES.android}\``);
    expect(text).toContain('3.3.0 (14) from `a000000`, runtime `3.3.0`');
    expect(text).toContain('3.3.0 (11) from `a000000`, runtime `3.3.0`');
    expect(text).toContain('`app.json native fields`');
    expect(text).toContain('`version` unchanged');
  });

  test('a beta build with this fingerprint is the base, even when files look native', () => {
    const result = plan('ios', {
      builds: [build('ios', 'b000000', '15'), ...HANDOVER],
      verdict: 'build',
      reasons: ['bun.lock'],
    });
    expect(result.action).toBe('publish');
    expect(result.base).toBe('b000000');
    expect(result.build.appBuildVersion).toBe('15');
    expect(result.flagged).toEqual(['bun.lock']);
  });

  test('the newer of the last update and the last build is the base', () => {
    const builds = [build('android', 'b000000', '12')];
    const updates = [{ group: 'g-1', runtimeVersion: RUNTIMES.android, commit: 'c000000' }];
    const result = plan('android', { builds, updates });
    expect([result.action, result.base]).toEqual(['publish', 'c000000']);
    expect(result.checked).toEqual([['c000000', SHA]]);
    // A newer build than the update wins.
    expect(plan('android', { builds: [build('android', 'd000000', '13')], updates }).base).toBe(
      'd000000'
    );
  });

  test('only the platform whose build has this fingerprint is published', () => {
    const builds = [build('ios', 'b000000', '15'), ...HANDOVER];
    const plans = ['ios', 'android'].map((platform) => plan(platform, { builds }));
    expect(plans.map(({ action }) => action)).toEqual(['publish', 'build']);
    expect(notPublishedLines(plans).join('\n')).toContain('**New store build needed** (Android)');
  });

  test('a build of another channel or runtime does not count', () => {
    const builds = [
      { ...build('ios', 'c000000', '16'), runtime: { version: 'f1a6older' } },
      build('ios', 'b000000', '15', 'production'),
      ...HANDOVER,
    ];
    const result = plan('ios', { builds });
    expect(result.action).toBe('build');
    // The newest beta build on iOS, whatever its runtime.
    expect(result.last.appBuildVersion).toBe('16');
    expect(result.checked).toEqual([['c000000', SHA]]);
  });

  test('a build off main with this fingerprint is named, not mistaken for a missing build', () => {
    const offMain = plan('ios', { builds: [build('ios', 'side000', '17'), ...HANDOVER] });
    expect(offMain.action).toBe('skip');
    expect(offMain.reason).toContain('3.3.0 (17) from `side000`');
    expect(offMain.reason).toContain("not in main's history");
    // An older build on main with the same fingerprint is still the base.
    const behind = plan('ios', {
      builds: [build('ios', 'side000', '17'), build('ios', 'b000000', '15')],
    });
    expect([behind.action, behind.base, behind.build.appBuildVersion]).toEqual([
      'publish',
      'b000000',
      '15',
    ]);
  });

  test('skips what went before, what goes backwards, and what changed nothing', () => {
    const builds = [build('ios', 'b000000', '15')];
    const went = plan('ios', {
      builds,
      updates: [{ group: 'g-2', runtimeVersion: RUNTIMES.ios, commit: SHA }],
    });
    expect(went.action).toBe('skip');
    expect(went.reason).toContain('went to beta before');
    const backwards = plan('ios', {
      builds,
      updates: [{ group: 'g-3', runtimeVersion: RUNTIMES.ios, commit: 'side000' }],
    });
    expect(backwards.reason).toContain('go backwards');
    const nothing = plan('ios', { builds, verdict: 'none' });
    expect([nothing.action, nothing.reason]).toEqual([
      'skip',
      'nothing in the app changed since b000000.',
    ]);
    expect(notPublishedLines([nothing])).toEqual([
      '- iOS: nothing in the app changed since b000000.',
    ]);
  });
});
