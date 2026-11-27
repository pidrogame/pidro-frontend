/**
 * End-to-end gameplay gate for CI: real backend, real client code, a full game.
 *
 * A registered host opens a table with two bots and mints an invite. A clean
 * Chromium profile in Swedish opens the invite link the way a friend would:
 * age gate, Marcel's welcome, a nameless guest, and the seat. The host's
 * protocol client and the server's turn timers play the game to its end while
 * the guest watches, recorded on video; whenever the server sends the idle
 * guest away, the guest comes back with I'm back. At game over the guest
 * presses Play again, the window shows the vote, the host agrees, and the
 * second game starts in the same room without anybody navigating.
 *
 * Requires a running backend (API_BASE_URL/WS_BASE_URL) and Expo web
 * (MOBILE_BASE_URL). Artifacts land in E2E_ARTIFACT_DIR.
 *
 * Local run (backend on :4100 with CI pacing, Expo web on :8081):
 *   API_BASE_URL=http://127.0.0.1:4100 WS_BASE_URL=ws://127.0.0.1:4100/socket \
 *     bun scripts/ci-game-e2e.mjs
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { confirmInitialTable } from './readiness-e2e.mjs';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(mobileRoot, '../../..');

const apiBaseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';
const wsBaseUrl = process.env.WS_BASE_URL ?? 'ws://127.0.0.1:4000/socket';
const mobileBaseUrl = process.env.MOBILE_BASE_URL ?? 'http://localhost:8081';
const artifactDir = process.env.E2E_ARTIFACT_DIR ?? resolve(repoRoot, 'screenshots/agent-game-e2e');
const globalTimeoutMs = Number(process.env.E2E_TIMEOUT_MINUTES ?? '20') * 60_000;

const suffix = Date.now().toString(36).slice(-6);
const hostUser = `ci_${suffix}b`;
const eligibleAgeTerms = { age_band: '18_plus', terms_version: '1' };
const password = 'ci-hallohallo';

function log(...parts) {
  console.log(new Date().toISOString().slice(11, 19), '[e2e]', ...parts);
}

async function api(path, method, token, body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, payload };
}

async function registerOrLogin(username) {
  const registered = await api('/api/v1/auth/register', 'POST', null, {
    user: { username, password },
    ...eligibleAgeTerms,
  });
  if (registered.ok) {
    return registered.payload?.data?.token ?? registered.payload?.token;
  }
  const login = await api('/api/v1/auth/login', 'POST', null, {
    username,
    password,
    ...eligibleAgeTerms,
  });
  if (!login.ok) {
    throw new Error(`register failed (${registered.status}) and login failed (${login.status})`);
  }
  return login.payload?.data?.token ?? login.payload?.token;
}

function runAutoplayer(args, label) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [resolve(mobileRoot, 'scripts/autoplay-full-game.mjs'), ...args],
      {
        cwd: mobileRoot,
        env: { ...process.env, API_BASE_URL: apiBaseUrl, WS_BASE_URL: wsBaseUrl },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    children.push(child);
    const lines = [];
    const forward = (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim()) continue;
        lines.push(line);
        console.log(`[${label}]`, line);
      }
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('close', (code) => {
      if (code === 0) resolvePromise(lines);
      else rejectPromise(new Error(`${label} exited with code ${code}`));
    });
    child.on('error', rejectPromise);
  });
}

const children = [];
function killChildren() {
  for (const child of children) {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
}

async function captureMilestones(page, seen) {
  const milestones = [
    ['waiting-table', 'waiting'],
    ['bidding-window', 'bidding'],
    ['trump-picker', 'trump'],
    ['seat-north', 'playing'],
    ['game-over-window', 'game-over'],
  ];
  for (const [testId, name] of milestones) {
    if (seen.has(name)) continue;
    try {
      if (await page.getByTestId(testId).first().isVisible({ timeout: 100 })) {
        seen.add(name);
        await page.screenshot({ path: resolve(artifactDir, `${name}.png`) });
        log(`milestone: ${name}`);
      }
    } catch {
      // milestone not on screen (or page busy) — keep polling
    }
  }
}

// The guest asks for a rematch from the game-over window. Two humans sit at
// this table, so the rematch row must say the guest is in and waits on the
// host until the host's protocol client agrees; then the same URL shows a
// fresh game.
async function rematchThroughUi(page, roomCode, seen) {
  const shot = async (name) => {
    await page.screenshot({ path: resolve(artifactDir, `${name}.png`) });
    seen.add(name);
    log(`milestone: ${name}`);
  };

  const playAgain = page.getByTestId('play-again');
  await playAgain.waitFor({ timeout: 15_000 });
  await playAgain.click();

  const status = page.getByTestId('rematch-status');
  await status.waitFor({ timeout: 15_000 });
  const statusText = (await status.innerText())?.trim();
  if (!/^Du är med\nVäntar på /.test(statusText ?? '')) {
    throw new Error(`rematch row read "${statusText}", expected "Du är med / Väntar på …"`);
  }
  if (await playAgain.isEnabled()) {
    throw new Error('Play again stayed enabled after the guest asked for a rematch');
  }
  await shot('rematch-waiting');

  await page.getByTestId('game-over-window').waitFor({ state: 'hidden', timeout: 45_000 });
  await page.getByTestId('game-table').first().waitFor({ timeout: 15_000 });
  if (!new RegExp(`/game/${roomCode}$`).test(new URL(page.url()).pathname)) {
    throw new Error(`the rematch navigated away from the room: ${page.url()}`);
  }
  // Let the dealer cut and the first deal land so the shot shows the new game.
  await page.waitForTimeout(6_000);
  await shot('rematch-started');
}

async function invitedGuestPlaysToGameOver() {
  log(`an invited guest joins a room hosted by ${hostUser}`);
  const hostToken = await registerOrLogin(hostUser);
  await api('/api/v1/rooms/current/leave', 'DELETE', hostToken).catch(() => {});
  const created = await api('/api/v1/rooms', 'POST', hostToken, {
    name: `CI e2e ${suffix}`,
    seats: { seat_2: 'ai', seat_4: 'ai' },
  });
  if (!created.ok) {
    throw new Error(`create multiplayer room failed: ${JSON.stringify(created.payload)}`);
  }
  const roomCode = created.payload?.data?.code ?? created.payload?.code;
  log(`room ${roomCode} created (seat_3 open for the invite guest)`);

  const minted = await api(`/api/v1/rooms/${roomCode}/invites`, 'POST', hostToken, {
    label: 'CI guest',
    platform: 'web',
  });
  if (!minted.ok) {
    throw new Error(`mint invite failed: ${JSON.stringify(minted.payload)}`);
  }
  const inviteCode = minted.payload?.data?.invite?.code;
  if (!inviteCode) throw new Error('mint invite response had no invite code');
  log(`invite ${inviteCode} minted`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    // English host and Swedish guest share the same protocol/game. No fixture override.
    locale: 'sv-FI',
    deviceScaleFactor: 1,
    recordVideo: { dir: artifactDir, size: { width: 844, height: 390 } },
  });
  const page = await context.newPage();
  let keepSeat;
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message ?? error)));

  try {
    await page.goto(mobileBaseUrl, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${mobileBaseUrl}/join/${inviteCode}?source=copy`, {
      waitUntil: 'domcontentloaded',
    });

    const ageChoice = page.getByRole('radio', { name: '18 eller äldre' });
    await ageChoice.waitFor({ timeout: 30_000 });
    await ageChoice.click();
    await page.getByRole('button', { name: 'Fortsätt' }).click();
    log('first-launch age gate completed with an eligible answer');

    // PID-295: Marcel's welcome meets the new player before their first table.
    await page.getByTestId('welcome-sheet').waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Nu spelar vi', exact: true }).click();
    await page.getByTestId('welcome-sheet').waitFor({ state: 'detached' });
    log('first-launch welcome read and closed');

    await page.getByTestId('welcome-quick-game').click();
    await page.getByTestId('invite-rule-set').waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Gå med vid bordet', exact: true }).click();
    await page.waitForURL(new RegExp(`/game/${roomCode}$`), { timeout: 30_000 });
    log('nameless guest created and invite redeemed through the UI');

    // Keep the guest seated for every scenario below: whenever the server
    // removes it for missed turns, press I'm back. This polls instead of using
    // addLocatorHandler because the script also sits in `await autoplayDone`
    // for a whole game, where no Playwright action would run the handler.
    let awayReturns = 0;
    let returning = false;
    const away = page.getByTestId('game-away-window');
    keepSeat = setInterval(async () => {
      if (returning || !(await away.isVisible().catch(() => false))) return;
      returning = true;
      awayReturns += 1;
      log(`guest away after missed turns (${awayReturns}): pressing I'm back`);
      await page
        .getByRole('button', { name: 'Jag är tillbaka' })
        .click({ timeout: 5_000 })
        .catch(() => {});
      returning = false;
    }, 500);

    const seen = new Set();
    await captureMilestones(page, seen);

    await confirmInitialTable([page], '[data-testid="game-table"]', {
      waitForStart: false,
      readyLabel: 'Jag är redo',
      onWaiting: () => captureMilestones(page, seen),
    });
    // Guest confirms first; the registered host confirms on its joined autoplay channel.
    // After game over the host agrees to a rematch only once the guest has
    // asked in the UI, a few seconds later so the recording shows the vote. It
    // stays while the guest sees the new deal.
    const autoplayDone = runAutoplayer(
      [
        ...['--room', roomCode, '--user', hostUser, '--password', password],
        ...['--max-minutes', '16', '--rematch', 'after-others'],
        ...['--rematch-delay-ms', '4000', '--rematch-linger-ms', '10000'],
      ],
      'multi'
    );

    // The UI seat never acts: the backend's turn timers play it. Poll for
    // milestone screenshots until the game-over overlay appears in the UI.
    const deadline = Date.now() + globalTimeoutMs;
    let uiGameOver = false;
    while (Date.now() < deadline) {
      await captureMilestones(page, seen);
      if (seen.has('game-over')) {
        uiGameOver = true;
        break;
      }
      await page.waitForTimeout(1_500);
    }
    if (!uiGameOver) {
      throw new Error('the UI never showed game-over-window');
    }
    await rematchThroughUi(page, roomCode, seen);
    await autoplayDone;
    if (awayReturns === 0) throw new Error('the idle guest was never sent to the away screen');
    log(
      `passed: game over and a rematch in the same room; the guest came back ${awayReturns} time(s) (milestones: ${[...seen].join(', ')})`
    );
    if (pageErrors.length) {
      log(`note: ${pageErrors.length} page error(s) during the game (non-fatal):`);
      for (const err of pageErrors.slice(0, 5)) log(`  ${err}`);
    }
    return { roomCode, milestones: [...seen], pageErrors: pageErrors.length };
  } catch (error) {
    await page.screenshot({ path: resolve(artifactDir, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    clearInterval(keepSeat);
    await context.close(); // flushes the video file
    await browser.close();
    // Chromium can leave more than one video segment; keep the largest as
    // the game recording and drop the rest.
    const segments = readdirSync(artifactDir)
      .filter((file) => file.endsWith('.webm') && file !== 'game.webm')
      .sort(
        (a, b) => statSync(resolve(artifactDir, b)).size - statSync(resolve(artifactDir, a)).size
      );
    segments.forEach((file, index) => {
      if (index === 0) renameSync(resolve(artifactDir, file), resolve(artifactDir, 'game.webm'));
      else rmSync(resolve(artifactDir, file));
    });
  }
}

function writeStepSummary(result, elapsedSeconds) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const lines = [
    '## Game e2e',
    '',
    `An invited guest joins by link and plays to game over (real UI, room \`${result.roomCode}\`), then a rematch starts in the same room, in ${elapsedSeconds}s.`,
    '',
    `- UI milestones captured: ${result.milestones.join(', ')}`,
    `- Page errors during the UI game: ${result.pageErrors}`,
    '- Video + screenshots: see the `game-e2e-artifacts` artifact on this run.',
    '',
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}

async function main() {
  const startedAt = Date.now();
  mkdirSync(artifactDir, { recursive: true });
  const watchdog = setTimeout(() => {
    console.error(`e2e watchdog: exceeded ${globalTimeoutMs / 60000} minutes, aborting`);
    killChildren();
    process.exit(1);
  }, globalTimeoutMs);

  const result = await invitedGuestPlaysToGameOver();

  clearTimeout(watchdog);
  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
  writeStepSummary(result, elapsedSeconds);
  log(`e2e passed in ${elapsedSeconds}s`);
  process.exit(0);
}

main().catch((error) => {
  console.error('game e2e failed:', error);
  killChildren();
  process.exit(1);
});
