/**
 * A two-factor challenge on every dialect, with two instances on one
 * database: an answered challenge is refused on the other instance, two
 * correct answers at once mint one session, wrong answers on both instances
 * share one budget in the database store, the mark outlives another
 * request's rollback on SQLite, expired marks are swept, no account id is
 * stored as given, and a store outage refuses an answer with one to try
 * again shortly.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createAdapter } from "../../../database/factory";
import { withCallDeadline } from "../../../domains/limits/call-deadline";
import {
  createDatabaseLimitStore,
  type DatabaseLimitStore,
} from "../../../domains/limits/database-limit-store";
import type { LimitStore } from "../../../domains/limits/limit-store";
import { createMemoryLimitStore } from "../../../domains/limits/memory-limit-store";
import { setNextlyLogger } from "../../../observability/logger";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { LIMIT_STORE_TABLE } from "../../../schemas/limit-store";
import { SPENT_CHALLENGES_TABLE } from "../../../schemas/spent-challenges";
import { ChallengeRegistry } from "../../pipeline/challenge";
import { challengeFlowKeys } from "../../pipeline/challenge-keys";
import { AuthHookRegistry } from "../../pipeline/hooks";
import { mintPendingToken } from "../../pipeline/pending-token";
import type { AccountState } from "../../session/account-state";
import {
  databaseSpentChallenges,
  sweepSpentChallenges,
  type SpentChallenges,
} from "../../pipeline/spent-challenges";
import { handleChallengeResolve } from "../challenge-resolve";
import { buildAuthRouterDeps } from "../deps-bridge";

import { fakeSessionRows, fixtureIdentity } from "./session-row-fake";

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;

const SECRET = "test-secret-that-is-at-least-32-characters-long!!";
const RIGHT = "123456";

/**
 * A point every caller waits at until `count` have reached it, so answers
 * meant to race are all past their checks before any goes on.
 */
function barrier(count: number): () => Promise<void> {
  let arrived = 0;
  let release: () => void = () => undefined;
  const all = new Promise<void>(resolve => {
    release = resolve;
  });
  return () => {
    arrived += 1;
    if (arrived >= count) release();
    return all;
  };
}

/** One instance of the site: its own deps over a shared database. */
function instance(
  adapter: TestAdapter,
  limitStore: LimitStore,
  options: {
    beforeResolve?: () => Promise<void>;
    /** The clock the marks sweep by, when not this one. */
    marksNow?: () => number;
    /** Runs each spend of a mark, so a case can put them in order. */
    spendIn?: <T>(spend: () => Promise<T>) => Promise<T>;
  } = {}
) {
  const challengeRegistry = new ChallengeRegistry();
  const resolve = vi.fn(
    async ({ response }: { response: { code?: string } }) => {
      await options.beforeResolve?.();
      return response.code === RIGHT
        ? { ok: true as const }
        : { ok: false as const };
    }
  );
  challengeRegistry.add({ id: "totp", resolve });
  const fetchAccountState = async (userId: string): Promise<AccountState> => ({
    userId,
    isActive: true,
    lockedUntil: null,
    emailVerified: new Date("2026-01-01T00:00:00Z"),
    passwordUpdatedAt: null,
    ...fixtureIdentity,
  });
  const sessionRows = fakeSessionRows(fetchAccountState);
  const deps = {
    secret: SECRET,
    isProduction: false,
    accessTokenTTL: 900,
    refreshTokenTTL: 604800,
    trustProxy: false,
    trustedProxyIps: [],
    fetchSessionRoles: async () => ({
      roleIds: ["editor"],
      validUntil: undefined,
    }),
    fetchCustomFields: async () => ({}),
    withSessionRowTransaction: sessionRows.withSessionRowTransaction,
    authHooks: new AuthHookRegistry(),
    pluginCtx: {} as never,
    challengeRegistry,
    challengeTokenTTL: 300,
    maxChallengeAttempts: 5,
    allowedOrigins: ["http://localhost:3000"],
    loginStallTimeMs: 0,
    auditLog: { write: async () => undefined },
    findUserById: async (id: string) => ({
      id,
      email: "a@b.c",
      name: "A",
      image: null,
      isActive: true,
      mustChangePassword: null,
    }),
    requireEmailVerification: true,
    fetchAccountState,
    limitStore,
    spentChallenges: ((marks: SpentChallenges): SpentChallenges => ({
      isSpent: mark => marks.isSpent(mark),
      spend: (mark, expiresAt) =>
        (options.spendIn ?? (run => run()))(() => marks.spend(mark, expiresAt)),
    }))(databaseSpentChallenges(adapter as never, { now: options.marksNow })),
  };
  return {
    sessions: () => sessionRows.committed.length,
    resolve,
    answer: (pendingToken: string, code: string) =>
      handleChallengeResolve(
        new Request("http://localhost:3000/admin/api/auth/challenge/resolve", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: "nextly_csrf=tok",
            origin: "http://localhost:3000",
          },
          body: JSON.stringify({
            csrfToken: "tok",
            pendingToken,
            response: { code },
          }),
        }),
        deps as never
      ),
  };
}

