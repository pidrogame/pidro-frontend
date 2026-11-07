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
export type TalkSheet = 'words' | 'typing' | 'log' | 'person' | 'report' | 'reported';

/** The sheets that show what was said, or answer it: opening one reads the log. */
const READS: readonly TalkSheet[] = ['words', 'typing', 'log'];

export interface TableTalk {
  /** What each seat shows right now. */
  landed: Partial<Record<Position, Landed>>;
  /** The band's last line, once its landing has faded. */
  line: Said | null;
  /** What was said this game, on this device only. */
  log: Said[];
  /** Someone else said something while no sheet of words was open (PID-393). */
  unread: boolean;
  sheet: TalkSheet | null;
  /** Whose face was tapped, for the person and report sheets. */
  person: string | null;
  /** What the band offers to say now (PID-328), for six seconds. */
  offer: Offer | null;
  /** Who you quieted this game (PID-329), by person, not seat. */
  quiet: string[];
  open: (sheet: TalkSheet | null, person?: string) => void;
  send: (item: TalkItem) => void;
  /** What you are typing (PID-318); it waits while the sheet is closed. */
  draft: string;
  setDraft: (draft: string) => void;
  /** Sends the draft; refused words stay in the box. */
  say: () => Promise<'sent' | 'filtered' | 'failed'>;
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
  unread?: boolean;
  sheet?: TalkSheet | null;
  person?: string;
  offer?: Offer | null;
  quiet?: string[];
  draft?: string;
  /** The server refuses what is typed, as for words it filters. */
  filtered?: boolean;
  /** Upright phones: the offer's tail held this far out of the bubble (PID-396). */
  slide?: number;
  /** Upright phones: the room left of the bubble, narrower than any phone's. */
  room?: number;
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
  const [unread, setUnread] = useState(fixture?.unread ?? false);
  const open = useCallback((next: TalkSheet | null, who?: string) => {
    setSheet(next);
    if (who) setPerson(who);
    if (next && READS.includes(next)) setUnread(false);
  }, []);
  const [offer, setOffer] = useState<Offer | null>(fixture?.offer ?? null);
  const [quiet, setQuiet] = useState<string[]>(fixture?.quiet ?? []);
  const [draft, setDraft] = useState(fixture?.draft ?? '');
  const quietRef = useRef(quiet);
  const pace = useRef(FRESH_PACE);
  const where = useRef({ ...at, offered: false });
  const offerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reading = useRef(false);
  useEffect(() => {
    where.current = { ...at, offered: offer != null };
    quietRef.current = quiet;
    reading.current = sheet != null && READS.includes(sheet);
  });
  // Held on this device, gone with the game: a rematch starts a clean log.
  const [game, setGame] = useState(you.game);
  if (you.game !== game) {
    setGame(you.game);
    setLanded({});
    setLine(null);
    setLog([]);
    open(null);
    setUnread(false);
    setOffer(null);
    setQuiet([]);
    setDraft('');
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
      if (said.userId !== you.userId && !reading.current) setUnread(true);
      // The other three may answer what someone said.
      if (said.userId !== you.userId) offerNow(replyOffer(said));
    });
  }, [offerNow, show, you.seat, you.userId]);

  // Anything said answers what the band offered.
  const answer = useCallback(() => {
    if (!where.current.offered) return;
    clearTimeout(offerTimer.current);
    pace.current = answered(pace.current);
    setOffer(null);
  }, []);

  const send = useCallback(
    (item: TalkItem) => {
      // Saying a word or a face instead drops what was typed and not sent.
      setDraft('');
      open(null);
      answer();
      playActionHaptic();
      if (!you.seat) return;
      if (__DEV__ && fixture) return show({ seat: you.seat, userId: you.userId ?? '', item });
      // A send that fails says nothing: the server broadcast nothing.
      pushGameAction('talk', { item }).catch(() => undefined);
    },
    [answer, fixture, open, show, you.seat, you.userId]
  );

  // Typed talk lands from the echo too; only readers get it, the sender among them.
  const say = useCallback(async () => {
    const text = draft.trim();
    if (!text || !you.seat) return 'failed';
    if (__DEV__ && fixture) {
      if (fixture.filtered) return 'filtered';
      show({ seat: you.seat, userId: you.userId ?? '', text });
    } else {
      try {
        await pushGameAction('say', { text });
      } catch (error: unknown) {
        return (error as { error?: string } | null)?.error === 'filtered' ? 'filtered' : 'failed';
      }
    }
    setDraft('');
    open(null);
    answer();
    playActionHaptic();
    return 'sent';
  }, [answer, draft, fixture, open, show, you.seat, you.userId]);

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
    unread,
    sheet,
    person,
    offer,
    quiet,
    open,
    send,
    draft,
    setDraft,
    say,
    hush,
    report,
  };
}
