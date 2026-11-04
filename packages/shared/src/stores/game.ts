import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useMemo } from 'react';
import type {
  ActiveTurnTimer,
  ServerBid,
  ServerGameState,
  PlayerMeta,
  PlayerRank,
  GameViewModel,
  GamePresentation,
  RelativePlayerView,
  LegalAction,
  Suit,
  SeatStatus,
  SeatLifecycleSnapshot,
} from '../types/game';
import type { Position, ReadinessSnapshot, Room } from '../types/lobby';
import { mapAbsoluteToRelative, isTeammate, POSITION_TO_INDEX } from '../utils/positions';
import { buildPositionsFromSeats } from '../utils/rooms';
import { isGeneratedGuestUsername, publicPlayerName, seatPlayerName } from '../utils/playerName';
import { lifecycleFromReply } from '../utils/seatLifecycle';
import { useBotCatalogueStore } from './bots';
import { resolveBotProfile } from '../utils/bots';

const POSITIONS: Position[] = ['north', 'east', 'south', 'west'];

// Retain public counts, never a cached private hand after losing player authority.
function publicState(state: ServerGameState | null): ServerGameState | null {
  if (!state) return null;
  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players ?? {}).map(([position, player]) => [
        position,
        {
          ...player,
          hand: Array.isArray(player.hand) ? player.hand.length : player.hand,
        },
      ]),
    ) as ServerGameState['players'],
  };
}

function publicPresentation(presentation: GamePresentation | null): GamePresentation | null {
  if (!presentation?.dealer_rob) return presentation;
  return {
    ...presentation,
    dealer_rob: {
      dealer: presentation.dealer_rob.dealer,
      automatic: presentation.dealer_rob.automatic,
      started_at_ms: presentation.dealer_rob.started_at_ms,
      ends_at_ms: presentation.dealer_rob.ends_at_ms,
    },
  };
}

function createEmptyPlayerMeta(position: Position): PlayerMeta {
  return {
    position,
    playerId: null,
    username: null,
    isYou: false,
    isTeammate: false,
    isOpponent: false,
    isConnected: false,
    seatStatus: 'normal',
  };
}

function displayUsername(meta: PlayerMeta): string | null {
  const username = meta.username?.trim() ?? '';
  if (username) return username;
  if (meta.isYou) return 'You';
  if (meta.seatStatus === 'bot_substitute' || meta.seatStatus === 'permanent_bot') {
    return 'Bot';
  }
  return null;
}

interface GameState {
  roomCode: string | null;
  youPlayerId: string | null;
  youPositionAbs: Position | null;
  role: 'player' | 'spectator' | null;

  serverState: ServerGameState | null;
  presentation: GamePresentation | null;
  legalActions: LegalAction[];
  playerMeta: Record<Position, PlayerMeta>;
  readyPlayers: Position[];
  readiness: ReadinessSnapshot | null;
  setReadiness: (snapshot: ReadinessSnapshot) => void;
  turnTimer: ActiveTurnTimer | null;
  lifecycle: SeatLifecycleSnapshot | null;
  applySeatLifecycle: (snapshot: SeatLifecycleSnapshot) => void;

  isChannelJoined: boolean;
  isRejoining: boolean;
  /** The server removed this player for missing turns; a bot is taking the seat. */
  isAway: boolean;
  lastError: string | null;

  initFromRoom: (params: { room: Room; youPlayerId: string }) => void;
  refreshPlayerIdentities: (room: Room) => void;
  setServerState: (state: ServerGameState | Record<string, any>) => void;
  setPresentation: (presentation: GamePresentation | null) => void;
  setLegalActions: (actions: LegalAction[]) => void;
  setTurnTimer: (timer: ActiveTurnTimer | null) => void;
  clearTurnTimer: (timerId?: number | null) => void;
  setYouPosition: (position: Position) => void;
  setRole: (role: 'player' | 'spectator' | null) => void;
  updateCurrentTurn: (position: Position | null) => void;
  setPlayerConnected: (
    playerId: string | null,
    position: Position | null,
    connected: boolean,
  ) => void;
  setSeatStatus: (position: Position, status: SeatStatus, username?: string | null) => void;
  setPlayerRank: (position: Position, rank: PlayerRank | null) => void;
  setChannelStatus: (joined: boolean, rejoining?: boolean) => void;
  setError: (err: string | null) => void;
  setAway: (away: boolean) => void;
  reset: () => void;
}

