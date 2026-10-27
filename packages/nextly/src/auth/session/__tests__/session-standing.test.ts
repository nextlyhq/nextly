/**
 * The per-request check that an access token's account may still use it.
 *
 * The cache is what bounds how long a change on another instance can go
 * unseen, so its tests drive a fake clock across that bound rather than
 * trusting the constant: a cache that never expired, or one that read on every
 * call, would both pass a test that only looked at a single call.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Whether services are registered, and the boot-migration gate, as this file
// sets them: the check may read the database only once both say it is ready.
const ready = vi.hoisted(() => ({
  registered: false,
  migrations: Promise.resolve() as Promise<void>,
}));
vi.mock("../../../di/service-access", () => ({
  isServicesRegistered: () => ready.registered,
}));
vi.mock("../../../init/boot-migrations-gate", () => ({
  awaitBootMigrations: () => ready.migrations,
}));

import { container } from "../../../di/container";
import type { NextlyError } from "../../../errors/nextly-error";
import {
  SESSION_CUTOFF_SECONDS,
  SESSION_STANDING_TTL_MS,
  accountIsActive,
  createSessionStandingCache,
  forgetSessionStanding,
  readSessionStanding,
  resetSessionStandingForTests,
  sessionTokenIsCurrent,
  setSessionStandingBoot,
  standingAdmits,
  watchTransaction,
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
    // Half, so a request that was past the check when the change landed
    // still finishes inside the bound.
    expect(SESSION_CUTOFF_SECONDS).toBeLessThanOrEqual(10);
    expect(SESSION_STANDING_TTL_MS).toBeLessThanOrEqual(
      (SESSION_CUTOFF_SECONDS * 1000) / 2
    );
  });
});

describe("createSessionStandingCache", () => {
  it("answers from memory inside its lifetime", async () => {
    const { read } = table({ u1: ACTIVE });
    const c = clock();
    const cache = createSessionStandingCache({ read, now: c.now });

    await cache.standing("u1", 0);
    c.advance(SESSION_STANDING_TTL_MS - 1);
    await cache.standing("u1", 0);

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("sees a change made elsewhere once its lifetime has passed", async () => {
    // Another instance's write never reaches this cache. The lifetime is
    // therefore the bound, and this is the case the bound is about.
    const { rows, read } = table({ u1: ACTIVE });
    const c = clock();
    const cache = createSessionStandingCache({ read, now: c.now });

    expect(await cache.standing("u1", 0)).toEqual(ACTIVE);
    rows.u1 = { isActive: false, sessionEpoch: 1 };
    c.advance(SESSION_STANDING_TTL_MS);

    expect(await cache.standing("u1", 0)).toEqual({
      isActive: false,
      sessionEpoch: 1,
    });
  });

  it("ages an answer from when its read began, not when it returned", async () => {
    // A read that queried before another instance's change and came back
    // late would otherwise start a fresh lifetime after the change, and hold
    // the old answer past the bound.
    const c = clock();
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
    const cache = createSessionStandingCache({ read, now: c.now });

    const slow = cache.standing("u1", 0);
    c.advance(SESSION_STANDING_TTL_MS);
    release(ACTIVE);
    await slow.catch(() => undefined);

    expect(await cache.standing("u1", 0)).toEqual({
      isActive: false,
      sessionEpoch: 1,
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("fails a read that outlived the lifetime, rather than admitting with it", async () => {
    // The request that was waiting on the slow read is the one the bound is
    // about: its answer may be from before a change that has since passed
    // the bound, so it is not an answer to admit on.
    const c = clock();
    let release: (value: SessionStanding) => void = () => {};
    const read = vi.fn(
      () =>
        new Promise<SessionStanding>(resolve => {
          release = resolve;
        })
    );
    const cache = createSessionStandingCache({ read, now: c.now });

    const slow = cache.standing("u1", 0);
    c.advance(SESSION_STANDING_TTL_MS);
    release(ACTIVE);

    await expect(slow).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("answers a read that came back within the lifetime", async () => {
    // The control: a read that is merely slow, not too old, still answers.
    const c = clock();
    let release: (value: SessionStanding) => void = () => {};
    const read = vi.fn(
      () =>
        new Promise<SessionStanding>(resolve => {
          release = resolve;
        })
    );
    const cache = createSessionStandingCache({ read, now: c.now });

    const slow = cache.standing("u1", 0);
    c.advance(SESSION_STANDING_TTL_MS - 1);
    release(ACTIVE);

    expect(await slow).toEqual(ACTIVE);
  });

  it("reads again when the clock has moved backward", async () => {
    // A negative age is not a fresh answer: a clock set back would
    // otherwise keep the held answer for as long as it took to catch up.
    const { read } = table({ u1: ACTIVE });
    const c = clock();
    const cache = createSessionStandingCache({ read, now: c.now });

    await cache.standing("u1", 0);
    c.advance(-60_000);
    await cache.standing("u1", 0);

    expect(read).toHaveBeenCalledTimes(2);
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

    const both = Promise.all([
      cache.standing("u1", 0),
      cache.standing("u1", 0),
    ]);
    release(ACTIVE);

    expect(await both).toEqual([ACTIVE, ACTIVE]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads again for a newer token that joined a read already running", async () => {
    // The running read may have queried before the change that signed this
    // token's epoch, on another instance. Taking its answer would refuse the
    // session just issued, and GET /auth/session would clear its cookie.
    let release: (value: SessionStanding) => void = () => {};
    const read = vi
      .fn<(userId: string) => Promise<SessionStanding | null>>()
      .mockImplementationOnce(
        () =>
          new Promise<SessionStanding>(resolve => {
            release = resolve;
          })
      )
      .mockResolvedValue({ isActive: true, sessionEpoch: 1 });
    const cache = createSessionStandingCache({ read });

    const older = cache.standing("u1", 0);
    const newer = cache.standing("u1", 1);
    release(ACTIVE);

    expect(await older).toEqual(ACTIVE);
    expect(await newer).toEqual({ isActive: true, sessionEpoch: 1 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads again for a token that joined a read answering inactive", async () => {
    // The account was deactivated when the running read queried and has been
    // reactivated since. Reactivation leaves the epoch where it was, so the
    // token signed after it carries the same epoch the inactive answer has.
    // Taking that answer would refuse a session the account may now use.
    let release: (value: SessionStanding) => void = () => {};
    const read = vi
      .fn<(userId: string) => Promise<SessionStanding | null>>()
      .mockImplementationOnce(
        () =>
          new Promise<SessionStanding>(resolve => {
            release = resolve;
          })
      )
      .mockResolvedValue(ACTIVE);
    const cache = createSessionStandingCache({ read });

    const older = cache.standing("u1", 0);
    const newer = cache.standing("u1", 0);
    release({ isActive: false, sessionEpoch: 0 });

    expect(await older).toEqual({ isActive: false, sessionEpoch: 0 });
    expect(await newer).toEqual(ACTIVE);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not hand a caller inside a transaction a read queued behind it", async () => {
    // On SQLite a read started outside a transaction queues behind the one
    // that is open. A plugin reading a session inside that transaction and
    // joining the queued read would wait for it, while it waits for the
    // transaction to finish: neither would ever settle.
    let inTransaction = false;
    const read = vi
      .fn<(userId: string) => Promise<SessionStanding | null>>()
      .mockImplementationOnce(() => new Promise<SessionStanding>(() => {}))
      .mockResolvedValue(ACTIVE);
    const cache = createSessionStandingCache({
      read,
      shared: () => !inTransaction,
    });

    void cache.standing("u1", 0);
    inTransaction = true;
    let inside: SessionStanding | null | "pending" = "pending";
    void cache.standing("u1", 0).then(standing => {
      inside = standing;
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(inside).toEqual(ACTIVE);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("shares and keeps nothing a caller inside a transaction read", async () => {
    // Read inside a transaction, the row may hold that transaction's
    // uncommitted change. Another request must neither join that read nor be
    // answered from it once it is done.
    let inTransaction = true;
    const read = vi
      .fn<(userId: string) => Promise<SessionStanding | null>>()
      .mockResolvedValueOnce({ isActive: true, sessionEpoch: 5 })
      .mockResolvedValue(ACTIVE);
    const cache = createSessionStandingCache({
      read,
      shared: () => !inTransaction,
    });

    expect(await cache.standing("u1", 0)).toEqual({
      isActive: true,
      sessionEpoch: 5,
    });
    inTransaction = false;

    expect(await cache.standing("u1", 0)).toEqual(ACTIVE);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps no answer from a read that failed", async () => {
    // A failure to read is not an answer. Cached, it would refuse every
    // request for the lifetime, or worse, hold an earlier answer past it.
    const read = vi
      .fn<(userId: string) => Promise<SessionStanding | null>>()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(ACTIVE);
    const cache = createSessionStandingCache({ read });

    await expect(cache.standing("u1", 0)).rejects.toThrow("connection reset");
    expect(await cache.standing("u1", 0)).toEqual(ACTIVE);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads again at once after forget", async () => {
    // How the instance that made a change stops serving its own stale answer
    // without waiting out the lifetime.
    const { rows, read } = table({ u1: ACTIVE });
    const cache = createSessionStandingCache({ read });

    await cache.standing("u1", 0);
    rows.u1 = { isActive: true, sessionEpoch: 1 };
    cache.forget("u1");

    expect(await cache.standing("u1", 0)).toEqual({
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

    const early = cache.standing("u1", 0);
    cache.forget("u1");
    release(ACTIVE);
    await early;

    expect(await cache.standing("u1", 0)).toEqual({
      isActive: false,
      sessionEpoch: 1,
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not keep a read that ran after forget but before the change committed", async () => {
    // The writer forgets inside its transaction. On PostgreSQL and MySQL a
    // read on another connection before the commit still sees the old row;
    // kept, it would serve that row for a whole lifetime after the commit.
    const { rows, read } = table({ u1: ACTIVE });
    const c = clock();
    const cache = createSessionStandingCache({ read, now: c.now });

    await cache.standing("u1", 0);
    cache.forget("u1");
    // Not committed yet: the row still reads as it was.
    expect(await cache.standing("u1", 0)).toEqual(ACTIVE);
    rows.u1 = { isActive: false, sessionEpoch: 1 };
    c.advance(1);

    expect(await cache.standing("u1", 0)).toEqual({
      isActive: false,
      sessionEpoch: 1,
    });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("keeps answers again once a lifetime has passed since forget", async () => {
    // The window after a forget costs a read per request for one lifetime,
    // and no longer: past it, a held answer saves the read again.
    const { read } = table({ u1: ACTIVE });
    const c = clock();
    const cache = createSessionStandingCache({ read, now: c.now });

    cache.forget("u1");
    c.advance(SESSION_STANDING_TTL_MS);
    await cache.standing("u1", 0);
    await cache.standing("u1", 0);

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps nothing read while the change that forgot it has not committed, however long it takes", async () => {
    // A writer that holds its transaction open past the lifetime, waiting on
    // a lock say, must not let a read of the old row be kept: that answer
    // would outlive the commit by a whole lifetime.
    const { rows, read } = table({ u1: ACTIVE });
    const c = clock();
    const cache = createSessionStandingCache({ read, now: c.now });
    let writing = true;

    await cache.standing("u1", 0);
    cache.forget("u1", () => writing);
    c.advance(SESSION_STANDING_TTL_MS + 1_000);
    // Not committed yet: the row still reads as it was.
    expect(await cache.standing("u1", 0)).toEqual(ACTIVE);
    rows.u1 = { isActive: false, sessionEpoch: 1 };
    writing = false;

    expect(await cache.standing("u1", 0)).toEqual({
      isActive: false,
      sessionEpoch: 1,
    });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("keeps a mark whose change is still uncommitted when the marks are full", async () => {
    // A writer held open while more accounts are forgotten than the cache
    // keeps marks for: the open writer's mark is the one that must stay.
    const { rows, read } = table({ u1: ACTIVE });
    const c = clock();
    const cache = createSessionStandingCache({
      read,
      now: c.now,
      maxEntries: 2,
    });
    let writing = true;

    cache.forget("u1", () => writing);
    cache.forget("u2");
    cache.forget("u3");
    c.advance(SESSION_STANDING_TTL_MS + 1_000);
    expect(await cache.standing("u1", 0)).toEqual(ACTIVE);
    rows.u1 = { isActive: false, sessionEpoch: 1 };
    writing = false;

    expect(await cache.standing("u1", 0)).toEqual({
      isActive: false,
      sessionEpoch: 1,
    });
  });

  it("keeps answers again once the forgetting change has committed and a lifetime has passed", async () => {
    const { read } = table({ u1: ACTIVE });
    const c = clock();
    const cache = createSessionStandingCache({ read, now: c.now });
    let writing = true;

    cache.forget("u1", () => writing);
    writing = false;
    c.advance(SESSION_STANDING_TTL_MS);
    await cache.standing("u1", 0);
    await cache.standing("u1", 0);

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads an account that no longer exists again on its next request", async () => {
    // Only an active account's answer is kept. A refusal kept for the
    // lifetime would refuse the account's next session too, had it come back.
    const { read } = table({});
    const cache = createSessionStandingCache({ read });

    expect(await cache.standing("gone", 0)).toBeNull();
    expect(await cache.standing("gone", 0)).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("sees a reactivation at once, rather than refusing the new session", async () => {
    // An old token checked while the account was off would otherwise leave
    // `inactive` held, and the sign-in straight after the account is switched
    // back on would be refused for the lifetime: GET /auth/session would
    // then clear the cookie it had just been given.
    const { rows, read } = table({ u1: { isActive: false, sessionEpoch: 1 } });
    const cache = createSessionStandingCache({ read });

    expect(await cache.standing("u1", 0)).toEqual({
      isActive: false,
      sessionEpoch: 1,
    });
    rows.u1 = { isActive: true, sessionEpoch: 1 };

    expect(await cache.standing("u1", 1)).toEqual({
      isActive: true,
      sessionEpoch: 1,
    });
  });

  it("reads again for a token newer than the answer it holds", async () => {
    // A token carries only an epoch the row once held, so one newer than the
    // held answer proves the answer stale: a password set on another
    // instance, and a sign-in with the new password straight after.
    const { rows, read } = table({ u1: ACTIVE });
    const cache = createSessionStandingCache({ read });

    await cache.standing("u1", 0);
    rows.u1 = { isActive: true, sessionEpoch: 1 };

    expect(await cache.standing("u1", 1)).toEqual({
      isActive: true,
      sessionEpoch: 1,
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("answers a token older than the answer it holds from memory", async () => {
    // The control for the case above: a token from before the account's
    // last change is refused without a read, so tokens the change ended
    // cost nothing.
    const { read } = table({ u1: { isActive: true, sessionEpoch: 2 } });
    const cache = createSessionStandingCache({ read });

    await cache.standing("u1", 2);
    expect(await cache.standing("u1", 1)).toEqual({
      isActive: true,
      sessionEpoch: 2,
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("holds no more accounts than its limit", async () => {
    const { read } = table({
      a: ACTIVE,
      b: ACTIVE,
      c: ACTIVE,
    });
    const cache = createSessionStandingCache({ read, maxEntries: 2 });

    await cache.standing("a", 0);
    await cache.standing("b", 0);
    await cache.standing("c", 0);
    // `a` was the oldest, so it went to make room and is read again; `c` is
    // still answered from memory, so only the oldest went, not the lot.
    await cache.standing("a", 0);
    await cache.standing("c", 0);

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
      { nx_sev: 3 },
      true,
    ],
    [
      "a token from before the account's last change",
      { isActive: true, sessionEpoch: 3 },
      { nx_sev: 2 },
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

  it("reads a token carrying an app's own `sev` claim as one from before the epoch", () => {
    // Tokens signed before the upgrade may carry a custom claim of that name;
    // it says nothing about the epoch, so such a token reads as epoch zero.
    expect(
      standingAdmits({ isActive: true, sessionEpoch: 0 }, { sev: "gold" })
    ).toBe(true);
  });

  it("judges an inactive account on its epoch alone when asked to", () => {
    // How the account-state route reports `disabled` for a token whose
    // sessions were never ended, while still refusing one they were.
    const inactive = { isActive: false, sessionEpoch: 2 };
    expect(standingAdmits(inactive, { nx_sev: 2 }, { activeOnly: false })).toBe(
      true
    );
    expect(standingAdmits(inactive, { nx_sev: 1 }, { activeOnly: false })).toBe(
      false
    );
    expect(standingAdmits(null, { nx_sev: 0 }, { activeOnly: false })).toBe(
      false
    );
  });

  it.each([["3"], [-1], [1.5], [null]])(
    "refuses a token whose epoch claim is %j",
    sev => {
      // Only core signs the claim, so a malformed one is not a token core
      // issued; reading it as epoch zero would admit it.
      expect(
        standingAdmits({ isActive: true, sessionEpoch: 0 }, { nx_sev: sev })
      ).toBe(false);
    }
  );
});

/**
 * An adapter whose users table holds one row, `standing`, for every id.
 *
 * PostgreSQL, where the read runs directly; on SQLite it is queued behind any
 * open transaction, which the integration suite covers on a real database.
 */
