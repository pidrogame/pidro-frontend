/**
 * Pure adapter: controller state → canvas render model (plan §5.2).
 * Deterministic for a given snapshot — no side effects, never throws on
 * malformed state (renders empty slots instead). Seat ownership comes from the
 * view model's relativePosition; canvas code never computes it.
 */
import { useMemo } from 'react';
import type {
  Card,
  GamePhase,
  LegalAction,
  RelativePlayerView,
  RelativePosition,
  SeatPin,
  ServerPlayerView,
  SeatStatus,
  ServerLastHand,
  ServerTrickDetails,
  Suit,
  TeamKey,
} from '@/types/game';
import type { BotPersona, BotProfile } from '@pidro/shared';
import type { Position } from '@/types/lobby';
import type { GameTableController } from '@/game/useGameTableController';
import { isTrumpCard, sortCards } from '@/utils/cards';
import { cardKey, type CardKey } from './cardKey';
import type { SecondDealShow } from './useSecondDealPresentation';
import type { HeldStyle } from './layout';

export type TableCard = {
  key: string;
  textureKey: CardKey;
  card: Card;
  isTrump: boolean;
  isLegalPlay: boolean;
  isCurrentTrick: boolean;
};
export type TableSeat = {
  absolutePosition: Position;
  relativePosition: RelativePosition;
  username: string | null;
  avatar_url: string | null;
  level: number | null;
  pin: SeatPin | null;
  bot_persona: BotPersona | null;
  bot_profile?: BotProfile | null;
  isYou: boolean;
  isTeammate: boolean;
  isOpponent: boolean;
  isConnected: boolean;
  seatStatus: SeatStatus;
  isCurrentTurn: boolean;
  /** Cards in hand, as the server counts them; a dealer picking shows nine. */
  cardCount: number | null;
  lastPlayedCard: TableCard | null;
  /** Out of trumps for the rest of the hand, as the server says. */
  out: boolean;
  /** Remaining cards folded face down. No faces enter the render model. */
  foldedCount: number;
  /**
   * The second deal as the server tells it: trumps kept after the discard,
   * cards drawn to refill. Never the dealer's: that stays the dealer's.
   */
  secondDeal: { kept: number; drawn: number | null } | null;
  /**
   * How many cards the seat threw away in the second deal, the dealer's
   * once down to six (PID-306). Null until known or from an older server.
   */
  discarded?: number | null;
};
export type TableModel = {
  phase: GamePhase;
  transitionDelayMs?: number;
  /** When this phone took the state in: how late its motion already starts. */
  arrivedAt?: number;
  /** How long the server shows the dealer cut before it deals. */
  dealerSelectionMs?: number;
  /** Presentation deadline only; collecting never extends the server's turn gate. */
  collectAt?: number;
  trumpSuit: Suit | null;
  /** Server-selected dealer, already mapped into the viewer's seat orientation. */
  dealerRelative: RelativePosition | null;
  seats: Record<RelativePosition, TableSeat | null>;
  yourHand: TableCard[];
  /** Server deal order, before the display-only suit sort. */
  dealtHand: TableCard[];
  dealStage?: 'dealing' | 'sorting';
  yourCardCount: number | null;
  dealerCuts: Partial<Record<RelativePosition, TableCard>>;
  currentTrick: Partial<Record<RelativePosition, TableCard>>;
  playedCards: Partial<Record<RelativePosition, TableCard[]>>;
  currentTurnRelative: RelativePosition | null;
  legalPlayKeys: Set<CardKey>;
  canPlay: boolean;
  /**
   * The played card the server says is taking the trick: the current trick's
   * leader, or once a trick is done, its winner until the next card lands.
   * Only with "Help me keep count" on (PID-230); null otherwise.
   */
  winningKey: string | null;
  /** What the trick in progress holds for its winner, as the server counts it. */
  trickPoints: number | null;
  /** The card played last in the trick in progress. */
  latestPlayKey: string | null;
  /** The trick taken most recently this hand: who took it and what it was worth. */
  lastTrick: TrickResult | null;
  lastHand: ServerLastHand | null;
  yourTeam: TeamKey | null;
  /** How your hand holds its cards; fixtures try the styles. */
  held?: HeldStyle;
  /** The second deal playing out (`useSecondDealPresentation`). */
  secondDealShow?: SecondDealShow;
  /** Trumps killed over six, face up for everyone, by the seat that killed them (PID-306). */
  killed?: Partial<Record<RelativePosition, Card[]>>;
};

