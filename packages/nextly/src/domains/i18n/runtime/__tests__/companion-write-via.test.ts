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
    // agreeing with itself.
    expect(sql).toBe(
      'INSERT INTO "dc_posts_locales" ("_parent", "_locale", "title", "body") ' +
        "VALUES ($1, $2, $3, $4) " +
        'ON CONFLICT ("_parent", "_locale") DO UPDATE SET ' +
        '"title" = excluded."title", "body" = excluded."body"'
    );
    expect(params).toEqual(["entry-1", "fr", "Bonjour", "Salut"]);
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
    expect(execute).not.toHaveBeenCalled();
  });
});
