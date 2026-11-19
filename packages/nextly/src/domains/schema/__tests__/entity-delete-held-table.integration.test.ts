/**
 * A collection's, a Single's or a field group's delete, on the dialects that delete in one
 * transaction, against a table another session holds, and against a stray field-group table.
 *
 * A held table: the delete's transaction drops the entity's translations table, and another session
 * holds it, as an open transaction that has read it does. Each try's wait is bounded by
 * PostgreSQL's `lock_timeout`, and once the tries run out the delete stops with
 * `NEXTLY_TABLE_BUSY`, having changed nothing: the entity, its translations and its registry row
 * all stand, and no delete file is left. The holder ends a while after that stop, so a delete that
 * waited on with no bound would finish instead, and fail the assertion rather than hang. Deleting
 * again once the holder ends finishes. PostgreSQL only: the SQLite suite runs in memory, where no
 * second connection can hold the database, and MySQL deletes in steps, as before.
 *
 * A stray table: a `comp_`-prefixed table the registry does not know and that has no
 * `_parent_table` column holds no field-group values, so the teardown that sweeps those values
 * passes over it. Asking it for rows by that column fails, which on PostgreSQL aborts the
 * delete's transaction; the delete asks the catalog for the column instead, so it finishes on
 * every dialect.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { defineCollection, text } from "../../../config";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { resolveRegistryTableName } from "../../field-groups/storage/resolve-storage-names";
import { resolveSingleTableName } from "../../singles/services/resolve-single-table-name";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../utils/resolve-table-name";

let instance: TestNextly | undefined;
/** The calls a plugin's in-transaction collection-delete handler received, by slug. */
const handled: string[] = [];
afterEach(async () => {
  handled.length = 0;
  vi.unstubAllEnvs();
  resetSessionStandingForTests();
  await instance?.destroy();
  instance = undefined;
});

const HISTORY = "./database/history";
/** The plugin's own collection, which its handler reads in the delete's transaction. */
const DESIGNS = "edh_designs";
/** A `comp_` table the registry does not know, with no `_parent_table` column. */
const STRAY = "comp_edh_stray";

type Kind = "collection" | "single" | "fieldGroup";

interface Deleted {
  kind: Kind;
  slug: string;
  table: string;
  registry: string;
}

const KINDS: readonly Kind[] = ["collection", "single", "fieldGroup"];

