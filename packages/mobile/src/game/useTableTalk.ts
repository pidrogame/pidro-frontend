import { useCallback, useEffect, useRef, useState } from 'react';
import { onTableTalk, pushGameAction } from '@/channels/hooks/useGameChannel';
import {
  land,
  landingMs,
  saidFrom,
  type Landed,
  type Position,
  type Said,
  type TalkItem,
} from '@/features/game/talk';
import { playActionHaptic } from './useGameHaptics';

export type TalkSheet = 'words' | 'log';

export interface TableTalk {
  /** What each seat shows right now. */
  landed: Partial<Record<Position, Landed>>;
  /** The band's last line, once its landing has faded. */
  line: Said | null;
  /** What was said this game, on this device only. */
  log: Said[];
  sheet: TalkSheet | null;
  open: (sheet: TalkSheet | null) => void;
  send: (item: TalkItem) => void;
}

/** `?fixture=talk-*` seeds: they hold still for a screenshot. */
export interface TalkFixture {
  landed?: Said[];
  line?: Said | null;
  log?: Said[];
  sheet?: TalkSheet | null;
}

/**
 * Table talk at one table: what lands at each seat, the band's last line and
 * the game's log. The server is the truth: everything, yours included, lands
 * as it broadcasts it, and a failed send is dropped without a word.
 */
export function useTableTalk(
  you: { seat: Position | null; userId: string | null; game?: string },
  fixture?: TalkFixture
): TableTalk {
  const [landed, setLanded] = useState<Partial<Record<Position, Landed>>>(() =>
    Object.fromEntries(
      (fixture?.landed ?? []).map((said, i) => [said.seat, land(undefined, said, i)])
    )
  );
  const [line, setLine] = useState<Said | null>(fixture?.line ?? null);
  const [log, setLog] = useState<Said[]>(fixture?.log ?? []);
  const [sheet, open] = useState<TalkSheet | null>(fixture?.sheet ?? null);
  // Held on this device, gone with the game: a rematch starts a clean log.
  const [game, setGame] = useState(you.game);
  if (you.game !== game) {
    setGame(you.game);
    setLanded({});
    setLine(null);
    setLog([]);
    open(null);
  }
  const key = useRef(100);
  const timers = useRef<Partial<Record<Position, ReturnType<typeof setTimeout>>>>({});

  const show = useCallback((said: Said) => {
    const at = ++key.current;
    setLanded((previous) => ({ ...previous, [said.seat]: land(previous[said.seat], said, at) }));
    setLog((previous) => [...previous, said]);
    clearTimeout(timers.current[said.seat]);
    timers.current[said.seat] = setTimeout(() => {
      setLanded((previous) => {
        if (previous[said.seat]?.key !== at) return previous;
        const next = { ...previous };
        delete next[said.seat];
        return next;
      });
      setLine(said);
    }, landingMs(said));
  }, []);

  // A landing still fading must not become the next game's line.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      Object.values(pending).forEach(clearTimeout);
      for (const seat of Object.keys(pending)) delete pending[seat as Position];
    };
  }, [game]);

  // Yours lands from the server's echo too: what lands is what it took.
  useEffect(() => {
    if (!you.seat) return;
    return onTableTalk((payload) => {
      const said = saidFrom(payload);
      if (said) show(said);
    });
  }, [show, you.seat]);

  const send = useCallback(
    (item: TalkItem) => {
      open(null);
      playActionHaptic();
      if (!you.seat) return;
      if (__DEV__ && fixture) return show({ seat: you.seat, userId: you.userId ?? '', item });
      // A send that fails says nothing: the server broadcast nothing.
      pushGameAction('talk', { item }).catch(() => undefined);
    },
    [fixture, show, you.seat, you.userId]
  );

  return { landed, line, log, sheet, open, send };
}
