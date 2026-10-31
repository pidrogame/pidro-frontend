import { useEffect, useRef, useState } from 'react';
import { AppState, useWindowDimensions } from 'react-native';
import { captureAnalytics } from './PostHogAnalytics';
import {
  firstSightOfHand,
  handKey,
  hasBots,
  nextTableWait,
  orientationOf,
  seatCounts,
  settleOrientation,
  type TableWait,
} from '@/features/analytics';
import { useGameStore } from '@/stores/game';

const ORIENTATION_SETTLE_MS = 2000;

/** What a seated player does at a table: waiting for it, its hands, and how they hold the phone. */
export function useTableAnalytics(roomCode: string | undefined) {
  const { width, height } = useWindowDimensions();
  const orientation = orientationOf(width, height);
  const player = useGameStore((s) => s.role === 'player' && s.youPositionAbs != null);
  const spectator = useGameStore((s) => s.role === 'spectator');
  const joined = useGameStore((s) => s.isChannelJoined);
  const readiness = useGameStore((s) => s.readiness);
  const lifecycle = useGameStore((s) => s.lifecycle);
  const state = useGameStore((s) => s.serverState);
  const [background, setBackground] = useState(AppState.currentState === 'background');
  const { vacant, bots } = seatCounts(readiness);
  const withBots = hasBots(readiness, lifecycle);
  const waiting = readiness?.status === 'waiting' || readiness?.status === 'ready';
  const started = !!state && !waiting;
  const ruleSet = state?.variant ?? readiness?.config?.rule_set ?? null;
  const hand = player ? handKey(state) : null;
  const handNumber = state?.hand_number ?? null;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) =>
      setBackground(next === 'background')
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!roomCode || !hand || !firstSightOfHand(roomCode, hand)) return;
    captureAnalytics('hand_started', {
      orientation,
      rule_set: ruleSet,
      room_code: roomCode,
      has_bots: withBots,
    });
  }, [hand, orientation, roomCode, ruleSet, withBots]);

  const wait = useRef<TableWait | null>(null);
  useEffect(() => {
    const next = nextTableWait(
      wait.current,
      { seated: player, joined, background, waiting, started, vacant, bots },
      Date.now()
    );
    wait.current = next.wait;
    if (next.started) captureAnalytics('table_wait_started');
    if (next.ended) captureAnalytics('table_wait_ended', next.ended);
  }, [background, bots, joined, player, started, vacant, waiting]);
  useEffect(
    () => () => {
      const next = nextTableWait(
        wait.current,
        {
          seated: false,
          joined: true,
          background: false,
          waiting: false,
          started: false,
          vacant: 0,
          bots: 0,
        },
        Date.now()
      );
      wait.current = null;
      if (next.ended) captureAnalytics('table_wait_ended', next.ended);
    },
    []
  );

  // Only a player's rotations during a game count, through a reconnect too; the
  // settled orientation starts from the one the game was entered in.
  const inGame = started && !spectator;
  const latest = useRef({ orientation, handNumber });
  const tracker = useRef<ReturnType<typeof settleOrientation> | null>(null);
  useEffect(() => {
    latest.current = { orientation, handNumber };
    tracker.current?.update(orientation);
  }, [handNumber, orientation]);
  useEffect(() => {
    if (!inGame) return;
    const settle = settleOrientation(
      latest.current.orientation,
      ORIENTATION_SETTLE_MS,
      (from, to) =>
        captureAnalytics('orientation_changed', {
          from,
          to,
          hand_number: latest.current.handNumber,
        })
    );
    tracker.current = settle;
    return () => {
      settle.cancel();
      tracker.current = null;
    };
  }, [inGame]);
}
