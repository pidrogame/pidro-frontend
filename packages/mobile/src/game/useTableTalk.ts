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
import {
  FRESH_PACE,
  OFFER_MS,
  answered,
  ignored,
  mayOffer,
  momentOffer,
  offered,
  replyOffer,
  type Offer,
} from '@/features/game/offers';
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
  /** What the band offers to say now (PID-328), for six seconds. */
  offer: Offer | null;
  open: (sheet: TalkSheet | null) => void;
  send: (item: TalkItem) => void;
}

/** Where the game is, for how often the band offers. */
export interface TalkAt {
  hand: number;
  /** The trick being played, as `hand:trick`. */
  trick: string;
  bidding: boolean;
  /** The band is on the table: an offer nobody sees is not offered. */
  shown: boolean;
}

/** `?fixture=talk-*` seeds: they hold still for a screenshot. */
export interface TalkFixture {
  landed?: Said[];
  line?: Said | null;
  log?: Said[];
  sheet?: TalkSheet | null;
  offer?: Offer | null;
}

/**
 * Table talk at one table: what lands at each seat, the band's last line and
 * the game's log. The server is the truth: everything, yours included, lands
 * as it broadcasts it, and a failed send is dropped without a word.
 */
export function useTableTalk(
  you: { seat: Position | null; userId: string | null; game?: string },
  at: TalkAt,
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
  const [offer, setOffer] = useState<Offer | null>(fixture?.offer ?? null);
  const pace = useRef(FRESH_PACE);
  const where = useRef({ ...at, offered: false });
  const offerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    where.current = { ...at, offered: offer != null };
  });
  // Held on this device, gone with the game: a rematch starts a clean log.
  const [game, setGame] = useState(you.game);
  if (you.game !== game) {
    setGame(you.game);
    setLanded({});
    setLine(null);
    setLog([]);
    open(null);
    setOffer(null);
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

  // A landing still fading, or an offer, must not carry into the next game.
  useEffect(() => {
    const pending = timers.current;
    pace.current = FRESH_PACE;
    return () => {
      Object.values(pending).forEach(clearTimeout);
      for (const seat of Object.keys(pending)) delete pending[seat as Position];
      clearTimeout(offerTimer.current);
    };
  }, [game]);

  // Unanswered for six seconds, it goes and counts as ignored.
  // A newer offer replacing one still up counts that one as ignored too.
  const offerNow = useCallback((next: Offer | null) => {
    const { hand, trick, shown, offered: up } = where.current;
    if (!next || !shown || !mayOffer(pace.current, where.current, next)) return;
    clearTimeout(offerTimer.current);
    if (up) pace.current = ignored(pace.current, hand);
    if (pace.current.hushed === hand) return setOffer(null);
    pace.current = offered(pace.current, trick);
    setOffer({ ...next });
    offerTimer.current = setTimeout(() => {
      pace.current = ignored(pace.current, hand);
      setOffer(null);
    }, OFFER_MS);
  }, []);

  // Yours lands from the server's echo too: what lands is what it took.
  useEffect(() => {
    if (!you.seat) return;
    return onTableTalk((event, payload) => {
      if (event === 'moment') return offerNow(momentOffer((payload as { id?: unknown })?.id));
      const said = saidFrom(payload);
      if (!said) return;
      show(said);
      // The other three may answer what someone said.
      if (said.userId !== you.userId) offerNow(replyOffer(said));
    });
  }, [offerNow, show, you.seat, you.userId]);

  const send = useCallback(
    (item: TalkItem) => {
      open(null);
      // Anything said answers what the band offered.
      if (where.current.offered) {
        clearTimeout(offerTimer.current);
        pace.current = answered(pace.current);
        setOffer(null);
      }
      playActionHaptic();
      if (!you.seat) return;
      if (__DEV__ && fixture) return show({ seat: you.seat, userId: you.userId ?? '', item });
      // A send that fails says nothing: the server broadcast nothing.
      pushGameAction('talk', { item }).catch(() => undefined);
    },
    [fixture, show, you.seat, you.userId]
  );

  return { landed, line, log, sheet, offer, open, send };
}
