/**
 * The REST limit, counted by who is asking: a session, a key, an address, or
 * the ceiling shared by unresolved sources. Driven through the limit with
 * readers of the test's own, so each case names the credential it carries;
 * the readers authentication supplies are covered in `rest-callers.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

import { InMemoryRateLimitStore, type RateLimitConfig } from "../rate-limit";
import type { RestCallerReaders } from "../rest-callers";
import { openRestLimitGate, type RestLimitTarget } from "../rest-limit-gate";
import {
  createRateLimiter,
  createRestLimits,
  SESSION_BUDGET_MULTIPLE,
  UNRESOLVED_CEILING_MULTIPLE,
} from "../rest-limits";

const SITE = "http://localhost";

/** How many requests the fake per-key budget admits a window. */
const KEY_BUDGET = 3;

/**
 * Readers for the test: a `session=<user>` cookie verifies as that user, a
 * key starting `valid-` resolves, and a resolved key's budget admits
 * {@link KEY_BUDGET} requests.
 */
function testReaders(): RestCallerReaders & {
  lookupKey: ReturnType<typeof vi.fn>;
  debitKey: ReturnType<typeof vi.fn>;
} {
  const spent = new Map<string, number>();
  return {
    sessionUser: vi.fn(async (request: Request) => {
      const match = /session=([^;]+)/.exec(request.headers.get("cookie") ?? "");
      return match?.[1] && match[1] !== "forged" ? match[1] : null;
    }),
    lookupKey: vi.fn(async (rawKey: string) =>
      rawKey.startsWith("valid-")
        ? {
            id: rawKey,
            userId: "owner",
            tokenType: "full-access" as const,
            roleId: null,
          }
        : null
    ),
    debitKey: vi.fn(async (keyId: string) => {
      const count = (spent.get(keyId) ?? 0) + 1;
      spent.set(keyId, count);
      return count > KEY_BUDGET ? new Response(null, { status: 429 }) : null;
    }),
  };
}

interface Caller {
  method?: string;
  path?: string;
  /** A resolved client address; omitted for an unresolved source. */
  address?: string;
  session?: string;
  key?: string;
}

function request(caller: Caller = {}): Request {
  const headers: Record<string, string> = {};
  if (caller.address) headers["x-forwarded-for"] = caller.address;
  if (caller.session) headers.cookie = `session=${caller.session}`;
  if (caller.key) headers.authorization = `Bearer ${caller.key}`;
  return new Request(
    `${SITE}${caller.path ?? "/admin/api/collections/posts"}`,
    {
      method: caller.method ?? "GET",
      headers,
    }
  );
}

function limiter(
  config: Partial<RateLimitConfig> = {},
  readers: RestCallerReaders = testReaders()
) {
  const limits = createRestLimits(
    {
      enabled: true,
      readLimit: 2,
      writeLimit: 1,
      windowMs: 60_000,
      trustProxy: true,
      store: new InMemoryRateLimitStore(),
      ...config,
    },
    readers
  );
  return (caller: Caller = {}, target: RestLimitTarget = "core") => {
    const req = request(caller);
    return openRestLimitGate(limits, req).settle(target);
  };
}

/** How many of `times` identical requests were admitted. */
async function admitted(
  check: ReturnType<typeof limiter>,
  caller: Caller,
  times: number,
  target: RestLimitTarget = "core"
): Promise<number> {
  let count = 0;
  for (let i = 0; i < times; i++) {
    if ((await check(caller, target)) === null) count++;
  }
  return count;
}

describe("REST limit: no exemption by path", () => {
  it("limits an /admin/api request under a default config", async () => {
    const check = limiter();
    expect(await admitted(check, { address: "203.0.113.7" }, 5)).toBe(2);
  });

  it("keeps an app's configured skip", async () => {
    const check = limiter({ skip: () => true });
    expect(await admitted(check, { address: "203.0.113.7" }, 5)).toBe(5);
  });
});

