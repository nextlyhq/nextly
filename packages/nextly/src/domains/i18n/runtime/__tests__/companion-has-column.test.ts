/**
 * The capability probe has to tell ABSENT from UNREACHABLE.
 *
 * `companionHasColumn` answers one question — does this companion physically carry this column —
 * and every caller treats a `false` as a fact about the schema. It used to be a
 * `SELECT … LIMIT 0` inside a bare `catch`, which answered `false` for a dropped connection, a
 * permission refusal and a genuinely absent column alike.
 *
 * That collapse is silent and it corrupts data rather than failing. `restoreI18nArchive` reads
 * this to choose between clearing a locale's timestamp and omitting it: on `false` it omits, so
 * an existing locale row keeps its NEWER timestamp while its content is replaced with OLDER
 * archived material, and the translation then reads as current. Nothing surfaces, because the
 * restore reports success.
 *
 * These tests pin the discrimination itself: a column list decides presence, and anything that
 * stops the list being read propagates instead of becoming a schema claim.
 *
 * @module domains/i18n/runtime/__tests__/companion-has-column.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companionHasColumn } from "../companion-io";

const introspectLiveSnapshot = vi.fn();

vi.mock("../../../schema/pipeline/diff/introspect-live", () => ({
  get introspectLiveSnapshot() {
    return introspectLiveSnapshot;
  },
}));

/** An adapter that can introspect and nothing else — the probe needs no write surface. */
function introspectingAdapter() {
  const drizzle = { marker: "the caller's connection" };
  return {
    dialect: "postgresql" as const,
    executeQuery: vi.fn(),
    getDrizzle: <T = unknown>(): T => drizzle as T,
    drizzle,
  };
}

beforeEach(() => {
  introspectLiveSnapshot.mockReset();
});

describe("companionHasColumn", () => {
  it("reads presence from the column list, not from a statement that parses", async () => {
    const adapter = introspectingAdapter();
    introspectLiveSnapshot.mockResolvedValue({
      tables: [
        {
          name: "dc_posts_locales",
          columns: [
            { name: "_parent" },
            { name: "_locale" },
            { name: "_updated_at" },
          ],
        },
      ],
    });

    await expect(
      companionHasColumn(adapter, "dc_posts_locales", "_updated_at")
    ).resolves.toBe(true);

    // Scoped to the one table. Introspection is per-table on SQLite and an IN clause on the
    // other two, so passing the whole managed namespace would turn a single question into a
    // full-schema read on every probe.
    expect(introspectLiveSnapshot).toHaveBeenCalledWith(
      adapter.drizzle,
      "postgresql",
      ["dc_posts_locales"]
    );
  });

  it("answers false for a column the table does not carry", async () => {
    const adapter = introspectingAdapter();
    introspectLiveSnapshot.mockResolvedValue({
      tables: [
        {
          name: "dc_posts_locales",
          columns: [{ name: "_parent" }, { name: "_locale" }],
        },
      ],
    });

    await expect(
      companionHasColumn(adapter, "dc_posts_locales", "_updated_at")
    ).resolves.toBe(false);
  });

  it("answers false for a companion that is not there at all", async () => {
    const adapter = introspectingAdapter();
    // Introspection scoped to a table that does not exist simply returns no table for it. That
    // is the same answer the replaced probe gave by failing its statement on the missing
    // relation, so callers that already tolerate a missing companion are unaffected.
    introspectLiveSnapshot.mockResolvedValue({ tables: [] });

    await expect(
      companionHasColumn(adapter, "dc_posts_locales", "_updated_at")
    ).resolves.toBe(false);
  });

  it("does not name another table's columns as its own", async () => {
    const adapter = introspectingAdapter();
    // A snapshot can carry more tables than were asked for. Matching on the name rather than
    // taking the first entry is what keeps a sibling companion from answering for this one.
    introspectLiveSnapshot.mockResolvedValue({
      tables: [
        {
          name: "dc_pages_locales",
          columns: [{ name: "_updated_at" }],
        },
        {
          name: "dc_posts_locales",
          columns: [{ name: "_parent" }],
        },
      ],
    });

    await expect(
      companionHasColumn(adapter, "dc_posts_locales", "_updated_at")
    ).resolves.toBe(false);
  });

  it("🔴 propagates a failure to READ the shape instead of reporting the column absent", async () => {
    const adapter = introspectingAdapter();
    const unreachable = new Error("connection terminated unexpectedly");
    introspectLiveSnapshot.mockRejectedValue(unreachable);

    // The whole point. A resolved `false` here is indistinguishable, to every caller, from a
    // companion that predates the column -- and the archive replay acts on that difference by
    // preserving a newer timestamp over older restored content. A transient failure must not be
    // able to author that decision, so it has to reach the caller as a failure.
    await expect(
      companionHasColumn(adapter, "dc_posts_locales", "_updated_at")
    ).rejects.toThrow(unreachable);
  });

  it("🔴 propagates a permission refusal, which reads exactly like an absent column", async () => {
    const adapter = introspectingAdapter();
    // A role that may write the companion but not read the catalog is the case a `catch` gets
    // most confidently wrong: nothing is broken, every write succeeds, and the probe quietly
    // reports every column of every companion as missing.
    introspectLiveSnapshot.mockRejectedValue(
      new Error("permission denied for table columns")
    );

    await expect(
      companionHasColumn(adapter, "dc_posts_locales", "_updated_at")
    ).rejects.toThrow(/permission denied/);
  });
});
