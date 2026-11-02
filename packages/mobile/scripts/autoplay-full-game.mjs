/**
 * Drives a full bot game to completion over the real game channel.
 *
 * Logs in, creates (or reuses) a 3-bot room, joins game:CODE, and whenever
 * legal actions arrive it plays a simple strategy (bid the minimum once in a
 * while, otherwise pass; play the first legal card) until phase=game_over.
 * Prints every phase/score transition and the progression_summary payload —
 * this verifies the backend loop AND gives us a real game-over room to
 * inspect in the UI.
 *
 * Usage: node scripts/autoplay-full-game.mjs [--user skiatest1 | --token T] [--room CODE]
 */
import { Socket } from 'phoenix';
import WebSocket from 'ws';

const apiBaseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:4001';
const wsBaseUrl = process.env.WS_BASE_URL ?? 'ws://127.0.0.1:4001/socket';

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}
const username = argValue('--user', 'skiatest1');
const password = argValue('--password', 'hallohallo');
const fixedRoom = argValue('--room', null);
// A session token plays as that player instead of logging in (a guest has no password).
const fixedToken = argValue('--token', null);
if (args.includes('--token') && !fixedToken) {
  console.error('--token needs a session token');
  process.exit(1);
}
const maxMinutes = Number(argValue('--max-minutes', '20'));
// After game over, ask for a rematch instead of exiting: `now`, or
// `after-others` to wait until another human has asked (then `--rematch-delay-ms`
// more, so a UI recording can show the waiting state). Exits 0 once the next
// game has started in the same room and `--rematch-linger-ms` of play has passed.
const rematchMode = argValue('--rematch', null);
const rematchDelayMs = Number(argValue('--rematch-delay-ms', '0'));
const rematchLingerMs = Number(argValue('--rematch-linger-ms', '0'));
// With --leave-after-rematch the player plays the rematch to its end and then
// leaves the room over REST, which is how the others get an open seat to fill.
const leaveAfterRematch = args.includes('--leave-after-rematch');
// How many rematches in a row before the linger exit (default one).
let rematchesLeft = Number(argValue('--rematches', '1'));
if (rematchMode && !['now', 'after-others'].includes(rematchMode)) {
  console.error(`--rematch takes now or after-others, got ${rematchMode}`);
  process.exit(1);
}

