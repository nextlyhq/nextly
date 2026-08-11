/**
 * What the Builder's shared migration runner tolerates, and what it must still refuse.
 *
 * The tolerance exists because re-running a half-applied migration is the repair path, and on MySQL
 * it was impossible: `CREATE INDEX` has no `IF NOT EXISTS`, so the second run reported a schema that
 * was in fact correct as a failed migration and the retry failed identically every time.
 *
 * The refusal matters at least as much. `Duplicate entry ... for key` is MySQL's runtime DATA
 * conflict, not a DDL artefact — swallowing it would let a rebuild's copy fail silently and the
 * following drop destroy the rows that never copied. Both directions are asserted here because a
 * tolerance is only safe if its edge is.
 */
import { describe, expect, it, vi } from "vitest";

import { applyMigrationStatements } from "../apply-migration-statements";

/** Records what it was asked to run, and fails on whichever statements are named. */
function runner(failures: Record<string, Error> = {}) {
  const executed: string[] = [];
  return {
    executed,
    executeQuery: vi.fn(async (sql: string) => {
      executed.push(sql);
      const failure = failures[sql];
      if (failure) throw failure;
      return [];
    }),
  };
}

const TWO_STATEMENTS = [
  "CREATE TABLE `single_page` (`id` varchar(36) NOT NULL)",
  "--> statement-breakpoint",
  "CREATE INDEX `idx_single_page_created_at` ON `single_page` (`created_at`)",
].join("\n");

describe("applyMigrationStatements", () => {
  it("runs each statement the migration declares", async () => {
    const adapter = runner();

    await applyMigrationStatements(adapter, TWO_STATEMENTS);

    expect(adapter.executed).toEqual([
      "CREATE TABLE `single_page` (`id` varchar(36) NOT NULL)",
      "CREATE INDEX `idx_single_page_created_at` ON `single_page` (`created_at`)",
    ]);
  });

  /**
   * The MySQL repair case, in the exact wording the driver produces. PostgreSQL and SQLite never
   * reach here because they emit `IF NOT EXISTS` for indexes; MySQL cannot, so without this a
   * create that stopped half way could never be finished.
   */
  it("tolerates an index MySQL says is already there, and keeps going", async () => {
    const index =
      "CREATE INDEX `idx_single_page_created_at` ON `single_page` (`created_at`)";
    const adapter = runner({
      [index]: new Error("Duplicate key name 'idx_single_page_created_at'"),
    });

    // The count includes the tolerated statement: it was dispatched, and a caller asking "did
    // anything reach the database" is owed a yes. Asserting the number rather than merely that it
    // resolves is what makes "keeps going" observable from the return value as well as the log.
    await expect(
      applyMigrationStatements(
        adapter,
        `${index}\n--> statement-breakpoint\nSELECT 1`
      )
    ).resolves.toBe(2);

    // The statement AFTER the tolerated one still ran: tolerating must not abandon the migration.
    expect(adapter.executed).toContain("SELECT 1");
  });

  it("tolerates a table that already exists", async () => {
    const create = "CREATE TABLE `single_page` (`id` varchar(36) NOT NULL)";
    const adapter = runner({
      [create]: new Error("Table 'single_page' already exists"),
    });

    await expect(applyMigrationStatements(adapter, create)).resolves.toBe(1);
  });

  it("counts no statements for a diff that rendered only a comment", async () => {
    // 🔴 What the count exists for. A diff with no operations still renders a header comment, so
    // the SQL string is non-empty while nothing runs — and a caller that inferred "something
    // happened" from the string would claim a schema it never touched. `SingleMetadataService`
    // asks this before deciding it may clear a durable `failed` verdict.
    const adapter = runner({});

    await expect(
      applyMigrationStatements(
        adapter,
        "-- Update dynamic collection: single_page"
      )
    ).resolves.toBe(0);
    expect(adapter.executed).toEqual([]);
  });

  /**
   * 🔴 The edge that makes the tolerance safe. This is a row conflict from an INSERT..SELECT during
   * a table rebuild, and its wording is one word away from the index case above. Swallowed, the
   * rebuild's copy fails silently and the drop that follows destroys the rows that did not copy.
   */
  it("still fails on a duplicate ROW, which is data loss rather than a re-run", async () => {
    const copy = "INSERT INTO `single_page__new` SELECT * FROM `single_page`";
    const adapter = runner({
      [copy]: new Error("Duplicate entry 'abc' for key 'single_page.PRIMARY'"),
    });

    await expect(applyMigrationStatements(adapter, copy)).rejects.toThrow(
      /Duplicate entry/
    );
  });

  it("still fails on an ordinary broken statement", async () => {
    const broken = "CREATE TABLE `single_page` (`id` NOT A TYPE)";
    const adapter = runner({
      [broken]: new Error("You have an error in your SQL syntax"),
    });

    await expect(applyMigrationStatements(adapter, broken)).rejects.toThrow(
      /SQL syntax/
    );
  });
});
