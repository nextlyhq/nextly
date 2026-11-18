/**
 * A Single's or a field group's delete, failing after its table is dropped, leaves all of the
 * entity or, on MySQL, what it left before.
 *
 * The delete removes the entity's translations, drops its tables, then removes its registry row. On
 * PostgreSQL and SQLite those run in one transaction, as a collection's delete does, so a failure at
 * the last step undoes the drops with the rest: the table, its translations and its registry row are
 * all still there, and the delete's migration file is withdrawn, since nothing it describes ran.
 * MySQL commits each table drop as it runs, so there the table is gone and the row stays, and the
 * file is kept, recorded nowhere, for `nextly migrate` or a retry to finish.
 *
 * The failure is injected by the database itself: a trigger refusing the registry row's delete,
 * which every delete reaches last whatever runs before it. Deleting again once the trigger is gone
 * finishes the delete on every dialect.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resetSessionStandingForTests } from "../../../../auth/session/session-standing";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { servedSchemaVersion } from "../../../../route-handler/schema-version";
import { resolveRegistryTableName } from "../../../field-groups/storage/resolve-storage-names";
import {
  cachedCompanionReadiness,
  isCompanionReady,
} from "../../../i18n/runtime/companion-readiness";
import { resolveSingleTableName } from "../../../singles/services/resolve-single-table-name";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { resolveComponentTableName } from "../../utils/resolve-table-name";

// A step after the delete's commit made to fail: forgetting the dropped translations table on the
// adapter itself, which only that step does. The teardown inside the transaction forgets it on the
// transaction's own adapter, a different object, and runs as it always does.
const afterCommitFails = vi.hoisted(() => ({
  on: undefined as object | undefined,
  thrown: 0,
}));
vi.mock("../../../i18n/runtime/companion-readiness", async importOriginal => {
  const real =
    await importOriginal<
      typeof import("../../../i18n/runtime/companion-readiness")
    >();
  return {
    ...real,
    forgetCompanionReadiness: (
      ...args: Parameters<typeof real.forgetCompanionReadiness>
    ) => {
      if (
        afterCommitFails.on !== undefined &&
        args[0] === afterCommitFails.on
      ) {
        afterCommitFails.thrown += 1;
        throw new Error("the work after the delete's commit failed");
      }
      real.forgetCompanionReadiness(...args);
    },
  };
});

let instance: TestNextly | undefined;
afterEach(async () => {
  afterCommitFails.on = undefined;
  afterCommitFails.thrown = 0;
  vi.unstubAllEnvs();
  resetSessionStandingForTests();
  await instance?.destroy();
  instance = undefined;
});

const HISTORY = "./database/history";
const TRIGGER = "nx_test_refuse_registry_delete";

/** The migration files written, by name. */
function migrationFiles(t: TestNextly): string[] {
  return readdirSync(join(t.basePath, "database", "history")).filter(f =>
    f.endsWith(".sql")
  );
}

interface Deleted {
  kind: "single" | "fieldGroup";
  slug: string;
  table: string;
  registry: string;
}

