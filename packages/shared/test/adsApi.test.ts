import { expect, it } from "bun:test";
import type { ApiClient } from "../src/api/client";
import { createAdsApi } from "../src/api/ads";

it("reports each outcome to its own endpoint with no body", async () => {
  const calls: unknown[][] = [];
  const api = {
    post: async (...args: unknown[]) => {
      calls.push(args);
      return { status: 204, data: "" };
    },
  } as unknown as ApiClient;
  const ads = createAdsApi(api);

  await ads.watched();
  await ads.unavailable();
  await ads.dismissed();

  expect(calls).toEqual([
    ["/api/v1/me/ads/watched"],
    ["/api/v1/me/ads/unavailable"],
    ["/api/v1/me/ads/dismissed"],
  ]);
});
