/**
 * The per-request check that an access token's account may still use it.
 *
 * The cache is what bounds how long a change on another instance can go
 * unseen, so its tests drive a fake clock across that bound rather than
 * trusting the constant: a cache that never expired, or one that read on every
 * call, would both pass a test that only looked at a single call.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { container } from "../../../di/container";
import type { NextlyError } from "../../../errors/nextly-error";
import {
  SESSION_CUTOFF_SECONDS,
  SESSION_STANDING_TTL_MS,
  createSessionStandingCache,
  readSessionStanding,
  resetSessionStandingForTests,
  sessionTokenIsCurrent,
  setSessionStandingBoot,
  standingAdmits,
  type SessionStanding,
} from "../session-standing";

const ACTIVE: SessionStanding = { isActive: true, sessionEpoch: 0 };

/** A reader over a table the test edits, counting what it is asked. */
function table(initial: Record<string, SessionStanding | null>) {
  const rows = { ...initial };
  const read = vi.fn(async (userId: string) => rows[userId] ?? null);
  return { rows, read };
}

function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("the documented bound", () => {
  it("leaves the cache's lifetime inside the ten seconds the docs state", () => {
    // The docs state the bound, and the spec caps it at ten seconds. The
    // cache's lifetime is what spends it, so it must fit with room for a
    // request already in flight when the change landed.
    expect(SESSION_CUTOFF_SECONDS).toBeLessThanOrEqual(10);
    expect(SESSION_STANDING_TTL_MS).toBeLessThan(SESSION_CUTOFF_SECONDS * 1000);
  });
});

