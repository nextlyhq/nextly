/**
 * The remembered verdict, and the message an operator gets when there is nothing to write to.
 *
 * No database: both are decisions made from what has already been observed, and the point of the
 * cache is that the common case reaches no database at all.
 */
import { describe, expect, it, vi } from "vitest";

import {
  cachedCompanionReadiness,
  companionNotReadyMessage,
  expireCompanionReadiness,
  forgetCompanionReadiness,
  isCompanionReady,
  resolveCompanionReadiness,
} from "./companion-readiness";

/** Counts what actually reached the database, which is the property under test. */
function countingAdapter(present: string[]) {
  const queries: string[] = [];
  return {
    queries,
    present,
    dialect: "postgresql" as const,
    executeQuery: (sql: string) => {
      queries.push(sql);
      const table = /FROM "([^"]+)"/.exec(sql)?.[1];
      if (table && present.includes(table)) return Promise.resolve([]);
      return Promise.reject(new Error(`relation "${table}" does not exist`));
    },
    getDrizzle: <T>() => ({}) as T,
  };
}

describe("companion readiness", () => {
  it("reaches the database once and then answers from memory", async () => {
    const adapter = countingAdapter(["dc_posts_locales"]);

    expect(await isCompanionReady(adapter, "dc_posts_locales")).toBe(true);
    expect(adapter.queries).toHaveLength(1);

    // The whole point: the healthy steady state, where every localized write used to pay a round
    // trip per entity, now pays none.
    expect(await isCompanionReady(adapter, "dc_posts_locales")).toBe(true);
    expect(await isCompanionReady(adapter, "dc_posts_locales")).toBe(true);
    expect(adapter.queries).toHaveLength(1);
  });

  it("keeps asking while the companion is absent", async () => {
    // Deliberately not remembered. `db:sync` and `migrate` run in a different process, so a
    // remembered "not ready" would outlive the migration that made it wrong — turning a window
    // between the check and the write into one that lasts until the next reload.
    const adapter = countingAdapter([]);

    expect(await isCompanionReady(adapter, "dc_posts_locales")).toBe(false);
    expect(await isCompanionReady(adapter, "dc_posts_locales")).toBe(false);
    expect(adapter.queries).toHaveLength(2);
  });

  it("does not pay for a column introspection when only readiness is asked for", async () => {
    // Telling `pre-migration` from `broken` costs a full table introspection, and callers that
    // only branch on `ready` would be paying for an answer they discard.
    const adapter = countingAdapter([]);
    await isCompanionReady(adapter, "dc_posts_locales");
    expect(adapter.queries).toEqual([
      'SELECT 1 FROM "dc_posts_locales" LIMIT 0',
    ]);
  });

  it("reports nothing remembered until something resolves it", () => {
    // What an in-transaction caller sees. Unknown must read as not-usable: guessing provisioned
    // issues the query that aborts the transaction.
    expect(cachedCompanionReadiness({}, "dc_posts_locales")).toBeUndefined();
  });

  it("forgets a verdict when the companion goes away", async () => {
    const adapter = countingAdapter(["dc_posts_locales"]);
    await resolveCompanionReadiness(adapter, {
      companionTableName: "dc_posts_locales",
      mainTableName: "dc_posts",
      localizedColumns: ["title"],
    });
    expect(cachedCompanionReadiness(adapter, "dc_posts_locales")).toBe("ready");

    forgetCompanionReadiness(adapter, "dc_posts_locales");
    expect(
      cachedCompanionReadiness(adapter, "dc_posts_locales")
    ).toBeUndefined();
  });

  it("re-verifies a verdict that has gone stale", async () => {
    // A companion is dropped by a disable migration running in its own process, which cannot reach
    // into a live server's memory. Without a bound, an old worker in a rolling deployment would
    // keep querying a table the database no longer has for as long as it lives.
    const adapter = countingAdapter(["dc_posts_locales"]);
    expect(await isCompanionReady(adapter, "dc_posts_locales")).toBe(true);
    expect(adapter.queries).toHaveLength(1);

    expireCompanionReadiness(adapter);

    // Verified again, and this time the table is gone.
    adapter.present.length = 0;
    expect(await isCompanionReady(adapter, "dc_posts_locales")).toBe(false);
    expect(adapter.queries).toHaveLength(2);
    // And the expired verdict is dropped, so a caller that can only read no longer sees it.
    expect(
      cachedCompanionReadiness(adapter, "dc_posts_locales")
    ).toBeUndefined();
  });

  it("does not let one connection vouch for another", async () => {
    // A table name does not identify a table. Two adapters mean two databases, and the first one's
    // verdict must not answer for a companion the second has never provisioned — otherwise its
    // reads and writes address a table that is not there instead of taking the fallback.
    const first = countingAdapter(["dc_posts_locales"]);
    const second = countingAdapter([]);

    expect(await isCompanionReady(first, "dc_posts_locales")).toBe(true);
    expect(await isCompanionReady(second, "dc_posts_locales")).toBe(false);
    expect(
      cachedCompanionReadiness(second, "dc_posts_locales")
    ).toBeUndefined();
    // And the second connection's miss did not disturb the first's verdict.
    expect(cachedCompanionReadiness(first, "dc_posts_locales")).toBe("ready");
  });
});

describe("companionNotReadyMessage", () => {
  const withEnv = (value: string | undefined, run: () => void) => {
    // Set NODE_ENV through Vitest's env stubbing rather than assigning
    // `process.env.NODE_ENV` directly: stubbing restores the original on
    // `unstubAllEnvs` and goes through an accessor that does not trip the
    // read-only `NODE_ENV` typing a direct assignment or `delete` runs into.
    // Passing `undefined` unsets it, covering the "NODE_ENV absent" case.
    vi.stubEnv("NODE_ENV", value);
    try {
      run();
    } finally {
      vi.unstubAllEnvs();
    }
  };

  it("names `nextly migrate` in production, where db:sync cannot help", () => {
    // Boot refuses to run DDL in production, so the development remedy is not merely unhelpful
    // there — it costs the operator the time to try it before they start looking for the answer.
    withEnv("production", () => {
      const message = companionNotReadyMessage("collection");
      expect(message).toContain("nextly migrate");
      expect(message).not.toContain("db:sync");
    });
  });

  it("names the development remedy everywhere else", () => {
    withEnv("development", () => {
      expect(companionNotReadyMessage("single")).toContain("db:sync");
    });
  });

  it("names the subject that could not be written", () => {
    withEnv("development", () => {
      expect(companionNotReadyMessage("field group")).toContain(
        "this field group"
      );
    });
  });
});
