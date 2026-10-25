/**
 * End-to-end gameplay gate for CI: real backend, real client code, full games.
 *
 * Stage 1 — solo gate: registers a throwaway account and runs
 * autoplay-full-game.mjs (3-bot room, protocol client) to game_over. This
 * exercises room creation, the game channel, legal_actions and progression
 * against the live server with zero UI variables. It then asks for a rematch:
 * the bots are still seated, so a fresh game must start in the same room on
 * the human's word alone.
 *
 * Stage 2 — invite guest video: a registered host creates a room and invite.
 * The registered host first signs in through the real UI. A clean Chromium
 * profile then opens the join route, creates a guest, redeems the invite, and
 * sits at the table. The host's protocol client and server turn timers finish
 * the game while the guest watches in the client, recorded on video. Each time
 * the server removes the idle guest for missed turns, the guest comes back
 * through the away screen's I'm back button. At game
 * over the guest presses Play again in the UI, the window shows the vote, the
 * host agrees, and the second game starts in the same room without anybody
 * navigating. Before that game ends, the guest loses its socket and misses
 * completion and the host's leave. On rejoin it must return to the waiting
 * table with the seat open. The guest (now the host) fills
 * it with a bot, readies up, and a third game starts in the same room.
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
const soloUser = `ci_${suffix}a`;
const hostUser = `ci_${suffix}b`;
const eligibleAgeTerms = { age_band: '18_plus', terms_version: '1' };
const ageGateFixture = JSON.stringify({
  state: { ageBand: '18_plus', termsVersion: '1' },
  version: 0,
});
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

// The host played the rematch to its end and left. The room must come back as
// a waiting table on the same URL, with the guest in charge of it: they seat a
// bot in the open seat, ready up, and a third game starts.
async function fillTheOpenSeatThroughUi(page, roomCode, seen) {
  const shot = async (name) => {
    await page.screenshot({ path: resolve(artifactDir, `${name}.png`) });
    seen.add(name);
    log(`milestone: ${name}`);
  };
  const sameRoom = () => new RegExp(`/game/${roomCode}$`).test(new URL(page.url()).pathname);

  await page.getByTestId('waiting-table').waitFor({ timeout: 60_000 });
  if (!sameRoom()) throw new Error(`the open seat navigated away from the room: ${page.url()}`);
  // The original host occupied north; its departure leaves that row vacant.
  const openSeat = page.getByTestId('new-table-seat-north');
  await openSeat.waitFor({ timeout: 15_000 });
  await shot('seat-open');

  await openSeat.click();
  await page.getByTestId('seat-picker-container').getByRole('radio', { name: /^Bot,/ }).click();
  const ready = page.getByRole('button', { name: 'Jag är redo' });
  await ready.waitFor({ timeout: 15_000 });
  await shot('seat-filled');
  await ready.click();

  await page.getByTestId('waiting-table').waitFor({ state: 'hidden', timeout: 30_000 });
  await page.getByTestId('game-table').first().waitFor({ timeout: 15_000 });
  if (!sameRoom()) throw new Error(`the third game navigated away from the room: ${page.url()}`);
  // Still a seated player in the new game: the scoreboard reads Us/Them for a
  // player and N/S – E/W for anybody else. Headless Chromium drops the socket
  // now and then, so allow a rejoin before judging.
  await page.getByText('DE', { exact: true }).first().waitFor({ timeout: 30_000 });
  await page
    .getByRole('button', { name: 'VI 0, DE 0. Alla givar.', exact: true })
    .waitFor({ timeout: 15_000 });
  await page.waitForTimeout(3_000);
  if (
    await page
      .getByTestId('game-over-window')
      .isVisible()
      .catch(() => false)
  ) {
    throw new Error("the third game started under the finished game's game-over window");
  }
  await shot('third-game-started');
}

async function verifyUiLogin(browser, username) {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    locale: 'en-US',
  });
  const page = await context.newPage();

  try {
    await page.goto(`${mobileBaseUrl}/(auth)/login`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(({ fixture }) => localStorage.setItem('age-gate-storage', fixture), {
      fixture: ageGateFixture,
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    const userField = page.getByLabel('Email or username', { exact: true });
    const passField = page.getByLabel('Password', { exact: true });
    const signIn = page.getByRole('button', { name: 'Sign in' });
    await userField.waitFor({ timeout: 30_000 });
    let formReady = false;
    for (let attempt = 0; attempt < 6 && !formReady; attempt += 1) {
      await userField.fill(username);
      await passField.fill(password);
      await page.waitForTimeout(500);
      formReady = await signIn.isEnabled();
    }
    if (!formReady) throw new Error('Sign in never enabled — login form did not accept input');
    await signIn.click();
    await page.waitForURL(/\/home$/, { timeout: 20_000 });
    log('returning-user UI login ok');
  } finally {
    await context.close();
  }
}

async function stageOneSoloGame() {
  log(`stage 1: solo full game as ${soloUser}`);
  await registerOrLogin(soloUser);
  const lines = await runAutoplayer(
    ['--user', soloUser, '--password', password, '--max-minutes', '8', '--rematch', 'now'],
    'solo'
  );
  if (!lines.some((line) => line.includes('REMATCH STARTED'))) {
    throw new Error('solo autoplayer exited without starting a rematch');
  }
  log('stage 1 passed: solo game reached game_over, then a rematch started in the same room');
}

async function stageTwoMultiplayerVideo() {
  log(`stage 2: invite guest joins a room hosted by ${hostUser}`);
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

  // PID-108: miss completion AND the host's leave, then hydrate a waiting
  // room over a cached nonterminal game. Intercept transport, not app state.
  let interruptCompletion = false;
  let interrupted = false;
  let hostHasLeft = false;
  let lastPhase;
  let interruptedPhase;
  // The guest's seat never acts, so every third turn timeout the server kicks
  // it (force_disconnect) and the app shows the away screen until the guest
  // presses I'm back. A kick on the last tricks can miss completion and the
  // leave without a terminal frame.
  let kicked = false;
  let rejoinedWaiting = false;
  let freshGameReceived = false;
  const terminalPhases = ['complete', 'game_over', 'finished'];
  await page.routeWebSocket(/\/socket\/websocket/, (socket) => {
    if (interrupted && !hostHasLeft) {
      void socket.close({ code: 1012, reason: 'Hold reconnect until host leaves' });
      return;
    }
    const server = socket.connectToServer();
    let dropped = false;
    server.onMessage((message) => {
      if (dropped) return;
      const [, , topic, event, payload] = JSON.parse(String(message));
      if (topic === `game:${roomCode}`) {
        const data = event === 'phx_reply' && payload.status === 'ok' ? payload.response : payload;
        const state = data.state ?? data.game_state;
        if (event === 'force_disconnect') kicked = true;
        const kickMissedCompletion =
          kicked && event === 'phx_reply' && data.readiness?.status === 'waiting' && !state;
        if (state) kicked = false;
        if (
          interruptCompletion &&
          !interrupted &&
          (kickMissedCompletion ||
            event === 'game_over' ||
            terminalPhases.includes(state?.phase) ||
            data.readiness?.status === 'finished' ||
            (event === 'readiness_updated' && payload.status === 'finished'))
        ) {
          interrupted = true;
          interruptedPhase = lastPhase;
          dropped = true;
          log(`PID-108: dropping guest socket before ${event}; cached phase=${lastPhase}`);
          void server.close();
          void socket.close({ code: 1012, reason: 'Miss completion and host leave' });
          return;
        }
        if (interrupted && !hostHasLeft) return;
        if (state) lastPhase = state.phase;
        if (interrupted && event === 'phx_reply' && payload.status === 'ok') {
          if (data.readiness?.status === 'waiting' && !state) {
            rejoinedWaiting = true;
            log('PID-108: rejoined waiting room without game state');
          }
        }
        if (
          rejoinedWaiting &&
          state?.scores?.north_south === 0 &&
          state?.scores?.east_west === 0 &&
          !terminalPhases.includes(state.phase)
        ) {
          freshGameReceived = true;
        }
      }
      socket.send(message);
    });
  });

  try {
    await verifyUiLogin(browser, hostUser);
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
    // then plays the rematch to its end and leaves the room.
    const autoplayDone = runAutoplayer(
      [
        ...['--room', roomCode, '--user', hostUser, '--password', password],
        ...['--max-minutes', '16', '--rematch', 'after-others'],
        ...['--rematch-delay-ms', '4000', '--leave-after-rematch'],
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
    interruptCompletion = true;
    await autoplayDone;
    // The host process can exit before Playwright handles the guest's queued frames.
    for (let attempt = 0; attempt < 150 && !interrupted; attempt += 1) {
      await page.waitForTimeout(100);
    }
    if (!interrupted || !interruptedPhase || terminalPhases.includes(interruptedPhase)) {
      throw new Error(`PID-108: did not interrupt a nonterminal game (phase=${interruptedPhase})`);
    }
    const reopened = await api(`/api/v1/rooms/${roomCode}`, 'GET', hostToken);
    if (!reopened.ok || reopened.payload?.data?.room?.status !== 'waiting') {
      throw new Error('PID-108: host leave did not reopen the room');
    }
    hostHasLeft = true;
    await page.getByTestId('waiting-table').waitFor({ timeout: 60_000 });
    if (!rejoinedWaiting || (await page.getByTestId('game-table').first().isVisible())) {
      throw new Error('PID-108: waiting rejoin did not replace the stale game canvas');
    }
    await fillTheOpenSeatThroughUi(page, roomCode, seen);
    if (!freshGameReceived) throw new Error('PID-108: no fresh game state after readying');
    if (awayReturns === 0) throw new Error('the idle guest was never sent to the away screen');
    log(
      `stage 2 passed: game over, a rematch, then a bot in the seat the host left; the guest came back ${awayReturns} time(s) (milestones: ${[...seen].join(', ')})`
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
    `Full solo game (protocol) and invite-to-guest multiplayer game (real UI, room \`${result.roomCode}\`): game over, a rematch in the same room, then the host left and a bot filled the seat for a third game, in ${elapsedSeconds}s.`,
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

  await stageOneSoloGame();
  const result = await stageTwoMultiplayerVideo();

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
