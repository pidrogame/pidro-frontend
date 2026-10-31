import { describe, expect, it } from 'bun:test';
import {
  ANALYTICS_EVENTS,
  claimFailure,
  firstSightOfHand,
  handKey,
  nextTableWait,
  settleOrientation,
} from '../src/features/analytics.ts';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Tilts come 5 ms apart, far inside the window even on a slow runner.
const SETTLE = 200;

describe('analytics event names', () => {
  it('are the names the PostHog insights look up, once each', () => {
    expect([...ANALYTICS_EVENTS].sort()).toEqual(
      [
        'room_created',
        'room_joined',
        'invite_previewed',
        'invite_joined',
        'guest_created',
        'hand_started',
        'orientation_changed',
        'classic_entry_tapped',
        'guest_chosen',
        'claim_started',
        'claim_succeeded',
        'claim_failed',
        'classic_forgot_started',
        'table_wait_started',
        'table_wait_ended',
      ].sort()
    );
    expect(new Set(ANALYTICS_EVENTS).size).toBe(ANALYTICS_EVENTS.length);
  });

  it('leave game_finished to the server', () => {
    expect(ANALYTICS_EVENTS).not.toContain('game_finished');
  });
});

describe('orientation debounce', () => {
  it('reports a rotation once it has held, from the orientation it left', async () => {
    const changes = [];
    const settle = settleOrientation('portrait', SETTLE, (from, to) => changes.push([from, to]));
    settle.update('landscape');
    await sleep(SETTLE * 2);
    settle.update('portrait');
    await sleep(SETTLE * 2);
    expect(changes).toEqual([
      ['portrait', 'landscape'],
      ['landscape', 'portrait'],
    ]);
  });

  it('sends nothing for a phone tilting back and forth on a table', async () => {
    const changes = [];
    const settle = settleOrientation('portrait', SETTLE, (from, to) => changes.push([from, to]));
    for (let i = 0; i < 6; i++) {
      settle.update(i % 2 ? 'portrait' : 'landscape');
      await sleep(5);
    }
    settle.update('portrait');
    await sleep(SETTLE * 2);
    expect(changes).toEqual([]);
  });

  it('reports only where a burst of tilts comes to rest', async () => {
    const changes = [];
    const settle = settleOrientation('portrait', SETTLE, (from, to) => changes.push([from, to]));
    settle.update('landscape');
    await sleep(5);
    settle.update('portrait');
    await sleep(5);
    settle.update('landscape');
    await sleep(SETTLE * 2);
    expect(changes).toEqual([['portrait', 'landscape']]);
  });

  it('drops a pending rotation when the game ends', async () => {
    const changes = [];
    const settle = settleOrientation('portrait', SETTLE, (from, to) => changes.push([from, to]));
    settle.update('landscape');
    settle.cancel();
    await sleep(SETTLE * 2);
    expect(changes).toEqual([]);
  });
});

describe('hand_started', () => {
  const starts = (room, states) =>
    states.filter((state) => {
      const key = handKey(state);
      return key !== null && firstSightOfHand(room, key);
    }).length;
  const hand = (hand_number, phase, game_instance_id) => ({
    hand_number,
    phase,
    ...(game_instance_id ? { game_instance_id } : {}),
  });

  it('counts each hand once through its phases and a reconnect into it', () => {
    expect(
      starts('ROOM1', [
        hand(1, 'dealer_selection'),
        hand(1, 'dealing'),
        hand(1, 'bidding'),
        hand(1, 'playing'),
        // The channel dropped and rejoined: the same hand's snapshot again.
        null,
        hand(1, 'playing'),
        hand(1, 'scoring'),
        hand(2, 'dealing'),
        hand(2, 'bidding'),
      ])
    ).toBe(2);
  });

  it('does not count again when the table screen comes back to the same hand', () => {
    expect(starts('ROOM2', [hand(4, 'playing')])).toBe(1);
    expect(starts('ROOM2', [hand(4, 'playing'), hand(4, 'hand_complete')])).toBe(0);
  });

  it('does not start a hand it first sees already being scored', () => {
    expect(
      starts('ROOM3', [hand(3, 'scoring'), hand(3, 'hand_complete'), hand(4, 'dealing')])
    ).toBe(1);
  });

  it("counts a rematch's first hand, with or without a game id", () => {
    expect(starts('ROOM4', [hand(1, 'bidding', 'g1'), hand(1, 'bidding', 'g2')])).toBe(2);
    expect(starts('ROOM5', [hand(9, 'playing'), hand(1, 'dealing')])).toBe(2);
  });

  it('keeps tables apart', () => {
    expect(starts('ROOM6', [hand(1, 'bidding')]) + starts('ROOM7', [hand(1, 'bidding')])).toBe(2);
  });
});

