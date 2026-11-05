import type { ApiClient } from "./client";
import type { SeatPin } from "../types/game";

export type LeagueId = "deuce" | "ten" | "jack" | "ace" | "pidro";

/** The backend's seat avatar object (not the client's flattened avatar_url). */
export interface LeagueAvatar {
  url: string | null;
}

export interface LeagueStanding {
  place: number;
  user_id: string;
  username: string;
  avatar: LeagueAvatar;
  level: number;
  prestige: number;
  pin: SeatPin | null;
  points: number;
  me: boolean;
}

export interface LeagueFriend {
  user_id: string;
  username: string;
  avatar: LeagueAvatar;
  level: number;
  prestige: number;
  league: LeagueId;
  place: number;
}

export interface LeagueRibbon {
  month: string;
  league: LeagueId;
  star: boolean;
  /** Server-owned: still running, with participation at every close so far. */
  star_possible: boolean;
  weeks_played: number;
  weeks_total: number;
  so_far: boolean;
}

export interface LeagueResult {
  id: string;
  week_starts_at: string;
  week_closes_at: string;
  old_league: LeagueId;
  new_league: LeagueId;
  move: "up" | "stayed" | "down";
  place: number;
  points: number;
  room_size: number;
  ribbon: LeagueRibbon & { changed: boolean };
}

export interface LeagueState {
  status: "placed" | "not_placed" | "opted_out" | "guest" | "off";
  league: LeagueId | null;
  week: { starts_at: string; closes_at: string } | null;
  room: {
    size: number;
    promote: number;
    demote: number;
    standings: LeagueStanding[];
  } | null;
  me: { place: number; points: number } | null;
  last_week: {
    league: LeagueId;
    place: number;
    room_size: number;
    points: number;
  } | null;
  pending_result: LeagueResult | null;
  friends: LeagueFriend[] | null;
  ribbons: { current: LeagueRibbon | null; past: LeagueRibbon[] };
  intro_seen: boolean;
  classic: boolean;
}

/** League responses are plain bodies, unlike the older wrapped APIs. */
export function createLeagueApi(api: ApiClient) {
  return {
    get: async (): Promise<LeagueState> =>
      (await api.get<LeagueState>("/api/v1/league")).data,
    markResultSeen: async (id: string): Promise<void> => {
      await api.post(`/api/v1/league/results/${encodeURIComponent(id)}/seen`);
    },
    setHidden: async (hidden: boolean): Promise<LeagueState> =>
      (await api.put<LeagueState>("/api/v1/league/hidden", { hidden })).data,
  };
}

export type LeagueApi = ReturnType<typeof createLeagueApi>;
