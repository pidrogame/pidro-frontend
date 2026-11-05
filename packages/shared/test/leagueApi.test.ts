import { describe, expect, test } from "bun:test";
import {
  createLeagueApi,
  type ApiClient,
  type LeagueRibbon,
  type LeagueState,
} from "../src/api";

const state: LeagueState = {
  status: "not_placed",
  league: "deuce",
  week: {
    starts_at: "2026-11-01T19:00:00Z",
    closes_at: "2026-11-08T19:00:00Z",
  },
  room: null,
  me: null,
  last_week: null,
  pending_result: null,
  friends: [],
  ribbons: { current: null, past: [] },
  intro_seen: false,
  classic: false,
};

function recordingApi(response: LeagueState = state) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api = {
    get: async (path: string) => {
      calls.push({ method: "get", path });
      return { data: response };
    },
    put: async (path: string, body: unknown) => {
      calls.push({ method: "put", path, body });
      return { data: response };
    },
    post: async (path: string) => {
      calls.push({ method: "post", path });
      return { status: 204, data: "" };
    },
  } as unknown as ApiClient;
  return { api, calls };
}

describe("league API contract", () => {
  test("preserves avatars and server star_possible on current, past and result ribbons", async () => {
    const ribbon: LeagueRibbon = {
      month: "2026-11",
      league: "jack",
      star: false,
      star_possible: false,
      weeks_played: 1,
      weeks_total: 5,
      so_far: true,
    };
    const response: LeagueState = {
      ...state,
      status: "placed",
      league: "jack",
      room: {
        size: 1,
        promote: 0,
        demote: 0,
        standings: [
          {
            place: 1,
            user_id: "me",
            username: "Mirja",
            avatar: { url: null },
            level: 44,
            prestige: 0,
            pin: "classic",
            points: 3120,
            me: true,
            friend: false,
          },
        ],
      },
      me: { place: 1, points: 3120 },
      friends: [
        {
          user_id: "friend",
          username: "Kalle",
          avatar: { url: "https://example.com/avatar.jpg" },
          level: 42,
          prestige: 0,
          league: "ace",
          place: 3,
          points: 2715,
        },
      ],
      ribbons: {
        current: ribbon,
        past: [
          {
            ...ribbon,
            month: "2026-10",
            so_far: false,
            star: true,
            star_possible: false,
            weeks_played: 4,
            weeks_total: 4,
          },
        ],
      },
      pending_result: {
        id: "result",
        week_starts_at: "2026-10-25T19:00:00Z",
        week_closes_at: "2026-11-01T19:00:00Z",
        old_league: "ten",
        new_league: "jack",
        move: "up",
        place: 1,
        points: 3120,
        room_size: 30,
        ribbon: { ...ribbon, star_possible: true, changed: true },
      },
    };
    const { api } = recordingApi(response);
    const received = await createLeagueApi(api).get();
    expect(received).toBe(response);
    expect(received.ribbons.current?.star_possible).toBe(false);
    expect(received.ribbons.past[0].star_possible).toBe(false);
    expect(received.pending_result?.ribbon.star_possible).toBe(true);
    expect(received.room?.standings[0].avatar).toEqual({ url: null });
    expect(received.room?.standings[0].friend).toBe(false);
    expect(received.friends?.[0].points).toBe(2715);
    expect(received.friends?.[0].avatar.url).toBe(
      "https://example.com/avatar.jpg",
    );
  });

  test("GET and hidden PUT return the plain response body, not data.data", async () => {
    const { api, calls } = recordingApi();
    const league = createLeagueApi(api);
    expect(await league.get()).toBe(state);
    expect(await league.setHidden(true)).toBe(state);
    expect(await league.setHidden(false)).toBe(state);
    expect(calls).toEqual([
      { method: "get", path: "/api/v1/league" },
      { method: "put", path: "/api/v1/league/hidden", body: { hidden: true } },
      { method: "put", path: "/api/v1/league/hidden", body: { hidden: false } },
    ]);
  });

  test("seen operations accept 204 and encode result IDs as one path segment", async () => {
    const { api, calls } = recordingApi();
    const league = createLeagueApi(api);
    expect(await league.markResultSeen("result/one ?")).toBeUndefined();
    expect(calls).toEqual([
      {
        method: "post",
        path: "/api/v1/league/results/result%2Fone%20%3F/seen",
      },
    ]);
  });

  test("existing API errors propagate unchanged", async () => {
    const failure = new Error("account required");
    const api = {
      get: async () => {
        throw failure;
      },
      put: async () => {
        throw failure;
      },
      post: async () => {
        throw failure;
      },
    } as unknown as ApiClient;
    const league = createLeagueApi(api);
    for (const action of [
      () => league.get(),
      () => league.setHidden(true),
      () => league.markResultSeen("id"),
    ]) {
      await expect(action()).rejects.toBe(failure);
    }
  });
});
