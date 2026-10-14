/**
 * The plugin limiter over the database limit store, on every dialect, with
 * two instances on one database: concurrent reservations admitted no more
 * than the rules allow, per-address code tries across resends, giving back,
 * rotation, keys stored only hashed, a count made while another request's
 * transaction is open, and an outage.
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import { setNextlyLogger } from "../../../observability/logger";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { rateLimitClient } from "../../../plugins/routes/route-options";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { LIMIT_STORE_TABLE } from "../../../schemas/limit-store";
import { withCallDeadline } from "../call-deadline";
import {
  createDatabaseLimitStore,
  type DatabaseLimitStore,
} from "../database-limit-store";
import type { LimitStore } from "../limit-store";
import type { LimitRule } from "../limit-rules";
import { createPluginLimiter, type PluginLimiter } from "../plugin-limiter";

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;

const HOUR = 60 * 60 * 1000;

const RULES = new Map<string, LimitRule>([
  ["perKey", { type: "window", windows: [{ max: 7, perMs: HOUR }] }],
  ["address", { type: "window", windows: [{ max: 3, perMs: HOUR }] }],
  ["client", { type: "window", windows: [{ max: 5, perMs: HOUR }] }],
  // 5 tries per address in any 24 hours, across every code minted for it.
  ["codeTries", { type: "window", windows: [{ max: 5, perMs: 24 * HOUR }] }],
  [
    "signin",
    {
      type: "backoff",
      free: 20,
      waitsMs: [60_000, 300_000],
      forgetAfterMs: 24 * HOUR,
    },
  ],
]);

/** A promise and the function that settles it, to hold a flow at one point. */
function gate(): { wait: Promise<void>; open: () => void } {
  let settle: () => void = () => undefined;
  const wait = new Promise<void>(resolve => {
    settle = resolve;
  });
  return { wait, open: () => settle() };
}

afterEach(() => {
  setNextlyLogger(undefined);
});