const initialPlayerMeta: Record<Position, PlayerMeta> = {
  north: createEmptyPlayerMeta('north'),
  east: createEmptyPlayerMeta('east'),
  south: createEmptyPlayerMeta('south'),
  west: createEmptyPlayerMeta('west'),
};

export const useGameStore = create<GameState>((set, get) => ({
  roomCode: null,
  youPlayerId: null,
  youPositionAbs: null,
  role: null,
  serverState: null,
  presentation: null,
  legalActions: [],
  playerMeta: { ...initialPlayerMeta },
  readyPlayers: [],
  readiness: null,
  turnTimer: null,
  lifecycle: null,
  applySeatLifecycle: (snapshot) =>
    set((current) => {
      if (!lifecycleFromReply(snapshot)) return {};
      if (current.roomCode !== snapshot.room_code) return {};
      if (
        current.lifecycle &&
        (current.lifecycle.room_id !== snapshot.room_id ||
          current.lifecycle.revision >= snapshot.revision)
      )
        return {};
      const playerMeta = { ...current.playerMeta };
      const youPositionAbs =
        current.role !== 'player'
          ? null
          : (POSITIONS.find(
              (position) =>
                snapshot.seats[position].player_id === current.youPlayerId &&
                current.youPlayerId != null,
            ) ?? current.youPositionAbs);
      for (const position of POSITIONS) {
        const seat = snapshot.seats[position];
        const known = Object.values(current.playerMeta).find(
          (meta) => seat.player_id != null && meta.playerId === seat.player_id,
        );
        const isYou = current.role === 'player' && position === youPositionAbs;
        const teammate = youPositionAbs != null && isTeammate(youPositionAbs, position);
        playerMeta[position] = {
          ...playerMeta[position],
          playerId: seat.player_id,
          username: seatPlayerName(seat, ''),
          avatar_url: seat.avatar_url !== undefined ? seat.avatar_url : (known?.avatar_url ?? null),
          level: seat.level !== undefined ? seat.level : (known?.level ?? null),
          prestige: seat.prestige !== undefined ? seat.prestige : (known?.prestige ?? null),
          pin: seat.pin !== undefined ? seat.pin : (known?.pin ?? null),
          bot_persona: seat.bot_persona ?? null,
          bot_profile: seat.bot_profile ?? null,
          seatStatus: seat.status,
          isConnected: seat.status !== 'reconnecting' && seat.status !== 'vacant',
          isYou,
          isTeammate: teammate && !isYou,
          isOpponent: youPositionAbs != null && !teammate && !isYou,
          rank:
            seat.player_id === current.playerMeta[position].playerId
              ? current.playerMeta[position].rank
              : null,
        };
      }
      return { lifecycle: snapshot, playerMeta, youPositionAbs };
    }),
  isChannelJoined: false,
  isRejoining: false,
  isAway: false,
  lastError: null,

  initFromRoom: ({ room, youPlayerId }) =>
    set((current) => {
      const sameSession = current.roomCode === room.code && current.youPlayerId === youPlayerId;
      // Once joined, only the channel's versioned snapshot owns seat identity/status.
      if (sameSession && current.lifecycle) return {};
      // Unversioned HTTP/lobby data can enrich names, never replace the channel roster.
      if (
        sameSession &&
        current.readiness &&
        ['waiting', 'ready'].includes(current.readiness.status)
      ) {
        room = roomWithReadiness(room, current.readiness);
      }
      const positions = room.positions ?? buildPositionsFromSeats(room.seats);
      let youPos: Position | null = null;

      POSITIONS.forEach((pos) => {
        if (positions?.[pos] === youPlayerId) youPos = pos;
      });
      if (!youPos && sameSession && !current.readiness) youPos = current.youPositionAbs;
      if (!sameSession || current.role !== 'player') youPos = null;

      const baseMeta: Record<Position, PlayerMeta> = {
        north: createEmptyPlayerMeta('north'),
        east: createEmptyPlayerMeta('east'),
        south: createEmptyPlayerMeta('south'),
        west: createEmptyPlayerMeta('west'),
      };

      POSITIONS.forEach((pos) => {
        const previous = current.playerMeta[pos];
        const snapshotPlayerId = positions?.[pos];
        const playerId =
          snapshotPlayerId !== undefined
            ? snapshotPlayerId
            : sameSession
              ? previous.playerId
              : null;
        const sameOccupant = sameSession && playerId != null && previous.playerId === playerId;
        // Match identity before position; a fallback index must not override either.
        const seat =
          (playerId != null
            ? room.seats?.find((candidate) => candidate.player?.id === playerId)
            : undefined) ??
          room.seats?.find((candidate) => candidate.position === pos) ??
          room.seats?.find(
            (candidate) =>
              candidate.position == null &&
              candidate.seat_index === POSITION_TO_INDEX[pos] &&
              (playerId == null || candidate.player?.id == null),
          );
        baseMeta[pos] = {
          position: pos,
          playerId,
          username: seat?.player
            ? seatPlayerName(seat.player, sameOccupant ? (previous.username ?? '') : '')
            : sameOccupant
              ? previous.username
              : null,
          avatar_url:
            seat?.player?.avatar_url !== undefined
              ? seat.player.avatar_url
              : sameOccupant
                ? previous.avatar_url
                : null,
          level:
            seat?.player?.level !== undefined
              ? seat.player.level
              : sameOccupant
                ? previous.level
                : null,
          prestige:
            seat?.player?.prestige !== undefined
              ? seat.player.prestige
              : sameOccupant
                ? previous.prestige
                : null,
          pin:
            seat?.player?.pin !== undefined ? seat.player.pin : sameOccupant ? previous.pin : null,
          bot_persona: seat?.player?.bot_persona ?? null,
          bot_profile: seat?.player?.bot_profile ?? null,
          isYou: youPos === pos,
          isTeammate: false,
          isOpponent: false,
          isConnected: sameOccupant ? previous.isConnected : true,
          seatStatus: seat?.player?.is_bot
            ? 'bot_substitute'
            : sameOccupant
              ? previous.seatStatus
              : 'normal',
        };
      });

      if (youPos) {
        POSITIONS.forEach((pos) => {
          const teammate = isTeammate(youPos!, pos);
          baseMeta[pos].isTeammate = teammate && !baseMeta[pos].isYou;
          baseMeta[pos].isOpponent = !teammate && !baseMeta[pos].isYou;
        });
      }

      return {
        roomCode: room.code,
        youPlayerId,
        youPositionAbs: youPos,
        playerMeta: baseMeta,
        ...(!sameSession
          ? { role: null, serverState: null, presentation: null, legalActions: [] }
          : {}),
        ...(!sameSession ? { lifecycle: null } : {}),
        ...(!sameSession ? { readiness: null, readyPlayers: [] } : {}),
      };
    }),

  refreshPlayerIdentities: (room) =>
    set((current) => {
      if (room.code !== current.roomCode) return current;
      const playerMeta = { ...current.playerMeta };
      for (const position of POSITIONS) {
        const meta = playerMeta[position];
        const player = room.seats?.find((seat) => seat.player?.id === meta.playerId)?.player;
        if (!player || player.is_bot) continue;
        playerMeta[position] = {
          ...meta,
          username: publicPlayerName(player.username, meta.username ?? '', player.display_name),
          ...(player.avatar_url !== undefined ? { avatar_url: player.avatar_url } : {}),
          ...(player.level !== undefined ? { level: player.level } : {}),
          ...(player.prestige !== undefined ? { prestige: player.prestige } : {}),
          ...(player.pin !== undefined ? { pin: player.pin } : {}),
        };
      }
      return { playerMeta };
    }),

  setServerState: (state) =>
    set((current) => {
      const raw = (
        current.role === 'player' ? state : publicState(state as ServerGameState)
      ) as Record<string, any>;

      const currentPlayer = raw.current_player ?? (raw.current_turn as Position | null | undefined);
      const trump = raw.trump ?? raw.trump_suit ?? null;
      const dealer = raw.dealer ?? (raw.current_dealer as Position | null | undefined);

      const bidsRaw = raw.bids;
      let bids: Record<Position, number | 'pass'> | undefined;
      // The record loses the order bids were made in; the hand log needs it.
      let bidOrder: ServerBid[] | undefined;
      if (Array.isArray(bidsRaw)) {
        const entries = bidsRaw.map((entry) => ({
          position: (entry?.position ?? entry?.pos ?? entry?.[0]) as Position | undefined,
          amount: (entry?.amount ?? entry?.bid ?? entry?.[1] ?? entry?.value) as
            | number
            | 'pass'
            | undefined,
        }));
        bidOrder = entries.filter(
          (entry): entry is ServerBid => !!entry.position && entry.amount != null,
        );
        bids = entries.reduce(
          (acc, { position, amount }) => {
            if (position) acc[position] = amount ?? acc[position] ?? 'pass';
            return acc;
          },
          {} as Record<Position, number | 'pass'>,
        );
      } else if (bidsRaw && typeof bidsRaw === 'object') {
        bids = bidsRaw as Record<Position, number | 'pass'>;
      }

      const highestBidAmount =
        raw.current_bid ?? raw.highest_bid?.amount ?? (raw.highest_bid as number | undefined);

      const bidWinner: Position | null | undefined =
        raw.bid_winner ?? raw.highest_bid?.position ?? null;

      const phase = (raw.phase as ServerGameState['phase'] | undefined) ?? null;
      const isTerminalPhase = phase === 'complete' || phase === 'game_over';

      return {
        serverState: {
          ...(raw as ServerGameState),
          current_player: currentPlayer ?? null,
          trump,
          dealer: dealer ?? null,
          bids: bids ?? undefined,
          bid_order: bidOrder,
          current_bid: highestBidAmount ?? null,
          bid_winner: bidWinner,
          highest_bid: raw.highest_bid,
        },
        ...(isTerminalPhase ? { turnTimer: null } : {}),
      };
    }),

  setPresentation: (presentation) =>
    set((current) => ({
      presentation:
        current.role === 'player' ? presentation : publicPresentation(presentation),
    })),

  setYouPosition: (position) => {
    const curr = get();
    if (curr.role !== 'player' || curr.youPositionAbs === position) return;

    const updated = { ...curr.playerMeta };
    POSITIONS.forEach((pos) => {
      const isYou = pos === position;
      const teammate = isTeammate(position, pos);
      updated[pos] = {
        ...updated[pos],
        isYou,
        isTeammate: teammate && !isYou,
        isOpponent: !teammate && !isYou,
      };
    });
    set({ youPositionAbs: position, playerMeta: updated });
  },

  setRole: (role) =>
    set((current) =>
      role === 'player'
        ? { role }
        : {
            role,
            youPositionAbs: null,
            legalActions: [],
            serverState: publicState(current.serverState),
            presentation: publicPresentation(current.presentation),
            playerMeta: Object.fromEntries(
              POSITIONS.map((position) => [
                position,
                {
                  ...current.playerMeta[position],
                  isYou: false,
                  isTeammate: false,
                  isOpponent: false,
                },
              ]),
            ) as Record<Position, PlayerMeta>,
          },
    ),

  setLegalActions: (actions) =>
    set((current) => ({
      legalActions: current.role === 'player' ? actions : [],
    })),

  setTurnTimer: (timer) => set({ turnTimer: timer }),

  clearTurnTimer: (timerId) =>
    set((curr) => {
      if (timerId != null && curr.turnTimer?.timerId !== timerId) {
        return {};
      }

      return { turnTimer: null };
    }),

  updateCurrentTurn: (position) =>
    set((curr) => ({
      serverState: curr.serverState ? { ...curr.serverState, current_player: position } : null,
    })),

  setPlayerConnected: (playerId, position, connected) =>
    set((curr) => {
      if (curr.lifecycle) return {};
      const updated = { ...curr.playerMeta };
      POSITIONS.forEach((pos) => {
        if (updated[pos].playerId === playerId || pos === position) {
          updated[pos] = { ...updated[pos], isConnected: connected };
        }
      });
      return { playerMeta: updated };
    }),

  setSeatStatus: (position, status, username) =>
    set((curr) => {
      if (curr.lifecycle) return {};
      const updated = { ...curr.playerMeta };
      updated[position] = {
        ...updated[position],
        seatStatus: status,
        ...(username !== undefined ? { username } : {}),
      };
      return { playerMeta: updated };
    }),

  setPlayerRank: (position, rank) =>
    set((curr) => {
      const updated = { ...curr.playerMeta };
      updated[position] = { ...updated[position], rank };
      return { playerMeta: updated };
    }),

  setReadiness: (snapshot) =>
    set((current) => {
      if (
        !snapshot ||
        (current.readiness &&
          (snapshot.room_id !== current.readiness.room_id ||
            snapshot.snapshot_revision <= current.readiness.snapshot_revision))
      )
        return {};
      // In-game seat lifecycle/rank hydration remains owned by its existing events.
      if (snapshot.status === 'playing' || snapshot.status === 'finished') {
        return { readiness: snapshot, readyPlayers: snapshot.ready_players };
      }
      const youPosition =
        current.role !== 'player'
          ? null
          : (POSITIONS.find((pos) => snapshot.positions[pos] === current.youPlayerId) ?? null);
      const playerMeta = { ...current.playerMeta };
      for (const pos of POSITIONS) {
        const playerId = snapshot.positions[pos];
        const seat = snapshot.seats[pos];
        const previous = Object.values(current.playerMeta).find(
          (meta) => meta.playerId === playerId,
        );
        const snapshotName = seatPlayerName(seat, '');
        const keepsKnownGuestName =
          previous?.username &&
          isGeneratedGuestUsername(seat.username) &&
          (typeof seat.display_name !== 'string' || !seat.display_name.trim());
        playerMeta[pos] = {
          ...createEmptyPlayerMeta(pos),
          playerId,
          username:
            (keepsKnownGuestName ? previous.username : snapshotName || previous?.username) ??
            null,
          avatar_url:
            seat.avatar_url !== undefined ? seat.avatar_url : (previous?.avatar_url ?? null),
          level: seat.level !== undefined ? seat.level : (previous?.level ?? null),
          prestige: seat.prestige !== undefined ? seat.prestige : (previous?.prestige ?? null),
          pin: seat.pin !== undefined ? seat.pin : (previous?.pin ?? null),
          bot_persona: seat.bot_persona ?? null,
          bot_profile: seat.bot_profile ?? null,
          isYou: pos === youPosition,
          isTeammate: !!youPosition && pos !== youPosition && isTeammate(youPosition, pos),
          isOpponent: !!youPosition && !isTeammate(youPosition, pos),
          isConnected: seat.occupant_type === 'bot' || seat.status === 'connected',
          seatStatus:
            seat.occupant_type === 'bot'
              ? 'bot_substitute'
              : seat.status === 'connected'
                ? 'normal'
                : 'reconnecting',
        };
      }
      return {
        readiness: snapshot,
        readyPlayers: snapshot.ready_players,
        playerMeta,
        youPositionAbs: youPosition,
      };
    }),

  setChannelStatus: (joined, rejoining = false) =>
    set({ isChannelJoined: joined, isRejoining: rejoining }),

  setError: (err) => set({ lastError: err }),

  setAway: (away) => set({ isAway: away }),

  reset: () =>
    set({
      roomCode: null,
      youPlayerId: null,
      youPositionAbs: null,
      role: null,
      serverState: null,
      presentation: null,
      legalActions: [],
      turnTimer: null,
      lifecycle: null,
      playerMeta: {
        north: createEmptyPlayerMeta('north'),
        east: createEmptyPlayerMeta('east'),
        south: createEmptyPlayerMeta('south'),
        west: createEmptyPlayerMeta('west'),
      },
      readyPlayers: [],
      readiness: null,
      isChannelJoined: false,
      isRejoining: false,
      isAway: false,
      lastError: null,
    }),
}));

