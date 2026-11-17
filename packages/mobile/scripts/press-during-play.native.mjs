#!/usr/bin/env node
/**
 * Release check, iOS simulator: a card pressed again while its play is still being
 * drawn lands on the table. It used to hang over the hand until your next play.
 *
 * The touch runs on the UI thread and the table redraws from the JS thread, so the
 * browser cannot show this (it commits inside the pointer event) and two Maestro
 * taps are seconds apart. The order is forced instead:
 *
 *   1. the app's JS thread is held busy, through Metro's debugger connection
 *   2. tap the playable card            (the play is queued, not drawn)
 *   3. finger down on the same card, and kept there
 *   4. the JS thread wakes and draws the play under the finger
 *   5. finger up
 *
 * Control: the same hold and the same tap, without the second press. The second
 * press has to end where the control ended. The table's dev hook reports the
 * sprites (`globalThis.__pidroCardMotion`), and its `pressed` flag is the witness
 * that step 4 happened under the finger; without it the run counts for nothing.
 *
 * Needs Metro serving Expo Go and one booted simulator that has opened the table
 * once (`just table-sim`), plus Maestro (docs/DEVICE-FLOWS.md).
 *
 *   METRO_PORT=8081 node scripts/press-during-play.native.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Metro's debugger refuses a socket without an Origin header, which Node's own WebSocket cannot send.
const WebSocket = createRequire(import.meta.url)('ws');

const PORT = process.env.METRO_PORT ?? '8081';
const METRO = `http://127.0.0.1:${PORT}`;
const TABLE = `exp://127.0.0.1:${PORT}/--/table-dev?phase=playing&role=player&locale=en`;
const HOLD_MS = Number(process.env.HOLD_MS ?? 10_500); // longer than Maestro needs to tap and press again
const PRESS_MS = Number(process.env.PRESS_MS ?? 6_000); // the JS thread wakes inside this
const MAESTRO = existsSync(`${process.env.HOME}/.maestro/bin/maestro`)
  ? `${process.env.HOME}/.maestro/bin/maestro`
  : 'maestro';
const work = mkdtempSync(join(tmpdir(), 'press-during-play-'));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const round = (n) => Math.round(n * 10) / 10;
const spot = (s) =>
  s ? `${s.kind} at ${round(s.x)}, ${round(s.y)}, scale ${round(s.scale * 100) / 100}` : 'gone';

const device = JSON.parse(
  execFileSync('xcrun', ['simctl', 'list', '-j', 'devices', 'booted'])
).devices;
const booted = Object.values(device).flat();
if (booted.length !== 1) {
  console.error(`✗ needs exactly one booted simulator, found ${booted.length}`);
  process.exit(2);
}

async function debuggerSocket() {
  const [target] = await (await fetch(`${METRO}/json/list`)).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl, { headers: { origin: METRO } });
  await new Promise((open, fail) => {
    ws.on('open', open);
    ws.on('error', fail);
  });
  let id = 0;
  const waiting = new Map();
  ws.on('message', (data) => {
    const message = JSON.parse(String(data));
    waiting.get(message.id)?.(message.result?.result?.value);
    waiting.delete(message.id);
  });
  const evaluate = (expression) =>
    new Promise((done) => {
      waiting.set(++id, done);
      ws.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true },
        })
      );
    });
  return { evaluate, close: () => ws.close() };
}

const sprites = async (js) =>
  JSON.parse((await js.evaluate('JSON.stringify(globalThis.__pidroCardMotion?.() ?? [])')) ?? '[]');

async function run(name, secondPress) {
  // A cold start: re-opening the link alone keeps the last table's state.
  try {
    execFileSync('xcrun', ['simctl', 'terminate', 'booted', 'host.exp.Exponent'], {
      stdio: 'ignore',
    });
  } catch {}
  await sleep(1_000);
  execFileSync('xcrun', ['simctl', 'openurl', 'booted', TABLE]);
  let js;
  let before = [];
  for (let tries = 0; tries < 40 && before.filter((s) => s.kind === 'hand').length !== 2; tries++) {
    await sleep(2_000);
    try {
      js?.close();
      js = await debuggerSocket();
      before = await sprites(js);
    } catch {
      before = [];
    }
  }
  await sleep(4_000); // the deal settles and the play guard lets go
  before = await sprites(js);
  const hand = before.filter((s) => s.kind === 'hand');
  if (hand.length !== 2) throw new Error(`${name}: the table did not come up with two hand cards`);
  const card = [...hand].sort((a, b) => a.y - b.y)[0]; // the playable card stands higher
  const screen = JSON.parse(
    await js.evaluate(
      'JSON.stringify(globalThis.nativeModuleProxy.DeviceInfo.getConstants().Dimensions.window)'
    )
  );
  const x = Math.round((card.x / screen.width) * 100);
  const y = Math.round((card.y / screen.height) * 100);

  const flow = join(work, `${name}.yaml`);
  writeFileSync(
    flow,
    [
      'appId: host.exp.Exponent',
      '---',
      '- takeScreenshot: ready', // Maestro's driver is up: the clock starts here
      `- tapOn:\n    point: "${x}%,${y}%"\n    waitToSettleTimeoutMs: 0`,
      // A press kept in place: 1% of travel stays inside the tap's slop.
      ...(secondPress
        ? [
            `- swipe:\n    start: "${x}%,${y}%"\n    end: "${x}%,${y + 1}%"\n    duration: ${PRESS_MS}`,
          ]
        : []),
      '',
    ].join('\n')
  );
  let drawnUnderFinger = false;
  let woke;
  const awake = new Promise((done) => (woke = done));
  const maestro = spawn(MAESTRO, ['--device', booted[0].udid, 'test', flow], { cwd: work });
  const finished = new Promise((done) => maestro.on('close', done));
  let output = '';
  let held = false;
  maestro.stdout.on('data', (chunk) => {
    output += chunk;
    if (held || !/Take screenshot.*COMPLETED/.test(output)) return;
    held = true;
    void js
      .evaluate(
        `(() => { const t = Date.now(); while (Date.now() - t < ${HOLD_MS}); return 1; })()`
      )
      .then(async () => {
        // The play is drawn now. Is the finger still on that card?
        for (let i = 0; i < 15 && !drawnUnderFinger; i++) {
          const now = (await sprites(js)).find((s) => s.key.endsWith(card.key));
          drawnUnderFinger = now?.kind === 'played' && now.pressed === true;
          await sleep(200);
        }
        woke();
      });
  });
  const code = await finished;
  if (code !== 0) throw new Error(`${name}: Maestro failed\n${output}`);
  await awake;
  await sleep(2_000); // the flight is 0.4 s; the old failure never moved again
  const after = (await sprites(js)).find((s) => s.key.endsWith(card.key));
  js.close();
  console.log(`${name}: ${card.key} was ${spot(card)}; now ${spot(after)}`);
  return { card, after, drawnUnderFinger };
}

const control = await run('one tap', false);
const pressed = await run('pressed again', true);

const landed = (r) => r.after?.kind === 'played' && r.after.y < r.card.y - r.card.height / 2;
if (!landed(control)) {
  console.error(
    '✗ control: one tap did not put the card on the table; nothing below means anything'
  );
  process.exit(2);
}
if (!pressed.drawnUnderFinger) {
  console.error(
    '✗ inconclusive: the play was not drawn while the finger was down. Rerun, or tune HOLD_MS/PRESS_MS.'
  );
  process.exit(2);
}
const off = Math.hypot(pressed.after.x - control.after.x, pressed.after.y - control.after.y);
if (
  pressed.after.kind !== 'played' ||
  off > 1 ||
  Math.abs(pressed.after.scale - control.after.scale) > 0.01
) {
  console.error(
    `✗ the card pressed again is ${round(off)} pt from where one tap puts it: it hangs over the hand`
  );
  process.exit(1);
}
console.log('✓ drawn under the finger, and the card landed where one tap puts it');