function adapterHolding(standing: SessionStanding) {
  return {
    getCapabilities: () => ({ dialect: "postgresql" }),
    inTransaction: () => false,
    transactionOpenInFlow: () => false,
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
    ready.registered = false;
  });

  it("keeps no answer from the database it no longer reads", async () => {
    // Services registered again, after a configuration change or in a test
    // booting a fresh database, bring another adapter. An answer the old one
    // gave is about a row the new one may not hold, and served from the
    // cache it would decide this database's sessions for the whole lifetime.
    const claims = { sub: "u1", nx_sev: 0 };
    ready.registered = true;
    container.registerSingleton("adapter", () => adapterHolding(ACTIVE));
    expect(await sessionTokenIsCurrent(claims)).toBe(true);

    container.clear();
    container.registerSingleton("adapter", () =>
      adapterHolding({ isActive: true, sessionEpoch: 1 })
    );

    expect(await sessionTokenIsCurrent(claims)).toBe(false);
  });
});

describe("forgetSessionStanding across a change of database", () => {
  afterEach(() => {
    resetSessionStandingForTests();
    container.clear();
    ready.registered = false;
  });

  it("marks the cache the registered adapter reads through, not one it replaced", async () => {
    // The cache still belongs to the old adapter until something reads
    // through the new one. A forget made then has to land where the next
    // read looks, or that read keeps the uncommitted change's old row.
    ready.registered = true;
    container.registerSingleton("adapter", () => adapterHolding(ACTIVE));
    expect(await accountIsActive("u1")).toBe(true);

    let row: SessionStanding = ACTIVE;
    let writing = true;
    container.clear();
    container.registerSingleton("adapter", () => ({
      ...adapterHolding(ACTIVE),
      transactionOpenInFlow: () => writing,
      getDrizzle: () => ({
        select: () => ({
          from: () => ({
            where: () => ({ limit: async () => [row] }),
          }),
        }),
      }),
    }));

    forgetSessionStanding("u1");
    // Read before the change commits: the row is still as it was.
    expect(await accountIsActive("u1")).toBe(true);
    row = { isActive: false, sessionEpoch: 1 };
    writing = false;

    expect(await accountIsActive("u1")).toBe(false);
  });
});

