/**
 * Remembering that a companion HAS a column, and deliberately not remembering that it has not.
 *
 * The staleness read names `_updated_at` in SQL, and naming a column a companion does not carry
 * fails the whole query for that collection. So the read is gated on a physical check — and that
 * check runs often enough that it has to be cached, which makes WHICH answers are cached the
 * entire design.
 *
 * `true` is safe to remember: the reconcile is additive by policy, and a field that stops being
 * localized keeps its column rather than dropping it, so nothing ordinary takes a column away.
 * `false` is not safe to remember: `nextly migrate` runs in a different process, so a negative
 * verdict outlives the migration that made it wrong — and the symptom is the feature quietly
 * staying off for that collection, which nobody sees, rather than an error anyone reports.
 *
 * @module domains/i18n/runtime/__tests__/companion-column-verdict.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cachedCompanionColumn,
  expireCompanionReadiness,
  forgetCompanionReadiness,
  resolveCompanionColumn,
} from "../companion-readiness";

const introspectLiveSnapshot = vi.fn();

vi.mock("../../../schema/pipeline/diff/introspect-live", () => ({
  get introspectLiveSnapshot() {
    return introspectLiveSnapshot;
  },
}));

/** A fresh adapter per test, so one test's verdicts can never answer another's question. */
function adapterWith(columnsByTable: Record<string, string[]>) {
  const drizzle = {};
  introspectLiveSnapshot.mockImplementation(
    (_db: unknown, _dialect: string, tables: string[]) => {
      const name = tables[0];
      const columns = columnsByTable[name];
      if (!columns) return Promise.resolve({ tables: [] });
      return Promise.resolve({
        tables: [{ name, columns: columns.map(c => ({ name: c })) }],
      });
    }
  );
  return {
    dialect: "postgresql" as const,
    executeQuery: vi.fn(),
    getDrizzle: <T = unknown>(): T => drizzle as T,
  };
}

// Reset here rather than in each test: a call count is the property under test in most of them,
// and a case that forgot its own reset would inherit the previous one's calls and pass or fail
// for a reason that has nothing to do with what it names.
beforeEach(() => {
  introspectLiveSnapshot.mockReset();
});

