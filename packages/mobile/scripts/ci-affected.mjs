/** Feature pushes are bounded checks, never an implicit release test. */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SMOKE = ['table-playing', 'lobby-list', 'home', 'login'];
const SUITES = ['table-behavior', 'lobby-and-creation', 'seats-and-game-over'];
const AREAS = [
  {
    name: 'table',
    files:
      /^(app\/(game\/|table-dev|report-dev)|src\/(game\/|components\/game\/|features\/game\/|stores\/game|types\/game)|scripts\/(readiness-e2e|verify-(table|seat|dealing|waiting|game-over)))/,
    cases: ['table-playing', 'table-bidding', 'table-game-over', 'table-status-a-cut'],
    tests: ['game', 'layout', 'lobby'],
  },
  {
    name: 'lobby',
    files:
      /^(app\/(lobby|new-table|join)|src\/components\/lobby\/|scripts\/verify-(lobby|create-room))/,
    cases: ['lobby-list', 'lobby-open', 'new-table-setup', 'new-table-ready'],
    tests: ['lobby', 'invites'],
  },
  {
    name: 'auth',
    files:
      /^(app\/\((auth|onboarding)\)|app\/(welcome|age|auth-flow-dev)|src\/(features\/(auth|onboarding)\/|components\/auth\/|api\/(auth|classic)|stores\/auth))/,
    cases: ['login', 'register', 'register-name', 'welcome'],
    tests: ['auth', 'onboarding'],
  },
  {
    name: 'home',
    files:
      /^(app\/\(shell\)\/(home|profile|friends|blocked-players|league)|src\/(components\/(friends|profile|home)\/|features\/(friends\/|profile|league|news)))/,
    cases: ['home', 'profile', 'news-sheet', 'league'],
    tests: ['friends', 'profile'],
  },
  {
    name: 'settings',
    files: /^(app\/(\(shell\)\/settings|device-settings)|src\/components\/settings\/)/,
    cases: ['settings', 'device-settings'],
    tests: ['rules.test.mjs'],
  },
];
const UNIT_SMOKE = [
  'packages/mobile/test/scripts/ci-affected.test.mjs',
  'packages/mobile/test/scripts/ci-ready.test.mjs',
];
const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(mobileRoot, '../..');

// Follow local imports, including transitive consumers and the workspace package.
// Area rules below also catch source-reading tests and runtime-selected dependencies.
function affectedUnitTests(files, tests) {
  const changed = new Set(files.map((file) => resolve(repoRoot, file)));
  const graph = new Map();
  const dependencies = (file) => {
    if (graph.has(file)) return graph.get(file);
    const imports = [];
    graph.set(file, imports);
    if (!existsSync(file)) return imports;
    const source = readFileSync(file, 'utf8');
    for (const [, name] of source.matchAll(
      /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
    )) {
      const path = name.startsWith('.')
        ? resolve(dirname(file), name)
        : name.startsWith('@/')
          ? resolve(mobileRoot, 'src', name.slice(2))
          : name === '@pidro/shared'
            ? resolve(repoRoot, 'packages/shared/src/index.ts')
            : null;
      if (!path) continue;
      const target = [
        path,
        `${path}.ts`,
        `${path}.tsx`,
        `${path}.js`,
        `${path}/index.ts`,
        `${path}/index.tsx`,
      ].find((candidate) => /\.(mjs|tsx?|js)$/.test(candidate) && existsSync(candidate));
      if (target) imports.push(target);
    }
    return imports;
  };
  const reachesChange = (file, seen = new Set()) => {
    if (changed.has(file)) return true;
    if (seen.has(file)) return false;
    seen.add(file);
    return dependencies(file).some((dependency) => reachesChange(dependency, seen));
  };
  return tests.filter((test) => reachesChange(resolve(repoRoot, test)));
}

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

const unitInventory = () =>
  ['packages/mobile/test', 'packages/shared/test'].flatMap((dir) =>
    readdirSync(resolve(repoRoot, dir), { recursive: true })
      .filter((name) => /\.test\.(mjs|ts|tsx|js)$/.test(name))
      .map((name) => `${dir}/${name}`)
  );