/** Keep display metadata, but take every seat identity from the authoritative snapshot. */
export function roomWithReadiness(room: Room, snapshot: ReadinessSnapshot): Room {
  return {
    ...room,
    config: snapshot.config ?? room.config,
    id: snapshot.room_id,
    status: snapshot.status,
    positions: snapshot.positions,
    seats: POSITIONS.map((position, seat_index) => {
      const id = snapshot.positions[position];
      const known = room.seats?.find((seat) => seat.player?.id === id)?.player;
      return {
        position,
        seat_index,
        status: id ? 'occupied' : 'free',
        held_for: snapshot.seats[position].held_for,
        min_games: snapshot.seats[position].min_games,
        password: snapshot.seats[position].password,
        player: id
          ? {
              ...known,
              id,
              username: publicPlayerName(
                snapshot.seats[position].username,
                known?.username ?? '',
                snapshot.seats[position].display_name ?? known?.display_name,
              ),
              display_name: snapshot.seats[position].display_name ?? known?.display_name,
              avatar_url:
                snapshot.seats[position].avatar_url !== undefined
                  ? snapshot.seats[position].avatar_url
                  : known?.avatar_url,
              level:
                snapshot.seats[position].level !== undefined
                  ? snapshot.seats[position].level
                  : known?.level,
              prestige:
                snapshot.seats[position].prestige !== undefined
                  ? snapshot.seats[position].prestige
                  : known?.prestige,
              pin:
                snapshot.seats[position].pin !== undefined
                  ? snapshot.seats[position].pin
                  : known?.pin,
              is_bot: snapshot.seats[position].occupant_type === 'bot',
              bot_persona:
                snapshot.seats[position].bot_persona !== undefined
                  ? snapshot.seats[position].bot_persona
                  : (known?.bot_persona ?? null),
              bot_profile: snapshot.seats[position].bot_profile ?? null,
            }
          : null,
      };
    }),
  };
}

