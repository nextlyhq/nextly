/**
 * The seam that let one companion upsert replace two.
 *
 * `collection-mutation-service.ts` carried its own private `upsertCompanionRow`
 * for one reason: it holds a transaction, and the shared helper took an
 * adapter. The two implementations built byte-identical SQL and drifted only in
 * where they read the dialect from. A second copy of an INSERT is not a style
 * problem here — i18n B2 adds an `_updated_at` column to this row, and a column
 * written by one copy and not the other leaves those locales permanently
 * unstamped, which makes a stale translation read as fresh. That failure is
 * silent, so the duplication had to go before the column arrives.
 *
 * These tests pin what the seam has to preserve for that replacement to be
 * safe: the transaction's own connection is used, the caller's dialect decides
 * the placeholder syntax, and the emitted statement is the one the deleted copy
 * emitted.
 *
 * @module domains/i18n/runtime/__tests__/companion-write-via.test
 */
import { describe, expect, it, vi } from "vitest";

import { companionWriteVia, upsertCompanionRow } from "../companion-io";

/** A transaction double that records the raw SQL it is handed. */
function txSpy() {
  const execute = vi.fn().mockResolvedValue([]);
  return { execute, tx: { execute } };
}

describe("companionWriteVia", () => {
  it("writes on the TRANSACTION's connection, never a pooled one", async () => {
    const { execute, tx } = txSpy();

    await upsertCompanionRow(
      companionWriteVia(tx, "postgresql"),
      "dc_posts_locales",
      "entry-1",
      "fr",
      { title: "Bonjour" }
    );

    // The whole point of the seam. A companion write that reached a pooled
    // connection would sit outside the caller's transaction: it would survive a
    // rollback of the main-table write it belongs to, leaving a translation for
    // a revision that never landed.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("takes its dialect from the caller, since a transaction carries none", async () => {
    const pg = txSpy();
    await upsertCompanionRow(
      companionWriteVia(pg.tx, "postgresql"),
      "dc_posts_locales",
      "entry-1",
      "fr",
      { title: "Bonjour" }
    );
    const sqlite = txSpy();
    await upsertCompanionRow(
      companionWriteVia(sqlite.tx, "sqlite"),
      "dc_posts_locales",
      "entry-1",
      "fr",
      { title: "Bonjour" }
    );

    // Placeholder syntax is dialect-specific and is the observable proof the
    // dialect was threaded rather than defaulted: Postgres numbers them,
    // everything else uses `?`. A default would silently produce a statement
    // the driver rejects on two of the three dialects.
    expect(pg.execute.mock.calls[0][0]).toContain("$1");
    expect(sqlite.execute.mock.calls[0][0]).not.toContain("$1");
    expect(sqlite.execute.mock.calls[0][0]).toContain("?");
  });

  it("emits the statement the deleted private copy emitted", async () => {
    const { execute, tx } = txSpy();

    await upsertCompanionRow(
      companionWriteVia(tx, "postgresql"),
      "dc_posts_locales",
      "entry-1",
      "fr",
      { title: "Bonjour", body: "Salut" }
    );

    const [sql, params] = execute.mock.calls[0];
    // Transcribed from the implementation this replaced, so the assertion is
    // about equivalence with the deleted code and not merely about the survivor
    // agreeing with itself -- plus exactly one deliberate addition, the B2
    // stamp this convergence existed to make possible. Spelled out in full
    // rather than matched loosely, because "the same statement, plus one named
    // column" is the whole claim; a `toContain` would pass for a statement that
    // had also quietly lost a translated column.
    expect(sql).toBe(
      'INSERT INTO "dc_posts_locales" ' +
        '("_parent", "_locale", "title", "body", "_updated_at") ' +
        "VALUES ($1, $2, $3, $4, $5) " +
        'ON CONFLICT ("_parent", "_locale") DO UPDATE SET ' +
        '"title" = excluded."title", "body" = excluded."body", ' +
        '"_updated_at" = excluded."_updated_at"'
    );
    // 🔴 `_updated_at` must appear in the DO UPDATE SET as well as the INSERT,
    // and the two are separate failures. Present in the INSERT alone, a FIRST
    // write to a locale is stamped and every subsequent one leaves the original
    // timestamp standing -- so a translation updated after its source moved
    // keeps reading as stale forever, and re-saving it never clears the
    // warning. That is the reassuring-looking direction of a nagging feature:
    // the warning that will not go away is the one people learn to ignore.
    expect(sql).toContain('"_updated_at" = excluded."_updated_at"');

    expect(params.slice(0, 4)).toEqual(["entry-1", "fr", "Bonjour", "Salut"]);
    // 🔴 ENCODED the way Drizzle would encode it, not handed to the driver raw.
    // A `Date` bound straight to a driver writes the LOCAL wall clock into a
    // column that records no time zone, while everything Drizzle writes is UTC
    // -- and this comparison reads both bases, because the back-fill seeds from
    // Drizzle-written version rows. On PostgreSQL that encoding is an ISO
    // string, so asserting `instanceof Date` would pass on exactly the value
    // this must not bind.
    expect(typeof params[4]).toBe("string");
    expect(new Date(params[4] as string).getTime()).toBeGreaterThan(0);
  });

  it("stamps `_updated_at` on the transaction path, not only the adapter one", async () => {
    // 🔴 The regression this pins is the entire reason the convergence came
    // first. `upsertCompanionRow` runs over TWO surfaces -- a real adapter's
    // `executeQuery`, and a transaction's `execute` through `companionWriteVia`
    // -- and the collection write path, which is the main one, is the
    // transaction. A stamp reaching only the adapter surface would leave every
    // locale written through a collection save permanently unstamped, reading
    // as UNKNOWN, and therefore never reported stale. Nobody notices a warning
    // that never fires, so this failure has no symptom to find it by.
    const { execute, tx } = txSpy();

    await upsertCompanionRow(
      companionWriteVia(tx, "sqlite"),
      "dc_posts_locales",
      "entry-1",
      "fr",
      { title: "Bonjour" }
    );

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain('"_updated_at"');
    // SQLite's encoding is epoch SECONDS, which is what its INTEGER column
    // stores. A different unit here orders correctly against itself and wrongly
    // against anything the back-fill seeded.
    expect(typeof params.at(-1)).toBe("number");
  });

  it("uses the injected clock, so the stamp is a value and not a coincidence", async () => {
    const { execute, tx } = txSpy();
    const now = new Date("2026-08-28T09:15:00.000Z");

    await upsertCompanionRow(
      companionWriteVia(tx, "postgresql"),
      "dc_posts_locales",
      "entry-1",
      "fr",
      { title: "Bonjour" },
      undefined,
      { now }
    );

    // Asserting the VALUE, not merely that something arrived. An implementation
    // that stamped a fixed instant, or the wrong one of two clocks in scope,
    // satisfies a shape assertion perfectly. Compared through the encoded form,
    // since that is what actually reaches the column.
    expect(execute.mock.calls[0][1].at(-1)).toBe(now.toISOString());
  });

  it("omits the stamp for a companion that physically predates the column", async () => {
    const { execute, tx } = txSpy();

    await upsertCompanionRow(
      companionWriteVia(tx, "postgresql"),
      "dc_posts_locales",
      "entry-1",
      "fr",
      { title: "Bonjour" },
      undefined,
      { updatedAt: "omit" }
    );

    // Naming a column the table does not have fails the whole statement, so the
    // opt-out is what keeps a write working against a companion the reconcile
    // has not reached yet. The translation still saves; only its staleness
    // stays unknown, which is what a NULL already means.
    expect(execute.mock.calls[0][0]).not.toContain("_updated_at");
  });

  it("quotes with backticks and uses MySQL's upsert clause", async () => {
    const { execute, tx } = txSpy();

    await upsertCompanionRow(
      companionWriteVia(tx, "mysql"),
      "dc_posts_locales",
      "entry-1",
      "fr",
      { title: "Bonjour" }
    );

    const [sql] = execute.mock.calls[0];
    expect(sql).toContain("`dc_posts_locales`");
    expect(sql).toContain("ON DUPLICATE KEY UPDATE `title` = VALUES(`title`)");
    expect(sql).not.toContain("ON CONFLICT");
  });

  it("writes nothing at all when there are no columns", async () => {
    const { execute, tx } = txSpy();

    await upsertCompanionRow(
      companionWriteVia(tx, "postgresql"),
      "dc_posts_locales",
      "entry-1",
      "fr",
      {}
    );

    // Not merely "no error": an INSERT naming only `_parent` and `_locale`
    // would create an empty companion row, and an empty row is not nothing --
    // it is a row that reads as "this locale exists" to every join.
    //
    // 🔴 The B2 stamp made this load-bearing a second way. `_updated_at` is
    // added to the column set, so counting the columns AFTER stamping would
    // make every no-op call a real write -- and because staleness is
    // `source._updated_at > target._updated_at`, moving the source's timestamp
    // with no content change would mark every other locale of that document
    // stale against an edit nobody made. The emptiness check has to run on the
    // caller's columns, before the stamp joins them.
    expect(execute).not.toHaveBeenCalled();
  });
});