export function selectChecks({ base, files, cases, ids, tests = [], full = false }) {
  if (full) {
    return {
      full: true,
      reasons: [{ file: '(explicit release test)', rule: 'complete regression' }],
      areas: [],
      adopt: [],
      cases: null,
      viewports: [],
      screens: ids.length,
      shards: shardsFor(ids.length, SUITES),
      unitTests: null,
      game: true,
      accounts: true,
    };
  }

  const reasons = [];
  const areas = new Set();
  const selectedTests = new Set([...UNIT_SMOKE, ...affectedUnitTests(files ?? [], tests)]);
  let visual = !base || /^0+$/.test(base) || !files;
  let shared = visual;
  let layout = false;
  if (visual)
    reasons.push({ file: '(unknown change range)', rule: 'smoke; release coverage deferred' });
  for (const file of files ?? []) {
    const path = file.replace(/^packages\/mobile\//, '');
    if (/\.test\.(mjs|ts|tsx|js)$/.test(file) && tests.includes(file)) selectedTests.add(file);
    if (/\.md$|^docs\/|^spec\/|^test\/ui-baselines\//.test(path)) {
      reasons.push({ file, rule: 'docs/baselines; no visual regression' });
      continue;
    }
    const area = AREAS.find(({ files: pattern }) => pattern.test(path));
    reasons.push({ file, rule: area?.name ?? 'shared/unknown; small smoke, not a full fallback' });
    if (area) areas.add(area);
    // Test-only changes exercise their test, not the application's screenshot inventory.
    if (/\.test\.(mjs|ts|tsx|js)$/.test(file)) continue;
    visual = true;
    shared ||= !area;
    layout ||= /\.tsx$|layout|tokens|global\.css/.test(path);
    const extraTestDir =
      path.startsWith('src/channels/') || path === 'src/bootstrap/realtime.ts'
        ? 'channels/'
        : path.startsWith('src/features/updates/')
          ? 'updates/'
          : /^app\/(_layout|index|\+native-intent)|_layout\.tsx$/.test(path)
            ? 'navigation/'
            : null;
    for (const test of tests) {
      if (area?.tests.some((dir) => test.startsWith(`packages/mobile/test/${dir}`)))
        selectedTests.add(test);
      if (extraTestDir && test.startsWith(`packages/mobile/test/${extraTestDir}`))
        selectedTests.add(test);
      if (
        /^\.github\/|scripts\/(ci-|ui-shards|verify-ui-grammar)/.test(path) &&
        test.startsWith('packages/mobile/test/scripts/')
      )
        selectedTests.add(test);
      if (file.startsWith('packages/shared/') && test.startsWith('packages/shared/test/'))
        selectedTests.add(test);
      // Include direct regressions outside the area's directories (news, league, scripts, etc.).
      const stem = path
        .split('/')
        .at(-1)
        .replace(/\.(mjs|tsx?|js)$/, '');
      if (test.split('/').at(-1).startsWith(`${stem}.test.`)) selectedTests.add(test);
    }
  }

  const known = new Set(cases.map(({ name }) => name));
  const affected = [...areas].flatMap((area) => area.cases);
  const selected = visual
    ? [...new Set([...SMOKE, ...affected, ...(shared ? ['ui-components'] : [])])]
        .filter((name) => known.has(name))
        .slice(0, 16)
    : [];
  const viewports = layout ? ['portrait', 'landscape'] : ['portrait'];
  const count = ids.filter((id) => {
    const slash = id.indexOf('/');
    return viewports.includes(id.slice(0, slash)) && selected.includes(id.slice(slash + 1));
  }).length;
  return {
    full: false,
    reasons,
    areas: [...areas].map(({ name }) => name),
    adopt: affected.filter((name) => selected.includes(name)),
    cases: selected,
    viewports,
    screens: count,
    shards: shardsFor(count, []),
    unitTests: [...selectedTests].sort(),
    // Full journeys and the multi-size behavioral suites belong to deliberate releases.
    game: false,
    accounts: false,
  };
}

function shardsFor(screens, suites) {
  const total = Math.min(15, Math.ceil(screens / 40));
  return [
    ...Array.from({ length: total }, (_, index) => ({
      shard: `matrix-${index + 1}`,
      partition: `${index + 1}/${total}`,
    })),
    ...suites.map((shard) => ({ shard, partition: '' })),
  ];
}

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
  const selection = selectChecks({
    base,
    files: full || !base ? [] : changedFiles(base, process.argv[3] || 'HEAD'),
    cases: listGrammar('--list-cases'),
    ids: listGrammar('--list'),
    tests: unitInventory(),
    full,
  });
  const summary = [
    `### ${full ? 'Release' : 'Feature'} checks`,
    `- UI: ${selection.screens} case/viewport checks; ${full ? 'every viewport/case' : selection.viewports.join(', ')} (additional state captures may follow)`,
    `- Unit: ${full ? 'complete suite' : selection.unitTests.join(', ')}`,
    `- Full game/account journeys: ${full ? 'run' : 'deferred to release'}`,
    '- Feature CI is representative regression coverage, not proof of every affected state.',
    ...selection.reasons.map(({ file, rule }) => `- \`${file}\`: ${rule}`),
    '',
  ].join('\n');
  console.log(summary);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `full=${selection.full}`,
        `ui=${selection.shards.length > 0}`,
        `ui_cases=${selection.cases?.join(',') ?? ''}`,
        `ui_viewports=${selection.viewports.join(',')}`,
        `unit_tests=${JSON.stringify(selection.unitTests)}`,
        `shards=${JSON.stringify(selection.shards)}`,
        `ui_adopt=${selection.adopt.join(',')}`,
        `game=${selection.game}`,
        `accounts=${selection.accounts}`,
        '',
      ].join('\n')
    );
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