describe("createSessionStandingCache", () => {
  it("answers from memory inside its lifetime", async () => {
    const { read } = table({ u1: ACTIVE });
    const c = clock();
    const cache = createSessionStandingCache({ read, now: c.now });

    await cache.standing("u1");
    c.advance(SESSION_STANDING_TTL_MS - 1);
    await cache.standing("u1");

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("sees a change made elsewhere once its lifetime has passed", async () => {
    // Another instance's write never reaches this cache. The lifetime is
    // therefore the bound, and this is the case the bound is about.
    const { rows, read } = table({ u1: ACTIVE });
    const c = clock();
    const cache = createSessionStandingCache({ read, now: c.now });

    expect(await cache.standing("u1")).toEqual(ACTIVE);
    rows.u1 = { isActive: false, sessionEpoch: 1 };
    c.advance(SESSION_STANDING_TTL_MS);

    expect(await cache.standing("u1")).toEqual({
      isActive: false,
      sessionEpoch: 1,
    });
  });

  it("shares one read among callers that arrive while it runs", async () => {
    let release: (value: SessionStanding) => void = () => {};
    const read = vi.fn(
      () =>
        new Promise<SessionStanding>(resolve => {
          release = resolve;
        })
    );
    const cache = createSessionStandingCache({ read });

    const both = Promise.all([cache.standing("u1"), cache.standing("u1")]);
    release(ACTIVE);

    expect(await both).toEqual([ACTIVE, ACTIVE]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps no answer from a read that failed", async () => {
    // A failure to read is not an answer. Cached, it would refuse every
    // request for the lifetime, or worse, hold an earlier answer past it.
    const read = vi
      .fn<(userId: string) => Promise<SessionStanding | null>>()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(ACTIVE);
    const cache = createSessionStandingCache({ read });

    await expect(cache.standing("u1")).rejects.toThrow("connection reset");
    expect(await cache.standing("u1")).toEqual(ACTIVE);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads again at once after forget", async () => {
    // How the instance that made a change stops serving its own stale answer
    // without waiting out the lifetime.
    const { rows, read } = table({ u1: ACTIVE });
    const cache = createSessionStandingCache({ read });

    await cache.standing("u1");
    rows.u1 = { isActive: true, sessionEpoch: 1 };
    cache.forget("u1");

    expect(await cache.standing("u1")).toEqual({
      isActive: true,
      sessionEpoch: 1,
    });
  });

  it("does not keep a read that began before forget", async () => {
    // The read may have queried before the change it is racing, so keeping
    // its answer would serve the old standing for a whole lifetime.
    let release: (value: SessionStanding) => void = () => {};
    const read = vi
      .fn<(userId: string) => Promise<SessionStanding | null>>()
      .mockImplementationOnce(
        () =>
          new Promise<SessionStanding>(resolve => {
            release = resolve;
          })
      )
      .mockResolvedValue({ isActive: false, sessionEpoch: 1 });
    const cache = createSessionStandingCache({ read });

    const early = cache.standing("u1");
    cache.forget("u1");
    release(ACTIVE);
    await early;

    expect(await cache.standing("u1")).toEqual({
      isActive: false,
      sessionEpoch: 1,
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps an account that no longer exists as refused, for the lifetime", async () => {
    // A deleted account's token is refused, and the refusal costs no more
    // reads than an answer for a live one does.
    const { read } = table({});
    const cache = createSessionStandingCache({ read });

    expect(await cache.standing("gone")).toBeNull();
    expect(await cache.standing("gone")).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("holds no more accounts than its limit", async () => {
    const { read } = table({
      a: ACTIVE,
      b: ACTIVE,
      c: ACTIVE,
    });
    const cache = createSessionStandingCache({ read, maxEntries: 2 });

    await cache.standing("a");
    await cache.standing("b");
    await cache.standing("c");
    // `a` was the oldest, so it went to make room and is read again.
    await cache.standing("a");

    expect(read.mock.calls.map(call => call[0])).toEqual(["a", "b", "c", "a"]);
  });
});

describe("standingAdmits", () => {
  it.each([
    ["an active account at the token's epoch", ACTIVE, {}, true],
    [
      "an active account whose epoch moved on",
      { isActive: true, sessionEpoch: 1 },
      {},
      false,
    ],
    [
      "a token at the account's current epoch",
      { isActive: true, sessionEpoch: 3 },
      { sev: 3 },
      true,
    ],
    [
      "a token from before the account's last change",
      { isActive: true, sessionEpoch: 3 },
      { sev: 2 },
      false,
    ],
    ["an inactive account", { isActive: false, sessionEpoch: 0 }, {}, false],
    ["an account that no longer exists", null, {}, false],
  ] as const)("judges %s", (_label, standing, claims, admitted) => {
    // A token signed before the epoch existed carries none, which is the
    // epoch every account starts at: it stays usable until the account's
    // first change, and not after it.
    expect(standingAdmits(standing, claims)).toBe(admitted);
  });

  it.each([["3"], [-1], [1.5], [null]])(
    "refuses a token whose epoch claim is %j",
    sev => {
      // Only core signs the claim, so a malformed one is not a token core
      // issued; reading it as epoch zero would admit it.
      expect(standingAdmits({ isActive: true, sessionEpoch: 0 }, { sev })).toBe(
        false
      );
    }
  );
});

/** An adapter whose users table holds one row, `standing`, for every id. */
function adapterHolding(standing: SessionStanding) {
  return {
    getCapabilities: () => ({ dialect: "sqlite" }),
    getDrizzle: () => ({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [standing],
          }),
        }),
      }),
    }),
  };
}

describe("sessionTokenIsCurrent across a change of database", () => {
  afterEach(() => {
    resetSessionStandingForTests();
    container.clear();
  });

  it("keeps no answer from the database it no longer reads", async () => {
    // Services registered again, after a configuration change or in a test
    // booting a fresh database, bring another adapter. An answer the old one
    // gave is about a row the new one may not hold, and served from the
    // cache it would decide this database's sessions for the whole lifetime.
    const claims = { sub: "u1", sev: 0 };
    container.registerSingleton("adapter", () => adapterHolding(ACTIVE));
    expect(await sessionTokenIsCurrent(claims)).toBe(true);

    container.clear();
    container.registerSingleton("adapter", () =>
      adapterHolding({ isActive: true, sessionEpoch: 1 })
    );

    expect(await sessionTokenIsCurrent(claims)).toBe(false);
  });
});

describe("readSessionStanding before services are registered", () => {
  afterEach(() => {
    setSessionStandingBoot(undefined);
    resetSessionStandingForTests();
    container.clear();
  });

  it("starts the services, then reads", async () => {
    // A process authenticates some requests before anything has booted. A
    // token whose signature already verified may start it: the request was
    // about to anyway, and without the database nothing can say whether
    // the account may still use the token.
    const adapter = adapterHolding({ isActive: true, sessionEpoch: 4 });
    const boot = vi.fn(async () => {
      container.registerSingleton("adapter", () => adapter);
    });
    setSessionStandingBoot(boot);

    expect(await readSessionStanding("u1")).toEqual({
      isActive: true,
      sessionEpoch: 4,
    });
    expect(boot).toHaveBeenCalledTimes(1);
  });

  it("refuses to answer when nothing can start them, naming the fix", async () => {
    // Failing closed: an unanswerable question is not a yes. An app's own
    // route that reads a session before initialising Nextly lands here, so
    // the operator is told the line that fixes it.
    const refusal = await readSessionStanding("u1").then(
      () => null,
      (error: unknown) => error
    );

    expect(refusal).toMatchObject({ code: "CONFIGURATION_ERROR" });
    expect((refusal as NextlyError).logMessage).toContain("getNextly");
  });
});
