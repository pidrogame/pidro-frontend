/**
 * Publishes the beta update for a green commit on main. Run by
 * .github/workflows/beta-update.yml after Frontend CI passes there:
 *
 *   node scripts/publish-beta.mjs <sha>
 *
 * The runtime is the commit's fingerprint, one per platform (app.json `runtimeVersion`,
 * fingerprint.config.js). A platform gets the update only on top of a beta build or update
 * with that runtime from main's history, and only main's newest commit goes out. A platform
 * with neither needs a new store build; scripts/ota-check.mjs says what changed. Anything
 * not published is a skip, with the reason in the run summary.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkCommits } from './ota-check.mjs';
import { updateName } from '../src/features/updateName.mjs';

const API = 'app.pidro.online';
const PLATFORMS = ['ios', 'android'];
const NAMES = { ios: 'iOS', android: 'Android' };
const short = (commit) => commit.slice(0, 7);

/**
 * What one platform does with this commit: `publish` on top of `base`, `build` (a new
 * store build is needed), or `skip` with the reason. `eas(...args)` answers like
 * `eas-cli <args> --json`.
 */
export function platformPlan(platform, sha, { eas, isAncestor, checkCommits }) {
  const { hash: runtime } = eas(
    'fingerprint:generate',
    '--platform',
    platform,
    '--environment',
    'production',
    '--non-interactive'
  );
  const plan = (action, fields) => ({ platform, runtime, action, ...fields });
  const builds = (limit, ...filters) =>
    eas(
      'build:list',
      '--platform',
      platform,
      '--channel',
      'beta',
      '--status',
      'finished',
      ...filters,
      '--limit',
      String(limit),
      '--non-interactive'
    );

  const groups = eas(
    'update:list',
    '--branch',
    'beta',
    '--runtime-version',
    runtime,
    '--limit',
    '25',
    '--non-interactive'
  ).currentPage;
  // Messages end in the short sha. Once published, a commit never goes out again, so a
  // re-run after a rollback can't bring the bad update back.
  if (groups.some(({ message }) => message.includes(`(${short(sha)})`)))
    return plan('skip', { reason: `${short(sha)} went to beta before.` });
  const updateCommit = groups[0]
    ? eas('update:view', groups[0].group)[0]?.gitCommitHash
    : undefined;
  if (updateCommit && !isAncestor(updateCommit, sha))
    return plan('skip', {
      reason: `beta carries ${short(updateCommit)}, which is not in ${short(sha)}'s history, so this would go backwards.`,
    });

  // On top of the newest of the last beta update and the last beta build for this runtime.
  const matching = builds(5, '--runtime-version', runtime);
  const build = matching.find(
    ({ gitCommitHash }) => gitCommitHash && isAncestor(gitCommitHash, sha)
  );
  const bases = [updateCommit, build?.gitCommitHash].filter(
    (commit) => commit && isAncestor(commit, sha)
  );
  const base = bases.find((commit) => bases.every((other) => isAncestor(other, commit)));
  if (!base && matching.length)
    return plan('skip', {
      reason: `build ${buildName(matching[0])} has runtime \`${runtime}\`, but its commit is not in main's history; push it, or build from main.`,
    });
  if (!base) {
    const [last] = builds(1);
    const from = last?.gitCommitHash;
    const changed = from && isAncestor(from, sha) ? checkCommits(from, sha).reasons : [];
    return plan('build', { last, changed });
  }

  const { verdict, reasons } = checkCommits(base, sha);
  if (verdict === 'none')
    return plan('skip', { reason: `nothing in the app changed since ${short(base)}.` });
  // The fingerprint decides; the file check only says what looked native.
  return plan('publish', {
    base,
    build: build ?? matching[0],
    flagged: verdict === 'build' ? reasons : [],
  });
}

const buildName = (build) =>
  build
    ? `${build.appVersion} (${build.appBuildVersion}) from \`${short(build.gitCommitHash ?? '')}\``
    : 'none';

/** The run summary's lines for the platforms that are not published. */
export function notPublishedLines(plans) {
  const builds = plans.filter(({ action }) => action === 'build');
  const lines = [];
  if (builds.length)
    lines.push(
      `**New store build needed** (${builds.length === PLATFORMS.length ? 'both' : NAMES[builds[0].platform]}).`,
      ''
    );
  for (const { platform, runtime, last, changed } of builds) {
    lines.push(
      `- ${NAMES[platform]}: no beta build or update has runtime \`${runtime}\`, this commit's fingerprint. Last beta build: ${buildName(last)}, runtime \`${last?.runtime?.version ?? 'none'}\`.`,
      ...changed.map((reason) => `  - \`${reason}\``)
    );
  }
  if (builds.length)
    lines.push(
      '',
      'Build with `version` unchanged; EAS numbers the build (docs/store-builds.md). Updates resume on top of it.'
    );
  for (const { platform, reason } of plans.filter(({ action }) => action === 'skip'))
    lines.push(`- ${NAMES[platform]}: ${reason}`);
  return lines;
}