describe("forgetSessionStanding while the writer's adapter is being replaced", () => {
  afterEach(() => {
    resetSessionStandingForTests();
    container.clear();
    ready.registered = false;
  });

  it("asks the adapter that holds the write whether it has committed", async () => {
    // Services registered again while a write on the old adapter is still
    // open: the mark goes to the new adapter's cache, but only the old one
    // can say whether the write has committed.
    const c = clock();
    resetSessionStandingForTests({ now: c.now });
    let writing = true;
    ready.registered = true;
    container.registerSingleton("adapter", () => ({
      ...adapterHolding(ACTIVE),
      transactionOpenInFlow: () => writing,
    }));
    expect(await accountIsActive("u1")).toBe(true);

    let row: SessionStanding = ACTIVE;
    container.clear();
    container.registerSingleton("adapter", () => ({
      ...adapterHolding(ACTIVE),
      transactionOpenInFlow: () => false,
      getDrizzle: () => ({
        select: () => ({
          from: () => ({
            where: () => ({ limit: async () => [row] }),
          }),
        }),
      }),
    }));

    forgetSessionStanding("u1");
    c.advance(SESSION_STANDING_TTL_MS + 1_000);
    // Still uncommitted, past the lifetime: the row reads as it was.
    expect(await accountIsActive("u1")).toBe(true);
    row = { isActive: false, sessionEpoch: 1 };
    writing = false;

    expect(await accountIsActive("u1")).toBe(false);
  });
});

