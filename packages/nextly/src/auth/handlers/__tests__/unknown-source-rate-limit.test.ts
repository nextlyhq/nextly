/**
 * The auth limiter for requests whose client address cannot be resolved,
 * driven through the router.
 *
 * Without a trusted proxy no address resolves, so these are every request on
 * a default deployment. Each counts against the account it names, under a
 * ceiling of a hundred times the budget that all of them share. A request the
 * limiter admits goes on to its handler, which refuses it for its missing
 * CSRF token (403) or its bad token; only the limiter answers 429, so 429
 * versus anything else is the limiter's verdict.
 */
import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NULL_AUDIT_LOG_WRITER } from "../../../domains/audit/audit-log-writer";
import { RateLimiter } from "../../middleware/rate-limiter";
import { SlidingWindowMemoryStore } from "../../middleware/sliding-window-store";
import {
  MemoryUnknownSourceCounter,
  StoreUnknownSourceCounter,
} from "../../middleware/unknown-source-counter";
import { mintPendingToken } from "../../pipeline/pending-token";
import type { AuthLimitAnswer, AuthStrategy } from "../../pipeline/types";
import { buildAuthRouterDeps } from "../deps-bridge";
import { routeAuthRequest, type AuthRouterDeps } from "../router";
import type { RateLimitStore } from "../../../middleware/rate-limit";

const W = 3_600_000;
const SECRET = "test-secret-that-is-at-least-32-characters-long!";

/** Accounts the stubs know, by id, for the pending-token routes. */
const ACCOUNTS: Record<string, string> = {
  "user-a": "a@example.com",
  "user-b": "b@example.com",
};

beforeEach(() => {
  // Only the clock: the handlers' own timers must still run.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 0, 1));
});

afterEach(() => {
  vi.useRealTimers();
});

interface Harness {
  deps: AuthRouterDeps;
  counter: MemoryUnknownSourceCounter;
  store: SlidingWindowMemoryStore;
  tokenLookups: Array<{ kind: string; token: string }>;
  accountLookups: string[];
}

function harness(
  options: {
    budget?: number;
    tokens?: Record<string, string>;
    trustProxy?: boolean;
  } = {}
): Harness {
  const counter = new MemoryUnknownSourceCounter();
  const store = new SlidingWindowMemoryStore();
  const tokenLookups: Harness["tokenLookups"] = [];
  const accountLookups: string[] = [];
  // Every dependency these requests never reach comes from the real bridge
  // over stand-in services (an adapter with no database: building the deps
  // asks for one, and nothing here queries it); the ones they do reach are
  // replaced below.
  const services: Record<string, unknown> = {
    adapter: { getDrizzle: () => ({}) },
  };
  const deps: AuthRouterDeps = {
    ...buildAuthRouterDeps(name => services[name] ?? {}),
    secret: SECRET,
    loginStallTimeMs: 0,
    allowedOrigins: [],
    trustProxy: options.trustProxy ?? false,
    trustedProxyIps: [],
    authRateLimit: {
      requestsPerHour: options.budget ?? 3,
      windowMs: W,
      store,
      unknownSourceCounter: counter,
    },
    auditLog: NULL_AUDIT_LOG_WRITER,
    findTokenOwner: async (kind, token) => {
      tokenLookups.push({ kind, token });
      return options.tokens?.[token] ?? null;
    },
    findUserByEmail: async email => {
      accountLookups.push(email);
      return null;
    },
    findUserById: async id => {
      accountLookups.push(id);
      const email = ACCOUNTS[id];
      return email
        ? {
            id,
            email,
            name: "n",
            image: null,
            isActive: true,
            mustChangePassword: true,
          }
        : null;
    },
    verifyEmail: async () => ({ success: false, error: "bad token" }),
    hasAdministrator: async () => true,
  };
  return { deps, counter, store, tokenLookups, accountLookups };
}

