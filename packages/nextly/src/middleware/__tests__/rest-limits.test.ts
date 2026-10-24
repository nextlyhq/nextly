/**
 * The REST limit, counted by who is asking: a session, a key, an address, or
 * the ceiling shared by unresolved sources. Driven through the limit with
 * readers of the test's own, so each case names the credential it carries;
 * the readers authentication supplies are covered in `rest-callers.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { container } from "../../di/container";

import { limitStoreUnavailable } from "../../domains/limits/limit-store";
import {
  InMemoryRateLimitStore,
  type RateLimitConfig,
  type RateLimitStore,
} from "../rate-limit";
import type { RestCallerReaders } from "../rest-callers";
import { openRestLimitGate, type RestLimitTarget } from "../rest-limit-gate";
import {
  createRateLimiter,
  createRestLimits,
  restLimitCounts,
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
    // Handed the request too, so the key's refusal carries its request id.
    expect(readers.debitKey).toHaveBeenCalledWith(
      "valid-k1",
      expect.any(Request)
    );
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

  /** How many of `paths` one address is admitted, each requested once. */
  async function admittedAcross(
    check: ReturnType<typeof limiter>,
    paths: string[],
    caller: Caller = {}
  ): Promise<number> {
    let count = 0;
    for (const path of paths) {
      const refused = await check({ address: "203.0.113.7", ...caller, path });
      if (refused === null) count++;
    }
    return count;
  }

  const rotate = (make: (n: number) => string) =>
    Array.from({ length: 6 }, (_, n) => make(n));

  it("opens no new budget for a collection named in the query", async () => {
    const check = limiter();
    const paths = rotate(n => `/admin/api/admin-meta?x=/collections/c${n}`);
    expect(await admittedAcross(check, paths)).toBe(2);
  });

  it("opens no new budget for a collection the config does not override", async () => {
    const check = limiter({ collections: { posts: { readLimit: 4 } } });
    const paths = rotate(n => `/admin/api/collections/nope-${n}/entries`);
    expect(await admittedAcross(check, paths)).toBe(2);
    // The control: an overridden collection still has a budget of its own.
    expect(
      await admittedAcross(
        check,
        rotate(() => "/admin/api/collections/posts")
      )
    ).toBe(4);
  });

  it("lets no rotation reset the bound on failed key lookups", async () => {
    const readers = testReaders();
    const check = limiter({}, readers);
    const paths = [
      ...rotate(n => `/admin/api/me?x=/collections/q${n}`),
      ...rotate(n => `/admin/api/collections/s${n}`),
    ];
    expect(await admittedAcross(check, paths, { key: "bogus" })).toBe(2);
    expect(readers.lookupKey).toHaveBeenCalledTimes(2);
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
    // Both halves of the ceiling, since a sign-in is a write.
    await admitted(check, {}, 50);
    await admitted(check, { method: "POST" }, 50);
    expect(await check({ method: "POST" })).not.toBeNull();
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

describe("REST limit: a burst under a bound", () => {
  /** A lookup held open until `finish`, as a slow database would hold it. */
  function heldOpen<T>(answer: T) {
    let finish: () => void = () => {};
    const open = new Promise<void>(resolve => {
      finish = resolve;
    });
    const started = vi.fn(async () => {
      await open;
      return answer;
    });
    return { started, finish };
  }

  it("starts no more key lookups than the bound has room for, however many arrive together", async () => {
    const lookup = heldOpen(null);
    const readers = { ...testReaders(), lookupKey: lookup.started };
    const check = limiter({}, readers);
    const burst = Array.from({ length: 8 }, () =>
      check({ key: "bogus", address: "203.0.113.7" })
    );
    // Every request has had its turn to peek before any lookup answers.
    await vi.waitFor(() => expect(lookup.started).toHaveBeenCalledTimes(2));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(lookup.started).toHaveBeenCalledTimes(2);
    lookup.finish();
    const answers = await Promise.all(burst);
    expect(answers.filter(answer => answer === null)).toHaveLength(2);
  });

  it("starts no more person resolutions than the plugin's bound has room for", async () => {
    const limits = createRestLimits(
      {
        enabled: true,
        readLimit: 2,
        writeLimit: 1,
        trustProxy: true,
        store: new InMemoryRateLimitStore(),
      },
      testReaders()
    );
    const resolution = heldOpen(null);
    const burst = Array.from({ length: 8 }, () =>
      limits.admitPerson(request({ address: "203.0.113.7" }), "accounts", {
        resolve: resolution.started,
        personOf: () => null,
      })
    );
    await vi.waitFor(() => expect(resolution.started).toHaveBeenCalledTimes(2));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(resolution.started).toHaveBeenCalledTimes(2);
    resolution.finish();
    const answers = await Promise.all(burst);
    expect(answers.filter(answer => "refused" in answer)).toHaveLength(6);
  });
});

describe("REST limit: while the store core's limits count in is away", () => {
  it("lets requests through rather than refusing the API", async () => {
    // A refusal would take the whole site down with its limit store, so the
    // general API limit lets requests through until the store answers.
    const away: RateLimitStore = {
      increment: () => Promise.reject(limitStoreUnavailable("unreachable")),
      reset: () => Promise.reject(limitStoreUnavailable("unreachable")),
      consume: () => Promise.reject(limitStoreUnavailable("unreachable")),
    };
    const check = limiter({ store: away });
    expect(await admitted(check, { address: "203.0.113.7" }, 5)).toBe(5);
    expect(await admitted(check, {}, 5)).toBe(5);
  });
});

describe("REST limit: where it counts", () => {
  afterEach(() => {
    container.clear();
  });

  it("keeps an app's store without consume working, counting as it did", async () => {
    // A store of the older contract may implement only increment and reset;
    // the REST limit picks its counting path by whether consume exists.
    const hits = new Map<string, number>();
    const plain: RateLimitStore = {
      increment: async (key, windowMs) => {
        const count = (hits.get(key) ?? 0) + 1;
        hits.set(key, count);
        return { count, resetTime: Date.now() + windowMs };
      },
      reset: async key => {
        hits.delete(key);
      },
    };
    const check = limiter({
      store: restLimitCounts({ store: plain }, async () => undefined),
    });

    expect(await admitted(check, { address: "203.0.113.7" }, 5)).toBe(2);
    // A request presenting an API key, whose lookup is bounded by a peek
    // where the store offers one, is counted rather than failing.
    expect(
      await admitted(check, { key: "bogus", address: "203.0.113.8" }, 1)
    ).toBe(1);
  });

  it("lets requests through when starting the services fails", async () => {
    // The REST limit only needs the services to find its store; a route that
    // never starts them must not fail because they could not start, so the
    // limit counts in this process's memory instead.
    const check = limiter({
      store: restLimitCounts({ limitStore: "database" }, async () => {
        throw new Error("database unreachable");
      }),
    });

    expect(await admitted(check, { address: "203.0.113.9" }, 3)).toBe(2);
  });

  it("lets requests through when starting the services never finishes", async () => {
    // A start held up (a hung database connection, a migration gate) is
    // waited for no longer than a store call, and the request counts in this
    // process's memory instead of hanging the route.
    const check = limiter({
      store: restLimitCounts(
        { limitStore: "database" },
        () => new Promise(() => {})
      ),
    });
    const started = Date.now();

    expect(await admitted(check, { address: "203.0.113.10" }, 1)).toBe(1);
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 10_000);

  it("starts the services on a cold worker so it counts in the shared store", async () => {
    // A worker serving only requests that never start the services would
    // otherwise count in its own memory for good, a budget per worker.
    const counted: string[] = [];
    const shared = new InMemoryRateLimitStore();
    const recording: RateLimitStore = {
      increment: (key, windowMs) => {
        counted.push(key);
        return shared.increment(key, windowMs);
      },
      reset: key => shared.reset(key),
      consume: (key, limit, windowMs) => {
        counted.push(key);
        return shared.consume!(key, limit, windowMs);
      },
    };
    const startServices = vi.fn(async () => {
      container.registerSingleton("coreRateLimitStore", () => recording);
    });
    const check = limiter({
      store: restLimitCounts({ limitStore: "database" }, startServices),
    });

    expect(await admitted(check, { address: "203.0.113.7" }, 3)).toBe(2);
    expect(startServices).toHaveBeenCalled();
    expect(counted.length).toBeGreaterThan(0);
  });
});

describe("REST limit: a key that does not resolve", () => {
  it("remembers why, so authentication's log can say it without a second lookup", async () => {
    const readers = testReaders();
    readers.lookupKey.mockImplementation(
      async (_rawKey: string, onRefused?: (cause: "revoked") => void) => {
        onRefused?.("revoked");
        return null;
      }
    );
    const limits = createRestLimits(
      {
        enabled: true,
        readLimit: 2,
        writeLimit: 1,
        windowMs: 60_000,
        trustProxy: true,
        store: new InMemoryRateLimitStore(),
      },
      readers
    );
    const gate = openRestLimitGate(
      limits,
      request({ key: "revoked-k1", address: "203.0.113.7" })
    );
    await gate.settle("core");
    expect(gate.knownKey("revoked-k1")).toMatchObject({
      resolved: null,
      cause: "revoked",
    });
  });
});

describe("REST limit: a refused request is recorded", () => {
  afterEach(() => {
    container.clear();
  });

  it("writes the refusal's line, as every answered refusal does", async () => {
    const info = vi.fn();
    container.register("logger", () => ({
      debug: vi.fn(),
      info,
      warn: vi.fn(),
      error: vi.fn(),
    }));
    const check = limiter();
    // Two reads a window from one address, so the third is refused.
    expect(await admitted(check, { address: "203.0.113.7" }, 3)).toBe(2);
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("Refused"),
      expect.objectContaining({ status: 429, code: "RATE_LIMITED" })
    );
  });
});
