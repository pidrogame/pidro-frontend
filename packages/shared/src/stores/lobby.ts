import { create } from 'zustand';
import type { LobbyCategories, LobbyCategoryKey, Room } from '../types/lobby';
import { emptyLobbyCategories, flattenLobbyCategories, lobbyCategoryKeys } from '../utils/rooms';

interface LobbyStats {
  online_players: number;
  active_games: number;
}

interface LobbyState {
  rooms: Room[];
  lobby: LobbyCategories;
  minimumNativeVersions: Partial<Record<'android' | 'ios', string>>;
  minimumNativeBuilds: Partial<Record<'android' | 'ios', string>>;
  nativeStoreUrls: Partial<Record<'android' | 'ios', string>>;
  nativeUpdatePopup: boolean;
  stats: LobbyStats;
  isLoading: boolean;
  error: string | null;

  setRooms: (rooms: Room[]) => void;
  setLobby: (lobby: LobbyCategories) => void;
  addRoom: (room: Room) => void;
  updateRoom: (room: Room) => void;
  upsertLobbyRoom: (room: Room, category?: LobbyCategoryKey | string | null) => void;
  removeRoom: (roomIdOrCode: string) => void;
  setStats: (stats: Partial<LobbyStats>) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  rooms: [],
  lobby: emptyLobbyCategories(),
  minimumNativeVersions: {},
  minimumNativeBuilds: {},
  nativeStoreUrls: {},
  nativeUpdatePopup: false,
  stats: {
    online_players: 0,
    active_games: 0,
  },
  isLoading: false,
  error: null,
};

export const useLobbyStore = create<LobbyState>((set) => ({
  ...initialState,

  setRooms: (rooms) =>
    set({
      rooms,
      lobby: {
        ...emptyLobbyCategories(),
        open_tables: rooms,
      },
    }),

  setLobby: (lobby) => set({ lobby, rooms: flattenLobbyCategories(lobby) }),

  addRoom: (room) =>
    set((state) => ({
      rooms: [...state.rooms, room],
    })),

  updateRoom: (updatedRoom) =>
    set((state) => {
      const replaceRoom = (room: Room) => {
        const idsMatch = !!room.id && !!updatedRoom.id && room.id === updatedRoom.id;
        const codesMatch = room.code === updatedRoom.code;
        return idsMatch || codesMatch ? updatedRoom : room;
      };
      const lobby = emptyLobbyCategories();
      lobbyCategoryKeys.forEach((key) => {
        lobby[key] = state.lobby[key].map(replaceRoom);
      });
      return {
        lobby,
        rooms: state.rooms.map(replaceRoom),
      };
    }),

  upsertLobbyRoom: (updatedRoom, category) =>
    set((state) => {
      const lobby = emptyLobbyCategories();
      const previousCategory = lobbyCategoryKeys.find((key) =>
        state.lobby[key].some((room) => room.code === updatedRoom.code),
      );
      const targetCategory =
        category === undefined
          ? (previousCategory ?? null)
          : lobbyCategoryKeys.includes(category as LobbyCategoryKey)
            ? (category as LobbyCategoryKey)
            : null;

      lobbyCategoryKeys.forEach((key) => {
        lobby[key] = state.lobby[key].filter((room) => room.code !== updatedRoom.code);
      });

      if (targetCategory) {
        lobby[targetCategory] = [updatedRoom, ...lobby[targetCategory]];
      }

      const nextRooms = flattenLobbyCategories(lobby);
      const previouslyCategorizedCodes = new Set(
        flattenLobbyCategories(state.lobby).map((room) => room.code),
      );
      state.rooms.forEach((room) => {
        if (
          room.code !== updatedRoom.code &&
          !previouslyCategorizedCodes.has(room.code) &&
          !nextRooms.some((candidate) => candidate.code === room.code)
        ) {
          nextRooms.push(room);
        }
      });
      if (category !== null && !nextRooms.some((room) => room.code === updatedRoom.code)) {
        nextRooms.push(updatedRoom);
      }

      return { lobby, rooms: nextRooms };
    }),

  removeRoom: (idOrCode) =>
    set((state) => {
      const lobby = emptyLobbyCategories();
      lobbyCategoryKeys.forEach((key) => {
        lobby[key] = state.lobby[key].filter((room) => {
          const matchesId = !!idOrCode && !!room.id && room.id === idOrCode;
          const matchesCode = room.code === idOrCode;
          return !(matchesId || matchesCode);
        });
      });

      return {
        lobby,
        rooms: state.rooms.filter((r) => {
          const matchesId = !!idOrCode && !!r.id && r.id === idOrCode;
          const matchesCode = r.code === idOrCode;
          return !(matchesId || matchesCode);
        }),
      };
    }),

  setStats: (newStats) =>
    set((state) => ({
      stats: { ...state.stats, ...newStats },
    })),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  reset: () => set(initialState),
}));
