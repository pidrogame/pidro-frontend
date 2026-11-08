/**
 * Rolls beta testers back to an earlier update group. From packages/mobile:
 *
 *   node scripts/rollback-ota.mjs              # per runtime, republish the group before the current one
 *   node scripts/rollback-ota.mjs <group-id>   # republish that group
 *   node scripts/rollback-ota.mjs --dry-run    # list the groups and the choice, publish nothing
 *
 * Needs a logged-in eas CLI or EXPO_TOKEN. When to roll back: docs/shipping.md.
 */
import { execFileSync, spawnSync } from 'node:child_process';

const dryRun = process.argv.includes('--dry-run');
const groupArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const ROLLBACK = 'Roll back to';

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const list = (...filters) =>
  JSON.parse(
    execFileSync(
      'bunx',
      ['eas-cli', 'update:list', '--branch', 'beta', ...filters, '--json', '--non-interactive'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
    )
  ).currentPage;
const groups = list('--limit', '8');
if (!groups.length) fail('no beta updates yet');

console.log('Recent beta update groups, newest first:');
groups.forEach(({ group, runtimeVersion, message }, index) =>
  console.log(`${index === 0 ? '→' : ' '} ${group}  ${runtimeVersion}  ${message}`)
);
console.log('');

// Listed as `"message" (2 hours ago by …)`.
const quoted = (message) => message.replace(/^"([^"]*)".*$/, '$1');
let targets = [
  groups.find(({ group }) => group === groupArg) ?? { group: groupArg, message: groupArg },
];
if (!groupArg) {
  // Picking "the one before" again after a rollback would bring back the bad update.
  const current = quoted(groups[0].message);
  if (current.startsWith(ROLLBACK))
    fail('beta is already rolled back; pass the group id to go further back');
  // Each platform has its own runtime (the fingerprint), so one publish is a group per
  // runtime. Each goes back to the group before it on the same runtime, or, the first
  // update on a new build, to the JS that build shipped with.
  const latest = groups.filter(({ message }) => quoted(message) === current);
  targets = latest.map(
    ({ runtimeVersion, platforms }) =>
      list('--runtime-version', runtimeVersion, '--limit', '2').find(
        ({ message }) => quoted(message) !== current
      ) ?? { runtimeVersion, platforms, embedded: true }
  );
}

for (const target of targets) {
  const args = target.embedded
    ? [
        'eas-cli',
        'update:roll-back-to-embedded',
        '--branch',
        'beta',
        '--runtime-version',
        target.runtimeVersion,
        '--platform',
        target.platforms.includes(',') ? 'all' : target.platforms,
        '--message',
        `${ROLLBACK} the build's own JS`,
        '--non-interactive',
      ]
    : [
        'eas-cli',
        'update:republish',
        '--group',
        target.group,
        '--destination-branch',
        'beta',
        '--message',
        `${ROLLBACK} ${quoted(target.message)}`,
        '--non-interactive',
      ];
  console.log(`→ bunx ${args.join(' ')}`);
  if (dryRun) continue;
  const status = spawnSync('bunx', args, { stdio: 'inherit' }).status;
  if (status !== 0) process.exit(status ?? 1);
}
if (dryRun) console.log('✓ dry run — nothing republished');