export type TrickResult = {
  /** 1-based count of finished tricks this hand; a new value means a new trick was taken. */
  number: number;
  winner: RelativePosition;
  points: number;
  twoOfTrump: { holder: RelativePosition; points: number } | null;
  /** The trick's cards in the order played. */
  plays: { holder: RelativePosition; card: Card }[];
};

const REL: RelativePosition[] = ['north', 'east', 'south', 'west'];
/** A hand as dealt. */
const DEALT_HAND = 9;

export type TableModelInput = {
  phase: GamePhase;
  transitionDelayMs?: number;
  trumpSuit: Suit | null;
  dealerRelative?: RelativePosition | null;
  players: RelativePlayerView[];
  yourHand: Card[] | null;
  yourCardCount: number | null;
  dealerSelectionCuts?: Partial<Record<Position, Card>> | null;
  currentTrick: unknown;
  tricks: unknown;
  /** PID-218 trick signals; absent from older servers. */
  trickDetails?: ServerTrickDetails | null;
  lastHand?: ServerLastHand | null;
  legalActions: LegalAction[];
  currentTurnRelative: RelativePosition | null;
  canPlay: boolean;
  getCardCountForPlayer: (absPosition: Position | null) => number | null;
  /** The server's per-seat view: who is out of trumps and how many they folded. */
  serverPlayers?: Partial<Record<Position, ServerPlayerView>> | null;
  /** "Help me keep count": lights the card winning the trick. */
  countHelp?: boolean;
  /** Trumps killed over six (PID-306); absent from older servers. */
  killedCards?: Partial<Record<Position, Card[]>> | null;
};

type RawPlay = { player?: Position; position?: Position; card?: Card };

function normalizePlays(trick: unknown): RawPlay[] {
  const plays = Array.isArray(trick)
    ? trick
    : trick && typeof trick === 'object' && 'plays' in trick
      ? (trick as { plays: unknown }).plays
      : trick && typeof trick === 'object' && 'cards' in trick
        ? (trick as { cards: unknown }).cards
        : null;
  return Array.isArray(plays) ? (plays as RawPlay[]) : [];
}

function normalizeCompletedTricks(tricks: unknown): RawPlay[][] {
  if (!Array.isArray(tricks)) return [];
  return tricks.map(normalizePlays).filter((plays) => plays.length > 0);
}

type RawTrickMeta = {
  winner?: Position;
  points?: number;
  two_of_trump?: { position?: Position; points?: number } | null;
};

function completedTrickMeta(tricks: unknown): RawTrickMeta[] {
  if (!Array.isArray(tricks)) return [];
  return tricks
    .filter((trick) => normalizePlays(trick).length > 0)
    .map((trick) => (trick && typeof trick === 'object' ? (trick as RawTrickMeta) : {}));
}

const teamOf = (position: Position): TeamKey =>
  position === 'north' || position === 'south' ? 'north_south' : 'east_west';