describe("REST limit: classified as authentication does", () => {
  it("counts a valid session with a valid key against the session, without looking the key up", async () => {
    const readers = testReaders();
    const check = limiter({}, readers);
    const caller = { session: "u1", key: "valid-k1", address: "203.0.113.7" };
    expect(await admitted(check, caller, 20)).toBe(2 * SESSION_BUDGET_MULTIPLE);
    expect(readers.lookupKey).not.toHaveBeenCalled();
    expect(readers.debitKey).not.toHaveBeenCalled();
  });

  it("counts a valid session with an invalid key against the session, without looking the key up", async () => {
    const readers = testReaders();
    const check = limiter({}, readers);
    expect(
      await admitted(
        check,
        { session: "u1", key: "bogus", address: "203.0.113.7" },
        20
      )
    ).toBe(2 * SESSION_BUDGET_MULTIPLE);
    expect(readers.lookupKey).not.toHaveBeenCalled();
  });

  it("counts an invalid session with a valid key against the key's own budget", async () => {
    const readers = testReaders();
    const check = limiter({}, readers);
    expect(
      await admitted(
        check,
        { session: "forged", key: "valid-k1", address: "203.0.113.7" },
        10
      )
    ).toBe(KEY_BUDGET);
    expect(readers.debitKey).toHaveBeenCalledWith("valid-k1");
    // The address's own budget is untouched by a resolving key.
    expect(await admitted(check, { address: "203.0.113.7" }, 5)).toBe(2);
  });
});

describe("REST limit: sessions", () => {
  it("spends a session's budget, five times the per-address budgets, whatever address it comes from", async () => {
    const check = limiter();
    let admittedReads = 0;
    for (let i = 0; i < 20; i++) {
      const result = await check({ session: "u1", address: `198.51.100.${i}` });
      if (result === null) admittedReads++;
    }
    expect(admittedReads).toBe(2 * SESSION_BUDGET_MULTIPLE);
    expect(
      await admitted(
        check,
        { session: "u1", method: "POST", address: "203.0.113.7" },
        20
      )
    ).toBe(1 * SESSION_BUDGET_MULTIPLE);
  });

  it("uses a configured session budget", async () => {
    const check = limiter({ sessions: { readLimit: 3, writeLimit: 4 } });
    expect(await admitted(check, { session: "u1" }, 10)).toBe(3);
    expect(await admitted(check, { session: "u1", method: "PATCH" }, 10)).toBe(
      4
    );
  });

  it("keeps one user's spent budget from refusing another's", async () => {
    const check = limiter();
    await admitted(check, { session: "u1" }, 20);
    expect(await check({ session: "u2" })).toBeNull();
  });

  it("counts a session that does not verify as carrying none", async () => {
    const check = limiter();
    expect(
      await admitted(check, { session: "forged", address: "203.0.113.7" }, 5)
    ).toBe(2);
  });
});

describe("REST limit: API keys", () => {
  it("admits a key for exactly its own budget, then refuses it, debiting once per request", async () => {
    const readers = testReaders();
    const check = limiter({}, readers);
    expect(await admitted(check, { key: "valid-k1" }, KEY_BUDGET + 2)).toBe(
      KEY_BUDGET
    );
    expect(readers.debitKey).toHaveBeenCalledTimes(KEY_BUDGET + 2);
  });

  it("refuses only the key whose budget is spent", async () => {
    const check = limiter();
    await admitted(check, { key: "valid-k1" }, KEY_BUDGET + 1);
    expect(await check({ key: "valid-k2" })).toBeNull();
  });

  it("spends a resolved source's own budget on invalid keys", async () => {
    const check = limiter();
    expect(await check({ key: "bogus", address: "203.0.113.7" })).toBeNull();
    expect(await check({ key: "bogus", address: "203.0.113.7" })).toBeNull();
    // Both failures spent the address's two reads.
    expect(await check({ address: "203.0.113.7" })).not.toBeNull();
  });

  it("bounds failed lookups from a resolved address before the next lookup, and only there", async () => {
    const readers = testReaders();
    const check = limiter({}, readers);
    const flood = await admitted(
      check,
      { key: "bogus", address: "203.0.113.7" },
      10
    );
    expect(flood).toBe(2);
    // The bound is spent: no further lookup ran for the refused requests.
    expect(readers.lookupKey).toHaveBeenCalledTimes(2);
    // The concession: a valid key sent under the same spent bound is refused,
    // before any lookup.
    expect(
      await check({ key: "valid-k1", address: "203.0.113.7" })
    ).not.toBeNull();
    expect(readers.lookupKey).toHaveBeenCalledTimes(2);
    // Nothing else: a session from that address, and a key from another.
    expect(await check({ session: "u1", address: "203.0.113.7" })).toBeNull();
    expect(
      await check({ key: "valid-k1", address: "198.51.100.1" })
    ).toBeNull();
  });

  it("bounds failed lookups from unresolved sources by their own ceiling, never the anonymous one", async () => {
    const readers = testReaders();
    const check = limiter({}, readers);
    const bound = 2 * UNRESOLVED_CEILING_MULTIPLE;
    expect(await admitted(check, { key: "bogus" }, bound + 5)).toBe(bound);
    expect(readers.lookupKey).toHaveBeenCalledTimes(bound);
    // The next valid key from an unresolved source is refused before lookup.
    expect(await check({ key: "valid-k1" })).not.toBeNull();
    expect(readers.lookupKey).toHaveBeenCalledTimes(bound);
    // The anonymous ceiling is unspent, and a session and a key from a
    // resolved address are admitted.
    expect(await check({})).toBeNull();
    expect(await check({ session: "u1" })).toBeNull();
    expect(
      await check({ key: "valid-k1", address: "198.51.100.1" })
    ).toBeNull();
  });
});