describeEachDialect("the plugin limiter on the database store", dialect => {
  let current: TestNextly;
  let other: TestAdapter;
  const opened: DatabaseLimitStore[] = [];

  beforeAll(async () => {
    current = await createTestNextly({ dialect });
    if (dialect === "sqlite") {
      // Both instances share the one connection; see the store's own suite
      // for why two connections in one process cannot stand in for two.
      other = current.adapter;
    } else {
      const url = process.env.DATABASE_URL;
      if (url === undefined)
        throw new Error("no database for a second instance");
      other = await createAdapter({ type: dialect, url });
    }
  });

  afterAll(async () => {
    // Each store drains its sweep before the database it sweeps goes away.
    for (const store of opened) await store.close();
    if (other !== current.adapter) await other.disconnect();
    await current.destroy();
  });

  /** A limiter of `plugin` on `adapter`'s database store. */
  function limiterOn(
    adapter: TestAdapter,
    options: {
      generation?: string;
      secret?: string;
      maxEntries?: number;
      store?: LimitStore;
      rules?: Record<string, LimitRule>;
    } = {}
  ): PluginLimiter {
    const generation = options.generation ?? "gen-a";
    const store =
      options.store ??
      createDatabaseLimitStore({
        adapter,
        generation,
        maxEntries: options.maxEntries,
        sweepIntervalMs: false,
      });
    if ("close" in store && typeof store.close === "function") {
      opened.push(store as DatabaseLimitStore);
    }
    return createPluginLimiter({
      plugin: "@test/limits",
      rules: options.rules ? new Map(Object.entries(options.rules)) : RULES,
      store,
      secret: options.secret ?? "install secret",
      singleInstance: false,
      transactions: adapter,
      clientAddress: () => null,
      clientOf: rateLimitClient,
    });
  }

  it("admits exactly a rule's number of 50 simultaneous reservations over two instances, for one key and for an address and a client", async () => {
    const first = limiterOn(current.adapter);
    const second = limiterOn(other);
    const key = randomUUID();

    const single = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        (index % 2 === 0 ? first : second).reserve([{ rule: "perKey", key }])
      )
    );
    const paired = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        (index % 2 === 0 ? first : second).reserve([
          { rule: "address", key: `${key}@example.com` },
          { rule: "client", key: "203.0.113.7" },
        ])
      )
    );

    expect(
      single.filter(outcome => outcome.status === "admitted")
    ).toHaveLength(7);
    // The address allows 3; the client's 5 never decide.
    expect(
      paired.filter(outcome => outcome.status === "admitted")
    ).toHaveLength(3);
  });

  it("refuses an address's sixth code try in 24 hours, though each try had a fresh code with tries left", async () => {
    const limits = limiterOn(current.adapter);
    const address = `${randomUUID()}@example.com`;
    const outcomes: string[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      // A resend mints a fresh code with a fresh budget of its own; the
      // address's tries are reserved before the code is ever consumed.
      const freshCodeTriesLeft = 5;
      const reservation = await limits.reserve([
        { rule: "codeTries", key: address },
      ]);
      outcomes.push(`${reservation.status}:${freshCodeTriesLeft}`);
    }
    expect(
      outcomes.slice(0, 5).every(outcome => outcome.startsWith("admitted"))
    ).toBe(true);
    expect(outcomes[5]).toBe("refused:5");
  });

  it("lifts the wait a released success set, and no other", async () => {
    const first = limiterOn(current.adapter);
    const second = limiterOn(other);
    const client = randomUUID();
    const signIn = (limits: PluginLimiter) =>
      limits.reserve([{ rule: "signin", key: client, count: "always" }]);
    for (let attempt = 0; attempt < 19; attempt += 1) {
      await signIn(attempt % 2 === 0 ? first : second);
    }
    const success = await signIn(first);
    if (success.status !== "admitted") throw new Error("not admitted");

    await second.release(success.reservation);
    await second.release(success.reservation);

    expect((await signIn(second)).status).toBe("admitted");
    // That attempt set a wait of its own, which no release of the earlier one lifts.
    await first.release(success.reservation);
    expect((await signIn(first)).status).toBe("refused");
  });

  it("starts counts again when the secret rotates, the earlier entries never taking the new ones' room", async () => {
    const before = limiterOn(current.adapter, {
      generation: randomUUID().slice(0, 8),
      secret: "earlier secret",
      maxEntries: 3,
    });
    for (let index = 0; index < 3; index += 1) {
      await before.reserve([{ rule: "perKey", key: `k${index}` }]);
    }
    expect(await before.reserve([{ rule: "perKey", key: "k3" }])).toEqual({
      status: "unavailable",
    });

    const after = limiterOn(other, {
      generation: randomUUID().slice(0, 8),
      secret: "rotated secret",
      maxEntries: 3,
    });
    for (let index = 0; index < 3; index += 1) {
      expect(
        (await after.reserve([{ rule: "perKey", key: `k${index}` }])).status
      ).toBe("admitted");
    }
  });

  it("starts a rule's counts again on every instance when the plugin changes the rule", async () => {
    const generation = randomUUID().slice(0, 8);
    const window = (perMs: number): Record<string, LimitRule> => ({
      r: { type: "window", windows: [{ max: 1, perMs }] },
    });
    const before = limiterOn(current.adapter, {
      generation,
      rules: window(10 * 60_000),
    });
    await before.reserve([{ rule: "r", key: "k" }]);
    expect((await before.reserve([{ rule: "r", key: "k" }])).status).toBe(
      "refused"
    );

    const after = limiterOn(other, { generation, rules: window(20 * 60_000) });

    expect((await after.reserve([{ rule: "r", key: "k" }])).status).toBe(
      "admitted"
    );
  });

  it("gives back the first of 40 outstanding reservations from another instance", async () => {
    const generation = randomUUID().slice(0, 8);
    const rules: Record<string, LimitRule> = {
      r: { type: "window", windows: [{ max: 100, perMs: HOUR }] },
    };
    const first = limiterOn(current.adapter, { generation, rules });
    const second = limiterOn(other, { generation, rules });
    const earliest = await first.reserve([{ rule: "r", key: "k" }]);
    if (earliest.status !== "admitted") throw new Error("not admitted");
    for (let attempt = 1; attempt < 40; attempt += 1) {
      await first.reserve([{ rule: "r", key: "k" }]);
    }

    await second.release(earliest.reservation);

    let admitted = 0;
    while (
      (await second.reserve([{ rule: "r", key: "k" }])).status === "admitted"
    ) {
      admitted += 1;
    }
    expect(admitted).toBe(61);
  });

  it("removes an entry's row once its only count is given back", async () => {
    const generation = randomUUID().slice(0, 8);
    const limits = limiterOn(current.adapter, { generation });
    const rowsOfGeneration = async () =>
      (
        await current.adapter.executeQuery<Record<string, unknown>>(
          `SELECT id FROM ${LIMIT_STORE_TABLE} WHERE generation = '${generation}' AND id NOT LIKE 'capacity:%'`
        )
      ).length;
    const success = await limits.reserve([{ rule: "signin", key: "c" }]);
    if (success.status !== "admitted") throw new Error("not admitted");
    expect(await rowsOfGeneration()).toBe(1);

    await limits.release(success.reservation);

    expect(await rowsOfGeneration()).toBe(0);
  });

  it("stores no key as given: neither the address nor the client", async () => {
    const limits = limiterOn(current.adapter);
    const address = `${randomUUID()}@example.com`;
    await limits.reserve([
      { rule: "address", key: address },
      { rule: "client", key: "198.51.100.23" },
    ]);

    const rows = await current.adapter.executeQuery<Record<string, unknown>>(
      `SELECT * FROM ${LIMIT_STORE_TABLE}`
    );

    const stored = JSON.stringify(rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(stored).not.toContain(address);
    expect(stored).not.toContain("198.51.100.23");
  });

  if (dialect === "sqlite") {
    it("waits for another request's open transaction rather than being refused, and its count stands when that rolls back", async () => {
      const limits = limiterOn(current.adapter);
      const key = randomUUID();
      await limits.check([{ rule: "perKey", key }]);
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
      const reserving = limits.reserve([{ rule: "perKey", key }]);
      held.open();

      expect((await reserving).status).toBe("admitted");
      await rolledBack;
      const read = await limits.check([{ rule: "perKey", key }]);
      expect(read).toMatchObject({ status: "ok" });
      // The count stood: six more fill the rule of seven.
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await limits.reserve([{ rule: "perKey", key }]);
      }
      expect((await limits.reserve([{ rule: "perKey", key }])).status).toBe(
        "refused"
      );
    });
  }

  it("answers unavailable while the store is taken away, and returns to normal once it is back", async () => {
    setNextlyLogger({
      error: () => undefined,
      warn: () => undefined,
      info: () => undefined,
      debug: () => undefined,
    });
    const limits = limiterOn(current.adapter);
    const key = randomUUID();
    expect((await limits.reserve([{ rule: "perKey", key }])).status).toBe(
      "admitted"
    );
    const away = `${LIMIT_STORE_TABLE}_away`;

    await current.adapter.executeQuery(
      dialect === "mysql"
        ? `RENAME TABLE ${LIMIT_STORE_TABLE} TO ${away}`
        : `ALTER TABLE ${LIMIT_STORE_TABLE} RENAME TO ${away}`
    );
    try {
      expect(await limits.reserve([{ rule: "perKey", key }])).toEqual({
        status: "unavailable",
      });
      expect(await limits.reset({ rule: "perKey", key })).toEqual({
        status: "unavailable",
      });
    } finally {
      await current.adapter.executeQuery(
        dialect === "mysql"
          ? `RENAME TABLE ${away} TO ${LIMIT_STORE_TABLE}`
          : `ALTER TABLE ${away} RENAME TO ${LIMIT_STORE_TABLE}`
      );
    }

    expect((await limits.reserve([{ rule: "perKey", key }])).status).toBe(
      "admitted"
    );
  });

  it("answers within the documented time when the store never answers", async () => {
    const silent: LimitStore = {
      shared: true,
      update: () => new Promise(() => undefined),
      read: () => new Promise(() => undefined),
      sweep: () => new Promise(() => undefined),
    };
    const limits = limiterOn(current.adapter, {
      store: withCallDeadline(silent),
    });
    const started = performance.now();

    const outcomes = await Promise.all([
      limits.reserve([{ rule: "perKey", key: "k" }]),
      limits.check([{ rule: "perKey", key: "k" }]),
    ]);

    expect(outcomes).toEqual([
      { status: "unavailable" },
      { status: "unavailable" },
    ]);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
