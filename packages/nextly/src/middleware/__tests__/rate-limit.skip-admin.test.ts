// Why: pin the default-skip behaviour. Without it, normal admin nav
// fires several parallel queries per page (/me, /dashboard/stats,
// /schema/journal, per-collection lists) and the public 100/60s cap
// trips after a handful of nav events. Admin is session-authed; the
// rate limiter exists to protect the public REST surface. See the
// `defaultSkipAdminApi` jsdoc and the `skip` field on RateLimitConfig.

import { describe, expect, it, vi } from "vitest";

import {
  createRateLimiter,
  defaultSkipAdminApi,
  type RateLimitStore,
} from "../rate-limit";

function makeStore(): RateLimitStore {
  // Always reports 1 request — verifies that the limiter never tries to
  // increment for skipped paths (we assert via the spy below).
  const increment = vi
    .fn<RateLimitStore["increment"]>()
    .mockResolvedValue({ count: 1, resetAt: Date.now() + 60000 });
  return {
    increment,
    reset: vi.fn(),
  };
}

describe("defaultSkipAdminApi", () => {
  it("returns true for admin internal API routes", () => {
    expect(
      defaultSkipAdminApi(
        new Request("http://localhost/admin/api/collections/posts/entries")
      )
    ).toBe(true);
    expect(
      defaultSkipAdminApi(new Request("http://localhost/admin/api/me"))
    ).toBe(true);
    expect(
      defaultSkipAdminApi(
        new Request("http://localhost/admin/api/schema/journal")
      )
    ).toBe(true);
  });

  it("returns false for public REST routes", () => {
    expect(
      defaultSkipAdminApi(
        new Request("http://localhost/api/collections/posts/entries")
      )
    ).toBe(false);
    expect(defaultSkipAdminApi(new Request("http://localhost/api/me"))).toBe(
      false
    );
  });

  it("returns false for non-API admin routes (the actual UI pages)", () => {
    // /admin/* without /api/ is the admin SPA HTML — Next.js serves it
    // via a different route handler, so it never hits this middleware
    // anyway, but pin the boundary just in case.
    expect(
      defaultSkipAdminApi(new Request("http://localhost/admin/collections"))
    ).toBe(false);
  });
});

describe("createRateLimiter — default skip behaviour", () => {
  it("does not rate-limit /admin/api/* requests by default", async () => {
    const store = makeStore();
    const limiter = createRateLimiter({
      enabled: true,
      readLimit: 1, // tight cap to make sure we'd 429 otherwise
      writeLimit: 1,
      windowMs: 60000,
      store,
    });

    // Hit the same admin endpoint many times — all should pass.
    for (let i = 0; i < 10; i++) {
      const result = await limiter(
        new Request("http://localhost/admin/api/me", { method: "GET" })
      );
      expect(result).toBeNull();
    }

    // Critical: the store should NEVER have been touched for skipped
    // paths. If it was, we'd be paying I/O for nothing AND we'd have
    // shared a bucket between admin + public.
    expect(store.increment).not.toHaveBeenCalled();
  });

  it("still rate-limits public /api/* requests with the same config", async () => {
    const store = makeStore();
    const limiter = createRateLimiter({
      enabled: true,
      readLimit: 1,
      writeLimit: 1,
      windowMs: 60000,
      store,
    });

    // First read passes (count === 1, limit === 1).
    const first = await limiter(
      new Request("http://localhost/api/collections/posts/entries", {
        method: "GET",
      })
    );
    expect(first).toBeNull();

    // Bump the store to 2 to simulate the second hit exceeding the cap.
    (store.increment as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      count: 2,
      resetAt: Date.now() + 60000,
    });
    const second = await limiter(
      new Request("http://localhost/api/collections/posts/entries", {
        method: "GET",
      })
    );
    expect(second).toBeInstanceOf(Response);
    expect((second as Response).status).toBe(429);
  });

  it("respects an explicit `skip: () => false` override (rate-limits admin too)", async () => {
    const store = makeStore();
    const limiter = createRateLimiter({
      enabled: true,
      readLimit: 1,
      writeLimit: 1,
      windowMs: 60000,
      store,
      skip: () => false, // user opts in to rate-limiting admin
    });

    const result = await limiter(
      new Request("http://localhost/admin/api/me", { method: "GET" })
    );
    expect(result).toBeNull();
    // Store WAS touched this time — caller asked for it.
    expect(store.increment).toHaveBeenCalledOnce();
  });
});
