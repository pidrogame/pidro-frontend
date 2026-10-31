/**
 * What a push runs (PID-310). Maps the files changed since the last green main to the
 * UI grammar cases, the UI suites, Game e2e and the account journeys. It fails safe:
 * a file no row of MAP claims, or no usable base commit, runs everything.
 *
 *   node scripts/ci-affected.mjs <base-sha> [head-sha]   # print the selection
 *   node scripts/ci-affected.mjs --full                  # the release test
 *
 * In CI it also writes the selection to $GITHUB_OUTPUT and why to $GITHUB_STEP_SUMMARY.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// What each part of the app draws (UI grammar case routes; /ui-dev cases by their state)
// and the UI suites that drive it. A push that touches only the table runs its cases on
// one viewport per layout profile computeLayout() branches on: the phone, the tight
// phone, the two-row landscape phone at its narrowest and as Marcel's TCL, and a tablet.
// The release test runs every viewport.
const AREAS = {
  table: {
    screens: ['/table-dev', '/game/*'],
    suites: ['table-behavior', 'seats-and-game-over'],
    viewports: [
      'portrait',
      'compact-portrait',
      'small-landscape',
      'android-landscape',
      'tablet-landscape',
    ],
  },
  lobby: {
    screens: [
      '/lobby',
      '/join/*',
      '/join-code',
      '/ui-dev?state={new-table,seat-rows,seat-picker,lobby-seats}',
    ],
    suites: ['lobby-and-creation'],
  },
  auth: {
    screens: ['/(auth)/*', '/auth-flow-dev', '/welcome', '/age', '/ui-dev?state=claim-classic'],
  },
  home: {
    screens: [
      '/{home,profile,friends,friends-add,blocked-players,league}',
      '/ui-dev?state={friends,friends-add,blocked-players,avatars,progression}',
    ],
  },
  settings: { screens: ['/settings', '/device-settings', '/ui-dev?state=settings'] },
};

// Changed file → what it runs. Paths inside packages/mobile drop that prefix. The first
// row a file matches wins; a file no row claims runs everything. Rows follow what the
// routes really import: most of src/game is also imported by app/lobby.tsx and
// app/new-table.tsx, which the smoke set's lobby screen covers on a table push, and
// `accounts: 'table'` runs the journeys that play through the table (tableJourneys).
const MAP = [
  {
    rule: 'docs and unit tests',
    files: [
      '**/*.md',
      'docs/**',
      'spec/**',
      'test/**',
      'scripts/*.test.mjs',
      'scripts/{ship,ota-check,publish-beta,rollback-ota}.mjs',
    ],
  },
  {
    rule: 'everything',
    all: true,
    files: [
      'package.json',
      'bun.lock',
      'bunfig.toml',
      'app.json',
      'app.config.*',
      '{babel,metro,tailwind}.config.js',
      'postcss.config.mjs',
      'global.css',
      'tsconfig.json',
      '.github/**',
      'packages/shared/**',
      'src/design/**',
      'src/components/ui/**',
      'app/{_layout,index,+native-intent}.tsx',
      'app/{(auth),(shell)}/_layout.tsx',
      'src/channels/**',
      'src/bootstrap/realtime.ts',
      'scripts/{verify-ui-grammar,verify-ui-readiness,ui-test-utils,ui-shards,compare-ui-baselines,ci-affected}.mjs',
      'scripts/ui-case-costs.json',
      'scripts/tailwind-v3-resolve.cjs',
      // Drawn on the shell screens too, or shared with home and welcome.
      'src/game/canvas/bakedBlur.tsx',
      'src/components/game/DealerChip.tsx',
      'public/cards/dealer-chip.png',
      'src/features/game/solo.ts',
    ],
  },
  {
    rule: 'table',
    areas: ['table'],
    game: true,
    accounts: 'table',
    files: [
      'app/game/**',
      'app/{table-dev,report-dev}.tsx',
      'src/game/**',
      'src/components/game/**',
      'src/features/game/**',
      'src/{stores,types}/game.ts',
      'src/utils/{cards,cardImages,positions}.ts',
      'public/cards/**',
      'scripts/verify-{table-chrome,seat-decisions,dealing,waiting-seats,game-over}.mjs',
    ],
  },
  {
    rule: 'lobby and creation',
    areas: ['lobby'],
    game: true,
    accounts: true,
    files: [
      'app/{lobby,new-table,join-code}.tsx',
      'app/join/**',
      'src/components/lobby/{PasswordKeypadSheet,RoomCard,SeatRequirementBadge}.tsx',
      'scripts/verify-{lobby,create-room}.mjs',
    ],
  },
  {
    // NewTableScreen, OpenChair and SeatRow are the waiting table at /game/:code too.
    rule: 'waiting table',
    areas: ['table', 'lobby'],
    game: true,
    accounts: true,
    files: ['src/components/lobby/**'],
  },
  {
    rule: 'auth and Classic claims',
    areas: ['auth'],
    accounts: true,
    files: [
      'app/{(auth),(onboarding)}/**',
      'app/{welcome,auth-flow-dev}.tsx',
      'src/api/classic.ts',
      'src/features/auth/{accountEmail,classicClaimForm,classicFound,loginSocial,pendingClassicVerification,resetLink}.ts',
      'src/components/auth/{AuthProviderButtons,KeepProgressPrompt,SwitchPlayersGuard}.tsx',
      'src/components/auth/useProviderSignIn.ts',
      'src/features/onboarding/reconcileAge.ts',
    ],
  },
  {
    rule: 'home, profile and friends',
    areas: ['home'],
    accounts: true,
    files: [
      'app/(shell)/{home,profile,friends,friends-add,blocked-players,league}.tsx',
      'src/components/friends/{FriendDiscovery,FriendSheet,InfoCard}.tsx',
      'src/components/profile/{BadgeSheet.tsx,useProfilePhoto.ts}',
      'src/features/profile.ts',
    ],
  },
  {
    rule: 'settings',
    areas: ['settings'],
    accounts: true,
    files: [
      'app/(shell)/settings.tsx',
      'app/device-settings.tsx',
      'src/components/settings/**',
      'src/features/rules/fixtures.ts',
    ],
  },
  { rule: 'Game e2e', game: true, files: ['scripts/{ci-game-e2e,autoplay-full-game}.mjs'] },
  // The account journeys follow the reset email into the old web client.
  { rule: 'account journeys', accounts: true, files: ['e2e/**', 'packages/web/**'] },
];