describe("companion column verdicts", () => {
  it("introspects once for a column that is there, then answers from memory", async () => {
    const adapter = adapterWith({
      dc_posts_locales: ["_parent", "_locale", "_updated_at"],
    });

    expect(
      await resolveCompanionColumn(adapter, "dc_posts_locales", "_updated_at")
    ).toBe(true);
    expect(introspectLiveSnapshot).toHaveBeenCalledTimes(1);

    // The reason the cache exists. Without it every read that wants staleness pays a catalogue
    // query per collection, which is the cost `companion-readiness` was written to remove.
    expect(
      await resolveCompanionColumn(adapter, "dc_posts_locales", "_updated_at")
    ).toBe(true);
    expect(
      await resolveCompanionColumn(adapter, "dc_posts_locales", "_updated_at")
    ).toBe(true);
    expect(introspectLiveSnapshot).toHaveBeenCalledTimes(1);
  });

  it("🔴 keeps asking while the column is absent, so a migration is picked up", async () => {
    const adapter = adapterWith({ dc_posts_locales: ["_parent", "_locale"] });

    expect(
      await resolveCompanionColumn(adapter, "dc_posts_locales", "_updated_at")
    ).toBe(false);
    expect(
      await resolveCompanionColumn(adapter, "dc_posts_locales", "_updated_at")
    ).toBe(false);
    // 🔴 Two calls, two queries. Remembering `false` would keep the staleness read switched off
    // for this collection until the process reloaded, even after `nextly migrate` added the
    // column in another process — and a feature that silently stays off has no symptom anyone
    // reports.
    expect(introspectLiveSnapshot).toHaveBeenCalledTimes(2);
  });

  it("sees the column the moment a migration adds it", async () => {
    const columns: Record<string, string[]> = {
      dc_posts_locales: ["_parent", "_locale"],
    };
    const adapter = adapterWith(columns);

    expect(
      await resolveCompanionColumn(adapter, "dc_posts_locales", "_updated_at")
    ).toBe(false);
    // Another process runs the migration.
    columns.dc_posts_locales = ["_parent", "_locale", "_updated_at"];
    expect(
      await resolveCompanionColumn(adapter, "dc_posts_locales", "_updated_at")
    ).toBe(true);
  });

  it("🔴 propagates a failure instead of recording the column as absent", async () => {
    const adapter = adapterWith({});
    introspectLiveSnapshot.mockRejectedValue(
      new Error("connection terminated unexpectedly")
    );

    // A resolved `false` here would be a claim about the schema made from a transient fault, and
    // the caller cannot tell it from a companion that genuinely predates the column.
    await expect(
      resolveCompanionColumn(adapter, "dc_posts_locales", "_updated_at")
    ).rejects.toThrow(/connection terminated/);
  });

  it("answers UNKNOWN rather than false when nothing has been resolved", async () => {
    const adapter = adapterWith({});
    // The in-transaction form. `undefined` is not "absent" — it is "nobody has looked", and a
    // caller that cannot look must omit whatever names the column rather than assume either way.
    expect(
      cachedCompanionColumn(adapter, "dc_posts_locales", "_updated_at")
    ).toBeUndefined();
    expect(introspectLiveSnapshot).not.toHaveBeenCalled();
  });

  it("forgets a companion's columns when the companion itself is forgotten", async () => {
    const adapter = adapterWith({
      dc_posts_locales: ["_parent", "_locale", "_updated_at"],
      dc_pages_locales: ["_parent", "_locale", "_updated_at"],
    });
    await resolveCompanionColumn(adapter, "dc_posts_locales", "_updated_at");
    await resolveCompanionColumn(adapter, "dc_pages_locales", "_updated_at");

    forgetCompanionReadiness(adapter, "dc_posts_locales");

    // 🔴 A replaced companion must not inherit the shape of the one it replaced. Dropping the
    // table verdict while keeping its column verdicts would leave exactly that claim standing.
    expect(
      cachedCompanionColumn(adapter, "dc_posts_locales", "_updated_at")
    ).toBeUndefined();
    // Scoped to the one companion, not the connection.
    expect(
      cachedCompanionColumn(adapter, "dc_pages_locales", "_updated_at")
    ).toBe(true);
  });

  it("does not let one connection vouch for another's schema", async () => {
    const first = adapterWith({
      dc_posts_locales: ["_parent", "_locale", "_updated_at"],
    });
    await resolveCompanionColumn(first, "dc_posts_locales", "_updated_at");

    // A second database, a test harness booting a fresh adapter, an instance replaced on reload:
    // `dc_posts_locales` in each is a different table, and a verdict shared between them lets the
    // first vouch for a companion the second has never migrated.
    const second = adapterWith({
      dc_posts_locales: ["_parent", "_locale", "_updated_at"],
    });
    expect(
      cachedCompanionColumn(second, "dc_posts_locales", "_updated_at")
    ).toBeUndefined();
  });

  it("re-verifies after the test seam expires a verdict", async () => {
    const adapter = adapterWith({
      dc_posts_locales: ["_parent", "_locale", "_updated_at"],
    });
    await resolveCompanionColumn(adapter, "dc_posts_locales", "_updated_at");
    expect(introspectLiveSnapshot).toHaveBeenCalledTimes(1);

    expireCompanionReadiness(adapter);

    expect(
      cachedCompanionColumn(adapter, "dc_posts_locales", "_updated_at")
    ).toBeUndefined();
    await resolveCompanionColumn(adapter, "dc_posts_locales", "_updated_at");
    expect(introspectLiveSnapshot).toHaveBeenCalledTimes(2);
  });
});