export function buildTableModel(input: TableModelInput): TableModel {
  const { trumpSuit } = input;
  const viewerIsDealer = input.players.some(
    (player) => player.isYou && player.relativePosition === input.dealerRelative
  );
  const concealPrivateDealerPool = input.phase === 'second_deal' && viewerIsDealer;

  const legalPlayKeys = new Set<CardKey>();
  for (const a of input.legalActions) {
    if (a.type === 'play_card' && a.card) legalPlayKeys.add(cardKey(a.card));
  }

  const toCard = (c: Card, key: string = cardKey(c), isCurrentTrick = false): TableCard => {
    const textureKey = cardKey(c);
    return {
      key,
      textureKey,
      card: c,
      isTrump: isTrumpCard(c, trumpSuit),
      isLegalPlay: legalPlayKeys.has(textureKey),
      isCurrentTrick,
    };
  };

  // Out of trumps only means something while the hand is played.
  const playing = input.phase === 'playing';
  const outOf = (abs: Position) => playing && !!input.serverPlayers?.[abs]?.eliminated;
  const foldedOf = (abs: Position) => {
    const view = input.serverPlayers?.[abs];
    return outOf(abs) ? (view?.folded_count ?? view?.revealed_cards?.length ?? 0) : 0;
  };
  // Every seat's second deal is public once the discard is done.
  const afterDiscard = input.phase === 'second_deal' || playing;
  const secondDealOf = (abs: Position) => {
    const view = input.serverPlayers?.[abs];
    return afterDiscard && typeof view?.kept_count === 'number'
      ? {
          kept: view.kept_count,
          drawn: typeof view.drawn_count === 'number' ? view.drawn_count : null,
        }
      : null;
  };
  const you = input.players.find((player) => player.isYou);
  const yourOut = !!you && outOf(you.absolutePosition);
  const heldHand =
    !yourOut && input.yourHand
      ? sortCards(input.yourHand, trumpSuit).map((card) => toCard(card))
      : [];
  const yourHand = concealPrivateDealerPool ? [] : heldHand;

  const absToRel = new Map<Position, RelativePosition>();
  for (const p of input.players) absToRel.set(p.absolutePosition, p.relativePosition);

  const dealerCuts: Partial<Record<RelativePosition, TableCard>> = {};
  if (input.phase === 'dealer_selection' && input.dealerSelectionCuts) {
    for (const [absolutePosition, card] of Object.entries(input.dealerSelectionCuts)) {
      if (!card) continue;
      const rel = absToRel.get(absolutePosition as Position);
      if (!rel) continue;
      const textureKey = cardKey(card);
      dealerCuts[rel] = toCard(card, `dealer-cut-${rel}-${textureKey}`);
    }
  }

  const playedCards: Partial<Record<RelativePosition, TableCard[]>> = {};
  const pushPlayedCard = (rel: RelativePosition, tableCard: TableCard) => {
    const cards = playedCards[rel] ?? [];
    cards.push(tableCard);
    playedCards[rel] = cards;
  };

  const currentTrick: Partial<Record<RelativePosition, TableCard>> = {};
  const completedTricks = normalizeCompletedTricks(input.tricks);
  const addPlayedCards = (plays: RawPlay[], trickIndex: number, isCurrentTrick: boolean) => {
    plays.forEach((play, playIndex) => {
      const abs = (play.player ?? play.position) as Position | undefined;
      if (!abs || !play.card) return;
      const rel = absToRel.get(abs);
      if (!rel) return;
      const textureKey = cardKey(play.card);
      const tableCard = toCard(
        play.card,
        `trick-${trickIndex}-${playIndex}-${rel}-${textureKey}`,
        isCurrentTrick
      );
      pushPlayedCard(rel, tableCard);
      if (isCurrentTrick) currentTrick[rel] = tableCard;
    });
  };

  completedTricks.forEach((plays, trickIndex) => addPlayedCards(plays, trickIndex, false));

  const currentTrickIndex = completedTricks.length;
  const currentPlays = normalizePlays(input.currentTrick);
  addPlayedCards(currentPlays, currentTrickIndex, true);

  // The server decides who is winning and what a trick is worth; the model
  // only finds the matching card. A trick's winner keeps the light until the
  // next trick's first card lands.
  const trickMeta = completedTrickMeta(input.tricks);
  const lastMeta = trickMeta[trickMeta.length - 1];
  const lastWinnerRel = lastMeta?.winner ? (absToRel.get(lastMeta.winner) ?? null) : null;
  const twoHolder = lastMeta?.two_of_trump?.position
    ? (absToRel.get(lastMeta.two_of_trump.position) ?? null)
    : null;
  const lastPlays = (completedTricks.at(-1) ?? []).flatMap((play) => {
    const abs = play.player ?? play.position;
    const holder = abs ? absToRel.get(abs) : undefined;
    return holder && play.card ? [{ holder, card: play.card }] : [];
  });
  const lastTrick: TrickResult | null =
    lastMeta && lastWinnerRel
      ? {
          number: trickMeta.length,
          winner: lastWinnerRel,
          points: typeof lastMeta.points === 'number' ? lastMeta.points : 0,
          twoOfTrump:
            twoHolder && typeof lastMeta.two_of_trump?.points === 'number'
              ? { holder: twoHolder, points: lastMeta.two_of_trump.points }
              : null,
          plays: lastPlays,
        }
      : null;

  let winningKey: string | null = null;
  if (currentPlays.length > 0) {
    const winning = input.trickDetails?.winning;
    const rel = winning ? absToRel.get(winning.position) : undefined;
    const card = rel ? currentTrick[rel] : undefined;
    if (card && winning && card.textureKey === cardKey(winning.card)) winningKey = card.key;
  } else if (lastWinnerRel) {
    const cards = playedCards[lastWinnerRel] ?? [];
    winningKey =
      cards.find((card) => card.key.startsWith(`trick-${currentTrickIndex - 1}-`))?.key ?? null;
  }
  const trickPoints =
    currentPlays.length > 0 && typeof input.trickDetails?.points === 'number'
      ? input.trickDetails.points
      : null;
  const latestAbs = currentPlays.at(-1)?.player ?? currentPlays.at(-1)?.position;
  const latestPlay = latestAbs ? (absToRel.get(latestAbs) ?? null) : null;

  const seats = {} as Record<RelativePosition, TableSeat | null>;
  for (const rel of REL) {
    const p = input.players.find((pp) => pp.relativePosition === rel) ?? null;
    seats[rel] = p
      ? {
          absolutePosition: p.absolutePosition,
          relativePosition: rel,
          username: p.username,
          avatar_url: p.avatar_url ?? null,
          level: p.level ?? null,
          pin: p.pin ?? null,
          bot_persona: p.bot_persona ?? null,
          bot_profile: p.bot_profile ?? null,
          isYou: p.isYou,
          isTeammate: p.isTeammate,
          isOpponent: p.isOpponent,
          isConnected: p.isConnected,
          seatStatus: p.seatStatus,
          isCurrentTurn: p.isCurrentTurn,
          // A dealer picking from the pack holds their nine as far as anyone
          // can see: how many trumps they kept is the dealer's edge.
          cardCount:
            input.phase === 'second_deal' && input.dealerRelative === rel && !p.isYou
              ? DEALT_HAND
              : input.getCardCountForPlayer(p.absolutePosition),
          secondDeal: secondDealOf(p.absolutePosition),
          discarded: afterDiscard
            ? (input.serverPlayers?.[p.absolutePosition]?.discarded_count ?? null)
            : null,
          lastPlayedCard: currentTrick[rel] ?? null,
          out: outOf(p.absolutePosition),
          foldedCount: foldedOf(p.absolutePosition),
        }
      : null;
  }

  return {
    phase: input.phase,
    transitionDelayMs: input.transitionDelayMs,
    trumpSuit,
    dealerRelative: input.dealerRelative ?? null,
    seats,
    yourHand,
    dealtHand:
      concealPrivateDealerPool || yourOut ? [] : (input.yourHand ?? []).map((card) => toCard(card)),
    yourCardCount: concealPrivateDealerPool ? null : input.yourCardCount,
    dealerCuts,
    currentTrick,
    playedCards,
    currentTurnRelative: input.currentTurnRelative,
    legalPlayKeys,
    canPlay: input.canPlay,
    winningKey: input.countHelp ? winningKey : null,
    trickPoints,
    latestPlayKey: latestPlay ? ((currentTrick[latestPlay] ?? null)?.key ?? null) : null,
    lastTrick,
    lastHand: input.lastHand ?? null,
    yourTeam: you ? teamOf(you.absolutePosition) : null,
    killed: playing
      ? Object.fromEntries(
          input.players.flatMap((p) => {
            const cards = input.killedCards?.[p.absolutePosition];
            return cards?.length ? [[p.relativePosition, cards]] : [];
          })
        )
      : {},
  };
}