describe.each(getConfiguredTestDialects())(
  "an entity delete against a held table or a stray field-group table (%s)",
  dialect => {
    async function boot(
      options: {
        /**
         * A plugin's in-transaction collection-delete handler: one that records its call, or one
         * that records it and then reads the plugin's own collection on the delete's transaction.
         */
        deleteHandler?: "records" | "reads its own table";
      } = {}
    ): Promise<TestNextly> {
      const t = await createTestNextly({
        dialect,
        db: { migrationsDir: HISTORY, uiSchemaFile: "./schema/builder.json" },
        localization: { locales: ["en", "de"], defaultLocale: "en" },
        // A plugin removing what it holds for a collection in the delete's transaction: code the
        // system does not know, which a second try would run again.
        ...(options.deleteHandler === undefined
          ? {}
          : {
              plugins: [
                definePlugin({
                  name: "edh-designer",
                  version: "1.0.0",
                  nextly: ">=0.0.0",
                  contributes: {
                    collections: [
                      defineCollection({
                        slug: DESIGNS,
                        fields: [text({ name: "title" })],
                      }),
                    ],
                  },
                  init(ctx) {
                    const reads =
                      options.deleteHandler === "reads its own table";
                    ctx.hooks.onCollectionDelete({
                      inTransaction: async ({ slug, transaction }) => {
                        handled.push(slug);
                        if (reads) {
                          await ctx.services.ownCollections.listEntriesInTransaction(
                            transaction,
                            DESIGNS,
                            { pagination: { limit: 1 } }
                          );
                        }
                      },
                    });
                  },
                }),
              ],
            }),
      });
      instance = t;
      // As the Builder runs: each save is applied, and recorded, here.
      vi.stubEnv("NODE_ENV", "development");
      return t;
    }

    /** A translated entity of `kind`, made through the Builder. */
    async function anEntity(t: TestNextly, kind: Kind): Promise<Deleted> {
      const fields = [{ name: "heading", type: "text", localized: true }];
      if (kind === "collection") {
        const slug = "edh_posts";
        await dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          { name: slug, label: "Post", localized: true, fields }
        );
        return {
          kind,
          slug,
          table: resolveCollectionTableName(slug),
          registry: "dynamic_collections",
        };
      }
      if (kind === "single") {
        const slug = "edh_notice";
        await dispatchSingles(
          "createSingle",
          {},
          { slug, label: "Notice", localized: true, fields }
        );
        return {
          kind,
          slug,
          table: resolveSingleTableName({ slug }),
          registry: "dynamic_singles",
        };
      }
      const slug = "edh_meta";
      await dispatchComponents(
        "createComponent",
        {},
        { slug, label: "Meta", localized: true, fields }
      );
      return {
        kind,
        slug,
        table: resolveComponentTableName(slug),
        registry: await resolveRegistryTableName(t.adapter),
      };
    }

    function remove(entity: Deleted): Promise<unknown> {
      if (entity.kind === "collection") {
        return dispatchCollections(
          {} as ServiceContainer,
          "deleteCollection",
          { collectionName: entity.slug },
          undefined
        );
      }
      return entity.kind === "single"
        ? dispatchSingles("deleteSingle", { slug: entity.slug }, undefined)
        : dispatchComponents(
            "deleteComponent",
            { slug: entity.slug },
            undefined
          );
    }

    const quote = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    async function registryRowCount(t: TestNextly, entity: Deleted) {
      const [row] = (await t.adapter.executeQuery(
        `SELECT COUNT(*) AS n FROM ${quote(entity.registry)} WHERE slug = '${entity.slug}'`
      )) as Array<{ n: number | string }>;
      return Number(row?.n);
    }

    /** The delete files written for `entity`, by name. */
    const deleteFiles = (t: TestNextly, entity: Deleted) =>
      readdirSync(join(t.basePath, "database", "history")).filter(f =>
        f.endsWith(`_${entity.slug}_delete.sql`)
      );

    /**
     * Another session holding `table` until the returned function is called: an open transaction
     * that has read it, which a drop of the table waits behind.
     */
    async function holdTable(
      t: TestNextly,
      table: string,
      // Held against reads too, as a table lock in the strongest mode holds it.
      mode: "reads" | "exclusive" = "reads"
    ): Promise<() => Promise<void>> {
      let held: () => void = () => undefined;
      const isHeld = new Promise<void>(resolve => {
        held = resolve;
      });
      let free: () => void = () => undefined;
      const freed = new Promise<void>(resolve => {
        free = resolve;
      });
      const holding = t.adapter.transaction(async tx => {
        await tx.execute(
          mode === "exclusive"
            ? `LOCK TABLE ${quote(table)} IN ACCESS EXCLUSIVE MODE`
            : `SELECT COUNT(*) AS n FROM ${quote(table)}`
        );
        held();
        await freed;
      });
      await isHeld;
      return async () => {
        free();
        await holding;
      };
    }

    it.runIf(dialect === "postgresql")(
      "a collection's, whose plugin handler ran before the held table, stops without trying again",
      async () => {
        const t = await boot({ deleteHandler: "records" });
        const entity = await anEntity(t, "collection");
        const companion = `${entity.table}_locales`;
        const release = await holdTable(t, companion);
        try {
          vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
          vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "3");

          const stopped = await remove(entity).then(
            () => "deleted",
            (error: unknown) => error
          );

          // Stopped at the first try's wait: a second try would run the handler again, and what it
          // does outside the database a rollback does not undo.
          // Asked of what the caller is told: the collection's road rebuilds the error from its
          // code and message, so the stop's log context does not reach it.
          expect(stopped).toMatchObject({
            code: "NEXTLY_TABLE_BUSY",
            publicMessage: expect.stringMatching(
              /stopped without trying again: table busy\.[\s\S]*a call of code the system does not know[\s\S]*through 1 try /
            ),
          });
          expect(handled).toEqual([entity.slug]);
          // Rolled back whole: the collection, its translations and its row stand.
          expect(await t.adapter.tableExists(entity.table)).toBe(true);
          expect(await t.adapter.tableExists(companion)).toBe(true);
          expect(await registryRowCount(t, entity)).toBe(1);
          expect(deleteFiles(t, entity)).toEqual([]);
        } finally {
          await release();
        }
      },
      30_000
    );

    it.runIf(dialect === "postgresql")(
      "a collection's, whose plugin handler itself waits for a held table, stops without trying again",
      async () => {
        const t = await boot({ deleteHandler: "reads its own table" });
        const entity = await anEntity(t, "collection");
        const designs = resolveCollectionTableName(DESIGNS);
        // Proves the handler's read reaches a table: a missing one would fail for another reason.
        expect(await t.adapter.tableExists(designs)).toBe(true);
        const release = await holdTable(t, designs, "exclusive");
        try {
          vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
          vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "3");

          const stopped = await remove(entity).then(
            () => "deleted",
            (error: unknown) => error
          );

          // The handler's own read ended waiting, after its call had begun: not tried again.
          expect(stopped).toMatchObject({
            code: "NEXTLY_TABLE_BUSY",
            publicMessage: expect.stringMatching(
              /stopped without trying again: table busy\.[\s\S]*through 1 try /
            ),
          });
          expect(handled).toEqual([entity.slug]);
          expect(await t.adapter.tableExists(entity.table)).toBe(true);
          expect(await registryRowCount(t, entity)).toBe(1);
          expect(deleteFiles(t, entity)).toEqual([]);
        } finally {
          await release();
        }
      },
      30_000
    );

    for (const kind of KINDS) {
      it.runIf(dialect === "postgresql")(
        `a ${kind}'s, against a held translations table, stops busy having changed nothing`,
        async () => {
          const t = await boot();
          const entity = await anEntity(t, kind);
          const companion = `${entity.table}_locales`;
          // Proves there is something to remove: a delete that did nothing would otherwise pass.
          expect(await t.adapter.tableExists(entity.table)).toBe(true);
          expect(await t.adapter.tableExists(companion)).toBe(true);
          expect(await registryRowCount(t, entity)).toBe(1);

          const release = await holdTable(t, companion);
          try {
            // A second a try, three in all: a try or two, then a stop, well before the holder ends.
            vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
            vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "3");
            const ending = new Promise<void>(resolve =>
              setTimeout(resolve, 8_000)
            ).then(release);

            const stopped = await remove(entity).then(
              () => "deleted",
              (error: unknown) => error
            );
            expect(stopped).toMatchObject({ code: "NEXTLY_TABLE_BUSY" });

            // Nothing changed: the entity, its translations, its row; and no delete file is left.
            expect(await t.adapter.tableExists(entity.table)).toBe(true);
            expect(await t.adapter.tableExists(companion)).toBe(true);
            expect(await registryRowCount(t, entity)).toBe(1);
            expect(deleteFiles(t, entity)).toEqual([]);

            // Once the holder ends, deleting again finishes.
            await ending;
            await remove(entity);
            expect(await t.adapter.tableExists(entity.table)).toBe(false);
            expect(await t.adapter.tableExists(companion)).toBe(false);
            expect(await registryRowCount(t, entity)).toBe(0);
            expect(deleteFiles(t, entity)).toHaveLength(1);
          } finally {
            // Released whatever the outcome, before the instance is destroyed.
            await release();
          }
        },
        30_000
      );

      it(`a ${kind}'s, beside a stray field-group table with no parent column, finishes`, async () => {
        const t = await boot();
        const entity = await anEntity(t, kind);
        // A test-owned table, created after boot so no runtime schema is registered for it.
        await t.adapter.executeQuery(
          `CREATE TABLE ${quote(STRAY)} (id varchar(64) PRIMARY KEY, label varchar(64))`
        );
        try {
          await remove(entity);

          expect(await t.adapter.tableExists(entity.table)).toBe(false);
          expect(await t.adapter.tableExists(`${entity.table}_locales`)).toBe(
            false
          );
          expect(await registryRowCount(t, entity)).toBe(0);
          // Passed over, not dropped: it is not this entity's.
          expect(await t.adapter.tableExists(STRAY)).toBe(true);
        } finally {
          await t.adapter.executeQuery(`DROP TABLE IF EXISTS ${quote(STRAY)}`);
        }
      });
    }
  }
);
