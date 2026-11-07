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
 * Stage 4: a player with 2,800,000 XP in the backend's database sits down, and
 * the seat shows ★4; the dealer chip and the bid keep their corners. Needs the
 * backend checkout (BACKEND_DIR, default ../../backend) to write that XP.
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
    await signInThroughUi(page, username);
    log('returning-user UI login ok');
  } finally {
    await context.close();
  }
}

async function signInThroughUi(page, username) {
  await page.goto(`${mobileBaseUrl}/(auth)/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(
    ({ fixture }) => {
      localStorage.setItem('age-gate-storage', fixture);
      localStorage.setItem('news-seen:welcome', '1');
    },
    { fixture: ageGateFixture }
  );
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

// PID-114: two people at one table. One taps a word in the sheet; it lands
// at their seat on both phones and then stays as the other's last line.
async function stageThreeTableTalk() {
  const [speaker, listener] = [`ci_${suffix}c`, `ci_${suffix}d`];
  log(`stage 3: table talk between ${speaker} and ${listener}`);
  const speakerToken = await registerOrLogin(speaker);
  const listenerToken = await registerOrLogin(listener);
  for (const token of [speakerToken, listenerToken])
    await api('/api/v1/rooms/current/leave', 'DELETE', token).catch(() => {});
  const created = await api('/api/v1/rooms', 'POST', speakerToken, {
    name: `CI talk ${suffix}`,
    seats: { seat_2: 'ai', seat_4: 'ai' },
  });
  const roomCode = created.payload?.data?.code ?? created.payload?.code;
  if (!roomCode) throw new Error(`create talk room failed: ${JSON.stringify(created.payload)}`);
  const joined = await api(`/api/v1/rooms/${roomCode}/join`, 'POST', listenerToken, {});
  if (!joined.ok) throw new Error(`join talk room failed: ${JSON.stringify(joined.payload)}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const video = { dir: resolve(artifactDir, 'talk'), size: { width: 390, height: 844 } };
  const pages = [];
  let keepSeats;
  try {
    for (const name of [speaker, listener]) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        locale: 'en-US',
        recordVideo: name === listener ? video : undefined,
      });
      const page = await context.newPage();
      await signInThroughUi(page, name);
      await page.goto(`${mobileBaseUrl}/game/${roomCode}`, { waitUntil: 'domcontentloaded' });
      pages.push(page);
    }
    const [said, heard] = pages;
    // Should a seat still be sent away now and then, come back.
    keepSeats = setInterval(() => {
      for (const page of pages)
        void page
          .getByTestId('game-away-window')
          .isVisible()
          .then((away) =>
            away
              ? page.getByRole('button', { name: "I'm back" }).click({ timeout: 3_000 })
              : undefined
          )
          .catch(() => {});
    }, 500);
    await confirmInitialTable(pages, '[data-testid="game-table"]');
    // Once both phones are at the table, both people play their turns over the
    // protocol while the phones talk: a seat that only times out is sent away,
    // and then the table has one person and no band.
    for (const name of [speaker, listener])
      runAutoplayer(
        [
          ...['--room', roomCode, '--user', name, '--password', password, '--max-minutes', '6'],
          // CI pacing ends a game in under a minute: rematches keep the table going.
          ...['--rematch', 'now', '--rematches', '6', '--rematch-linger-ms', '300000'],
        ],
        `talk-${name.slice(-1)}`
      ).catch(() => {});
    for (const page of pages)
      await page.getByTestId('talk-band').first().waitFor({ timeout: 30_000 });
    log('both players see the band: two people at the table');

    // A "time ran out" notice can still sit in the band's slot. Under one,
    // press the control itself, as a screen reader does.
    const tap = async (target) => {
      await target.waitFor({ timeout: 5_000 });
      await target
        .click({ timeout: 1_500 })
        .catch(() => target.evaluate((node) => node.click(), undefined, { timeout: 2_000 }));
    };
    // The band, or the speech button beside an offer standing in its place.
    const opener = (page) =>
      page
        .getByTestId('talk-band')
        .or(page.getByTestId('talk-offer').getByTestId('talk-speech'))
        .first();
    // An adult's band opens the composer, with the words in it. Others: the log, then the words.
    // It opens at once or not at all: your turn can close it before it is seen, so do not
    // wait the default 30 s for it, which three turns would spend the whole Thanks! budget on.
    const sayFrom = async (page) => {
      await tap(opener(page));
      const log = page.getByTestId('talk-sheet-log');
      const words = page.getByTestId('talk-sheet-words');
      const typing = page.getByTestId('talk-sheet-typing');
      await log.or(words).or(typing).first().waitFor({ timeout: 5_000 });
      if (await typing.isVisible()) return typing;
      if (await log.isVisible()) await tap(log.getByTestId('talk-band'));
      await words.waitFor({ timeout: 5_000 });
      return words;
    };

    // Your turn coming closes an adult's composer, as it should; then say it again.
    const sayWord = async (item) => {
      const sheet = await sayFrom(said);
      // Turns come fast here and each closes the composer: press it, do not wait for stillness.
      await tap(sheet.getByTestId(item));
      await sheet.waitFor({ state: 'detached', timeout: 5_000 });
    };
    for (let attempt = 1; ; attempt += 1) {
      const spoken = await sayWord('talk-word_nice').then(
        () => true,
        (error) => {
          if (attempt >= 8) throw error;
          return false;
        }
      );
      if (spoken) break;
      await said.waitForTimeout(2_000);
    }
    await said.getByTestId('talk-landed').getByText('Nice trick!').waitFor({ timeout: 10_000 });

    // On the other phone it lands at the speaker's seat, the avatar nearest it.
    const landing = heard.getByTestId('talk-landed').filter({ hasText: 'Nice trick!' });
    await landing.waitFor({ timeout: 10_000 });
    await heard.screenshot({ path: resolve(artifactDir, 'talk-landed.png') });
    const at = await landing.boundingBox();
    const seats = await heard.locator('[data-testid^="seat-"][aria-label]').evaluateAll((nodes) =>
      nodes
        .filter((node) => /^seat-(north|east|south|west)$/.test(node.dataset.testid))
        .map((node) => {
          const box = node.getBoundingClientRect();
          return {
            label: node.getAttribute('aria-label'),
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
          };
        })
    );
    const nearest = seats
      .map((seat) => ({
        ...seat,
        distance: Math.hypot(seat.x - (at.x + at.width / 2), seat.y - (at.y + at.height / 2)),
      }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (!nearest?.label?.startsWith(speaker))
      throw new Error(`the word landed by ${nearest?.label}, not by ${speaker}`);
    log(`the word landed at ${speaker}'s seat on ${listener}'s phone`);

    // It fades after about three seconds and the band keeps it, unless an
    // offer stands in the band's place (bots finish tricks fast here).
    await heard
      .getByTestId('talk-band')
      .first()
      .getByText('Nice trick!')
      .or(heard.getByTestId('talk-offer'))
      .first()
      .waitFor({ timeout: 8_000 });
    await heard.screenshot({ path: resolve(artifactDir, 'talk-last-line.png') });
    log('a word sent from one phone landed on the other and stayed in its band');

    // PID-328: praise is answered. Offers wait out bidding, take one trick at a
    // time and stop for a hand after three are ignored, so say it again until
    // the other phone offers Thanks!.
    let answered = false;
    const ok = () => true;
    const lost = () => false;
    const until = Date.now() + 120_000;
    for (let attempt = 1; Date.now() < until && !answered; attempt += 1) {
      if (
        !(await opener(said)
          .isVisible()
          .catch(() => false))
      ) {
        await said.waitForTimeout(2_000);
        continue;
      }
      const spoke = await sayWord('talk-word_well').then(ok, (error) => {
        log(`Well played did not go (attempt ${attempt}): ${String(error).split('\n')[0]}`);
        return false;
      });
      if (!spoke) {
        await said.waitForTimeout(2_000);
        continue;
      }
      const thanks = heard
        .getByTestId('talk-offer')
        .getByRole('button', { name: 'Thanks!', exact: true });
      if (
        !(await thanks.waitFor({ timeout: 4_000 }).then(
          () => true,
          () => false
        ))
      ) {
        log(`no Thanks! offered yet (attempt ${attempt}); saying it again`);
        await said.waitForTimeout(2_500);
        continue;
      }
      await heard.screenshot({ path: resolve(artifactDir, 'talk-offer.png') });
      // CI pacing ends a hand in seconds: an offer can go before the tap, and
      // game over can cover the landing. Either way, say it again.
      if (!(await tap(thanks).then(ok, lost))) {
        log(`the offer went before the tap (attempt ${attempt}); saying it again`);
        continue;
      }
      const back = said.getByTestId('talk-landed').filter({ hasText: 'Thanks!' });
      if (!(await back.waitFor({ timeout: 10_000 }).then(ok, lost))) {
        log(`Thanks! was covered before it landed (attempt ${attempt}); saying it again`);
        continue;
      }
      await said.screenshot({ path: resolve(artifactDir, 'talk-reply-landed.png') });
      answered = true;
    }
    if (!answered)
      throw new Error('no offered Thanks! came back to Well played within two minutes');
    log('one tap on the offered Thanks! came back to the first phone');

    // PID-318: both are adults, so both read typed talk. What one types lands
    // at their seat on the other phone.
    const typed = `Nice five ${suffix}`;
    let landedTyped = false;
    for (let attempt = 1; attempt <= 8 && !landedTyped; attempt += 1) {
      if (!(await opener(said).isVisible().catch(lost))) {
        await said.waitForTimeout(2_000);
        continue;
      }
      // Your turn coming closes the box, as it should; then type it again.
      const typedIt = async () => {
        await tap(opener(said));
        const typing = said.getByTestId('talk-sheet-typing');
        await typing.waitFor({ timeout: 5_000 });
        await typing.locator('input').fill(typed, { timeout: 3_000 });
        await tap(typing.getByTestId('talk-say'));
      };
      if (!(await typedIt().then(ok, lost))) {
        log(`the box closed before Send (attempt ${attempt}); typing it again`);
        await said.keyboard.press('Escape').catch(lost);
        continue;
      }
      landedTyped = await heard
        .getByTestId('talk-landed')
        .filter({ hasText: typed })
        .waitFor({ timeout: 10_000 })
        .then(ok, lost);
      if (!landedTyped) log(`the typed line was covered (attempt ${attempt}); typing it again`);
    }
    if (!landedTyped) throw new Error('a typed line never landed on the other phone');
    await heard.screenshot({ path: resolve(artifactDir, 'talk-typed.png') });
    log('stage 3 passed: a typed line landed at its seat on the other phone too');
  } finally {
    clearInterval(keepSeats);
    killChildren();
    for (const page of pages) await page.context().close();
    await browser.close();
  }
}

