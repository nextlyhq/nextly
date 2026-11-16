/**
 * What another plugin's write costs the page builder, on every configured
 * dialect.
 *
 * The page builder listens on every collection's writes: an entry's save may
 * move the address a template serves it at, and a document holding blocks is
 * indexed, reported on and fenced. A write to a collection that can neither be
 * served at an address nor hold blocks, such as another plugin's private
 * bookkeeping, concerns none of that, and is judged so from the site's code
 * alone: no statement reaches the templates, the address store, the component
 * registry or any table of the page builder's own.
 *
 * What separates the skip from a plausible broken one:
 * - one update of a plugin's private record sends none of those statements;
 * - a collection declared in code that a template may serve is still judged
 *   on every save, so the entry of one given an address at runtime, on its
 *   template, holds that address;
 * - a collection made at runtime, which the site's code does not declare, is
 *   still judged, and once it is given a blocks field its writes are reported
 *   on as any document holding blocks is.
 *
 * Each statement is logged at the driver (`statement-log`).
 *
 * @module __tests__/unservable-writes.integration.test
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TEMPLATES_SLUG } from "../collections/templates";
import { pageBuilder } from "../plugin";

import { held, idOf, startupSettled } from "./entry-page-claims-harness";
import { openStatementLog } from "./statement-log";

/** A plugin's private bookkeeping, as the SEO plugin's address record is. */
const RECORDS = "pb_test_records";

/** A collection declared in code, with no address and no blocks. */
const NOTES = "notes";

/**
 * The tables a write the page builder has no part in must not reach: the
 * templates, every table of its own and the component registry.
 */
const PAGE_BUILDER_TABLES =
  /["`](dc_templates|dc_nx_pb_\w+|page_builder__\w+|dynamic_components)["`]/;

/** Whether `statement` names one of {@link PAGE_BUILDER_TABLES}. */
const reachesPageBuilder = (statement: string): boolean =>
  PAGE_BUILDER_TABLES.test(statement);

/** A plugin keeping private records, hidden from the admin. */
const recordsPlugin = definePlugin({
  name: "@test/records",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    collections: [
      defineCollection({
        slug: RECORDS,
        labels: { singular: "Record", plural: "Records" },
        internal: true,
        fields: [text({ name: "note" })],
      }),
    ],
  },
});

const TEMPLATE = { formatVersion: 1, kind: "template", nodes: [] };

describe.each(getConfiguredTestDialects())(
  "writes the page builder has no part in (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      vi.unstubAllEnvs();
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [pageBuilder(), recordsPlugin],
        collections: [
          defineCollection({
            slug: NOTES,
            labels: { singular: "Note", plural: "Notes" },
            fields: [text({ name: "title" })],
          }),
        ],
        // Where a collection made at runtime writes its definition and its
        // migration, below the instance's own folder.
        db: {
          migrationsDir: "./database/history",
          uiSchemaFile: "./schema/builder.json",
        },
      });
      await startupSettled(current);
      return current;
    }

    /** The statements one update of `id` in `collection` sends, after-hooks included. */
    async function statementsOfUpdate(
      t: TestNextly,
      collection: string,
      id: string,
      data: Record<string, unknown>
    ): Promise<string[]> {
      // What earlier writes and the start left running is over before the
      // update, and what the update starts after its commit is over before
      // its statements are read.
      await t.events.settle();
      const log = await openStatementLog(t.adapter, dialect);
      let from = 0;
      try {
        await log.quiet();
        from = log.statements.length;
        await t.nextly.update({
          collection,
          id,
          data: { ...data, _overwrite: true },
          overrideAccess: true,
        });
        await t.events.settle();
        await log.quiet();
      } finally {
        log.close();
      }
      return log.statements.slice(from);
    }

    it("an update of another plugin's private record sends nothing to the page builder's tables or the component registry", async () => {
      const t = await boot();
      const record = idOf(
        await t.nextly.create({
          collection: RECORDS,
          data: { note: "first" },
          overrideAccess: true,
        })
      );

      const statements = await statementsOfUpdate(t, RECORDS, record, {
        note: "second",
      });

      // The update itself was logged, so an empty answer is not a log that
      // saw nothing.
      expect(
        statements.some(statement =>
          new RegExp(`^update ["\`]dc_${RECORDS}["\`]`, "i").test(statement)
        )
      ).toBe(true);
      expect(statements.filter(reachesPageBuilder)).toEqual([]);
    });

    it("a collection declared in code that a template may serve is still judged, and its entry holds the address its template is given at runtime", async () => {
      const t = await boot();
      const note = idOf(
        await t.nextly.create({
          collection: NOTES,
          data: { title: "One", slug: "one" },
          overrideAccess: true,
        })
      );
      expect(await held(t)).toEqual([]);

      // Judged on its save: its template is read, though it has none yet.
      const judged = await statementsOfUpdate(t, NOTES, note, {
        title: "One again",
      });
      expect(
        judged.filter(statement => /["`]dc_templates["`]/.test(statement))
      ).not.toEqual([]);

      // Given an address at runtime, on its template, and saved again.
      await t.nextly.create({
        collection: TEMPLATES_SLUG,
        data: {
          title: "Notes",
          collection: NOTES,
          content: TEMPLATE,
          status: "published",
          address: "/notes",
        },
        overrideAccess: true,
      });
      await t.nextly.update({
        collection: NOTES,
        id: note,
        data: { title: "One, served", _overwrite: true },
        overrideAccess: true,
      });
      expect(await held(t)).toEqual([`address /notes/one ${NOTES}:${note}`]);
    });

    it("a collection made at runtime is still judged, and is reported on as a holder of blocks once it is given a blocks field", async () => {
      const t = await boot();
      // Made and changed as the Schema Builder makes and changes one in
      // development, where its migration is applied as it is written.
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService") as unknown as {
        createCollection(
          data: Record<string, unknown>,
          context: object
        ): Promise<unknown>;
        updateCollection(
          name: string,
          data: Record<string, unknown>,
          context: object
        ): Promise<unknown>;
      };
      await service.createCollection(
        {
          name: "recipes",
          label: "Recipe",
          fields: [{ name: "title", type: "text" }],
        },
        {}
      );
      const recipe = idOf(
        await t.nextly.create({
          collection: "recipes",
          data: { title: "Soup" },
          overrideAccess: true,
        })
      );
      const before = await statementsOfUpdate(t, "recipes", recipe, {
        title: "Soup, hot",
      });
      expect(
        before.filter(statement => /["`]dc_templates["`]/.test(statement))
      ).not.toEqual([]);

      await service.updateCollection(
        "recipes",
        {
          fields: [
            { name: "title", type: "text" },
            { name: "body", type: "blocks" },
          ],
        },
        {}
      );
      const after = await statementsOfUpdate(t, "recipes", recipe, {
        title: "Soup, cold",
      });
      // The breakpoint removals' write report reads its runs for a document
      // that may hold blocks.
      expect(
        after.filter(statement =>
          /["`]page_builder__breakpoint_removals["`]/.test(statement)
        )
      ).not.toEqual([]);
    });
  }
);