/** A pending token for a fresh flow of `userId`. */
function pendingFor(userId: string, flow = randomUUID()): Promise<string> {
  return mintPendingToken(
    {
      userId,
      challengeId: "totp",
      attempts: 0,
      flow,
      flowExpiresAt: Math.floor(Date.now() / 1000) + 300,
    } as never,
    SECRET,
    300
  );
}

/** A promise and the function that settles it, to hold a flow at one point. */
function gate(): { wait: Promise<void>; open: () => void } {
  let settle: () => void = () => undefined;
  const wait = new Promise<void>(resolve => {
    settle = resolve;
  });
  return { wait, open: () => settle() };
}

describeEachDialect("a two-factor challenge on one database", dialect => {
  let current: TestNextly;
  let other: TestAdapter;
  const opened: DatabaseLimitStore[] = [];

  beforeAll(async () => {
    current = await createTestNextly({ dialect });
    if (dialect === "sqlite") {
      // Both instances share the one connection: two connections in one
      // process cannot stand in for two processes on SQLite.
      other = current.adapter;
    } else {
      const url = process.env.DATABASE_URL;
      if (url === undefined)
        throw new Error("no database for a second instance");
      other = await createAdapter({ type: dialect, url });
    }
  });

  afterAll(async () => {
    for (const store of opened) await store.close();
    if (other !== current.adapter) await other.disconnect();
    await current.destroy();
  });

  /** The database store on `adapter`, under one generation. */
  function databaseStore(adapter: TestAdapter, generation: string): LimitStore {
    const store = createDatabaseLimitStore({
      adapter: adapter as never,
      generation,
      sweepIntervalMs: false,
    });
    opened.push(store);
    return withCallDeadline(store);
  }

  it("gives a booted site's auth router the database's marks, and the selected limit store", async () => {
    const deps = buildAuthRouterDeps(
      current.getService as unknown as (name: string) => unknown
    );
    const mark = `${randomUUID().replaceAll("-", "")}`.padEnd(64, "3");

    expect(deps.spentChallenges).toBeDefined();
    expect(deps.limitStore).toBeDefined();
    expect(await deps.spentChallenges?.spend(mark, Date.now() + 60_000)).toBe(
      true
    );
    // Written to the table, where every instance on this database reads it.
    const rows = await current.adapter.executeQuery<{ id: string }>(
      `SELECT id FROM ${SPENT_CHALLENGES_TABLE} WHERE id = '${mark}'`
    );
    expect(rows).toHaveLength(1);
    expect(await deps.spentChallenges?.spend(mark, Date.now() + 60_000)).toBe(
      false
    );
  });

  it("refuses on the other instance an answer already accepted, with the memory store, before the resolver runs", async () => {
    const first = instance(current.adapter, createMemoryLimitStore());
    const second = instance(other, createMemoryLimitStore());
    const token = await pendingFor(randomUUID());

    expect((await first.answer(token, RIGHT)).status).toBe(200);
    const replay = await second.answer(token, RIGHT);

    expect(replay.status).toBe(401);
    expect(second.resolve).not.toHaveBeenCalled();
    expect(first.sessions() + second.sessions()).toBe(1);
  });

  it("mints one session when two correct answers arrive at once on two instances", async () => {
    // Both answers are past the check for a settled flow before either is
    // resolved, so only the mark's one write can tell them apart.
    const together = barrier(2);
    const first = instance(current.adapter, createMemoryLimitStore(), {
      beforeResolve: together,
    });
    const second = instance(other, createMemoryLimitStore(), {
      beforeResolve: together,
    });
    const token = await pendingFor(randomUUID());

    const statuses = (
      await Promise.all([
        first.answer(token, RIGHT),
        second.answer(token, RIGHT),
      ])
    ).map(response => response.status);

    expect(statuses.sort()).toEqual([200, 401]);
    expect(first.sessions() + second.sessions()).toBe(1);
  });

  it("counts wrong answers on both instances against one budget in the database store", async () => {
    const generation = randomUUID().slice(0, 8);
    const first = instance(
      current.adapter,
      databaseStore(current.adapter, generation)
    );
    const second = instance(other, databaseStore(other, generation));
    const token = await pendingFor(randomUUID());

    // Five attempts in all, alternating instances; the sixth is refused
    // before it is examined, though it is the right answer.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await (attempt % 2 === 0 ? first : second).answer(token, "000000");
    }
    const sixth = await first.answer(token, RIGHT);

    expect(sixth.status).toBe(401);
    expect(first.sessions()).toBe(0);
    expect(
      first.resolve.mock.calls.length + second.resolve.mock.calls.length
    ).toBe(5);
  });

  it("hands the store the budget's key, and writes the mark, with no account id as given", async () => {
    const generation = randomUUID().slice(0, 8);
    const store = databaseStore(current.adapter, generation);
    // Every key the store is handed: the database store hashes keys into its
    // row ids itself, but the memory store and an app's own store hold them
    // as given, so the key must hold no account id before it gets there.
    const keys: string[] = [];
    const recording: LimitStore = {
      shared: store.shared,
      update: (updated, apply) => {
        keys.push(...updated);
        return store.update(updated, apply);
      },
      read: read => {
        keys.push(...read);
        return store.read(read);
      },
      sweep: () => store.sweep(),
    };
    const site = instance(current.adapter, recording);
    const userId = `user-${randomUUID()}`;
    const token = await pendingFor(userId);

    await site.answer(token, "000000");
    await site.answer(token, RIGHT);

    expect(keys.length).toBeGreaterThan(0);
    expect(keys.join("\n")).not.toContain(userId);
    const rows = JSON.stringify([
      ...(await current.adapter.executeQuery(
        `SELECT * FROM ${LIMIT_STORE_TABLE}`
      )),
      ...(await current.adapter.executeQuery(
        `SELECT * FROM ${SPENT_CHALLENGES_TABLE}`
      )),
    ]);
    expect(rows.length).toBeGreaterThan(2);
    expect(rows).not.toContain(userId);
  });

  it("sweeps a mark once it has been kept as long as it was given, and keeps one still inside that", async () => {
    const marks = databaseSpentChallenges(current.adapter as never);
    const now = Date.now();
    const expired = `${randomUUID().replaceAll("-", "")}`.padEnd(64, "0");
    const live = `${randomUUID().replaceAll("-", "")}`.padEnd(64, "1");
    await marks.spend(expired, now + 60_000);
    await marks.spend(live, now + 10 * 60_000);

    // Five minutes on: the first mark's keep-until has passed, the
    // second's not.
    await sweepSpentChallenges(current.adapter as never, now + 5 * 60_000);

    expect(await marks.isSpent(expired)).toBe(false);
    expect(await marks.isSpent(live)).toBe(true);
  });

  it("mints one session when two answers let through before the token's end reach their marks after it", async () => {
    // Both are past the settled check together, and the marks sweep as if
    // the token's five minutes were over by then: the first mark's own sweep
    // must not remove it before the second answer meets it.
    const together = barrier(2);
    const afterTheEnd = () => Date.now() + 301_000;
    // One spend after the other, the first with its sweep finished, so the
    // second meets whatever the first's sweep left.
    let queue: Promise<unknown> = Promise.resolve();
    const oneAtATime = <T>(spend: () => Promise<T>): Promise<T> => {
      const next = queue.then(spend);
      queue = next.catch(() => undefined);
      return next;
    };
    const first = instance(current.adapter, createMemoryLimitStore(), {
      beforeResolve: together,
      marksNow: afterTheEnd,
      spendIn: oneAtATime,
    });
    const second = instance(other, createMemoryLimitStore(), {
      beforeResolve: together,
      marksNow: afterTheEnd,
      spendIn: oneAtATime,
    });
    const token = await pendingFor(randomUUID());

    const statuses = (
      await Promise.all([
        first.answer(token, RIGHT),
        second.answer(token, RIGHT),
      ])
    ).map(response => response.status);

    expect(statuses.sort()).toEqual([200, 401]);
    expect(first.sessions() + second.sessions()).toBe(1);
  });

  it("refuses an answer with one to try again shortly while the budget's store is away, and examines answers again once it is back", async () => {
    setNextlyLogger({
      error: () => undefined,
      warn: () => undefined,
      info: () => undefined,
      debug: () => undefined,
    });
    try {
      const generation = randomUUID().slice(0, 8);
      const site = instance(
        current.adapter,
        databaseStore(current.adapter, generation)
      );
      const token = await pendingFor(randomUUID());
      expect((await site.answer(token, "000000")).status).toBe(401);
      const away = `${LIMIT_STORE_TABLE}_away`;

      await current.adapter.executeQuery(
        dialect === "mysql"
          ? `RENAME TABLE ${LIMIT_STORE_TABLE} TO ${away}`
          : `ALTER TABLE ${LIMIT_STORE_TABLE} RENAME TO ${away}`
      );
      let refused: Response;
      try {
        refused = await site.answer(token, RIGHT);
      } finally {
        await current.adapter.executeQuery(
          dialect === "mysql"
            ? `RENAME TABLE ${away} TO ${LIMIT_STORE_TABLE}`
            : `ALTER TABLE ${away} RENAME TO ${LIMIT_STORE_TABLE}`
        );
      }

      expect(refused.status).toBe(503);
      expect(
        ((await refused.json()) as { error: { message: string } }).error.message
      ).toMatch(/try again shortly/i);
      expect(site.sessions()).toBe(0);
      expect(site.resolve).toHaveBeenCalledTimes(1);

      expect((await site.answer(token, RIGHT)).status).toBe(200);
      expect(site.sessions()).toBe(1);
    } finally {
      setNextlyLogger(undefined);
    }
  });

  if (dialect === "sqlite") {
    it("keeps the mark when another request's open transaction rolls back", async () => {
      const marks = databaseSpentChallenges(current.adapter as never);
      const mark = challengeFlowKeys(SECRET, {
        userId: randomUUID(),
        challengeId: "totp",
        flow: randomUUID(),
      }).mark;
      const started = gate();
      const held = gate();

      const rolledBack = current.adapter
        .transaction(async () => {
          started.open();
          await held.wait;
          throw new Error("roll the other request's work back");
        })
        .catch(() => undefined);
      await started.wait;
      const spending = marks.spend(mark, Date.now() + 60_000);
      held.open();

      expect(await spending).toBe(true);
      await rolledBack;
      expect(await marks.isSpent(mark)).toBe(true);
      // And it still refuses a second write of the same mark.
      expect(await marks.spend(mark, Date.now() + 60_000)).toBe(false);
    });
  }
});

describe("a mark written inside the caller's own transaction", () => {
  it("is refused rather than joining it", async () => {
    const marks = databaseSpentChallenges({
      getCapabilities: () => ({ dialect: "sqlite" }),
      transactionOpenInFlow: () => true,
    } as never);

    await expect(
      marks.spend("a".repeat(64), Date.now() + 60_000)
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });
});
