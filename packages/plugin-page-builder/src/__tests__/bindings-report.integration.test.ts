/**
 * The "Bindings to fix" report, kept on real writes: a page saved holding a
 * binding that no longer fits is reported, saving it fixed reports nothing,
 * and deleting the page reports nothing either. A document judged whole keeps
 * a row with no issues, which is how the report says "nothing to fix".
 *
 * What only a server shows: the report is kept by hooks after each committed
 * write, in the plugin's own table, which no unit test reaches.
 *
 * @module __tests__/bindings-report.integration.test
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asOverwrite } from "../document-version";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";

type Node = Record<string, unknown>;

const ARTICLES = "bri_articles";
const TABLE = "page_builder__binding_issues";

const pageOf = (binding: Node) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "h",
      type: "core/heading",
      version: 1,
      props: { text: "Own", level: 2 },
      bindings: { text: binding },
    },
  ],
});

describe.each(getConfiguredTestDialects())(
  "the bindings report kept on writes (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        collections: [
          defineCollection({
            slug: ARTICLES,
            fields: [
              text({ name: "title" }),
              { name: "content", type: BLOCKS_TYPE } as never,
            ],
          }),
        ],
      });
    });

    afterAll(async () => {
      await t?.destroy();
    });

    /** The report's row for an article, as stored. */
    async function rowOf(
      id: string
    ): Promise<Record<string, unknown> | undefined> {
      const rows = await t.adapter.select<Record<string, unknown>>(TABLE);
      return rows.find(
        row => row.document_key === `collection:${ARTICLES}:${id}`
      );
    }

    /** The codes a row's stored issues carry. */
    function codesOf(row: Record<string, unknown> | undefined): string[] {
      const issues: unknown =
        typeof row?.issues === "string" ? JSON.parse(row.issues) : row?.issues;
      return Array.isArray(issues)
        ? issues.flatMap(issue => (issue as { codes: string[] }).codes)
        : [];
    }

    it("reports a broken binding a save kept, nothing once fixed, and nothing once deleted", async () => {
      const created = await t.nextly.create({
        collection: ARTICLES,
        data: { title: "Launch", content: pageOf({ $bind: "title" }) },
        overrideAccess: true,
      });
      const id = String(created.item.id);
      // Fits: nothing to report.
      expect(codesOf(await rowOf(id))).toEqual([]);

      // Planted past every check, as a save before a rename left it, then
      // saved again with an edit beside it: the save keeps the binding, and
      // the report lists it.
      const registry = t.getService("collectionRegistryService") as unknown as {
        getCollectionBySlug(
          slug: string
        ): Promise<{ tableName: string } | null>;
      };
      const table = (await registry.getCollectionBySlug(ARTICLES))!.tableName;
      const broken = pageOf({ $bind: "headline", fallback: "Untitled" });
      await t.adapter.update(
        table,
        { content: dialect === "sqlite" ? JSON.stringify(broken) : broken },
        { and: [{ column: "id", op: "=", value: id }] }
      );
      await t.nextly.update({
        collection: ARTICLES,
        id,
        data: asOverwrite({ title: "Launch day", content: broken }),
        overrideAccess: true,
      });
      const row = await rowOf(id);
      expect(row?.place).toBe("entries");
      expect(codesOf(row)).toEqual(["binding-field-missing"]);

      await t.nextly.update({
        collection: ARTICLES,
        id,
        data: asOverwrite({ content: pageOf({ $bind: "title" }) }),
        overrideAccess: true,
      });
      expect(codesOf(await rowOf(id))).toEqual([]);

      // Broken again, then deleted: the row goes with it.
      await t.adapter.update(
        table,
        { content: dialect === "sqlite" ? JSON.stringify(broken) : broken },
        { and: [{ column: "id", op: "=", value: id }] }
      );
      await t.nextly.update({
        collection: ARTICLES,
        id,
        data: asOverwrite({ title: "Again", content: broken }),
        overrideAccess: true,
      });
      expect(codesOf(await rowOf(id))).toEqual(["binding-field-missing"]);
      await t.nextly.delete({
        collection: ARTICLES,
        id,
        overrideAccess: true,
      });
      expect(codesOf(await rowOf(id))).toEqual([]);
    });
  }
);