function log(...parts) {
  console.log(new Date().toISOString().slice(11, 19), ...parts);
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

async function main() {
  let token = fixedToken;
  if (token) {
    log('playing with the given session token');
  } else {
    const login = await api('/api/v1/auth/login', 'POST', null, {
      username,
      password,
    });
    if (!login.ok) throw new Error(`login failed: ${login.status}`);
    token = login.payload?.data?.token ?? login.payload?.token;
    log(`logged in as ${username}`);
  }

  let roomCode = fixedRoom;
  if (roomCode) {
    // Take a seat if we don't have one yet (fresh joiner into a waiting room).
    // Never leave first: this user may already host the requested active game.
    let joined = await api(`/api/v1/rooms/${roomCode}/join`, 'POST', token, {});
    if (joined.payload?.errors?.some((error) => error.code === 'ALREADY_IN_ROOM')) {
      // This error specifically means another room; the same room uses ALREADY_SEATED.
      const left = await api('/api/v1/rooms/current/leave', 'DELETE', token);
      if (!left.ok) throw new Error(`leave other room failed: ${JSON.stringify(left.payload)}`);
      joined = await api(`/api/v1/rooms/${roomCode}/join`, 'POST', token, {});
    }
    log(
      joined.ok
        ? `took a seat in ${roomCode}`
        : `seat join skipped (${JSON.stringify(joined.payload)?.slice(0, 120) ?? joined.status})`
    );
  }
  if (!roomCode) {
    await api('/api/v1/rooms/current/leave', 'DELETE', token).catch(() => {});
    const created = await api('/api/v1/rooms', 'POST', token, {
      name: `Autoplay ${Date.now().toString().slice(-6)}`,
      seats: { seat_2: 'ai', seat_3: 'ai', seat_4: 'ai' },
    });
    if (!created.ok) throw new Error(`create room failed: ${JSON.stringify(created.payload)}`);
    roomCode = created.payload?.data?.code ?? created.payload?.code;
  }
  log(`room ${roomCode}`);

  const socket = new Socket(wsBaseUrl, {
    transport: WebSocket,
    authToken: token,
  });
  socket.connect();

  const channel = socket.channel(`game:${roomCode}`);
  let lastPhase = null;
  let lastScores = '';
  let acting = false;
  // States that arrive while an action is in flight are only remembered here.
  let latest = null;
  let finished = false;
  let progressionReceived = false;
  let progressionDeadline = null;
  let joined = false;
  let readiness = null;
  let confirmedEpoch = null;
  let readinessDeadline = null;
  let myPosition = null;
  let rematchAsked = false;
  let rematchStarted = false;
  let rematchDeadline = null;

  // Game over is where a plain run ends. A rematch run stays on the channel.
  function gameOverConfirmed() {
    if (rematchStarted && leaveAfterRematch) return leaveRoom();
    if (!rematchMode || (rematchStarted && rematchesLeft <= 0)) process.exit(0);
    if (rematchStarted) {
      // Another rematch: the vote opens again.
      rematchStarted = false;
      rematchAsked = false;
    }
    maybeAskForRematch();
  }

  async function leaveRoom() {
    const left = await api(`/api/v1/rooms/${roomCode}/leave`, 'DELETE', token);
    if (!left.ok) {
      console.error(`leaving ${roomCode} after the rematch failed: ${left.status}`);
      process.exit(5);
    }
    log(`LEFT ${roomCode} after the rematch game`);
    process.exit(0);
  }

  function maybeAskForRematch() {
    if (!rematchMode || rematchAsked || !finished || !progressionReceived) return;
    const vote = readiness;
    if (!vote || vote.status !== 'finished') return;
    if (rematchMode === 'after-others') {
      const others = (vote.ready_players ?? []).filter(
        (position) => position !== myPosition && vote.seats?.[position]?.occupant_type === 'human'
      );
      if (!others.length) return;
    }
    rematchAsked = true;
    setTimeout(() => {
      // Send the epoch of the newest vote, not the one that triggered the wait.
      const current = readiness;
      // Asking for a rematch confirms this roster for the next game.
      confirmedEpoch = current.ready_epoch;
      rematchDeadline = setTimeout(() => {
        console.error('rematch was accepted but no new game started within 30s');
        process.exit(4);
      }, 30_000);
      channel
        .push('rematch', { room_id: current.room_id, ready_epoch: current.ready_epoch })
        .receive('ok', () => log(`asked for a rematch epoch=${current.ready_epoch}`))
        .receive('error', (error) => {
          console.error('rematch rejected', error);
          process.exit(4);
        })
        .receive('timeout', () => {
          console.error('rematch timed out');
          process.exit(4);
        });
    }, rematchDelayMs);
  }

  function handleReadiness(snapshot) {
    if (!snapshot) return; // Older backends start immediately and send no snapshot.
    if (readiness && snapshot.snapshot_revision <= readiness.snapshot_revision) return;
    readiness = snapshot;
    // Game over clears readiness and bumps the epoch: that snapshot opens the
    // rematch vote, it does not change the roster this player confirmed.
    if (finished || snapshot.status === 'finished') {
      maybeAskForRematch();
      return;
    }
    if (confirmedEpoch !== null && snapshot.ready_epoch !== confirmedEpoch) {
      console.error('Readiness epoch reset after confirmation; refusing to confirm a new roster');
      process.exit(1);
    }
    if (!joined || confirmedEpoch !== null || snapshot.status !== 'waiting') return;
    if (!['north', 'east', 'south', 'west'].every((position) => snapshot.positions?.[position]))
      return;
    confirmedEpoch = snapshot.ready_epoch;
    readinessDeadline = setTimeout(() => {
      console.error(
        'Initial readiness did not start the game within 30s; another human may not be ready'
      );
      process.exit(1);
    }, 30_000);
    channel
      .push('ready', { room_id: snapshot.room_id, ready_epoch: confirmedEpoch })
      .receive('ok', () => log(`confirmed initial readiness epoch=${confirmedEpoch}`))
      .receive('error', (error) => {
        console.error('Initial ready rejected; no automatic retry', error);
        process.exit(1);
      })
      .receive('timeout', () => {
        console.error('Initial ready timed out; no automatic retry');
        process.exit(1);
      });
  }

  function chooseAction(actions, state) {
    const first = (type) => actions.find((a) => a.type === type);
    // Occasionally take the bid on the first hand so both outcomes exercise;
    // otherwise pass when possible, else minimum bid.
    const bidActions = actions.filter((a) => a.type === 'bid').sort((a, b) => a.amount - b.amount);
    if (first('select_dealer')) return ['select_dealer', {}];
    if (first('declare_trump')) {
      // pick the suit we hold most of
      const hand = state?.hands?.[state?.your_position] ?? state?.your_hand ?? [];
      const counts = {};
      for (const c of hand) counts[c.suit] = (counts[c.suit] ?? 0) + 1;
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'hearts';
      return ['declare_trump', { suit: best }];
    }
    if (first('select_hand')) {
      const act = first('select_hand');
      return ['select_hand', { cards: act.cards }];
    }
    if (first('play_card')) {
      const act = first('play_card');
      return ['play_card', { card: { rank: act.card.rank, suit: act.card.suit } }];
    }
    if (first('pass')) return ['pass', {}];
    if (bidActions.length) return ['bid', { amount: bidActions[0].amount }];
    return null;
  }

  function handleState(payload) {
    const state = payload?.state ?? payload?.game_state ?? payload;
    if (!state || typeof state !== 'object' || !('phase' in state)) return;
    if (state.phase && readinessDeadline) clearTimeout(readinessDeadline);
    const actions = payload?.legal_actions ?? [];
    latest = payload;

    const scores = JSON.stringify(state.scores ?? null);
    if (state.phase !== lastPhase || scores !== lastScores) {
      log(
        `phase=${state.phase} hand=${state.hand_number ?? '?'} scores=${scores} legal=${actions.length}`
      );
      lastPhase = state.phase;
      lastScores = scores;
    }

    if (state.phase === 'game_over' || state.phase === 'complete') {
      if (finished) return;
      log('GAME OVER', scores);
      finished = true;
      if (progressionReceived) return gameOverConfirmed();
      progressionDeadline = setTimeout(() => {
        console.error('game finished without the required progression_summary event');
        process.exit(3);
      }, 8000);
      return;
    }

    if (finished && rematchAsked && !rematchStarted) {
      // Same channel, same room code: the rematch is a new game in place.
      const total = Object.values(state.scores ?? {}).reduce((sum, value) => sum + value, 0);
      if (total !== 0) {
        console.error(`rematch started with scores ${scores}; expected a fresh game`);
        process.exit(4);
      }
      if (rematchDeadline) clearTimeout(rematchDeadline);
      rematchStarted = true;
      finished = false;
      progressionReceived = false;
      rematchesLeft -= 1;
      log(`REMATCH STARTED in ${roomCode} phase=${state.phase} scores=${scores}`);
      if (!leaveAfterRematch && rematchesLeft <= 0)
        setTimeout(() => process.exit(0), rematchLingerMs);
    }

    if (!actions.length || acting) return;
    const choice = chooseAction(actions, state);
    if (!choice) return;
    acting = true;
    // After an action chosen from a stale state is rejected, no new state arrives until
    // this seat acts: act on one that came meanwhile. (After an accepted action, one that
    // came meanwhile is older than the action.)
    const rejected = () => {
      acting = false;
      if (latest !== payload) handleState(latest);
    };
    setTimeout(() => {
      channel
        .push(choice[0], choice[1])
        .receive('ok', () => {
          acting = false;
        })
        .receive('error', (err) => {
          log(`action ${choice[0]} rejected: ${JSON.stringify(err)}`);
          rejected();
        })
        .receive('timeout', rejected);
      log(`-> ${choice[0]} ${JSON.stringify(choice[1]).slice(0, 60)}`);
    }, 400);
  }

  channel.on('game_state', handleState);
  channel.on('readiness_updated', handleReadiness);
  channel.on('progression_summary', (payload) => {
    progressionReceived = true;
    log('PROGRESSION_SUMMARY', JSON.stringify(payload));
    if (finished) {
      if (progressionDeadline) clearTimeout(progressionDeadline);
      gameOverConfirmed();
    }
  });

  channel
    .join()
    .receive('ok', (resp) => {
      log(`joined game:${roomCode} as ${resp?.position ?? '?'}`);
      if (resp?.readiness && !resp.position) {
        console.error('Autoplay must join as a seated actor before confirming readiness');
        process.exit(1);
      }
      joined = true;
      myPosition = resp?.position ?? null;
      // Reconcile any event received before the join ack, then confirm only once.
      const snapshot =
        readiness && readiness.snapshot_revision > resp?.readiness?.snapshot_revision
          ? readiness
          : (resp?.readiness ?? readiness);
      readiness = null;
      handleReadiness(snapshot);
      handleState(resp);
    })
    .receive('error', (err) => {
      console.error('join failed', err);
      process.exit(1);
    });

  setTimeout(() => {
    console.error(`timed out after ${maxMinutes} minutes; phase=${lastPhase}`);
    process.exit(2);
  }, maxMinutes * 60_000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
