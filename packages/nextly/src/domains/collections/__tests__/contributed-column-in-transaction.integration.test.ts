/**
 * A save on a transaction a plugin opened, carrying a column a schema hook contributed to the
 * collection's table, is judged and written on that transaction: what its gate reads of the
 * collection (its table, whose contributed columns the body may name) is read there too, never
 * on the pool.
 *
 * A read on the pool while the transaction is open cannot see the transaction's own writes on
 * PostgreSQL and MySQL, and on SQLite waits for the connection the transaction holds. The
 * plausible broken implementation reads the collection's table name on the pool: it still
 * saves on a database where the pool answers, so the test watches where the read is asked.
 */
import { afterEach, expect, it, vi } from "vitest";

import { DynamicCollectionService } from "../../dynamic-collections/services/dynamic-collection-service";

import { defineCollection, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  clearActiveExtensionSchema,
  setActiveExtensionSchema,
} from "../../schema/extension/active-schema";
import { buildExtensionSchema } from "../../schema/extension/build-extension-schema";
import { col } from "../../schema/extension/dsl";

/** How long the save may take before it counts as waiting on itself. */
const SETTLES_WITHIN_MS = 10_000;

describeEachDialect(
  "a save on a plugin's transaction carrying a contributed column",
  dialect => {
    let t: TestNextly | undefined;
    let services: PluginContext["services"] | undefined;

    afterEach(async () => {
      clearActiveExtensionSchema();
      await t?.destroy();
      t = undefined;
    });

    /** `searchVector`, a column the app's schema hook adds to the notes' table. */
    async function contribute(): Promise<void> {
      const schema = await buildExtensionSchema({
        dialect: "postgresql",
        coreTableNames: ["users", "media"],
        entities: [
          {
            name: "dc_notes",
            slug: "notes",
            entityKind: "collection",
            columns: [
              { name: "id", kind: "varchar", nullable: false },
              { name: "title", kind: "text", nullable: true },
            ],
          },
        ],
        pluginPrefixes: new Map(),
        plugins: [],
        app: {
          owner: { kind: "app" },
          extend: [
            ({ schema: draft }) => {
              draft.extendTable("dc_notes", {
                columns: { searchVector: col.text({ nullable: true }) },
              });
            },
          ],
        },
      });
      setActiveExtensionSchema("postgresql", schema);
    }

    it("is judged and written on the transaction, and settles", async () => {
      t = await createTestNextly({
        dialect,
        plugins: [
          definePlugin({
            name: "@test/contributed-column-probe",
            version: "1.0.0",
            nextly: ">=0.0.0",
            init: context => {
              services = context.services;
            },
          }),
        ],
        collections: [
          defineCollection({
            slug: "notes",
            status: true,
            fields: [text({ name: "title" })],
          }),
        ],
      });
      const created = await t.nextly.create({
        collection: "notes",
        data: { title: "draft note", status: "draft" },
      });
      const id = created.item.id as string;
      await contribute();

      // Every read of the collection's record asked while the plugin's transaction is open, and
      // whether it was asked on that transaction (an executor) or on the pool (none).
      let inside = false;
      const poolReadsInside: unknown[] = [];
      const getCollection = DynamicCollectionService.prototype.getCollection;
      vi.spyOn(
        DynamicCollectionService.prototype,
        "getCollection"
      ).mockImplementation(function (this: DynamicCollectionService, ...args) {
        if (inside && args[1] === undefined) poolReadsInside.push(args[0]);
        return getCollection.apply(this, args);
      });

      const saved = services!.collections.withTransaction(async tx => {
        inside = true;
        try {
          return await services!.collections.updateEntryInTransaction(
            tx,
            "notes",
            id,
            { status: "published", searchVector: "words", _overwrite: true },
            {} as never
          );
        } finally {
          inside = false;
        }
      });
      const outcome = await Promise.race([
        saved.then(
          () => "settled",
          (error: unknown) => `refused: ${String(error)}`
        ),
        new Promise<string>(resolve =>
          setTimeout(() => resolve("still waiting"), SETTLES_WITHIN_MS)
        ),
      ]);
      vi.restoreAllMocks();

      expect(poolReadsInside).toEqual([]);
      expect(outcome).toBe("settled");
      const read = await t.nextly.findByID({
        collection: "notes",
        id,
        status: "all",
      });
      expect(read).toMatchObject({ status: "published" });
    }, 30_000);
  }
);
