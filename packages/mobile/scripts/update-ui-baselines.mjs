/**
 * Refresh the visual-regression baselines from CI.
 *
 * Downloads the ui-grammar-screenshots artifact of the latest successful
 * Frontend CI run on main (or the run given as an argument) into
 * test/ui-baselines/. A full run replaces what is there; a push that captured only
 * some screens (scripts/ci-affected.mjs) overwrites just those. Commit the result.
 *
 *   bun run ui:baselines            # latest green main run
 *   bun run ui:baselines 12345678   # a specific run id
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselineRoot = resolve(mobileRoot, 'test/ui-baselines');

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

const artifactsOf = (runId) =>
  sh(
    `gh api --paginate "repos/{owner}/{repo}/actions/runs/${runId}/artifacts" -q '.artifacts[].name'`
  )
    .split('\n')
    .filter((name) => name.startsWith('ui-grammar-screenshots'));

// No run id: the latest green main run that captured screens (a docs-only push captures none).
let runId = process.argv[2];
if (!runId) {
  const green = sh(
    `gh run list --branch main --workflow "Frontend CI" --status success --limit 20 --json databaseId -q '.[].databaseId'`
  ).split('\n');
  runId = green.find((id) => id && artifactsOf(id).length);
  if (!runId) {
    console.error('no recent successful Frontend CI run on main captured screens');
    process.exit(1);
  }
}

// A push that captured only some screens uploads ui-grammar-screenshots-partial: those
// overwrite their baselines and the rest stay. Only a full run replaces the tree.
const full = artifactsOf(runId).includes('ui-grammar-screenshots');
const name = full ? 'ui-grammar-screenshots' : 'ui-grammar-screenshots-partial';
console.log(`downloading ${name} from run ${runId} …`);
const download = mkdtempSync(join(tmpdir(), 'pidro-ui-baselines-'));
sh(`gh run download ${runId} --name ${name} --dir "${download}"`);
if (full) rmSync(baselineRoot, { recursive: true, force: true });
cpSync(download, baselineRoot, { recursive: true });
rmSync(download, { recursive: true, force: true });
console.log(`baselines refreshed in ${baselineRoot} — review with \`git diff --stat\` and commit`);