describe("REST limit: addresses", () => {
  it("keeps the per-address budgets, apart for each address", async () => {
    const check = limiter();
    expect(await admitted(check, { address: "203.0.113.7" }, 5)).toBe(2);
    expect(
      await admitted(check, { address: "203.0.113.7", method: "POST" }, 5)
    ).toBe(1);
    expect(await check({ address: "198.51.100.1" })).toBeNull();
  });

  it("keeps a collection's override", async () => {
    const check = limiter({ collections: { posts: { readLimit: 4 } } });
    expect(await admitted(check, { address: "203.0.113.7" }, 10)).toBe(4);
  });
});

describe("REST limit: the unresolved sources' ceiling", () => {
  it("shares one ceiling, ten times the per-address budgets by default", async () => {
    const check = limiter();
    expect(await admitted(check, {}, 50)).toBe(2 * UNRESOLVED_CEILING_MULTIPLE);
    expect(await admitted(check, { method: "DELETE" }, 50)).toBe(
      1 * UNRESOLVED_CEILING_MULTIPLE
    );
  });

  it("uses a configured ceiling", async () => {
    const check = limiter({ unresolvedCeiling: { readLimit: 3 } });
    expect(await admitted(check, {}, 10)).toBe(3);
  });

  it("never refuses a verified session or a resolving key once spent", async () => {
    const check = limiter();
    await admitted(check, {}, 50);
    expect(await check({})).not.toBeNull();
    expect(await check({ session: "u1" })).toBeNull();
    expect(await check({ key: "valid-k1" })).toBeNull();
  });

  it("keeps a route with an auth limit of its own out of the ceiling", async () => {
    const check = limiter();
    await admitted(check, {}, 50);
    expect(
      await check({ path: "/admin/api/auth/login", method: "POST" }, "auth")
    ).toBeNull();
  });
});

describe("REST limit: off", () => {
  it("counts nothing, and leaves a key's own budget to authentication", async () => {
    const readers = testReaders();
    const check = limiter({ enabled: false }, readers);
    expect(await admitted(check, {}, 100)).toBe(100);
    expect(await admitted(check, { key: "valid-k1" }, 10)).toBe(10);
    // The limit looked nothing up, so authentication still spends the key's
    // budget as it always has (`rest-callers.test.ts`).
    expect(readers.lookupKey).not.toHaveBeenCalled();
  });
});

describe("createRateLimiter", () => {
  it("is the same limit, for an app's own route", async () => {
    const check = createRateLimiter({
      enabled: true,
      readLimit: 1,
      writeLimit: 1,
      keyGenerator: () => "app-client",
      store: new InMemoryRateLimitStore(),
    });
    const first = await check(request());
    const second = await check(request());
    expect(first).toBeNull();
    expect(second?.status).toBe(429);
  });
});
