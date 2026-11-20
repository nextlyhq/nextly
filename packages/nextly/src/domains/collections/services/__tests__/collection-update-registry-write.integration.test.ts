/**
 * A collection update (`updateCollection`) in development runs its own migration file, as the
 * schema dialog's save does, and records it applied in the ledger. The collection's registry row is
 * written in the file's own transaction, after its ledger row, so the change, the ledger row and the
 * registry row commit or roll back together: where the registry write fails, the update is taken
 * back whole and answered as the failure it is.
 *
 * An update that carries values across its change (a field filled from a stated default, say) keeps
 * the schema push, which commits on its own transaction, then records the save's files applied. The
 * registry row is written in that recording transaction, after the ledger rows. Where the registry
 * write fails, the ledger rows go back with it and the files are kept, recorded applied nowhere. The
 * pushed change stays in the database, so the update answers that it failed part way, naming the
 * kept file and the steps that finish it, and never that it was applied.
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
import { PushSchemaPipeline } from "../../../schema/pipeline/pushschema-pipeline";
import { writeRegistryRows } from "../../../schema/schema-version";
import { isWebhookRecordingEnabled } from "../../../webhooks/recording-policy";

const HISTORY = "./database/history";
const DEFINITION = "./schema/builder.json";
const SLUG = "cur_posts";
const TABLE = `dc_${SLUG}`;
const BEFORE = [{ name: "heading", type: "text" }];
const AFTER = [...BEFORE, { name: "extra", type: "text" }];
// A field filled from its stated default over the rows already there, which keeps the push.
const FILLED = [
  ...BEFORE,
  { name: "extra", type: "text", default: "new", options: { variant: "short" } },
];

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
  /**
   * Boot in development with the Builder save writer set up, and create the collection; with
   * `languages`, English and Spanish are configured.
   */
  async function boot(languages = false): Promise<TestNextly> {
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({
      dialect: dialect as TestDialect,
      db: { migrationsDir: HISTORY, uiSchemaFile: DEFINITION },
      ...(languages
        ? { localization: { locales: ["en", "es"], defaultLocale: "en" } }
        : {}),
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
  ): Promise<{ failed: boolean; said: string; status?: unknown }> {
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
        status: (error as { statusCode?: unknown }).statusCode,
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

  it("runs its own file, recording it and the row together, when nothing fails", async () => {
    const t = await boot();
    const before = await recorded(t);
    const filesBefore = migrationFiles(t);
    const pushed = vi.spyOn(PushSchemaPipeline.prototype, "apply");

    const { failed, said } = await update();

    expect(failed, `the update failed: ${said}`).toBe(false);
    // The update's file carried the change, not the push.
    expect(pushed, "the push").not.toHaveBeenCalled();
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

  it("keeps the push for a field filled from a stated default, filling the rows already there", async () => {
    const t = await boot();
    const handler = t.getService("collectionsHandler") as unknown as {
      getEntryService(): {
        createEntry(
          params: Record<string, unknown>,
          data: Record<string, unknown>
        ): Promise<{ success: boolean }>;
      };
    };
    const entry = await handler
      .getEntryService()
      .createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { heading: "One" }
      );
    expect(entry.success, JSON.stringify(entry)).toBe(true);
    const pushed = vi.spyOn(PushSchemaPipeline.prototype, "apply");

    const { failed, said } = await update({ fields: FILLED });

    expect(failed, `the update failed: ${said}`).toBe(false);
    expect(pushed, "the push").toHaveBeenCalled();
    const rows = await t.adapter.executeQuery<{ extra: unknown }>(
      `SELECT extra FROM ${TABLE}`
    );
    expect(rows.map(row => row.extra)).toEqual(["new"]);
  });

  // MySQL commits a file's DDL statement by statement, so there is no transaction for the whole
  // update to be taken back in.
  it.skipIf(dialect === "mysql")(
    "takes the whole update back, nothing applied, when the registry write fails on its file's road",
    async () => {
      // Counted first, on an update without a failure: the last is the write in the file's
      // transaction.
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
      // Nothing is left part way, so there is no kept file to finish.
      expect(said, "the answer").not.toContain("migrate:resolve");
      expect(migrationFiles(t), "the migrations folder").toEqual(filesBefore);
      expect(await appliedFiles(t), "the ledger").toEqual(appliedBefore);
      expect(await recorded(t), "the registry row").toEqual(before);
      expect(await columnsOf(t), "the table").not.toContain("extra");
    }
  );

  it("answers that it failed part way on the push's road, its files kept and recorded nowhere, when the registry write fails", async () => {
    // Counted first, on an update without a failure: the last is the write after the push.
    let writes: number;
    {
      const t = await boot();
      const counted = await countingTrigger(t, 0);
      const { failed, said } = await update({ fields: FILLED });
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

    const { failed, said } = await update({ fields: FILLED });

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

    const { failed, said, status } = await update();

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
    // The status its code owns (`NEXTLY_MIGRATION_APPLY_FAILED`).
    expect(status, "the answer's status").toBe(500);
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

  it("brings this process's running shape to a translation switch saved alone", async () => {
    const t = await boot(true);
    const handler = t.getService("collectionsHandler") as unknown as {
      getEntryService(): {
        createEntry(
          params: Record<string, unknown>,
          data: Record<string, unknown>
        ): Promise<{ success: boolean; data: unknown }>;
      };
      getEntry(params: Record<string, unknown>): Promise<unknown>;
    };
    const created = await handler
      .getEntryService()
      .createEntry(
        { collectionName: SLUG, overrideAccess: true, locale: "en" },
        { heading: "Hello" }
      );
    expect(created.success, JSON.stringify(created)).toBe(true);
    const entryId = String((created.data as { id: unknown }).id);

    const { failed, said } = await update({ localized: true });

    expect(failed, `the update failed: ${said}`).toBe(false);
    // The value moved to the translations table; a read here finds it there.
    const read = await handler.getEntry({
      collectionName: SLUG,
      entryId,
      locale: "en",
      overrideAccess: true,
    });
    expect(
      JSON.stringify(read),
      `the read after the switch: ${JSON.stringify(read)}`
    ).toContain('"heading":"Hello"');
  });

  it("leaves the webhook recording policy as stored when the transaction holding its write rolls back", async () => {
    const t = await boot();
    const handler = t.getService("collectionsHandler");
    const registry = Reflect.get(handler as object, "collectionService") as {
      updateCollectionMetadata(
        slug: string,
        updates: Record<string, unknown>
      ): Promise<unknown>;
    };
    // Control: recording is on before.
    expect(isWebhookRecordingEnabled("collection", SLUG)).toBe(true);

    // The row write joined to a transaction that then rolls back, as the update's joins the one
    // recording its files.
    const rolledBack = new Error("rolled back");
    await expect(
      t.adapter.transaction(async () => {
        await writeRegistryRows(t.adapter, () =>
          registry.updateCollectionMetadata(SLUG, {
            webhooks: { record: false },
          })
        );
        throw rolledBack;
      })
    ).rejects.toThrow("rolled back");

    expect(
      isWebhookRecordingEnabled("collection", SLUG),
      "the policy after the rollback"
    ).toBe(true);
    // And a write that commits moves it.
    await writeRegistryRows(t.adapter, () =>
      registry.updateCollectionMetadata(SLUG, { webhooks: { record: false } })
    );
    expect(
      isWebhookRecordingEnabled("collection", SLUG),
      "the policy after a commit"
    ).toBe(false);
  });

  it("records the change it saved, marked failed, when this server cannot load it, with no save writer", async () => {
    const t = await boot();
    // The update's service without the Builder save writer, as one built outside the app's
    // registration.
    const handler = t.getService("collectionsHandler");
    const metadata = Reflect.get(handler as object, "metadataService") as {
      registerRuntimeSchema: (...args: unknown[]) => Promise<unknown>;
    };
    Reflect.set(metadata, "builderSave", undefined);
    // The push and the file have run by the time the running shape is loaded; loading it fails.
    const loaded = vi
      .spyOn(metadata, "registerRuntimeSchema")
      .mockRejectedValue(new Error("injected failure loading the shape"));

    const { failed, said, status } = await update();

    // Control: the load after the change was reached.
    expect(loaded, "the running shape was loaded").toHaveBeenCalled();
    expect(failed, `the update answered: ${said}`).toBe(true);
    expect(said, "the answer").toBe(
      "The schema change and its migration were saved, but the server could not load the collection's new shape, so its record is marked failed."
    );
    expect(status, "the answer's status").toBe(500);
    // The table and the file have `extra`, so the row does too: a later save built from it keeps
    // the field rather than dropping its column.
    expect(await columnsOf(t), "the table").toContain("extra");
    expect(await recorded(t), "the registry row").toMatchObject({
      fields: ["heading", "extra"],
      migrationStatus: "failed",
    });
  });
});