// PID-338: a Legend at a real table. The server keeps 2,800,000 XP for this
// player, which is level 100 and four stars, and the seat says so with the
// server's numbers: "★4" under the face while the dealer is cut. During the
// hand the dealer chip holds the bottom left and the bid the top right.
async function stageFourLegendSeat() {
  const legend = `ci_${suffix}e`;
  log(`stage 4: ${legend} sits at a table with 2,800,000 XP`);
  const token = await registerOrLogin(legend);
  const me = await api('/api/v1/auth/me', 'GET', token);
  const userId = (me.payload?.data ?? me.payload)?.user?.id;
  if (!/^[0-9a-f-]{36}$/.test(userId ?? '')) throw new Error(`no user id: ${JSON.stringify(me)}`);
  await seedXp(userId, 2_800_000);
  const own = await api('/api/v1/profile', 'GET', token);
  const veteran = (own.payload?.data ?? own.payload)?.veteran;
  if (veteran?.level !== 100 || veteran?.prestige !== 4) {
    throw new Error(`the server does not count four stars: ${JSON.stringify(veteran)}`);
  }
  await api('/api/v1/rooms/current/leave', 'DELETE', token).catch(() => {});
  const created = await api('/api/v1/rooms', 'POST', token, {
    name: `CI legend ${suffix}`,
    seats: { seat_2: 'ai', seat_3: 'ai', seat_4: 'ai' },
  });
  const roomCode = created.payload?.data?.code ?? created.payload?.code;
  if (!roomCode) throw new Error(`create legend room failed: ${JSON.stringify(created.payload)}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  let keepSeat;
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await signInThroughUi(page, legend);
    await page.goto(`${mobileBaseUrl}/game/${roomCode}`, { waitUntil: 'domcontentloaded' });
    await confirmInitialTable([page], '[data-testid="game-table"]');
    // The phone only watches: the player bids and plays over the protocol, so
    // the hand gets a bid, and the seat is never sent away for missed turns.
    runAutoplayer(
      ['--room', roomCode, '--user', legend, '--password', password, '--max-minutes', '3'],
      'legend'
    ).catch(() => {});
    keepSeat = setInterval(() => {
      void page
        .getByTestId('game-away-window')
        .isVisible()
        .then((away) =>
          away
            ? page.getByRole('button', { name: "I'm back" }).click({ timeout: 3_000 })
            : undefined
        )
        .catch(() => {});
    }, 500);
    // The cut lasts three seconds; the chip shows only until the deal.
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="seat-south-level"]')?.textContent?.trim() === '★4',
      null,
      { timeout: 20_000 }
    );
    await page.screenshot({ path: resolve(artifactDir, 'legend-cut.png') });
    log('stage 4: the seat shows ★4 from the server');

    const dealer = page.locator('[data-testid^="seat-"][data-testid$="-dealer"]').first();
    const bid = page.locator('[data-testid^="seat-"][data-testid$="-bid"]').first();
    await dealer.waitFor({ timeout: 30_000 });
    await bid.waitFor({ timeout: 30_000 });
    // A badge's centre against the centre of the avatar it sits on, once it has
    // landed: the bid slides in from under the avatar (BID_ARRIVAL_MS), so it
    // counts after ten frames without moving. A badge drawn anew meanwhile is
    // measured again; one still moving after five seconds fails.
    const settle = (node) =>
      new Promise((landed, moving) => {
        const measure = () => {
          const b = node.getBoundingClientRect();
          const a = node.parentElement.getBoundingClientRect();
          return {
            seat: node.dataset.testid,
            x: b.x + b.width / 2 - (a.x + a.width / 2),
            y: b.y + b.height / 2 - (a.y + a.height / 2),
          };
        };
        let last = measure();
        let still = 0;
        const limit = setTimeout(
          () => moving(new Error(`the badge is still moving: ${JSON.stringify(last)}`)),
          5_000
        );
        const frame = () => {
          if (!node.isConnected) return (clearTimeout(limit), landed(null));
          const now = measure();
          still = now.x === last.x && now.y === last.y ? still + 1 : 0;
          last = now;
          if (still < 10) return requestAnimationFrame(frame);
          clearTimeout(limit);
          landed(now);
        };
        requestAnimationFrame(frame);
      });
    const offset = async (badge) =>
      (await badge.evaluate(settle, undefined, { timeout: 30_000 })) ?? offset(badge);
    const [d, b] = [await offset(dealer), await offset(bid)];
    await page.screenshot({ path: resolve(artifactDir, 'legend-hand.png') });
    if (!(d.x < 0 && d.y > 0))
      throw new Error(`the dealer chip left the bottom left: ${JSON.stringify(d)}`);
    if (!(b.x > 0 && b.y < 0)) throw new Error(`the bid left the top right: ${JSON.stringify(b)}`);
    if (await page.locator('[data-testid^="seat-"][data-testid$="-pin"]').count()) {
      throw new Error('a pin is drawn at the table');
    }
    log(
      `stage 4 passed: ${d.seat} at (${Math.round(d.x)}, ${Math.round(d.y)}), ${b.seat} at (${Math.round(b.x)}, ${Math.round(b.y)})`
    );
  } finally {
    clearInterval(keepSeat);
    killChildren();
    await browser.close();
    await api('/api/v1/rooms/current/leave', 'DELETE', token).catch(() => {});
  }
}

// XP lives only on the server, so the journey writes it there, the way a long
// Classic career would have. One row in the backend's own database.
function seedXp(userId, xp) {
  const backend = process.env.BACKEND_DIR ?? resolve(mobileRoot, '../../backend');
  const code = `
    Application.ensure_all_started(:postgrex)
    Application.ensure_all_started(:ecto_sql)
    {:ok, _} = PidroServer.Repo.start_link(pool_size: 1)
    Ecto.Adapters.SQL.query!(PidroServer.Repo, """
    INSERT INTO player_profiles (id, user_id, veteran_xp, inserted_at, updated_at)
    VALUES (gen_random_uuid(), $1::text::uuid, $2, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET veteran_xp = EXCLUDED.veteran_xp
    """, [System.fetch_env!("SEED_USER_ID"), String.to_integer(System.fetch_env!("SEED_XP"))])
  `;
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('mix', ['run', '--no-start', '-e', code], {
      cwd: backend,
      env: { ...process.env, SEED_USER_ID: userId, SEED_XP: String(xp) },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('close', (status) =>
      status === 0 ? resolvePromise() : rejectPromise(new Error(`seeding XP exited ${status}`))
    );
    child.on('error', rejectPromise);
  });
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
    '- Table talk: two players, a word sent from one phone landed at its seat on the other, the Thanks! it offered came back, and a typed line landed too (`talk/`, `talk-*.png`).',
    '- A Legend at the table: 2,800,000 XP on the server shows ★4 at the seat during the cut; the dealer chip sat bottom left and the bid top right during the hand (`legend-*.png`).',
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
  await stageThreeTableTalk();
  await stageFourLegendSeat();

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