function post(
  h: Harness,
  path: string,
  body: Record<string, unknown> | string,
  headers: Record<string, string> = {}
): Promise<Response> {
  const request = new Request(`http://localhost:3000/admin/api/auth/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return routeAuthRequest(request, path, h.deps).then(res => {
    if (!res) throw new Error(`no route for ${path}`);
    return res;
  });
}

const login = (h: Harness, email: string) =>
  post(h, "login", { email, password: "pw" });

/** Whether the limiter admitted the request. */
const admitted = async (res: Promise<Response>) => (await res).status !== 429;

describe("identifier keying", () => {
  it("one source spending one address's budget leaves another address signing in", async () => {
    const h = harness({ budget: 3 });
    for (let i = 0; i < 3; i++) {
      expect(await admitted(login(h, "a@example.com"))).toBe(true);
    }
    expect(await admitted(login(h, "a@example.com"))).toBe(false);
    expect(await admitted(login(h, "b@example.com"))).toBe(true);
  });

  it("spellings the account lookup treats as one address share one budget", async () => {
    const h = harness({ budget: 3 });
    expect(await admitted(login(h, "Ann@Example.com"))).toBe(true);
    expect(await admitted(login(h, " ann@example.com "))).toBe(true);
    expect(await admitted(login(h, "ANN@EXAMPLE.COM\t"))).toBe(true);
    for (const spelling of ["ann@example.com", "  Ann@EXAMPLE.com"]) {
      expect(await admitted(login(h, spelling))).toBe(false);
    }
  });

  it("answers a spent address the same whether or not it has an account", async () => {
    const h = harness({ budget: 2 });
    h.deps.findUserByEmail = async email => {
      h.accountLookups.push(email);
      return email === "real@example.com"
        ? ({ id: "real", email } as Awaited<
            ReturnType<AuthRouterDeps["findUserByEmail"]>
          >)
        : null;
    };
    for (let i = 0; i < 2; i++) {
      await login(h, "real@example.com");
      await login(h, "ghost@example.com");
    }
    const real = await login(h, "real@example.com");
    const ghost = await login(h, "ghost@example.com");

    expect(real.status).toBe(429);
    expect(ghost.status).toBe(real.status);
    expect(await ghost.text()).toBe(await real.text());
    expect([...ghost.headers.entries()]).toEqual([...real.headers.entries()]);
    // The limiter keys on the address as given and never asks whether it
    // exists, so nothing it does can depend on the answer.
    expect(h.accountLookups).toEqual([]);
  });

  it("keeps a spent address refused through a flood of fresh ones", async () => {
    const h = harness({ budget: 2 }); // a ceiling of 200
    await login(h, "victim@example.com");
    await login(h, "victim@example.com");
    for (let i = 0; i < 300; i++) {
      await login(h, `fresh-${i}@example.com`);
      if (i % 50 === 0) {
        expect(await admitted(login(h, "victim@example.com"))).toBe(false);
      }
    }
    expect(await admitted(login(h, "victim@example.com"))).toBe(false);
    expect(h.counter.trackedKeys).toBeLessThanOrEqual(200);
  });
});

/** A store that remembers every key it is asked about. */
function recordingStore(): { store: RateLimitStore; keys: Set<string> } {
  const inner = new SlidingWindowMemoryStore();
  const keys = new Set<string>();
  return {
    keys,
    store: {
      increment: (key, windowMs) => {
        keys.add(key);
        return inner.increment(key, windowMs);
      },
      reset: key => inner.reset(key),
      consume: (key, limit, windowMs) => {
        keys.add(key);
        return inner.consume(key, limit, windowMs);
      },
    },
  };
}

describe("the keys a shared store sees", () => {
  async function keysFor(secret: string): Promise<string[]> {
    const h = harness();
    const recorded = recordingStore();
    h.deps.secret = secret;
    h.deps.authRateLimit = {
      ...h.deps.authRateLimit,
      unknownSourceCounter: new StoreUnknownSourceCounter(
        new RateLimiter(recorded.store)
      ),
    };
    await login(h, "Ann@Example.com");
    return [...recorded.keys].filter(key =>
      key.startsWith("auth-unknown:account:")
    );
  }

  it("never names an address, plainly or as a bare hash", async () => {
    const [key] = await keysFor(SECRET);
    expect(key).toBeDefined();
    const bareHash = createHash("sha256")
      .update("ann@example.com")
      .digest("hex");
    expect(key).not.toContain("ann@example.com");
    expect(key).not.toContain(bareHash);
  });

  it("keys an address differently under another install's secret", async () => {
    const [ours] = await keysFor(SECRET);
    const [theirs] = await keysFor(`${SECRET}-other-install`);
    expect(ours).not.toBe(theirs);
  });
});

describe("token routes", () => {
  const tokens = {
    "reset-a": "A@Example.com",
    "reset-b": "b@example.com",
  };

  it("counts a valid token against its own account, and a token of nobody's against the account-less budget", async () => {
    const h = harness({ budget: 2, tokens });
    await login(h, "a@example.com");
    await login(h, "a@example.com");

    // The token's owner is spelled differently from the sign-ins; one account.
    expect(
      await admitted(post(h, "reset-password", { token: "reset-a" }))
    ).toBe(false);
    expect(
      await admitted(post(h, "reset-password", { token: "reset-b" }))
    ).toBe(true);

    for (let i = 0; i < 5; i++) {
      await post(h, "reset-password", { token: `bogus-${i}` });
    }
    // The bogus tokens spent the account-less budget, which a malformed body
    // shares, and nobody's account budget: b still completes.
    expect(await admitted(post(h, "login", "not json"))).toBe(false);
    expect(
      await admitted(post(h, "reset-password", { token: "reset-b" }))
    ).toBe(true);
  });

  it("asks each stored-token route about its own kind of token", async () => {
    const h = harness();
    await post(h, "reset-password", { token: "t1" });
    await post(h, "verify-email", { token: "t2" });
    await post(h, "accept-invite", { token: "t3" });
    expect(h.tokenLookups).toEqual([
      { kind: "reset", token: "t1" },
      { kind: "verification", token: "t2" },
      { kind: "invite", token: "t3" },
    ]);
  });

  it("counts a pending sign-in against the account its token names", async () => {
    const h = harness({ budget: 2 });
    const pendingFor = (userId: string) =>
      mintPendingToken(
        { userId, challengeId: "must-change-password", attempts: 0 },
        SECRET,
        300
      );
    await login(h, "a@example.com");
    await login(h, "a@example.com");

    const forA = await pendingFor("user-a");
    const forB = await pendingFor("user-b");
    expect(
      await admitted(post(h, "set-initial-password", { pendingToken: forA }))
    ).toBe(false);
    expect(
      await admitted(
        post(h, "challenge/resolve", {}, { cookie: `nextly_pending=${forA}` })
      )
    ).toBe(false);
    expect(
      await admitted(post(h, "set-initial-password", { pendingToken: forB }))
    ).toBe(true);
  });

  it("looks up no more tokens than the ceiling admits, and a valid completion below it still completes", async () => {
    const h = harness({ budget: 1, tokens: { valid: "v@example.com" } }); // ceiling 100
    for (let i = 0; i < 150; i++) {
      if (i === 50) {
        expect(
          await admitted(post(h, "reset-password", { token: "valid" }))
        ).toBe(true);
        continue;
      }
      const res = await post(h, "reset-password", { token: `random-${i}` });
      if (i > 100) {
        expect(res.status).toBe(429);
        expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
      }
    }
    // One lookup per arrival the ceiling let through, and none past it.
    expect(h.tokenLookups).toHaveLength(100);
  });
});

describe("reading the body", () => {
  /** A login whose body records whether anything read it. */
  function watchedLogin(h: Harness, email: string) {
    const watch = { pulled: false };
    const bytes = new TextEncoder().encode(
      JSON.stringify({ email, password: "pw" })
    );
    // A queue of zero, so the stream is pulled only when something reads it.
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          watch.pulled = true;
          controller.enqueue(bytes);
          controller.close();
        },
      },
      { highWaterMark: 0 }
    );
    const request = new Request("http://localhost:3000/admin/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body,
      duplex: "half",
    } as RequestInit);
    return { watch, response: routeAuthRequest(request, "login", h.deps) };
  }

  it("refuses at a met ceiling without reading the body", async () => {
    const h = harness({ budget: 1 }); // ceiling 100
    for (let i = 0; i < 100; i++) await login(h, `flood-${i}@example.com`);

    const { watch, response } = watchedLogin(h, "late@example.com");
    expect((await response)?.status).toBe(429);
    expect(watch.pulled).toBe(false);
  });

  it("reads the body below the ceiling (the control)", async () => {
    const h = harness({ budget: 1 });
    const { watch, response } = watchedLogin(h, "a@example.com");
    expect((await response)?.status).not.toBe(429);
    expect(watch.pulled).toBe(true);
  });

  it("acts on nothing past its bound: an oversized body counts as naming no account", async () => {
    const h = harness({ budget: 1 });
    await login(h, "a@example.com");
    expect(await admitted(login(h, "a@example.com"))).toBe(false);

    const oversized = {
      email: "a@example.com",
      password: "pw",
      padding: "x".repeat(40 * 1024),
    };
    // Not refused by a's spent budget: the limiter never read the address.
    expect(await admitted(post(h, "login", oversized))).toBe(true);
    // It spent the account-less budget instead.
    expect(await admitted(post(h, "login", oversized))).toBe(false);
  });
});

describe("the account-less budget", () => {
  it("bounds bodies that name nothing together, apart from keyed sign-ins", async () => {
    const h = harness({ budget: 2 });
    expect(await admitted(post(h, "login", "not json"))).toBe(true);
    expect(await admitted(post(h, "login", { password: "pw" }))).toBe(true);
    expect(await admitted(post(h, "forgot-password", {}))).toBe(false);
    expect(await admitted(post(h, "reset-password", {}))).toBe(false);
    expect(await admitted(login(h, "a@example.com"))).toBe(true);
  });
});

describe("the numbers", () => {
  it.each([30, 5])(
    "gives each address the configured budget (%i an hour)",
    async budget => {
      const h = harness({ budget });
      for (let i = 0; i < budget; i++) {
        expect(await admitted(login(h, "a@example.com"))).toBe(true);
      }
      expect(await admitted(login(h, "a@example.com"))).toBe(false);
    }
  );

  it("refuses every kind of unknown-source request once mixed admissions meet the ceiling", async () => {
    const tokens: Record<string, string> = {};
    for (let i = 0; i < 20; i++) tokens[`t-${i}`] = `holder-${i}@example.com`;
    const h = harness({ budget: 1, tokens }); // ceiling 100
    for (let i = 0; i < 79; i++) {
      expect(await admitted(login(h, `invented-${i}@example.com`))).toBe(true);
    }
    for (let i = 0; i < 20; i++) {
      expect(
        await admitted(post(h, "reset-password", { token: `t-${i}` }))
      ).toBe(true);
    }
    expect(await admitted(post(h, "login", "not json"))).toBe(true);

    const refusals = await Promise.all([
      login(h, "another-invented@example.com"),
      login(h, "holder-0@example.com"),
      post(h, "login", { password: "pw" }),
      post(h, "reset-password", { token: "t-0" }),
      post(h, "verify-email", { token: "never-issued" }),
    ]);
    for (const res of refusals) {
      expect(res.status).toBe(429);
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    }
  });
});

describe("a resolved client address", () => {
  const from = { "x-forwarded-for": "203.0.113.7" };

  it("keeps its own bucket and budget, whatever addresses it names", async () => {
    const h = harness({ budget: 2, trustProxy: true });
    expect(
      await admitted(post(h, "login", { email: "a@example.com" }, from))
    ).toBe(true);
    expect(
      await admitted(post(h, "login", { email: "b@example.com" }, from))
    ).toBe(true);
    expect(
      await admitted(post(h, "login", { email: "c@example.com" }, from))
    ).toBe(false);
    expect(await new RateLimiter(h.store).peek("auth-ip:203.0.113.7", W)).toBe(
      2
    );
    expect(h.counter.trackedKeys).toBe(0);
  });

  it("is admitted within its budget after the unknown-source ceiling is met", async () => {
    const h = harness({ budget: 1, trustProxy: true }); // ceiling 100
    // No forwarded address: these do not resolve, even with a trusted proxy.
    for (let i = 0; i < 100; i++) await login(h, `flood-${i}@example.com`);
    expect(await admitted(login(h, "late@example.com"))).toBe(false);

    expect(
      await admitted(post(h, "login", { email: "a@example.com" }, from))
    ).toBe(true);
  });
});

describe("a budget of zero", () => {
  it("limits no auth request at all", async () => {
    const h = harness({ budget: 0 });
    for (let i = 0; i < 50; i++) {
      expect(await admitted(login(h, "a@example.com"))).toBe(true);
      expect(await admitted(post(h, "login", "not json"))).toBe(true);
      expect(
        await admitted(post(h, "reset-password", { token: `t-${i}` }))
      ).toBe(true);
    }
    expect(h.counter.trackedKeys).toBe(0);
    expect(h.tokenLookups).toEqual([]);
  });
});

describe("strategies that name the account a sign-in targets", () => {
  /** Every key a strategy was asked about, in order. */
  type Asked = string[];

  /**
   * A username strategy: it claims a request that carries a `username`, and
   * looks the name up trimmed and lowercased, so it names it the same way.
   */
  function usernameStrategy(asked: Asked = []): AuthStrategy {
    return {
      name: "username",
      authenticate: async input =>
        typeof input.body.username === "string"
          ? { type: "fail" }
          : { type: "pass" },
      limitKey: ({ body }): AuthLimitAnswer => {
        asked.push(String(body.username));
        return typeof body.username === "string"
          ? { handles: true, key: body.username.trim().toLowerCase() }
          : { handles: false };
      },
    };
  }

  /** A strategy keyed on a credential that names nobody before lookup. */
  function codeStrategy(): AuthStrategy {
    return {
      name: "oauth",
      authenticate: async input =>
        typeof input.body.code === "string"
          ? { type: "fail" }
          : { type: "pass" },
      limitKey: ({ body }) =>
        typeof body.code === "string"
          ? { handles: true, key: body.code }
          : { handles: false },
    };
  }

  /** A strategy written before the limiter could ask it anything. */
  function silentStrategy(claims: boolean): AuthStrategy {
    return {
      name: "legacy",
      authenticate: async () => (claims ? { type: "fail" } : { type: "pass" }),
    };
  }

  /** The harness with `strategies` ahead of the built-in password one. */
  function withStrategies(
    strategies: AuthStrategy[],
    options: Parameters<typeof harness>[0] = {}
  ): Harness {
    const h = harness(options);
    h.deps.authStrategies = [...strategies, ...h.deps.authStrategies];
    return h;
  }

  const signIn = (h: Harness, body: Record<string, unknown>) =>
    post(h, "login", { password: "pw", ...body });

  it("asks no strategy anything once the ceiling is met", async () => {
    const asked: Asked = [];
    const h = withStrategies([usernameStrategy(asked)], { budget: 1 }); // ceiling 100
    for (let i = 0; i < 100; i++) await signIn(h, { username: `u${i}` });
    asked.length = 0;

    expect(await admitted(signIn(h, { username: "late" }))).toBe(false);
    expect(asked).toEqual([]);
  });

  it("asks about a spent key no more times than the ceiling admits", async () => {
    const asked: Asked = [];
    const h = withStrategies([usernameStrategy(asked)], { budget: 1 }); // ceiling 100
    for (let i = 0; i < 150; i++) await signIn(h, { username: "ann" });
    expect(asked).toHaveLength(100);
  });

  it("buys no fresh budget by rotating the email, whatever spelling of the name", async () => {
    const h = withStrategies([usernameStrategy()], { budget: 3 });
    for (const [i, spelling] of ["ann", "Ann", " ANN "].entries()) {
      expect(
        await admitted(
          signIn(h, { username: spelling, email: `fresh-${i}@example.com` })
        )
      ).toBe(true);
    }
    expect(
      await admitted(
        signIn(h, { username: "ann\t", email: "fresh-3@example.com" })
      )
    ).toBe(false);
    expect(await admitted(signIn(h, { username: "bob" }))).toBe(true);
  });

  it("limits an unknown name apart from a known one, and answers both alike when spent", async () => {
    const h = withStrategies([usernameStrategy()], { budget: 2 });
    // Each name has a budget of its own: neither spends the other's.
    for (let i = 0; i < 2; i++) {
      expect(await admitted(signIn(h, { username: "real" }))).toBe(true);
      expect(await admitted(signIn(h, { username: "ghost" }))).toBe(true);
    }
    const real = await signIn(h, { username: "real" });
    const ghost = await signIn(h, { username: "ghost" });

    expect(real.status).toBe(429);
    expect(ghost.status).toBe(real.status);
    expect(await ghost.text()).toBe(await real.text());
    expect([...ghost.headers.entries()]).toEqual([...real.headers.entries()]);
    expect(h.accountLookups).toEqual([]);
  });

  it("keys a code strategy on its code, and leaves requests it does not handle to the password budget", async () => {
    const h = withStrategies([codeStrategy()], { budget: 2 });
    await signIn(h, { code: "code-1" });
    await signIn(h, { code: "code-1" });
    expect(await admitted(signIn(h, { code: "code-1" }))).toBe(false);
    expect(await admitted(signIn(h, { code: "code-2" }))).toBe(true);

    expect(await admitted(login(h, "a@example.com"))).toBe(true);
    expect(await admitted(login(h, "a@example.com"))).toBe(true);
    expect(await admitted(login(h, "a@example.com"))).toBe(false);
    expect(await admitted(signIn(h, { code: "code-2" }))).toBe(true);
  });

  it("lets the first strategy that handles a request decide its budget", async () => {
    const first: AuthStrategy = {
      name: "first",
      authenticate: async () => ({ type: "fail" }),
      limitKey: ({ body }) =>
        typeof body.a === "string"
          ? { handles: true, key: body.a }
          : { handles: false },
    };
    const second: AuthStrategy = {
      name: "second",
      authenticate: async () => ({ type: "fail" }),
      limitKey: ({ body }) => ({ handles: true, key: String(body.b) }),
    };
    const h = withStrategies([first, second], { budget: 2 });
    // The second strategy would name a fresh key each time; the first decides.
    await signIn(h, { a: "same", b: "b-0" });
    await signIn(h, { a: "same", b: "b-1" });
    expect(await admitted(signIn(h, { a: "same", b: "b-2" }))).toBe(false);

    // And the second strategy's key was never spent by those requests.
    for (let i = 0; i < 2; i++) {
      expect(await admitted(signIn(h, { b: "shared" }))).toBe(true);
    }
  });

  it("keeps a name a strategy reads apart from the same string as an email", async () => {
    const h = withStrategies([usernameStrategy()], { budget: 2 });
    await signIn(h, { username: "a@example.com" });
    await signIn(h, { username: "a@example.com" });
    expect(await admitted(signIn(h, { username: "a@example.com" }))).toBe(
      false
    );
    expect(await admitted(login(h, "a@example.com"))).toBe(true);
  });

  it("counts a password sign-in and a reset request for one address against one budget", async () => {
    const h = withStrategies([usernameStrategy()], { budget: 2 });
    await login(h, "a@example.com");
    await post(h, "forgot-password", { email: "A@Example.com" });
    expect(await admitted(login(h, "a@example.com"))).toBe(false);
  });

  it.each([
    [
      "throws",
      () => {
        throw new Error("strategy fault");
      },
    ],
    ["rejects", () => Promise.reject(new Error("strategy fault"))],
  ])(
    "counts a request account-less when the strategy's answer %s",
    async (_, limitKey) => {
      const faulty: AuthStrategy = {
        name: "faulty",
        authenticate: async () => ({ type: "fail" }),
        limitKey: limitKey as AuthStrategy["limitKey"],
      };
      const h = withStrategies([faulty], { budget: 2 });
      // Each names a fresh address, which buys nothing past the shared budget.
      expect(await admitted(login(h, "x0@example.com"))).toBe(true);
      expect(await admitted(login(h, "x1@example.com"))).toBe(true);
      expect(await admitted(login(h, "x2@example.com"))).toBe(false);
      expect(await admitted(post(h, "login", "not json"))).toBe(false);
    }
  );

  it("keeps its state within the bound, at one key size, through a flood of maximum-length keys", async () => {
    const h = withStrategies([usernameStrategy()], { budget: 1 }); // ceiling 100
    const recorded = recordingStore();
    const counter = new StoreUnknownSourceCounter(
      new RateLimiter(recorded.store)
    );
    h.deps.authRateLimit = {
      ...h.deps.authRateLimit,
      unknownSourceCounter: counter,
    };
    // Each name fills nearly the whole of the body the limiter reads.
    const long = (i: number) => `${i}-`.padEnd(30_000, "x");
    for (let i = 0; i < 300; i++) await signIn(h, { username: long(i) });

    const strategyKeys = [...recorded.keys].filter(key =>
      key.startsWith("auth-unknown:strategy:")
    );
    expect(strategyKeys).toHaveLength(100);
    expect(new Set(strategyKeys.map(key => key.length)).size).toBe(1);
    expect(strategyKeys[0].length).toBeLessThan(200);
  });

  it.each([true, false])(
    "keys the chain on the email when a strategy that cannot answer comes first (it claims: %s)",
    async claims => {
      const asked: Asked = [];
      const h = withStrategies(
        [silentStrategy(claims), usernameStrategy(asked)],
        {
          budget: 2,
        }
      );
      // Rotating the email buys a fresh budget: the username is not the key.
      for (let i = 0; i < 4; i++) {
        expect(
          await admitted(
            signIn(h, { username: "ann", email: `e${i}@example.com` })
          )
        ).toBe(true);
      }
      // And one email is one budget, whatever username it carries.
      await signIn(h, { username: "u1", email: "same@example.com" });
      await signIn(h, { username: "u2", email: "same@example.com" });
      expect(
        await admitted(signIn(h, { username: "u3", email: "same@example.com" }))
      ).toBe(false);
      expect(asked).toEqual([]);
    }
  );
});

describe("setup with its token", () => {
  // Setup checks its CSRF token before the setup token, so these requests
  // carry both: what is under test is the limit, not the CSRF check.
  const csrf = { cookie: "nextly_csrf=csrf-token" };
  const VALID = "the-valid-setup-token";

  function withSetup(options: Parameters<typeof harness>[0]): Harness {
    const h = harness(options);
    let administrator = false;
    h.deps.hasAdministrator = async () => administrator;
    h.deps.setupToken = {
      required: true,
      verify: async presented => (presented === VALID ? "valid" : "invalid"),
      confirm: async presented => (presented === VALID ? "valid" : "invalid"),
      spend: async () => {},
      claim: async () => ({ release: async () => {} }),
    };
    h.deps.createSuperAdmin = async data => {
      administrator = true;
      return { id: "admin-1", email: data.email, name: data.name };
    };
    h.deps.fetchSessionRoles = async () => ({
      roleIds: [],
      validUntil: undefined,
    });
    h.deps.storeRefreshToken = async () => {};
    return h;
  }

  const setup = (
    h: Harness,
    setupToken: string,
    email: string,
    headers: Record<string, string> = {}
  ) =>
    post(
      h,
      "setup",
      {
        email,
        name: "Owner",
        password: "Str0ng-P@ssw0rd!",
        setupToken,
        csrfToken: "csrf-token",
      },
      { ...csrf, ...headers }
    );

  it("completes with the valid token from an unresolved source once wrong ones spent the ceiling", async () => {
    const h = withSetup({ budget: 1 }); // a ceiling of 100
    for (let i = 0; i < 100; i++)
      await setup(h, `wrong-${i}`, `guess-${i}@example.com`);
    expect((await setup(h, "wrong-again", "late@example.com")).status).toBe(
      429
    );
    expect((await setup(h, VALID, "owner@example.com")).status).toBe(201);
  });

  it("keeps setup closed in production for dependencies built without a token store", async () => {
    const h = withSetup({ budget: 100 });
    delete (h.deps as { setupToken?: unknown }).setupToken;
    h.deps.isProduction = true;
    const res = await setup(h, VALID, "owner@example.com");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "SETUP_TOKEN_REQUIRED"
    );
  });

  it("leaves a tokenless setup outside production out of the limit, as before", async () => {
    const h = withSetup({ budget: 1 }); // a ceiling of 100
    h.deps.setupToken = { ...h.deps.setupToken!, required: false };
    // The auth limit spent by sign-ins first.
    for (let i = 0; i < 100; i++)
      await post(h, "login", { email: `u${i}@example.com`, password: "pw" });
    expect((await setup(h, "", "owner@example.com")).status).toBe(201);
  });

  it("completes with the valid token from a resolved address whose own budget is spent", async () => {
    const from = { "x-forwarded-for": "203.0.113.7" };
    const h = withSetup({ budget: 2, trustProxy: true });
    await setup(h, "wrong-1", "a@example.com", from);
    await setup(h, "wrong-2", "b@example.com", from);
    expect((await setup(h, "wrong-3", "c@example.com", from)).status).toBe(429);
    expect((await setup(h, VALID, "owner@example.com", from)).status).toBe(201);
  });
});
