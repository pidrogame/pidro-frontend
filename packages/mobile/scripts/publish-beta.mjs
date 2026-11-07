/**
 * Publishes the beta update for a green commit on main. Run by
 * .github/workflows/beta-update.yml after Frontend CI passes there:
 *
 *   node scripts/publish-beta.mjs <sha>
 *
 * It publishes only main's newest commit, only on top of what the beta channel already
 * carries, and only when everything since the last beta build or update for this runtime
 * can ship over the air (scripts/ota-check.mjs). Anything else is a skip, with the reason
 * in the run summary.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { checkCommits } from './ota-check.mjs';
import { updateName } from '../src/features/updateName.mjs';

const sha = process.argv[2];
if (!sha) {
  console.error('usage: node scripts/publish-beta.mjs <sha>');
  process.exit(1);
}

// A pasted secret can carry a newline, which is not a legal header value.
process.env.EXPO_TOKEN = process.env.EXPO_TOKEN?.trim();

const API = 'app.pidro.online';
const short = (commit) => commit.slice(0, 7);

function summary(...lines) {
  const text = `${lines.join('\n')}\n`;
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}

function skip(...lines) {
  summary('### Beta update: not published', '', ...lines);
  process.exit(0);
}

function sh(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

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

const { expo } = JSON.parse(readFileSync('app.json', 'utf8'));
const runtime = typeof expo.runtimeVersion === 'string' ? expo.runtimeVersion : expo.version;

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
  skip(`${short(sha)} went to beta before; a new commit on main publishes.`);
const updateCommit = groups[0] ? eas('update:view', groups[0].group)[0]?.gitCommitHash : undefined;
const [build] = eas(
  'build:list',
  '--channel',
  'beta',
  '--status',
  'finished',
  '--runtime-version',
  runtime,
  '--limit',
  '1',
  '--non-interactive'
);

if (updateCommit === sha) skip(`Beta already carries ${short(sha)}.`);
if (updateCommit && !isAncestor(updateCommit, sha))
  skip(
    `Beta carries ${short(updateCommit)}, which is not in ${short(sha)}'s history, so this would go backwards.`
  );

// Compare against the newest of the last beta update and the last beta build.
const bases = [updateCommit, build?.gitCommitHash].filter(
  (commit) => commit && isAncestor(commit, sha)
);
const base = bases.find((commit) => bases.every((other) => isAncestor(other, commit)));
if (!base)
  skip(
    `**New store build needed.** No beta build or update for runtime ${runtime} comes from main's history.`
  );

const { verdict, reasons } = checkCommits(base, sha);
if (verdict === 'none') skip(`Nothing in the app changed since ${short(base)}.`);
if (verdict === 'build') {
  console.log(`::warning::New store build needed for ${short(sha)}`);
  skip(
    `**New store build needed.** Native changes since ${short(base)}:`,
    '',
    ...reasons.map((reason) => `- \`${reason}\``),
    '',
    'Bump `version` in app.json, then follow docs/store-builds.md on both platforms the same day; updates resume on top of it.'
  );
}

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
      APP_VARIANT: 'beta',
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

const updateGroup = JSON.parse(readFileSync('dist/eas-update-metadata.json', 'utf8')).updates[0]
  .group;
const link = `https://expo.dev/accounts/${expo.owner}/projects/${expo.slug}/updates/${updateGroup}`;
const pointsAtProduction = ['ios', 'android'].every((platform) => {
  const dir = `dist/_expo/static/js/${platform}`;
  return readdirSync(dir).some(
    (file) => file.endsWith('.hbc') && readFileSync(`${dir}/${file}`).includes(API)
  );
});

if (!pointsAtProduction) {
  summary(
    '### Beta update: published a bundle that does not point at the server',
    '',
    `Group \`${updateGroup}\` ([dashboard](${link})) has no \`${API}\` in its bundle.`,
    'Roll back now from packages/mobile: `node scripts/rollback-ota.mjs`'
  );
  process.exit(1);
}

summary(
  `### Beta update published: ${name}`,
  '',
  `- Commit: \`${short(sha)}\` ${subject}`,
  `- Runtime: ${runtime}, on top of \`${short(base)}\``,
  `- Update group: \`${updateGroup}\``,
  `- Dashboard: ${link}`
);
