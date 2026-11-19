/**
 * A collection update (`updateCollection`) in development applies its change with the schema push,
 * which commits on its own transaction, then records the save's migration files applied in the
 * ledger. The collection's registry row is written in that same recording transaction, after the
 * ledger rows, so the two commit or roll back together.
 *
 * Where the registry write fails, the ledger rows go back with it and the files are kept, recorded
 * applied nowhere. The pushed change stays in the database, so the update answers that it failed
 * part way, naming the kept file and the steps that finish it, and never that it was applied.
 *
 * A collection service with no Builder save writer (`setBuilderSave` never called) pushes the change
 * and writes the file itself. If the table is then not found, it answers that the update failed and
 * writes no registry row, rather than storing the requested fields as failed under an answer that
 * the update went through. The app's registration always sets the writer, and with it the save is
 * refused before this point when the table does not stand as the file says (`verifiedUnits`).
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";
import { SchemaEventsRepository } from "../../../schema/events/schema-events-repository";
import { writeRegistryRows } from "../../../schema/schema-version";

const HISTORY = "./database/history";
const DEFINITION = "./schema/builder.json";
const SLUG = "cur_posts";
const TABLE = `dc_${SLUG}`;
const BEFORE = [{ name: "heading", type: "text" }];
const AFTER = [...BEFORE, { name: "extra", type: "text" }];

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
  vi.unstubAllEnvs();
});

/** End the instance under test, for a case that boots more than one. */
async function shutDown(): Promise<void> {
  const instance = current;
  current = undefined;
  await instance?.destroy();
}