// One table, one lobby, one home and one auth screen, each on its usual viewports
// (portrait and landscape among them; a table push keeps only the table's), whenever
// anything visual runs.
export const SMOKE = ['table-playing', 'lobby-list', 'home', 'login'];
const SUITES = ['table-behavior', 'lobby-and-creation', 'seats-and-game-over'];
const SCREENS_PER_SHARD = 40;
const MAX_SHARDS = 10;

const glob = (pattern) =>
  new RegExp(
    `^${pattern
      .replace(/[.+?^$()|[\]\\]/g, '\\$&')
      .replace(/\{([^}]*)\}/g, (_, options) => `(?:${options.split(',').join('|')})`)
      .replace(/\*\*\/|\*\*|\*/g, (star) =>
        star === '*' ? '[^/]*' : star === '**/' ? '(?:.*/)?' : '.*'
      )}$`
  );
const matches = (patterns, path) => patterns.some((pattern) => glob(pattern).test(path));
const screenOf = ({ path }) => {
  const [route, query] = path.split('?');
  if (route !== '/ui-dev') return route;
  return `/ui-dev?state=${new URLSearchParams(query).get('state') ?? 'components'}`;
};

// The account journeys that reach /game/:code or /table-dev, read from the specs so a
// new one joins by itself.
export const tableJourneys = (dir = resolve(mobileRoot, 'e2e/specs')) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.spec.ts'))
    .filter((name) =>
      /game\\?\/|game-table|waiting-table|support\/game|table-dev/.test(
        readFileSync(resolve(dir, name), 'utf8')
      )
    )
    .map((name) => `specs/${name}`);

/**
 * base: the commit the change is measured from; files: paths changed since then
 * (repo-relative); cases: [{ name, path }] from verify-ui-grammar --list-cases;
 * ids: every viewport/case id from verify-ui-grammar --list; journeys: tableJourneys().
 */
