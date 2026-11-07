import { describe, expect, it } from "bun:test";
import type { ApiClient } from "../src/api/client";
import { createAuthApi } from "../src/api/auth";

describe("auth API", () => {
  it("deletes the account with no request body", async () => {
    const calls: unknown[][] = [];
    const api = {
      delete: async (...args: unknown[]) => {
        calls.push(args);
        return { status: 204, data: "" };
      },
    } as unknown as ApiClient;

    await expect(createAuthApi(api).deleteAccount()).resolves.toBeUndefined();

    expect(calls).toEqual([["/api/v1/auth/me"]]);
  });
});

describe("ads on /me", () => {
  const reads: unknown[][] = [];
  const me = (data: unknown) =>
    ({
      get: async (...args: unknown[]) => {
        reads.push(args);
        return { data: { data } };
      },
    }) as unknown as ApiClient;
  const user = { id: "u1", email: null, username: "bengt" };
  const ads = { eligible: true, next_game_needs_ad: true, games_until_ad: 0, free_games_left: 0 };

  it("puts the server's ads on the user, next to which /me sends them", async () => {
    await expect(createAuthApi(me({ user, ads })).getMe()).resolves.toEqual({ ...user, ads });
  });

  it("leaves ads off for an older server", async () => {
    const result = await createAuthApi(me({ user })).getMe();
    expect(result).toEqual(user);
    expect("ads" in result).toBe(false);
  });

  // Offers count only on ad-aware reads, so 3.3.0 says so on every one, invitations included.
  it("reads /me as ad-aware", async () => {
    reads.length = 0;
    const auth = createAuthApi(me({ user, ads, seat_invitations: [] }));
    await auth.getMe();
    await auth.getSeatInvitations();
    const adAware = ["/api/v1/auth/me", { params: { ads_aware: true } }];
    expect(reads).toEqual([adAware, adAware]);
  });
});
