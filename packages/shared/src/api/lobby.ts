import type { ApiClient } from './client';
import type {
  LobbyCategories,
  Room,
  CreateRoomRequest,
  Position,
  PositionPreference,
  SeatType,
} from '../types/lobby';
import {
  flattenLobbyCategories,
  lobbyCategoryKeys,
  normalizeLobbyCategories,
  normalizeRoom,
  normalizeRooms,
} from '../utils/rooms';

export interface ListRoomsResponse {
  data?: {
    rooms: Room[];
    meta?: {
      total_rooms: number;
      online_players: number;
      active_games: number;
    };
  };
  rooms?: Room[];
  meta?: {
    total_rooms: number;
    online_players: number;
    active_games: number;
  };
}

export interface ListLobbyResponse {
  data?: Partial<LobbyCategories>;
  lobby?: Partial<LobbyCategories>;
}

export interface GetRoomResponse {
  data?: { room: Room };
  room?: Room;
}

export interface JoinRoomResponse {
  data?: { room: Room; assigned_position: string };
  room?: Room;
  assigned_position?: string;
}

export interface CreateRoomResponse {
  data?: { code: string; room: Room };
  code?: string;
  room?: Room;
}

function extractRoomsFromResponse(body: any): Room[] {
  const candidates = [body?.data?.rooms, body?.rooms, body?.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

export function createLobbyApi(api: ApiClient) {
  return {
    listRooms: async (): Promise<{ rooms: Room[]; meta?: ListRoomsResponse['meta'] }> => {
      const response = await api.get<any>('/api/v1/rooms');
      const body = response.data;
      const rooms = normalizeRooms(extractRoomsFromResponse(body));
      const meta = body?.meta ?? body?.data?.meta;
      return { rooms, meta };
    },

    listLobby: async (): Promise<{ lobby: LobbyCategories; rooms: Room[] }> => {
      const response = await api.get<ListLobbyResponse>('/api/v1/lobby');
      const body = response.data;
      const rawLobby = body?.data ?? body?.lobby ?? body;
      if (!lobbyCategoryKeys.every((key) => Array.isArray((rawLobby as Partial<LobbyCategories>)?.[key]))) {
        throw new Error('Incomplete lobby response');
      }
      const lobby = normalizeLobbyCategories(rawLobby);
      return {
        lobby,
        rooms: flattenLobbyCategories(lobby),
      };
    },

    getRoom: async (code: string): Promise<Room> => {
      const response = await api.get<GetRoomResponse>(`/api/v1/rooms/${code}`);
      const payload = response.data;
      const rawRoom = payload?.data?.room ?? payload?.room ?? payload;
      return normalizeRoom(rawRoom);
    },

    createRoom: async (payload: CreateRoomRequest): Promise<CreateRoomResponse['data']> => {
      const response = await api.post<CreateRoomResponse>('/api/v1/rooms', payload);
      const data = response.data?.data ?? response.data;
      const room = data?.room ? normalizeRoom(data.room) : normalizeRoom(data);
      return { code: data?.code ?? room.code, room };
    },

    joinRoom: async (
      code: string,
      position?: PositionPreference,
      password?: string,
    ): Promise<{ room: Room; assigned_position: string }> => {
      const body = position ? { position, ...(password ? { password } : {}) } : undefined;
      const response = await api.post<JoinRoomResponse>(`/api/v1/rooms/${code}/join`, body);
      return {
        room: normalizeRoom(response.data?.data?.room ?? response.data?.room),
        assigned_position:
          response.data?.data?.assigned_position ?? response.data?.assigned_position ?? '',
      };
    },

    watchRoom: async (code: string): Promise<Room> => {
      const response = await api.post<GetRoomResponse>(`/api/v1/rooms/${code}/watch`);
      const payload = response.data;
      const rawRoom = payload?.data?.room ?? payload?.room ?? payload;
      return normalizeRoom(rawRoom);
    },

    leaveRoom: async (code: string): Promise<void> => {
      await api.delete(`/api/v1/rooms/${code}/leave`);
    },

    unwatchRoom: async (code: string): Promise<void> => {
      await api.delete(`/api/v1/rooms/${code}/unwatch`);
    },

    /** Not now on a seat invitation: the host's hold at that seat opens again. */
    declineSeatInvitation: async (code: string, position: Position): Promise<void> => {
      await api.post(`/api/v1/rooms/${code}/seats/${position}/decline`);
    },

    kickPlayer: async (code: string, position: Position): Promise<Room> => {
      const response = await api.post<GetRoomResponse>(`/api/v1/rooms/${code}/kick`, { position });
      return normalizeRoom(response.data?.data?.room ?? response.data?.room);
    },

    /** Host only, while waiting: the seat becomes this entry, replacing a bot, a hold or a requirement. */
    setSeat: async (code: string, position: Position, seat: SeatType): Promise<Room> => {
      const response = await api.put<GetRoomResponse>(`/api/v1/rooms/${code}/seats/${position}`, { seat });
      return normalizeRoom(response.data?.data?.room ?? response.data?.room);
    },

    /** Host only, while waiting (PID-457): a bot sits in every open seat; a held seat stays held. */
    fillWithBots: async (code: string): Promise<Room> => {
      const response = await api.post<GetRoomResponse>(`/api/v1/rooms/${code}/fill-with-bots`);
      return normalizeRoom(response.data?.data?.room ?? response.data?.room);
    },
  };
}

export type LobbyApi = ReturnType<typeof createLobbyApi>;