describe("forgetSessionStanding after a read has already moved the cache", () => {
  afterEach(() => {
    resetSessionStandingForTests();
    container.clear();
    ready.registered = false;
  });

  it("asks an adapter the cache served before, not only the one it serves now", async () => {
    // The write began on the old adapter; services were registered again and
    // a read through the new one moved the cache before the write forgot the
    // account. The old adapter is still the only one that knows the write is
    // open.
    const c = clock();
    resetSessionStandingForTests({ now: c.now });
    let writing = true;
    ready.registered = true;
    container.registerSingleton("adapter", () => ({
      ...adapterHolding(ACTIVE),
      transactionOpenInFlow: () => writing,
    }));
    expect(await accountIsActive("u1")).toBe(true);

    let row: SessionStanding = ACTIVE;
    container.clear();
    container.registerSingleton("adapter", () => ({
      ...adapterHolding(ACTIVE),
      getDrizzle: () => ({
        select: () => ({
          from: () => ({
            where: () => ({ limit: async () => [row] }),
          }),
        }),
      }),
    }));
    // The read that moves the cache to the new adapter.
    expect(await accountIsActive("u2")).toBe(true);

    forgetSessionStanding("u1");
    c.advance(SESSION_STANDING_TTL_MS + 1_000);
    expect(await accountIsActive("u1")).toBe(true);
    row = { isActive: false, sessionEpoch: 1 };
    writing = false;

    expect(await accountIsActive("u1")).toBe(false);
  });
});