function main(sha) {
  // A pasted secret can carry a newline, which is not a legal header value.
  process.env.EXPO_TOKEN = process.env.EXPO_TOKEN?.trim();
  // The beta's runtime, like its bundle, is the beta variant's (app.config.js).
  process.env.APP_VARIANT = 'beta';

  function summary(...lines) {
    const text = `${lines.join('\n')}\n`;
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  }

  function skip(...lines) {
    summary('### Beta update: not published', '', ...lines);
    process.exit(0);
  }

  const sh = (command, args) =>
    execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const eas = (...args) => JSON.parse(sh('bunx', ['eas-cli', ...args, '--json']));
  const isAncestor = (commit, of) =>
    spawnSync('git', ['merge-base', '--is-ancestor', commit, of]).status === 0;

  // A re-run of an older Frontend CI run can go green after newer commits landed. The one
  // commit allowed on top is the baselines the green run adopted itself (frontend-ci.yml):
  // the same app, and no run of its own.
  const tip = sh('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0];
  if (tip !== sha) {
    sh('git', ['fetch', '--quiet', 'origin', tip]);
    const above = sh('git', ['diff', '--name-only', sha, tip]).split('\n').filter(Boolean);
    if (
      !isAncestor(sha, tip) ||
      !above.every((file) => file.startsWith('packages/mobile/test/ui-baselines/'))
    )
      skip(`main has moved on to ${short(tip)}; its own green run publishes.`);
  }

  const plans = PLATFORMS.map((platform) =>
    platformPlan(platform, sha, { eas, isAncestor, checkCommits })
  );
  const publishing = plans.filter(({ action }) => action === 'publish');
  if (plans.some(({ action }) => action === 'build'))
    console.log(`::warning::New store build needed for ${short(sha)}`);
  if (!publishing.length) skip(...notPublishedLines(plans));

  const { expo } = JSON.parse(readFileSync('app.json', 'utf8'));
  const subject = sh('git', ['log', '-1', '--format=%s', sha]).trim();
  const name = updateName(sha) ?? short(sha);
  const published = spawnSync(
    'bunx',
    [
      'eas-cli',
      'update',
      '--branch',
      'beta',
      '--environment',
      'production',
      '--platform',
      publishing.length === PLATFORMS.length ? 'all' : publishing[0].platform,
      '--message',
      `${name} · ${subject} (${short(sha)})`,
      '--non-interactive',
      '--emit-metadata',
    ],
    {
      stdio: 'inherit',
      // The API and socket URLs live only in eas.json's build profile; without them the
      // bundle points at localhost.
      env: {
        ...process.env,
        EXPO_PUBLIC_API_URL: `https://${API}`,
        EXPO_PUBLIC_WS_URL: `wss://${API}/socket`,
        // Settings → About the app shows which commit is running (AppUpdateSection).
        EXPO_PUBLIC_UPDATE_NAME: name,
        EXPO_PUBLIC_UPDATE_SHA: short(sha),
        EXPO_PUBLIC_UPDATE_DATE: new Date().toISOString().slice(0, 10),
      },
    }
  );
  if (published.status !== 0) process.exit(published.status ?? 1);

  // One group per runtime, so one per platform.
  const updates = Object.fromEntries(
    JSON.parse(readFileSync('dist/eas-update-metadata.json', 'utf8')).updates.map((update) => [
      update.platform,
      update,
    ])
  );
  const group = (platform) => {
    const id = updates[platform]?.group;
    return `group [\`${id}\`](https://expo.dev/accounts/${expo.owner}/projects/${expo.slug}/updates/${id})`;
  };
  const pointsAtProduction = publishing.every(({ platform }) => {
    const dir = `dist/_expo/static/js/${platform}`;
    return readdirSync(dir).some(
      (file) => file.endsWith('.hbc') && readFileSync(`${dir}/${file}`).includes(API)
    );
  });

  if (!pointsAtProduction) {
    summary(
      '### Beta update: published a bundle that does not point at the server',
      '',
      `${publishing.map(({ platform }) => group(platform)).join(', ')}: no \`${API}\` in the bundle.`,
      'Roll back now from packages/mobile: `node scripts/rollback-ota.mjs`'
    );
    process.exit(1);
  }

  summary(
    `### Beta update published: ${name}`,
    '',
    `- Commit: \`${short(sha)}\` ${subject}`,
    ...publishing.flatMap(({ platform, base, build, flagged }) => [
      `- ${NAMES[platform]}: runtime \`${updates[platform]?.runtimeVersion}\`, rides on build ${buildName(build)}, on top of \`${short(base)}\`, ${group(platform)}`,
      ...flagged.map((reason) => `  - looked native, but the fingerprint matches: \`${reason}\``),
    ]),
    ...(publishing.length < PLATFORMS.length ? ['', ...notPublishedLines(plans)] : [])
  );
  // EAS works out the runtime again when it publishes; it must be the one checked above.
  if (publishing.some(({ platform, runtime }) => updates[platform]?.runtimeVersion !== runtime)) {
    console.log('::error::EAS published to a runtime other than the fingerprint checked');
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sha = process.argv[2];
  if (!sha) {
    console.error('usage: node scripts/publish-beta.mjs <sha>');
    process.exit(1);
  }
  main(sha);
}
