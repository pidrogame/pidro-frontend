/**
 * Visual regression check: compare the UI-grammar captures against the
 * committed baselines in test/ui-baselines/ and fail when a screen drifted
 * by more than the threshold. Diff images land next to the captures.
 *
 * Baselines are CI renders (Linux Chromium) — running this against captures
 * from a Mac will flag font/antialiasing noise, so it is wired into CI, not
 * the local loop. Refresh baselines after an intentional visual change with
 * `bun run ui:baselines` (pulls the latest green main run's captures).
 *
 * A push that ran only some screens (scripts/ci-affected.mjs) sets UI_DIFF_PARTIAL=1:
 * the screens it captured are compared, the rest are left to the release test.
 *
 * UI_ADOPT names the cases the change draws (scripts/ci-affected.mjs). Their drift, and
 * their captures with no baseline yet, become the new baselines in the checkout for CI
 * to commit; drift anywhere else still fails.
 */
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselineRoot = resolve(mobileRoot, 'test/ui-baselines');
const captureRoot =
  process.env.UI_SHOT_DIR ?? resolve(mobileRoot, '../../../screenshots/agent-mobile-ui');
const diffRoot = resolve(captureRoot, 'diffs');

// Percentage of pixels allowed to differ before a screen counts as drifted.
// Generous enough to absorb antialiasing jitter; a broken layout moves far
// more than this.
const MAX_DIFF_PERCENT = Number(process.env.UI_DIFF_MAX_PERCENT ?? '2');

// Screens with ongoing motion at capture time — not stable enough to diff.
// The kill clears as the first card lands (PID-306): asserted, not diffed.
const SKIP = new Set(['table-completed-trick', 'table-two-rows-kill']);
const PARTIAL = process.env.UI_DIFF_PARTIAL === '1';
const ADOPT = new Set(process.env.UI_ADOPT?.split(',').filter(Boolean));

if (!existsSync(baselineRoot)) {
  console.error(`no baselines at ${baselineRoot} — run \`bun run ui:baselines\` first`);
  process.exit(1);
}
if (!existsSync(captureRoot)) {
  console.error(`no captures at ${captureRoot} — run the UI grammar suite first`);
  process.exit(1);
}

const failures = [];
const adopted = [];
let compared = 0;
let notCaptured = 0;

for (const viewport of readdirSync(baselineRoot, { withFileTypes: true })) {
  if (!viewport.isDirectory()) continue;
  for (const file of readdirSync(resolve(baselineRoot, viewport.name))) {
    if (!file.endsWith('.png')) continue;
    const caseName = file.replace(/\.png$/, '');
    const label = `${viewport.name}/${caseName}`;
    if (SKIP.has(caseName)) continue;

    const capturePath = resolve(captureRoot, viewport.name, file);
    if (!existsSync(capturePath)) {
      if (PARTIAL) {
        notCaptured += 1;
        continue;
      }
      failures.push(`missing capture for ${label} (screen removed? refresh baselines)`);
      continue;
    }

    const baseline = PNG.sync.read(readFileSync(resolve(baselineRoot, viewport.name, file)));
    const capture = PNG.sync.read(readFileSync(capturePath));
    const drifted = (why) => {
      if (!ADOPT.has(caseName)) return failures.push(`${label}: ${why}`);
      copyFileSync(capturePath, resolve(baselineRoot, viewport.name, file));
      adopted.push(`${label}: ${why}`);
    };
    if (baseline.width !== capture.width || baseline.height !== capture.height) {
      drifted(
        `size changed ${baseline.width}x${baseline.height} → ${capture.width}x${capture.height}`
      );
      continue;
    }

    const diff = new PNG({ width: baseline.width, height: baseline.height });
    const differing = pixelmatch(
      baseline.data,
      capture.data,
      diff.data,
      baseline.width,
      baseline.height,
      {
        threshold: 0.15,
        includeAA: false,
      }
    );
    const percent = (differing / (baseline.width * baseline.height)) * 100;
    compared += 1;

    if (percent > MAX_DIFF_PERCENT) {
      mkdirSync(resolve(diffRoot, viewport.name), { recursive: true });
      writeFileSync(resolve(diffRoot, viewport.name, file), PNG.sync.write(diff));
      drifted(`${percent.toFixed(2)}% of pixels differ (limit ${MAX_DIFF_PERCENT}%)`);
    }
  }
  // A case the change adds has no baseline yet: its first capture becomes one.
  const captured = resolve(captureRoot, viewport.name);
  if (!existsSync(captured)) continue;
  for (const file of readdirSync(captured)) {
    const caseName = file.replace(/\.png$/, '');
    if (!file.endsWith('.png') || !ADOPT.has(caseName) || SKIP.has(caseName)) continue;
    if (existsSync(resolve(baselineRoot, viewport.name, file))) continue;
    copyFileSync(resolve(captured, file), resolve(baselineRoot, viewport.name, file));
    adopted.push(`${viewport.name}/${caseName}: new screen`);
  }
}

console.log(
  `visual diff: ${compared} screens compared, ${failures.length} drifted` +
    (adopted.length ? `, ${adopted.length} to adopt as this change's new baselines` : '') +
    (PARTIAL ? `, ${notCaptured} not captured by this run` : '')
);
for (const line of adopted) console.log(`  ↻ ${line}`);
if (adopted.length && process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `### ${adopted.length} screens to adopt as new baselines`,
      '',
      'They are screens this change draws (scripts/ci-affected.mjs). Adopt baselines commits them once the whole run is green.',
      '',
      ...adopted.map((line) => `- \`${line.replace(': ', '`: ')}`),
      '',
    ].join('\n')
  );

if (failures.length) {
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(`diff images: ${diffRoot}`);
  console.error(
    `intentional change? review this run's captures and refresh with \`bun run ui:baselines ${process.env.GITHUB_RUN_ID ?? '<runId>'}\``
  );
  process.exit(1);
}