describe("watchTransaction", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops watching, rather than throwing, when the probe fails", () => {
    vi.useFakeTimers();
    let calls = 0;
    const writing = watchTransaction(() => {
      calls += 1;
      if (calls > 1) throw new Error("probe failed");
      return true;
    }, 50);

    expect(() => vi.advanceTimersByTime(50)).not.toThrow();
    expect(writing?.()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("answers nothing for a caller outside any transaction", () => {
    expect(watchTransaction(() => false)).toBeUndefined();
  });

  it("reports the transaction open until it ends, then stops watching", () => {
    // Watching holds the writer's context through its timer, so it must stop
    // once the transaction ends rather than keep that context for as long as
    // the mark it feeds is kept.
    vi.useFakeTimers();
    let open = true;
    const writing = watchTransaction(() => open, 50);

    expect(writing?.()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(writing?.()).toBe(true);
    open = false;
    vi.advanceTimersByTime(50);

    expect(writing?.()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("readSessionStanding before services are registered", () => {
  afterEach(() => {
    setSessionStandingBoot(undefined);
    resetSessionStandingForTests();
    container.clear();
    ready.registered = false;
    ready.migrations = Promise.resolve();
  });

  it("starts the services, then reads", async () => {
    // A process authenticates some requests before anything has booted. A
    // token whose signature already verified may start it: the request was
    // about to anyway, and without the database nothing can say whether
    // the account may still use the token.
    const adapter = adapterHolding({ isActive: true, sessionEpoch: 4 });
    const boot = vi.fn(async () => {
      container.registerSingleton("adapter", () => adapter);
      ready.registered = true;
    });
    setSessionStandingBoot(boot);

    expect(await readSessionStanding("u1")).toEqual({
      isActive: true,
      sessionEpoch: 4,
    });
    expect(boot).toHaveBeenCalledTimes(1);
  });

  it("waits for a registration under way rather than reading through its adapter", async () => {
    // Registration puts the adapter in the container before it has run the
    // boot migrations and marked itself done. A request arriving in between
    // must not read through it: on an upgrade the column it reads may be
    // the one those migrations are adding.
    const adapter = adapterHolding({ isActive: true, sessionEpoch: 4 });
    container.registerSingleton("adapter", () => adapter);
    const boot = vi.fn(async () => {
      ready.registered = true;
    });
    setSessionStandingBoot(boot);

    await readSessionStanding("u1");

    expect(boot).toHaveBeenCalledTimes(1);
  });

  it("reads only once the boot migrations have settled", async () => {
    // The same gate `getCachedNextly()` waits on: a read while it is open
    // may meet a schema the migrations have not finished, and a refused boot
    // must keep refusing here too.
    let settle: () => void = () => {};
    ready.migrations = new Promise<void>(resolve => {
      settle = resolve;
    });
    ready.registered = true;
    const limit = vi.fn(async () => [{ isActive: true, sessionEpoch: 0 }]);
    container.registerSingleton("adapter", () => ({
      getCapabilities: () => ({ dialect: "postgresql" }),
      getDrizzle: () => ({
        select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
      }),
    }));

    const read = readSessionStanding("u1");
    // Long enough for every other step of the read to have run, so the read
    // not having happened is the gate's doing rather than a slow import.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(limit).not.toHaveBeenCalled();

    settle();
    await read;
    expect(limit).toHaveBeenCalledTimes(1);
  });

  it("refuses to answer when nothing can start them, naming the fix", async () => {
    // Failing closed: an unanswerable question is not a yes. An app's own
    // route that reads a session before initialising Nextly lands here, so
    // the operator is told the line that fixes it.
    const refusal = await readSessionStanding("u1").then(
      () => null,
      (error: unknown) => error
    );

    expect(refusal).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(String((refusal as NextlyError).logContext?.remedy ?? "")).toContain(
      "getNextly"
    );
  });
});

describe("readSessionStanding on SQLite", () => {
  afterEach(() => {
    resetSessionStandingForTests();
    container.clear();
    ready.registered = false;
  });

  it("reads through the adapter's transaction, so it queues behind an open one", async () => {
    // On SQLite every request shares one connection. A read issued while
    // another request's transaction is open would see the epoch that
    // transaction raised, and if that transaction then rolls back, the cache
    // would keep an epoch that never committed and refuse the live session.
    // The read has to go through the adapter's own transaction, which waits
    // for the open one. A fixture that declared PostgreSQL would skip that.
    const base = adapterHolding({ isActive: true, sessionEpoch: 4 });
    const transaction = vi.fn(<R>(work: () => Promise<R>) => work());
    const adapter = {
      ...base,
      getCapabilities: () => ({ dialect: "sqlite" }),
      transaction,
    };
    ready.registered = true;
    container.registerSingleton("adapter", () => adapter);

    expect(await readSessionStanding("u1")).toEqual({
      isActive: true,
      sessionEpoch: 4,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
