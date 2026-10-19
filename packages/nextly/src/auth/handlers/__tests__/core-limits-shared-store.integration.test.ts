/**
 * Core's own limits in the database store, on every dialect: two instances on
 * one database count one budget, the store holds no address as given, an
 * entry lapses by the end of its window, and an outage refuses sign-in while
 * the API is let through.
 *
 * Each "instance" is a router and a REST limit of its own over a database
 * store of its own on its own connection (SQLite's one connection excepted),
 * built as the boot builds them: the selected store, held to its time, under
 * the core adapter and its outage watch.
 *
 * @module auth/handlers/__tests__/core-limits-shared-store.integration.test
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it } from "vitest";

import { NULL_AUDIT_LOG_WRITER } from "../../../domains/audit/audit-log-writer";
import { createAdapter } from "../../../database/factory";
import { withCallDeadline } from "../../../domains/limits/call-deadline";
import { watchCoreLimitOutage } from "../../../domains/limits/core-limit-outage";
import { coreLimitStore } from "../../../domains/limits/core-limit-store";
import {
  createDatabaseLimitStore,
  type DatabaseLimitStore,
} from "../../../domains/limits/database-limit-store";
import type { LimitStore } from "../../../domains/limits/limit-store";
import type { RateLimitStore } from "../../../middleware/rate-limit";
import { openRestLimitGate } from "../../../middleware/rest-limit-gate";
import { createRestLimits } from "../../../middleware/rest-limits";
import { setNextlyLogger } from "../../../observability/logger";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  LIMIT_STORE_COUNTER_PREFIX,
  LIMIT_STORE_TABLE,
} from "../../../schemas/limit-store";
import { buildAuthRouterDeps } from "../deps-bridge";
import { routeAuthRequest, type AuthRouterDeps } from "../router";

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;

const SECRET = "test-secret-that-is-at-least-32-characters-long!!";
const SITE = "http://localhost:3000";

setNextlyLogger({
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
});

/** Core's limit store over `store`, as the boot builds it. */
function coreCounts(store: LimitStore): RateLimitStore {
  return watchCoreLimitOutage(coreLimitStore(withCallDeadline(store), SECRET));
}