describe.each(getConfiguredTestDialects())(
  "a Single's or a field group's delete that fails after its table drop (%s)",
  dialect => {
    async function boot(): Promise<TestNextly> {
      const t = await createTestNextly({
        dialect,
        db: { migrationsDir: HISTORY, uiSchemaFile: "./schema/builder.json" },
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      instance = t;
      // As the Builder runs: each save is applied, and recorded, here.
      vi.stubEnv("NODE_ENV", "development");
      return t;
    }

    /** A translated Single, made through the Builder. */
    async function aSingle(): Promise<Deleted> {
      const slug = "notice";
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug,
          label: "Notice",
          localized: true,
          fields: [{ name: "heading", type: "text", localized: true }],
        }
      );
      return {
        kind: "single",
        slug,
        table: resolveSingleTableName({ slug }),
        registry: "dynamic_singles",
      };
    }

    /** A translated field group, made through the Builder. */
    async function aFieldGroup(t: TestNextly): Promise<Deleted> {
      const slug = "meta";
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug,
          label: "Meta",
          localized: true,
          fields: [{ name: "note", type: "text", localized: true }],
        }
      );
      return {
        kind: "fieldGroup",
        slug,
        table: resolveComponentTableName(slug),
        registry: await resolveRegistryTableName(t.adapter),
      };
    }

    function remove(entity: Deleted): Promise<unknown> {
      return entity.kind === "single"
        ? dispatchSingles("deleteSingle", { slug: entity.slug }, undefined)
        : dispatchComponents(
            "deleteComponent",
            { slug: entity.slug },
            undefined
          );
    }

    /** A trigger refusing the delete of `entity`'s registry row, and its removal. */
    async function refuseRowDelete(t: TestNextly, entity: Deleted) {
      const run = (sql: string) => t.adapter.executeQuery(sql);
      if (dialect === "postgresql") {
        await run(
          `CREATE OR REPLACE FUNCTION ${TRIGGER}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'the registry row removal failed'; END $$ LANGUAGE plpgsql`
        );
        await run(
          `CREATE TRIGGER ${TRIGGER} BEFORE DELETE ON "${entity.registry}" FOR EACH ROW WHEN (OLD.slug = '${entity.slug}') EXECUTE FUNCTION ${TRIGGER}()`
        );
        return async () => {
          await run(`DROP TRIGGER ${TRIGGER} ON "${entity.registry}"`);
          await run(`DROP FUNCTION ${TRIGGER}()`);
        };
      }
      if (dialect === "mysql") {
        await run(
          `CREATE TRIGGER ${TRIGGER} BEFORE DELETE ON \`${entity.registry}\` FOR EACH ROW BEGIN IF OLD.slug = '${entity.slug}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'the registry row removal failed'; END IF; END`
        );
        return async () => {
          await run(`DROP TRIGGER ${TRIGGER}`);
        };
      }
      await run(
        `CREATE TRIGGER ${TRIGGER} BEFORE DELETE ON "${entity.registry}" WHEN OLD.slug = '${entity.slug}' BEGIN SELECT RAISE(ABORT, 'the registry row removal failed'); END`
      );
      return async () => {
        await run(`DROP TRIGGER ${TRIGGER}`);
      };
    }

    async function registryRowCount(t: TestNextly, entity: Deleted) {
      const [row] = (await t.adapter.executeQuery(
        `SELECT COUNT(*) AS n FROM ${dialect === "mysql" ? `\`${entity.registry}\`` : `"${entity.registry}"`} WHERE slug = '${entity.slug}'`
      )) as Array<{ n: number | string }>;
      return Number(row?.n);
    }

    const deleteFile = (t: TestNextly, entity: Deleted) =>
      migrationFiles(t).filter(f => f.endsWith(`_${entity.slug}_delete.sql`));

    async function failsThenFinishes(
      t: TestNextly,
      entity: Deleted
    ): Promise<void> {
      const companion = `${entity.table}_locales`;
      // Proves there is something to remove: a delete that did nothing would otherwise pass.
      expect(await t.adapter.tableExists(entity.table)).toBe(true);
      expect(await t.adapter.tableExists(companion)).toBe(true);
      expect(await registryRowCount(t, entity)).toBe(1);
      const filesBefore = migrationFiles(t);
      const allow = await refuseRowDelete(t, entity);

      await expect(remove(entity)).rejects.toBeDefined();

      // The registry row stays on every dialect: its removal is what failed.
      expect(await registryRowCount(t, entity)).toBe(1);
      if (dialect === "mysql") {
        // MySQL committed the drops as they ran: the table and its translations are gone, and the
        // delete's file is kept, recorded nowhere, for a retry or `nextly migrate` to finish.
        expect(await t.adapter.tableExists(entity.table)).toBe(false);
        expect(await t.adapter.tableExists(companion)).toBe(false);
        expect(deleteFile(t, entity)).toHaveLength(1);
      } else {
        // One transaction, rolled back whole: the table and its translations are still there, and
        // no delete file is left behind, since nothing it describes ran.
        expect(await t.adapter.tableExists(entity.table)).toBe(true);
        expect(await t.adapter.tableExists(companion)).toBe(true);
        expect(deleteFile(t, entity)).toEqual([]);
        expect(migrationFiles(t)).toEqual(filesBefore);
      }

      await allow();
      // Where the failed delete was undone, what this process remembers before the delete that
      // finishes: the translations table seen ready, on the adapter itself, and the schema version
      // it serves. (On MySQL the failed delete already dropped the translations table.)
      const whole = dialect !== "mysql";
      if (whole) {
        expect(await isCompanionReady(t.adapter, companion)).toBe(true);
      }
      const servedBefore = await servedSchemaVersion();
      expect(servedBefore).toBeDefined();
      await remove(entity);

      expect(await t.adapter.tableExists(entity.table)).toBe(false);
      expect(await t.adapter.tableExists(companion)).toBe(false);
      expect(await registryRowCount(t, entity)).toBe(0);
      expect(deleteFile(t, entity)).toHaveLength(1);
      if (whole) {
        // Forgotten on the adapter itself, not only on the transaction's: an entity made again
        // under the name starts from nothing remembered about the dropped table.
        expect(cachedCompanionReadiness(t.adapter, companion)).toBeUndefined();
        // Served at once, not after the read interval: the delete is a registry write.
        expect(await servedSchemaVersion()).toBeGreaterThan(servedBefore ?? 0);
      }
    }

    it("a Single's", async () => {
      const t = await boot();
      await failsThenFinishes(t, await aSingle());
    });

    it("a field group's", async () => {
      const t = await boot();
      await failsThenFinishes(t, await aFieldGroup(t));
    });

    /** The migration files the ledger records applied, by name. */
    async function appliedFiles(t: TestNextly): Promise<string[]> {
      const repo = new SchemaEventsRepository(
        t.adapter.getDrizzle() as never,
        t.adapter.getCapabilities().dialect
      );
      return (await repo.listFileApplies())
        .filter(row => row.status === "applied")
        .map(row => String(row.filename));
    }

    /**
     * A failure after the delete's commit, on the dialects that delete in one transaction: the
     * delete is the database's, so its file is kept and recorded applied, and the failure is still
     * told. Withdrawing the file would leave a database that no migration says lost the tables.
     */
    async function failsAfterItsCommit(
      t: TestNextly,
      entity: Deleted
    ): Promise<void> {
      afterCommitFails.on = t.adapter;

      // Told, whatever words the dispatcher gives it; and it is the step after the commit that failed.
      await expect(remove(entity)).rejects.toBeDefined();
      expect(afterCommitFails.thrown).toBe(1);

      expect(await t.adapter.tableExists(entity.table)).toBe(false);
      expect(await t.adapter.tableExists(`${entity.table}_locales`)).toBe(
        false
      );
      expect(await registryRowCount(t, entity)).toBe(0);
      const [file, ...more] = deleteFile(t, entity);
      expect(file).toBeDefined();
      expect(more).toEqual([]);
      expect(await appliedFiles(t)).toContain(file);
    }

    it.skipIf(dialect === "mysql")(
      "a Single's, failing after its commit, keeps its file recorded applied",
      async () => {
        const t = await boot();
        await failsAfterItsCommit(t, await aSingle());
      }
    );

    it.skipIf(dialect === "mysql")(
      "a field group's, failing after its commit, keeps its file recorded applied",
      async () => {
        const t = await boot();
        await failsAfterItsCommit(t, await aFieldGroup(t));
      }
    );
  }
);