export function useTableModel(
  c: GameTableController,
  presentationHand?: Card[],
  countHelp = false
): TableModel {
  return useMemo(
    () =>
      buildTableModel({
        phase: c.phase,
        transitionDelayMs: c.serverState?.transition_delay_ms,
        trumpSuit: c.trumpSuit,
        dealerRelative: c.viewModel?.dealerRelative ?? null,
        players: c.players,
        yourHand: presentationHand ?? c.yourHand,
        yourCardCount: presentationHand?.length ?? c.yourCardCount,
        dealerSelectionCuts: c.serverState?.dealer_selection_cuts,
        currentTrick: c.currentTrick,
        tricks: c.completedTricks,
        trickDetails: c.serverState?.current_trick_details ?? null,
        lastHand: c.serverState?.last_hand ?? null,
        legalActions: c.legalActions,
        currentTurnRelative: c.currentTurnRelative,
        canPlay: c.isPlayingTurn && !c.isPlayingCard,
        getCardCountForPlayer: c.getCardCountForPlayer,
        serverPlayers: c.serverState?.players ?? null,
        countHelp,
        killedCards: c.serverState?.killed_cards ?? null,
      }),
    [
      c.phase,
      c.serverState?.transition_delay_ms,
      c.trumpSuit,
      c.viewModel?.dealerRelative,
      c.players,
      c.yourHand,
      c.yourCardCount,
      presentationHand,
      c.serverState?.dealer_selection_cuts,
      c.currentTrick,
      c.completedTricks,
      c.serverState?.current_trick_details,
      c.serverState?.last_hand,
      c.legalActions,
      c.currentTurnRelative,
      c.isPlayingTurn,
      c.isPlayingCard,
      c.getCardCountForPlayer,
      c.serverState?.players,
      countHelp,
      c.serverState?.killed_cards,
    ]
  );
}
