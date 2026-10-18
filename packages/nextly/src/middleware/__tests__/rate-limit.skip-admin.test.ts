// The deprecated `defaultSkipAdminApi`: no longer the default, and unchanged
// for an app that passes it as `skip`.

import { describe, expect, it } from "vitest";

import { defaultSkipAdminApi, InMemoryRateLimitStore } from "../rate-limit";
import { createRateLimiter } from "../rest-limits";

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

describe("createRateLimiter and the admin API", () => {
  const tight = {
    enabled: true,
    readLimit: 1,
    writeLimit: 1,
    windowMs: 60000,
    keyGenerator: () => "one-client",
  };
  const admin = () =>
    new Request("http://localhost/admin/api/me", { method: "GET" });

  it("limits /admin/api/* requests by default", async () => {
    const limiter = createRateLimiter({
      ...tight,
      store: new InMemoryRateLimitStore(),
    });
    expect(await limiter(admin())).toBeNull();
    expect((await limiter(admin()))?.status).toBe(429);
  });

  it("still exempts them for an app passing defaultSkipAdminApi as skip", async () => {
    const limiter = createRateLimiter({
      ...tight,
      store: new InMemoryRateLimitStore(),
      skip: defaultSkipAdminApi,
    });
    for (let i = 0; i < 5; i++) expect(await limiter(admin())).toBeNull();
  });
});
