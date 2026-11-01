import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

/** The hand of words, the game's log, or a face tapped at the table (PID-329). */
export type TalkSheet = 'words' | 'log' | 'person' | 'report' | 'reported';

export interface TableTalk {
  /** What each seat shows right now. */
  landed: Partial<Record<Position, Landed>>;
  /** The band's last line, once its landing has faded. */
  line: Said | null;
  /** What was said this game, on this device only. */
  log: Said[];
  sheet: TalkSheet | null;
  /** Whose face was tapped, for the person and report sheets. */
  person: string | null;
  /** What the band offers to say now (PID-328), for six seconds. */
  offer: Offer | null;
  /** Who you quieted this game (PID-329), by person, not seat. */
  quiet: string[];
  open: (sheet: TalkSheet | null, person?: string) => void;
  send: (item: TalkItem) => void;
  hush: (userId: string) => void;
  report: (userId: string, reason: ReportReason) => Promise<void>;
}

export type ReportReason = 'rude' | 'bothering' | 'other';

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
  person?: string;
  offer?: Offer | null;
  quiet?: string[];
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
  const [sheet, setSheet] = useState<TalkSheet | null>(fixture?.sheet ?? null);
  const [person, setPerson] = useState<string | null>(fixture?.person ?? null);
  const open = useCallback((next: TalkSheet | null, who?: string) => {
    setSheet(next);
    if (who) setPerson(who);
  }, []);
  const [offer, setOffer] = useState<Offer | null>(fixture?.offer ?? null);
  const [quiet, setQuiet] = useState<string[]>(fixture?.quiet ?? []);
  const quietRef = useRef(quiet);
  const pace = useRef(FRESH_PACE);
  const where = useRef({ ...at, offered: false });
  const offerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    where.current = { ...at, offered: offer != null };
    quietRef.current = quiet;
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
    setQuiet([]);
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
      // Someone quieted while their word was landing does not become the line.
      if (!quietRef.current.includes(said.userId)) setLine(said);
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
      if (!said || quietRef.current.includes(said.userId)) return;
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
    [fixture, open, show, you.seat, you.userId]
  );

  const hush = useCallback((userId: string) => {
    // What the band offers may answer them; it goes too.
    clearTimeout(offerTimer.current);
    setOffer(null);
    setQuiet((previous) =>
      previous.includes(userId) ? previous.filter((id) => id !== userId) : [...previous, userId]
    );
  }, []);
  // Reported once is reported: the server's "already" is a thanks too.
  const report = useCallback(
    (userId: string, reason: ReportReason) =>
      __DEV__ && fixture
        ? Promise.resolve()
        : pushGameAction('report', { user_id: userId, reason }).catch((error: unknown) => {
            if ((error as { error?: string } | null)?.error !== 'already_reported') throw error;
          }),
    [fixture]
  );

  // Quiet hides what they said too, for as long as they are quiet.
  const heard = (said: Said) => !quiet.includes(said.userId);
  const shown = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(landed).filter(([, landing]) => !quiet.includes(landing.userId))
      ) as typeof landed,
    [landed, quiet]
  );
  return {
    landed: shown,
    line: line && heard(line) ? line : null,
    log: log.filter(heard),
    sheet,
    person,
    offer,
    quiet,
    open,
    send,
    hush,
    report,
  };
}
