/**
 * What the admin makes of a refresh that lost a race with another tab.
 *
 * Two tabs refreshing the same token at once get one rotation: the winner
 * sets fresh cookies, and the loser is answered 401 `REFRESH_SUPERSEDED`
 * without a cookie clear. The fresh cookies are already in this browser, so
 * the losing tab retries; only a 401 that clears the session sends it to sign
 * in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../fetcher", () => ({ BASE_URL: "/admin/api" }));

import { authFetch, refreshAccessToken } from "../refreshInterceptor";

const fetchSpy = vi.fn();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const expired = () =>
  json(401, { error: { code: "TOKEN_EXPIRED", message: "expired" } });

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("refreshAccessToken", () => {
  it("reads REFRESH_SUPERSEDED as a refresh another tab already made", async () => {
    fetchSpy.mockResolvedValueOnce(
      json(401, { error: { code: "REFRESH_SUPERSEDED", message: "rotated" } })
    );

    await expect(refreshAccessToken()).resolves.toBe("ok");
  });

  it("reads any other 401 as a dead session", async () => {
    // The control: without it, a refresh that answered "ok" to every 401
    // would satisfy the case above.
    fetchSpy.mockResolvedValueOnce(
      json(401, { error: { code: "REFRESH_FAILED", message: "invalid" } })
    );

    await expect(refreshAccessToken()).resolves.toBe("auth_failed");
  });
});

describe("authFetch after a superseded refresh", () => {
  it("retries the original request instead of signing the tab out", async () => {
    fetchSpy
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(
        json(401, {
          error: { code: "REFRESH_SUPERSEDED", message: "rotated" },
        })
      )
      .mockResolvedValueOnce(json(200, { ok: true }));

    const res = await authFetch("/admin/api/thing");

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