export function selectChecks({ base, files, cases, ids, journeys = [], full = false }) {
  const reasons = [];
  let all = full;
  if (full) reasons.push({ file: '(release test)', rule: 'everything' });
  else if (!base || /^0+$/.test(base) || !files) {
    all = true;
    reasons.push({ file: '(no base commit to compare)', rule: 'everything' });
  }
  const areas = new Set();
  let game = false;
  let accounts = false;
  let journeysOnly = true;
  for (const file of all ? [] : files) {
    const path = file.replace(/^packages\/mobile\//, '');
    const row = MAP.find(({ files: patterns }) => matches(patterns, path));
    reasons.push({ file, rule: row?.rule ?? 'everything (no rule claims it)' });
    if (!row || row.all) all = true;
    else {
      row.areas?.forEach((area) => areas.add(area));
      game ||= Boolean(row.game);
      accounts ||= Boolean(row.accounts);
      if (row.accounts === true) journeysOnly = false;
    }
  }
  if (all) {
    return {
      full: true,
      reasons,
      cases: null,
      screens: ids.length,
      shards: shardsFor(ids.length, SUITES),
      game: true,
      accounts: true,
      viewports: null,
      journeys: null,
    };
  }

  const screens = [...areas].flatMap((area) => AREAS[area].screens);
  const selected = new Set(
    cases.filter((testCase) => matches(screens, screenOf(testCase))).map(({ name }) => name)
  );
  if (areas.size) SMOKE.forEach((name) => selected.add(name));
  // Narrow only when every area drawn has its own viewports; anything else runs them all.
  const narrow = areas.size > 0 && [...areas].every((area) => AREAS[area].viewports);
  const viewports = narrow ? [...areas].flatMap((area) => AREAS[area].viewports) : null;
  const count = ids.filter((id) => {
    const [viewport, name] = [id.slice(0, id.indexOf('/')), id.slice(id.indexOf('/') + 1)];
    return selected.has(name) && (!viewports || viewports.includes(viewport));
  }).length;
  const suites = SUITES.filter((suite) =>
    [...areas].some((area) => AREAS[area].suites?.includes(suite))
  );
  return {
    full: false,
    reasons,
    areas: [...areas],
    cases: [...selected],
    screens: count,
    shards: shardsFor(count, suites),
    game,
    accounts,
    viewports,
    // No list to narrow to runs every journey.
    journeys: accounts && journeysOnly && journeys.length ? journeys : null,
  };
}

function shardsFor(screens, suites) {
  const total = Math.min(MAX_SHARDS, Math.ceil(screens / SCREENS_PER_SHARD));
  return [
    ...Array.from({ length: total }, (_, index) => ({
      shard: `matrix-${index + 1}`,
      partition: `${index + 1}/${total}`,
    })),
    ...suites.map((shard) => ({ shard, partition: '' })),
  ];
}

function summarize(selection, base) {
  const yes = (value) => (value ? 'runs' : 'skipped');
  const visual = selection.full
    ? `all ${selection.screens} screens`
    : selection.cases.length
      ? `${selection.cases.length} cases, ${selection.screens} screens (${selection.areas.join(', ')} + smoke) on ${selection.viewports ? selection.viewports.join(', ') : 'every viewport'}`
      : 'nothing visual';
  const matrix = selection.shards.filter(({ partition }) => partition).length;
  const suites = selection.shards.filter(({ partition }) => !partition).map(({ shard }) => shard);
  return [
    `### What this ${selection.full ? 'run' : 'push'} checks`,
    '',
    `Changes measured from \`${base ? base.slice(0, 7) : 'nothing'}\`.`,
    '',
    `- **UI grammar:** ${visual}; ${matrix} matrix shard(s)${suites.length ? `, ${suites.join(', ')}` : ''}`,
    `- **Game e2e:** ${yes(selection.game)}`,
    `- **Account journeys:** ${yes(selection.accounts)}${selection.journeys ? `, the ${selection.journeys.length} that play through the table` : ''}`,
    '- **Mobile quality:** runs',
    '',
    '| Changed file | Rule |',
    '| --- | --- |',
    ...selection.reasons.slice(0, 200).map(({ file, rule }) => `| \`${file}\` | ${rule} |`),
    ...(selection.reasons.length > 200 ? [`| … ${selection.reasons.length - 200} more | |`] : []),
    '',
  ].join('\n');
}

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const listGrammar = (flag) =>
  JSON.parse(
    execFileSync(process.execPath, ['scripts/verify-ui-grammar.mjs', flag], {
      cwd: mobileRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
        UI_CASES: '',
        UI_VIEWPORTS: '',
        UI_PARTITION: '',
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
  );

function changedFiles(base, head) {
  try {
    const git = (...args) => execFileSync('git', args, { cwd: mobileRoot, encoding: 'utf8' });
    git('merge-base', '--is-ancestor', base, head);
    return git('diff', '--name-only', '--no-renames', base, head).split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const full = process.argv[2] === '--full';
  const base = full ? '' : (process.argv[2] ?? '');
  const head = process.argv[3] || 'HEAD';
  const selection = selectChecks({
    base,
    files: full || !base ? [] : changedFiles(base, head),
    cases: listGrammar('--list-cases'),
    ids: listGrammar('--list'),
    journeys: tableJourneys(),
    full,
  });
  const summary = summarize(selection, base);
  console.log(summary);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `full=${selection.full}`,
        `ui=${selection.shards.length > 0}`,
        `ui_cases=${selection.full ? '' : selection.cases.join(',')}`,
        `shards=${JSON.stringify(selection.shards)}`,
        `ui_viewports=${selection.viewports?.join(',') ?? ''}`,
        `game=${selection.game}`,
        `accounts=${selection.accounts}`,
        `account_specs=${selection.journeys?.join(' ') ?? ''}`,
        '',
      ].join('\n')
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
