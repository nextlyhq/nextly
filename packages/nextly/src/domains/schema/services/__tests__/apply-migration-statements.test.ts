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

import {
  applyMigrationStatements,
  applyMigrationWhole,
} from "../apply-migration-statements";

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

    await expect(
      applyMigrationStatements(
        adapter,
        `${index}\n--> statement-breakpoint\nSELECT 1`
      )
    ).resolves.toBeUndefined();

    // The statement AFTER the tolerated one still ran: tolerating must not abandon the migration.
    expect(adapter.executed).toContain("SELECT 1");
  });

  it("tolerates a table that already exists", async () => {
    const create = "CREATE TABLE `single_page` (`id` varchar(36) NOT NULL)";
    const adapter = runner({
      [create]: new Error("Table 'single_page' already exists"),
    });

    await expect(
      applyMigrationStatements(adapter, create)
    ).resolves.toBeUndefined();
  });

  it("runs nothing for a diff that rendered only a comment", async () => {
    // A diff with no operations still renders a header comment, so a non-empty SQL string is not
    // a non-empty migration. Worth pinning because that asymmetry is what makes "the SQL is not
    // empty" the wrong way to ask whether anything reached the database — a guard written that way
    // never fires, and reads as though it does.
    const adapter = runner({});

    await expect(
      applyMigrationStatements(
        adapter,
        "-- Update dynamic collection: single_page"
      )
    ).resolves.toBeUndefined();
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

/**
 * A rename the database refuses because its target exists is a rename that could not be made. Both
 * runners pass over "Duplicate column name" for a column an earlier run already ADDED, and must
 * never do so for a RENAME: that recorded a rename while the values stayed in the old column.
 */
describe("a rename whose target already exists", () => {
  const duplicateColumn = () => new Error("Duplicate column name 'headline'");
  const RENAME =
    "ALTER TABLE `single_hero` RENAME COLUMN `heading` TO `headline`";
  const ADD = "ALTER TABLE `single_hero` ADD COLUMN `headline` text";

  it("fails applyMigrationStatements", async () => {
    const adapter = runner({ [RENAME]: duplicateColumn() });
    await expect(applyMigrationStatements(adapter, RENAME)).rejects.toThrow(
      /Duplicate column name/
    );
  });

  // The control: the same refusal for an ADD is still the re-run it always was.
  it("is not confused with an ADD an earlier run made, which applyMigrationStatements still passes over", async () => {
    const adapter = runner({ [ADD]: duplicateColumn() });
    await expect(
      applyMigrationStatements(adapter, ADD)
    ).resolves.toBeUndefined();
  });

  /** A MySQL database whose every statement is refused as a duplicate column. */
  function mysqlRefusingEach() {
    return {
      execute: vi.fn(async () => {
        throw duplicateColumn();
      }),
    };
  }

  it("fails applyMigrationWhole on MySQL, even where it passes over what an earlier run applied", async () => {
    const db = mysqlRefusingEach();
    await expect(
      applyMigrationWhole({
        db: db as never,
        dialect: "mysql",
        migrationSQL: `${RENAME};`,
        entity: "single",
        tolerateApplied: true,
      })
    ).rejects.toBeDefined();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("is not confused with an ADD, which applyMigrationWhole still passes over on MySQL", async () => {
    const db = mysqlRefusingEach();
    await expect(
      applyMigrationWhole({
        db: db as never,
        dialect: "mysql",
        migrationSQL: `${ADD};`,
        entity: "single",
        tolerateApplied: true,
      })
    ).resolves.toBeUndefined();
  });
});
