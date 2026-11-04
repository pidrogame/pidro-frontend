import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import type { ActiveTurnTimer, Card } from '@/types/game';
import { optimisticPlay, turnLight, type PendingPlay } from '@/features/game/playPresentation';
import type { TableModel } from './tableModel';
import {
  PLAY_CARD_TRAVEL_MS,
  PLAY_CONFIRM_TIMEOUT_MS,
  TRICK_TRANSITION_MS,
} from './animationTiming';
import { cardKey } from './cardKey';
import { blockedPlay } from '@/diagnostics/actions';
import { cardPlayed } from '@/features/game/sounds';
import { play } from '../sounds';

const cards = (model: TableModel) =>
  Object.values(model.playedCards)
    .flat()
    .map((c) => c.textureKey)
    .sort()
    .join('|');
const transitionEnd = (timer: ActiveTurnTimer | null) =>
  timer?.phase === 'playing'
    ? timer.receivedAtMs +
      Math.max(0, Math.min(timer.transitionDelayMs, timer.remainingMs - timer.durationMs))
    : 0;

export function usePlayPresentation(
  source: TableModel,
  send: (card: Card) => Promise<boolean | void> | boolean | void,
  timer: ActiveTurnTimer | null = null
) {
  const reduced = useReducedMotion();
  const [, tick] = useState(0);
  // This clock only schedules presentation deadlines; it never changes game state.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const [pending, setPending] = useState<PendingPlay | null>(null);
  const pendingRef = useRef(pending);
  const [motion, setMotion] = useState({
    source,
    live: false,
    landsAt: 0,
    collectUntil: transitionEnd(timer),
    pendingLanding: null as { delayMs: number } | null,
    pendingHold: null as { delayMs: number } | null,
    previousTurn: source.currentTurnRelative,
  });
  const changed = cards(source) !== cards(motion.source);
  // Compare content, not identity: the deal hooks create presentation objects
  // during render. Derive before paint so a new server turn cannot flash.
  if (
    changed ||
    source.phase !== motion.source.phase ||
    source.lastTrick?.number !== motion.source.lastTrick?.number ||
    source.currentTurnRelative !== motion.source.currentTurnRelative
  ) {
    const completed =
      source.lastTrick?.number !== motion.source.lastTrick?.number && !!source.lastTrick;
    const confirmed = pending && !source.yourHand.some((card) => card.key === pending.card.key);
    const pendingLanding =
      source.phase !== 'playing'
        ? null
        : changed
          ? confirmed || reduced
            ? null
            : { delayMs: PLAY_CARD_TRAVEL_MS }
          : motion.pendingLanding;
    const landsAt =
      source.phase !== 'playing'
        ? 0
        : changed
          ? pendingLanding
            ? Infinity
            : (confirmed ? pending.startedAt : now) + (reduced ? 0 : PLAY_CARD_TRAVEL_MS)
          : motion.landsAt;
    const resetHold = source.phase !== 'playing' || !source.lastTrick;
    const delayMs = source.transitionDelayMs ?? TRICK_TRANSITION_MS;
    const pendingHold = resetHold
      ? null
      : completed
        ? delayMs > 0 || pendingLanding
          ? { delayMs }
          : null
        : motion.pendingHold;
    setMotion({
      source,
      live: motion.live || changed || completed,
      landsAt,
      collectUntil: resetHold
        ? 0
        : completed
          ? pendingHold
            ? Infinity
            : Math.max(landsAt, now + delayMs)
          : motion.collectUntil,
      pendingLanding,
      pendingHold,
      previousTurn: changed
        ? turnLight({
            turn: motion.source.currentTurnRelative,
            previousTurn: motion.previousTurn,
            now,
            landsAt: motion.landsAt,
            collectUntil: motion.collectUntil,
            pending: false,
          })
        : motion.previousTurn,
    });
  }
  // Server-driven motion starts after commit; confirmation keeps the optimistic
  // landing clock. A slow render must not consume landing or reading time.
  useEffect(() => {
    const landing = motion.pendingLanding;
    const hold = motion.pendingHold;
    if (!landing && !hold) return;
    const frame = requestAnimationFrame(() => {
      const startedAt = Date.now();
      setMotion((current) => {
        if (current.pendingLanding !== landing || current.pendingHold !== hold) return current;
        const landsAt = landing ? startedAt + landing.delayMs : current.landsAt;
        return {
          ...current,
          pendingLanding: null,
          pendingHold: null,
          landsAt,
          collectUntil: hold ? Math.max(landsAt, startedAt + hold.delayMs) : current.collectUntil,
        };
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [motion.pendingLanding, motion.pendingHold]);

  // A live trick uses its own snapshot's delay, even zero. Timer events can
  // arrive in either order; only a cold load needs their remaining hold.
  const collectUntil = motion.live
    ? motion.collectUntil
    : Math.max(motion.collectUntil, transitionEnd(timer));
  const expiresAt = pending ? pending.startedAt + PLAY_CONFIRM_TIMEOUT_MS : 0;
  const pendingLandsAt = pending ? pending.startedAt + (reduced ? 0 : PLAY_CARD_TRAVEL_MS) : 0;
  useEffect(() => {
    const deadlines = [motion.landsAt, pendingLandsAt, collectUntil, expiresAt].filter(
      (at) => Number.isFinite(at) && at > now
    );
    if (!deadlines.length) return;
    const id = setTimeout(
      () => tick((value) => value + 1),
      Math.max(0, Math.min(...deadlines) - Date.now()) + 1
    );
    return () => clearTimeout(id);
  }, [motion.landsAt, pendingLandsAt, collectUntil, expiresAt, now]);

  const presented = optimisticPlay(source, pending, now);
  const optimistic = presented !== source;
  if (pending && !optimistic) setPending(null);
  // A card sounds as it leaves: your tap's flight, or another seat's. Its
  // confirmation is the same card, already on the felt.
  const shownCards = cards(presented);
  const playedBefore = useRef(presented.playedCards);
  useEffect(() => {
    if (cardPlayed(playedBefore.current, presented.playedCards)) play('card');
    playedBefore.current = presented.playedCards;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the cards on the felt, not the object
  }, [shownCards]);
  useEffect(() => {
    if (!pending) pendingRef.current = null;
  }, [pending]);

  const playCard = useCallback(
    (card: Card) => {
      if (pendingRef.current || !source.canPlay) {
        blockedPlay(pendingRef.current ? 'pending' : 'not_your_turn');
        return;
      }
      const held = source.yourHand.find((item) => item.textureKey === cardKey(card));
      if (!held?.isLegalPlay) {
        blockedPlay('illegal_action');
        return;
      }
      const next = { card: held, startedAt: Date.now(), rejected: false };
      pendingRef.current = next;
      setPending(next);
      const reject = () => {
        if (pendingRef.current !== next) return;
        setPending({ ...next, rejected: true });
      };
      try {
        Promise.resolve(send(card)).then((accepted) => {
          if (accepted === false) reject();
        }, reject);
      } catch {
        reject();
      }
    },
    [source, send, setPending]
  );

  const lit =
    source.phase === 'playing'
      ? turnLight({
          turn: source.currentTurnRelative,
          previousTurn: optimistic ? 'south' : motion.previousTurn,
          now,
          landsAt: optimistic ? pendingLandsAt : motion.landsAt,
          collectUntil,
          pending: optimistic,
        })
      : source.currentTurnRelative;
  const model = useMemo(
    () =>
      source.phase !== 'playing' || source.dealStage
        ? presented
        : {
            ...presented,
            collectAt: collectUntil,
            seats: Object.fromEntries(
              Object.entries(presented.seats).map(([rel, seat]) => [
                rel,
                seat ? { ...seat, isCurrentTurn: rel === lit } : null,
              ])
            ) as TableModel['seats'],
          },
    [presented, lit, collectUntil, source.phase, source.dealStage]
  );
  return { model, playCard };
}