/** A router whose sign-in limit counts in `counts`. */
function router(counts: RateLimitStore, budget: number, windowMs = 3_600_000) {
  const deps: AuthRouterDeps = {
    // The router's own services, stubbed: only its sign-in limit is under
    // test, and that counts in `counts`.
    ...buildAuthRouterDeps(name =>
      name === "adapter" ? { getDrizzle: () => ({}) } : {}
    ),
    secret: SECRET,
    loginStallTimeMs: 0,
    allowedOrigins: [],
    trustProxy: true,
    trustedProxyIps: [],
    authRateLimit: { requestsPerHour: budget, windowMs, counts },
    auditLog: NULL_AUDIT_LOG_WRITER,
    findUserByEmail: async () => null,
  };
  /** A sign-in from `address`; its status, 429 when the limit refused it. */
  return async (address: string): Promise<number> => {
    const request = new Request(`${SITE}/admin/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: SITE,
        "x-forwarded-for": address,
      },
      body: JSON.stringify({ email: "a@example.com", password: "pw" }),
    });
    const response = await routeAuthRequest(request, "login", deps);
    if (!response) throw new Error("no route for login");
    return response.status;
  };
}

/** A REST limit counting reads in `counts`; null when a read was admitted. */
function restLimit(counts: RateLimitStore, reads: number) {
  const limits = createRestLimits({
    enabled: true,
    readLimit: reads,
    writeLimit: 1,
    windowMs: 60_000,
    trustProxy: true,
    store: counts,
  });
  return (address: string) =>
    openRestLimitGate(
      limits,
      new Request(`${SITE}/admin/api/collections/posts`, {
        headers: { "x-forwarded-for": address },
      })
    ).settle("core");
}

describeEachDialect("core's own limits in the database store", dialect => {
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
    return store;
  }

  /** Two instances' core stores on one database, under one generation. */
  function twoInstances(): [RateLimitStore, RateLimitStore, LimitStore] {
    const generation = randomUUID().slice(0, 8);
    const first = databaseStore(current.adapter, generation);
    return [
      coreCounts(first),
      coreCounts(databaseStore(other, generation)),
      first,
    ];
  }

  /** Every stored row, as text. */
  const storedRows = async (): Promise<string> =>
    JSON.stringify(
      await current.adapter.executeQuery(`SELECT * FROM ${LIMIT_STORE_TABLE}`)
    );

  it("admits exactly the sign-in budget across two instances", async () => {
    const [first, second] = twoInstances();
    const signIn = [router(first, 5), router(second, 5)];
    const address = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      statuses.push(await signIn[attempt % 2](address));
    }

    expect(statuses.filter(status => status !== 429)).toHaveLength(5);
    expect(statuses.slice(5).every(status => status === 429)).toBe(true);
  }, 60_000);

  it("admits exactly the REST read budget across two instances", async () => {
    const [first, second] = twoInstances();
    const reads = [restLimit(first, 3), restLimit(second, 3)];
    const address = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

    let admitted = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if ((await reads[attempt % 2](address)) === null) admitted += 1;
    }

    expect(admitted).toBe(3);
  }, 60_000);

  it("stores no client address as given", async () => {
    const [first] = twoInstances();
    const address = "203.0.113.77";

    await router(first, 5)(address);
    await restLimit(first, 3)(address);

    const rows = await storedRows();
    expect(rows.length).toBeGreaterThan(2);
    expect(rows).not.toContain(address);
  }, 60_000);

  it("leaves no entry past its window once the store is swept", async () => {
    const [first, , store] = twoInstances();
    const before = await current.adapter.executeQuery<{ id: string }>(
      `SELECT id FROM ${LIMIT_STORE_TABLE}`
    );
    await router(first, 5, 1_000)("203.0.113.88");
    const during = await current.adapter.executeQuery<{ id: string }>(
      `SELECT id FROM ${LIMIT_STORE_TABLE}`
    );
    expect(during.length).toBeGreaterThan(before.length);

    await new Promise(resolve => setTimeout(resolve, 1_500));
    await store.sweep();

    const after = new Set(
      (
        await current.adapter.executeQuery<{ id: string }>(
          `SELECT id FROM ${LIMIT_STORE_TABLE}`
        )
      ).map(row => row.id)
    );
    // The entries the sign-in wrote; not the store's own counter of its live
    // rows, which never lapses by design.
    const added = during.filter(
      row =>
        !before.some(earlier => earlier.id === row.id) &&
        !row.id.startsWith(LIMIT_STORE_COUNTER_PREFIX)
    );
    expect(added.length).toBeGreaterThan(0);
    for (const row of added) expect(after.has(row.id)).toBe(false);
  }, 60_000);

  it("refuses sign-in and lets the API through while the store is away, and counts again once it is back", async () => {
    const [first] = twoInstances();
    const signIn = router(first, 2);
    const read = restLimit(first, 1);
    const address = "203.0.113.99";
    const away = `${LIMIT_STORE_TABLE}_away`;

    await current.adapter.executeQuery(
      dialect === "mysql"
        ? `RENAME TABLE ${LIMIT_STORE_TABLE} TO ${away}`
        : `ALTER TABLE ${LIMIT_STORE_TABLE} RENAME TO ${away}`
    );
    try {
      expect(await signIn(address)).toBe(503);
      expect(await read(address)).toBeNull();
      expect(await read(address)).toBeNull();
    } finally {
      await current.adapter.executeQuery(
        dialect === "mysql"
          ? `RENAME TABLE ${away} TO ${LIMIT_STORE_TABLE}`
          : `ALTER TABLE ${away} RENAME TO ${LIMIT_STORE_TABLE}`
      );
    }

    // Back: counted again, so the budget of two refuses a third.
    expect(await signIn(address)).not.toBe(429);
    expect(await signIn(address)).not.toBe(429);
    expect(await signIn(address)).toBe(429);
    expect(await read(address)).toBeNull();
    expect(await read(address)).not.toBeNull();
  }, 60_000);

  it("answers within the documented time when the store never answers", async () => {
    const silent: LimitStore = {
      shared: true,
      update: () => new Promise(() => undefined),
      read: () => new Promise(() => undefined),
      sweep: () => new Promise(() => undefined),
    };
    const counts = coreCounts(silent);
    const started = performance.now();

    const [signIn, read] = await Promise.all([
      router(counts, 5)("203.0.113.100"),
      restLimit(counts, 1)("203.0.113.100"),
    ]);

    expect(signIn).toBe(503);
    expect(read).toBeNull();
    expect(performance.now() - started).toBeLessThan(3_000);
  }, 60_000);
});