export function useGameViewModel(): GameViewModel | null {
  const profiles = useBotCatalogueStore((state) => state.profiles);
  const { serverState, playerMeta, youPositionAbs, roomCode, role } = useGameStore(
    useShallow((state) => ({
      serverState: state.serverState,
      playerMeta: state.playerMeta,
      youPositionAbs: state.youPositionAbs,
      roomCode: state.roomCode,
      role: state.role,
    })),
  );

  return useMemo(() => {
    if (!serverState || !roomCode) {
      return null;
    }

    const viewerPositionAbs = (role === 'player' ? youPositionAbs : null) ?? 'south';

    const rawState = serverState as unknown as Record<string, unknown>;
    const currentPlayer =
      serverState.current_player ?? (rawState.current_turn as Position | null | undefined) ?? null;
    const trumpSuit = serverState.trump ?? (rawState.trump_suit as Suit | null) ?? null;
    const dealerPosition =
      serverState.dealer ?? (rawState.current_dealer as Position | null | undefined) ?? null;
    const { phase } = serverState;

    const players: RelativePlayerView[] = POSITIONS.map((absPos) => {
      const meta = playerMeta[absPos];
      const botProfile = resolveBotProfile(meta.bot_persona, meta.bot_profile, profiles);
      const relPos = mapAbsoluteToRelative(absPos, viewerPositionAbs);
      const isCurrentTurn = currentPlayer === absPos;

      return {
        absolutePosition: absPos,
        relativePosition: relPos,
        playerId: meta.playerId,
        username: botProfile?.name || displayUsername(meta),
        avatar_url: meta.avatar_url ?? null,
        isYou: role === 'player' && meta.isYou,
        isTeammate: role === 'player' && meta.isTeammate,
        isOpponent: role === 'player' && meta.isOpponent,
        isConnected: meta.isConnected,
        isCurrentTurn,
        seatStatus: meta.seatStatus,
        rank: meta.rank ?? null,
        level: meta.level ?? null,
        prestige: meta.prestige ?? null,
        pin: meta.pin ?? null,
        bot_persona: meta.bot_persona ?? null,
        bot_profile: botProfile,
      };
    });

    return {
      roomCode,
      phase,
      viewerPositionAbsolute: viewerPositionAbs,
      trumpSuit,
      dealerAbsolute: dealerPosition ?? null,
      dealerRelative: dealerPosition
        ? mapAbsoluteToRelative(dealerPosition, viewerPositionAbs)
        : null,
      currentTurnAbsolute: currentPlayer ?? null,
      currentTurnRelative: currentPlayer
        ? mapAbsoluteToRelative(currentPlayer, viewerPositionAbs)
        : null,
      players,
    };
  }, [serverState, playerMeta, youPositionAbs, roomCode, role, profiles]);
}