describeEachDialect("a collection update's registry write", dialect => {
  /** Boot in development with the Builder save writer set up, and create the collection. */
  async function boot(): Promise<TestNextly> {
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({
      dialect: dialect as TestDialect,
      db: { migrationsDir: HISTORY, uiSchemaFile: DEFINITION },
    });
    await dispatchCollections(
      {} as ServiceContainer,
      "createCollection",
      {},
      { name: SLUG, label: SLUG, fields: BEFORE }
    );
    clearRegistryRowCache();
    return current;
  }

  /** An update (by default the one adding `extra`), as what it threw or what it answered. */
  async function update(
    body: Record<string, unknown> = { fields: AFTER }
  ): Promise<{ failed: boolean; said: string }> {
    try {
      const answer = await dispatchCollections(
        {} as ServiceContainer,
        "updateCollection",
        { collectionName: SLUG },
        body
      );
      const said =
        answer instanceof Response
          ? JSON.stringify(await answer.json())
          : JSON.stringify(answer);
      return {
        failed: answer instanceof Response && answer.status >= 400,
        said,
      };
    } catch (error) {
      return {
        failed: true,
        said: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** The migration files in the folder, sorted. */
  function migrationFiles(t: TestNextly): string[] {
    const dir = join(t.basePath, HISTORY);
    if (!existsSync(dir)) return [];
    const found: string[] = [];
    const walk = (at: string) => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const path = join(at, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".sql")) found.push(path);
      }
    };
    walk(dir);
    return found.sort();
  }

  /** The files the ledger records applied. */
  async function appliedFiles(t: TestNextly): Promise<string[]> {
    const repo = new SchemaEventsRepository(
      t.adapter.getDrizzle() as never,
      t.adapter.dialect
    );
    return (await repo.listFileApplies())
      .filter(row => row.status === "applied")
      .map(row => String(row.filename))
      .sort();
  }

  /** The registry row's fields, schema version and migration status, as stored. */
  async function recorded(t: TestNextly) {
    clearRegistryRowCache();
    const [row] = await t.adapter.select<Record<string, unknown>>(
      "dynamic_collections",
      {
        columns: ["fields", "schemaVersion", "migrationStatus"],
        where: { and: [{ column: "slug", op: "=", value: SLUG }] },
      }
    );
    const fields =
      typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields;
    return {
      fields: (fields as { name: string }[] | undefined)?.map(f => f.name),
      schemaVersion: Number(row?.schemaVersion),
      migrationStatus: row?.migrationStatus,
    };
  }

  async function columnsOf(t: TestNextly): Promise<string[]> {
    const rows = await t.adapter.executeQuery<{ name: string }>(
      dialect === "sqlite"
        ? `SELECT name FROM pragma_table_info('${TABLE}')`
        : dialect === "mysql"
          ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${TABLE}'`
          : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${TABLE}'`
    );
    return rows.map(row => String(row.name));
  }

  /**
   * A trigger counting the updates of the collection's registry row, refusing the `failAt`-th (none
   * for 0). A refused write rolls its count back with it. Returns how many it counted.
   */
  async function countingTrigger(
    t: TestNextly,
    failAt: number
  ): Promise<() => Promise<number>> {
    const run = (sql: string) => t.adapter.executeQuery(sql);
    await run("CREATE TABLE cur_count (n INTEGER NOT NULL)");
    await run("INSERT INTO cur_count (n) VALUES (0)");
    const refusal = "injected failure of a registry write";
    if (dialect === "postgresql") {
      await run(
        `CREATE FUNCTION cur_count_write() RETURNS trigger AS $$ BEGIN UPDATE cur_count SET n = n + 1; IF (SELECT n FROM cur_count) = ${String(failAt)} THEN RAISE EXCEPTION '${refusal}'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`
      );
      await run(
        `CREATE TRIGGER cur_registry BEFORE UPDATE ON dynamic_collections FOR EACH ROW WHEN (OLD.slug = '${SLUG}') EXECUTE FUNCTION cur_count_write()`
      );
    } else if (dialect === "mysql") {
      await run(
        `CREATE TRIGGER cur_registry BEFORE UPDATE ON dynamic_collections FOR EACH ROW BEGIN IF OLD.slug = '${SLUG}' THEN UPDATE cur_count SET n = n + 1; IF (SELECT n FROM cur_count) = ${String(failAt)} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${refusal}'; END IF; END IF; END`
      );
    } else {
      await run(
        `CREATE TRIGGER cur_registry BEFORE UPDATE ON dynamic_collections WHEN OLD.slug = '${SLUG}' BEGIN UPDATE cur_count SET n = n + 1; SELECT RAISE(ABORT, '${refusal}') WHERE (SELECT n FROM cur_count) = ${String(failAt)}; END`
      );
    }
    return async () =>
      Number(
        (
          await t.adapter.executeQuery<{ n: unknown }>(
            "SELECT n FROM cur_count"
          )
        )[0]?.n ?? Number.NaN
      );
  }

  it("records the files and the row together when nothing fails", async () => {
    const t = await boot();
    const before = await recorded(t);
    const filesBefore = migrationFiles(t);

    const { failed, said } = await update();

    expect(failed, `the update failed: ${said}`).toBe(false);
    const written = migrationFiles(t).filter(f => !filesBefore.includes(f));
    expect(written.length, "the update's files").toBeGreaterThan(0);
    const applied = await appliedFiles(t);
    for (const file of written) {
      expect(
        applied.some(name => file.endsWith(name)),
        `${file} recorded applied`
      ).toBe(true);
    }
    expect(await recorded(t)).toEqual({
      fields: ["heading", "extra"],
      // An update through this path leaves the version the Builder's apply checks as it was.
      schemaVersion: before.schemaVersion,
      migrationStatus: "applied",
    });
    expect(await columnsOf(t)).toContain("extra");
  });

  it("answers that it failed part way, its files kept and recorded nowhere, when the registry write fails", async () => {
    // Counted first, on an update without a failure: the last is the write after the push.
    let writes: number;
    {
      const t = await boot();
      const counted = await countingTrigger(t, 0);
      const { failed, said } = await update();
      expect(failed, `the counting update failed: ${said}`).toBe(false);
      writes = await counted();
      await shutDown();
    }
    // Control: the trigger reaches the update's registry writes.
    expect(
      writes,
      "no registry write of the update was counted"
    ).toBeGreaterThan(0);

    const t = await boot();
    const before = await recorded(t);
    const filesBefore = migrationFiles(t);
    const appliedBefore = await appliedFiles(t);
    await countingTrigger(t, writes);

    const { failed, said } = await update();

    expect(failed, `the update answered: ${said}`).toBe(true);
    expect(said, "the answer").not.toContain("Collection updated");
    expect(said, "the answer").not.toContain("applied successfully");
    // The kept file's steps: the change is in the database, its file recorded nowhere.
    expect(said, "the answer").toContain("migrate:resolve --applied");
    const kept = migrationFiles(t).filter(f => !filesBefore.includes(f));
    expect(kept.length, "the update's files are kept").toBeGreaterThan(0);
    expect(await appliedFiles(t), "the ledger").toEqual(appliedBefore);
    expect(await recorded(t), "the registry row").toEqual(before);
    // The push committed on its own transaction: the change is in the table.
    expect(await columnsOf(t), "the table").toContain("extra");
  });

  it("answers failed and writes no row when the table is not found after the change, with no save writer", async () => {
    const t = await boot();
    const before = await recorded(t);
    // The update's service without the Builder save writer, as one built outside the app's
    // registration.
    const handler = t.getService("collectionsHandler");
    const metadata: unknown = Reflect.get(handler as object, "metadataService");
    expect(metadata, "the metadata service").toBeDefined();
    Reflect.set(metadata as object, "builderSave", undefined);
    // The table goes missing only once the change has run and its file is saved, so the push itself
    // reads the table as it is.
    const fileManager = Reflect.get(metadata as object, "fileManager") as {
      saveMigration: (...args: unknown[]) => Promise<unknown>;
    };
    let saved = false;
    const saveMigration = fileManager.saveMigration.bind(fileManager);
    vi.spyOn(fileManager, "saveMigration").mockImplementation(
      async (...args: unknown[]) => {
        const done = await saveMigration(...args);
        saved = true;
        return done;
      }
    );
    let askedAfter = 0;
    const tableExists = t.adapter.tableExists.bind(t.adapter);
    vi.spyOn(t.adapter, "tableExists").mockImplementation(
      async (name: string) => {
        if (saved && name === TABLE) {
          askedAfter += 1;
          return false;
        }
        return tableExists(name);
      }
    );

    const { failed, said } = await update();

    // Control: the check after the change was reached.
    expect(
      askedAfter,
      "the table was looked for after the change"
    ).toBeGreaterThan(0);
    expect(failed, `the update answered: ${said}`).toBe(true);
    // The table's name stays in the log: the answer says which collection, never its storage.
    expect(said, "the answer").toBe(
      "The collection's table was not found after the schema change, so its record was left as it was."
    );
    expect(await recorded(t), "the registry row").toEqual(before);
  });

  it("answers failed with nothing kept when a settings-only update's registry write fails", async () => {
    const SETTINGS = { label: "Posts renamed" };
    // Counted first, on an update without a failure: the last is the save's own write.
    let writes: number;
    {
      const t = await boot();
      const counted = await countingTrigger(t, 0);
      const filesBefore = migrationFiles(t);
      const { failed, said } = await update(SETTINGS);
      expect(failed, `the counting update failed: ${said}`).toBe(false);
      // Control: the update writes a file, which a failure must then withdraw.
      expect(
        migrationFiles(t).length,
        "the settings-only update's file"
      ).toBeGreaterThan(filesBefore.length);
      writes = await counted();
      await shutDown();
    }
    // Control: the trigger reaches the update's registry writes.
    expect(
      writes,
      "no registry write of the update was counted"
    ).toBeGreaterThan(0);

    const t = await boot();
    const before = await recorded(t);
    const filesBefore = migrationFiles(t);
    const appliedBefore = await appliedFiles(t);
    await countingTrigger(t, writes);

    const { failed, said } = await update(SETTINGS);

    expect(failed, `the update answered: ${said}`).toBe(true);
    // Nothing was pushed, so nothing is left part way: no kept file, no steps to finish it.
    expect(said, "the answer").not.toContain("migrate:resolve");
    expect(migrationFiles(t), "the migrations folder").toEqual(filesBefore);
    expect(await appliedFiles(t), "the ledger").toEqual(appliedBefore);
    expect(await recorded(t), "the registry row").toEqual(before);
  });

  it("moves the served schema version only once the transaction holding a registry write commits", async () => {
    const t = await boot();
    /** How many times this process has marked its served schema version as moved. */
    const marks = () =>
      Number(
        (
          Reflect.get(globalThis, "__nextly_servedSchema") as
            | { marks?: number }
            | undefined
        )?.marks ?? 0
      );
    const before = marks();
    let inside = Number.NaN;

    // A registry write joined to a transaction still open, as the update's is to the one that
    // records its files.
    await t.adapter.transaction(async () => {
      await writeRegistryRows(t.adapter, () => Promise.resolve(undefined));
      inside = marks();
    });

    expect(inside, "marked while the transaction was open").toBe(before);
    expect(marks(), "marked once it committed").toBeGreaterThan(before);
  });
});