describe('table wait', () => {
  const table = (overrides) => ({
    seated: true,
    joined: true,
    background: false,
    waiting: true,
    started: false,
    vacant: 2,
    bots: 0,
    ...overrides,
  });

  it('starts only for a seated player at a table that is not full', () => {
    expect(nextTableWait(null, table({ vacant: 0 }), 0)).toEqual({ wait: null });
    expect(nextTableWait(null, table({ seated: false }), 0)).toEqual({ wait: null });
    expect(nextTableWait(null, table(), 1000)).toEqual({
      wait: { since: 1000, bots: 0 },
      started: true,
    });
  });

  it('keeps waiting as seats fill, and ends when the game starts', () => {
    const wait = { since: 1000, bots: 0 };
    expect(nextTableWait(wait, table({ vacant: 0 }), 5000)).toEqual({ wait });
    expect(
      nextTableWait(wait, table({ waiting: false, started: true, vacant: 0 }), 48_600)
    ).toEqual({ wait: null, ended: { wait_seconds: 48, outcome: 'game_started' } });
  });

  it('says bots filled the table when the game starts with more bots than the wait began with', () => {
    const wait = { since: 0, bots: 1 };
    expect(nextTableWait(wait, table({ started: true, vacant: 0, bots: 2 }), 90_000).ended).toEqual(
      {
        wait_seconds: 90,
        outcome: 'bots_added',
      }
    );
    expect(
      nextTableWait(wait, table({ started: true, vacant: 0, bots: 1 }), 0).ended?.outcome
    ).toBe('game_started');
  });

  it('counts leaving, or the app going to the background, as left', () => {
    const wait = { since: 0, bots: 0 };
    const left = { wait: null, ended: { wait_seconds: 12, outcome: 'left' } };
    expect(nextTableWait(wait, table({ seated: false }), 12_000)).toEqual(left);
    // The socket pauses in the background, so the channel is down by then too.
    expect(nextTableWait(wait, table({ background: true, joined: false }), 12_000)).toEqual(left);
  });

  it('keeps the wait through a channel reconnect that clears the seat', () => {
    const wait = { since: 0, bots: 0 };
    expect(nextTableWait(wait, table({ joined: false, seated: false }), 3000)).toEqual({ wait });
    expect(nextTableWait(wait, table(), 4000)).toEqual({ wait });
    expect(nextTableWait(null, table({ joined: false }), 0)).toEqual({ wait: null });
  });
});

describe('claim_failed', () => {
  it('carries the method and the error code, nothing else', () => {
    expect(claimFailure('password', 'INVALID_CREDENTIALS')).toEqual({
      method: 'password',
      error_code: 'INVALID_CREDENTIALS',
    });
    expect(claimFailure('password', 'email')).toEqual({ method: 'password', error_code: 'email' });
  });

  it('never carries a message or anything the player typed', () => {
    for (const code of [
      'No Classic account for bengt@example.com',
      'hunter2!',
      'Sonja Lindqvist',
      'ThunderThor88',
      undefined,
      null,
      { message: 'secret' },
    ]) {
      expect(claimFailure('apple', code)).toEqual({ method: 'apple', error_code: 'unknown' });
    }
  });
});
