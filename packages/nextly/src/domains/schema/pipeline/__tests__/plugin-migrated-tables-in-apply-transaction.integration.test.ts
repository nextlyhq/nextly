/**
 * A dev schema apply reads which tables plugins own through its own
 * transaction, and still leaves a plugin-migrated table in place.
 *
 * The apply runs inside one transaction on PostgreSQL and MySQL. The owner
 * registry (`nextly_schema_owners`) is read in the middle of it, to withhold
 * any drop of a plugin-migrated table. Read through the pooled handle instead
 * of the transaction, that read takes a second connection while the
 * transaction holds the first: outside it, and able to stall a small pool.
 * The escape guard (`src/__tests__/transaction-escapes`) reports exactly that,
 * and this file asserts it saw no such read.
 *
 * The fixture is a managed table the desired schema does not declare, claimed
 * in the owner registry by a plugin's migration stream. A spy on the registry
 * read shows the apply reached the read on every dialect, so a clean guard is
 * not the clean result of an apply that never read the registry.
 *
 * What separates the fix is the guard's report, on PostgreSQL and MySQL only.
 * SQLite has one connection and runs this apply with no transaction, so no
 * read can escape there and the guard cannot report one: on SQLite this file
 * checks the behaviour only. That the claimed table survives is behaviour, not
 * the fix: the drop guard also refuses any drop of a table outside the
 * desired set, so the table would survive a registry read on either handle.
 */
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import {
  describeTransactionEscapes,
  recordTransactionEscapes,
  takeTransactionEscapes,
} from "../../../../__tests__/transaction-escapes";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { SchemaOwnersRepository } from "../../ownership/schema-owners-repository";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { RealClassifier } from "../classifier/classifier";
import { RealPreCleanupExecutor } from "../pre-cleanup/executor";
import { PushSchemaPipeline } from "../pushschema-pipeline";
import {
  noopMigrationJournal,
  noopNotifier,
  noopPreRenameExecutor,
} from "../pushschema-pipeline-stubs";
import { RegexRenameDetector } from "../rename-detector";

/** Claimed by a plugin's migration stream: dev push must never drop it. */
const CLAIMED = "dc_plugin_claimed_items";

/**
 * What the guard saw, taken here so the case can assert it, and recorded in
 * the run's inventory as the setup file records every other test's.
 */
function drain() {
  const escapes = takeTransactionEscapes();
  recordTransactionEscapes(escapes, expect.getState().testPath);
  return escapes;
}

/** The apply a reload runs, with every drop confirmed as a developer would. */
async function applyNothingDeclared(
  adapter: TestNextly["adapter"],
  dialect: TestDialect
) {
  const db = adapter.getDrizzle();
  const pipeline = new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor(dialect, db),
    renameDetector: new RegexRenameDetector(),
    classifier: new RealClassifier(),
    promptDispatcher: {
      dispatch: ({ events }) =>
        Promise.resolve({
          confirmedRenames: [],
          resolutions: events.map(event => ({
            kind: "confirm_drop" as const,
            eventId: event.id,
          })),
          proceed: true,
        }),
    },
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: new RealPreCleanupExecutor(),
    migrationJournal: noopMigrationJournal,
    notifier: noopNotifier,
  });
  const databaseName =
    dialect === "mysql"
      ? String(
          (
            await adapter.executeQuery<Record<string, unknown>>(
              "SELECT DATABASE() AS name"
            )
          )[0]?.name
        )
      : undefined;
  return pipeline.apply({
    desired: { collections: {}, singles: {}, components: {} },
    db,
    dialect,
    source: "code",
    promptChannel: "terminal",
    ...(databaseName !== undefined ? { databaseName } : {}),
  });
}

describeEachDialect(
  "a dev schema apply with a plugin-migrated table in the database",
  dialect => {
    let current: TestNextly;

    beforeAll(async () => {
      current = await createTestNextly({ dialect });
      await current.adapter.executeQuery(
        `CREATE TABLE ${CLAIMED} (id VARCHAR(36) PRIMARY KEY)`
      );
      await new SchemaOwnersRepository(
        current.adapter.getDrizzle(),
        dialect
      ).upsert([
        {
          tableName: CLAIMED,
          ownerKind: "plugin",
          ownerId: "acme",
          migratedBy: "plugin:acme",
          ownerVersion: "1.0.0",
          schemaVersion: 1,
          state: "active",
        },
      ]);
      // What the boot and the fixture made is not this case's to judge.
      drain();
    });

    afterAll(async () => {
      vi.restoreAllMocks();
      await current.destroy();
    });

    it("reads the owner registry through its transaction and keeps the plugin's table", async () => {
      const registryRead = vi.spyOn(SchemaOwnersRepository.prototype, "read");
      const result = await applyNothingDeclared(current.adapter, dialect);
      const escapes = drain();

      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      // The apply read the registry, so the guard had a read to watch.
      expect(registryRead).toHaveBeenCalled();
      // Accepted or not: no read of the owner registry left the transaction.
      expect(
        escapes
          .map(escape => `${escape.dialect} ${escape.key}`)
          .filter(key => key.endsWith("select nextly_schema_owners"))
      ).toEqual([]);
      // Drained above, so the setup file no longer sees them: any other
      // escape the baseline does not accept still fails this case.
      expect(describeTransactionEscapes(escapes)).toBeUndefined();
      const tables = await current.adapter.listTables();
      expect(tables).toContain(CLAIMED);
    });
  }
);
