/**
 * The "Bindings to fix" report, kept on real writes: a page saved holding a
 * binding that no longer fits is reported, saving it fixed reports nothing,
 * and deleting the page reports nothing either. A document judged whole keeps
 * a row with no issues, which is how the report says "nothing to fix".
 *
 * What only a server shows: each committed write marks its document in the
 * plugin's own table, and the report's job judges it as stored, which no unit
 * test reaches. The job is run here as a jobs pass runs it, after each write.
 *
 * @module __tests__/bindings-report.integration.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  defineNamedQuery,
  hasBlock,
  registerBlocks,
} from "@nextlyhq/blocks-engine";
import type { PluginDefinition } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, defineSingle, text } from "nextly/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BINDINGS_REPORT_JOB } from "../bindings-report/job";
import { asOverwrite } from "../document-version";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { documentKeyOf } from "../host-rewrite/contract";
import { pageBuilder } from "../plugin";

type Node = Record<string, unknown>;

const ARTICLES = "bri_articles";
const BRAND = "bri_brand";
const STAT = "bri/stat";
const TABLE = "page_builder__binding_issues";

/** Rows of their own, declaring a price and nothing else. */
const deals = defineNamedQuery({
  name: "bri.deals",
  label: "Deals",
  reads: { collections: [ARTICLES] },
  rows: {
    key: "id",
    fields: [
      { name: "id", type: "text" },
      { name: "price", type: "number" },
    ],
  },
  async run() {
    return { rows: [] };
  },
});

/** A block whose `value` is a number and which has no `subtitle`. */
function registerStat(): void {
  if (hasBlock(STAT)) return;
  registerBlocks(
    [
      {
        name: STAT,
        version: 1,
        description: "A number with a caption.",
        example: { props: {} },
        render: () => null,
        props: {
          value: { type: "number" },
          caption: { type: "text", role: "content" },
        },
        defaultProps: { value: 0, caption: "" },
      },
    ] as never,
    { source: "test" } as never
  );
}

/** A page of these nodes. */
const pageWith = (nodes: Node[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/** A list of `props`' source, its entries drawn with one item-bound heading. */
const listOf = (props: Node, path: string): Node => ({
  id: "list",
  type: "core/collection-loop",
  version: 1,
  props: { limit: 3, ...props },
  slots: {
    children: [
      {
        id: "entry",
        type: "core/heading",
        version: 1,
        props: { text: "Own", level: 2 },
        bindings: {
          text: { $bind: path, source: "item", fallback: "Untitled" },
        },
      },
    ],
  },
});

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

/** The report's job, as a jobs pass runs it. */
function reportPass(plugin: PluginDefinition): () => Promise<unknown> {
  const job = plugin.contributes?.jobs?.find(
    entry => entry.slug === BINDINGS_REPORT_JOB
  );
  if (job === undefined) throw new Error("the page builder has no report job");
  return async () =>
    job.handler(
      null as never,
      {
        user: null,
        now: new Date(),
        deadline: new Date(Date.now() + 60_000),
        content: {},
      } as never
    );
}

describe.each(getConfiguredTestDialects())(
  "the bindings report kept on writes (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let pass: () => Promise<unknown>;

    beforeAll(async () => {
      const plugin = pageBuilder({ namedQueries: [deals] });
      pass = reportPass(plugin);
      t = await createTestNextly({
        dialect,
        plugins: [plugin],
        collections: [
          defineCollection({
            slug: ARTICLES,
            fields: [
              text({ name: "title" }),
              { name: "content", type: BLOCKS_TYPE } as never,
            ],
          }),
        ],
        singles: [
          defineSingle({ slug: BRAND, fields: [text({ name: "motto" })] }),
        ],
      });
      registerStat();
    });

    afterAll(async () => {
      await t?.destroy();
    });

    /** The report's row for an article, as stored. */
    async function rowOf(
      id: string
    ): Promise<Record<string, unknown> | undefined> {
      const rows = await t.adapter.select<Record<string, unknown>>(TABLE);
      // The key as the store spells it, through the one function that does.
      const key = documentKeyOf({ kind: "collection", slug: ARTICLES, id });
      return rows.find(row => row.documentKey === key);
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
      await pass();
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
      await pass();
      const row = await rowOf(id);
      expect(row?.place).toBe("entries");
      expect(codesOf(row)).toEqual(["binding-field-missing"]);

      await t.nextly.update({
        collection: ARTICLES,
        id,
        data: asOverwrite({ content: pageOf({ $bind: "title" }) }),
        overrideAccess: true,
      });
      await pass();
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
      await pass();
      expect(codesOf(await rowOf(id))).toEqual(["binding-field-missing"]);
      await t.nextly.delete({
        collection: ARTICLES,
        id,
        overrideAccess: true,
      });
      await pass();
      expect(codesOf(await rowOf(id))).toEqual([]);
    });
    /**
     * The codes reported for a page planted past every check, as a save before
     * a schema change left it, then saved again with an edit beside it: the
     * save keeps it, and the report lists the document.
     */
    async function reportedAfterChange(nodes: Node[]): Promise<string[]> {
      const created = await t.nextly.create({
        collection: ARTICLES,
        data: { title: "Launch", content: pageWith([]) },
        overrideAccess: true,
      });
      const id = String(created.item.id);
      const registry = t.getService("collectionRegistryService") as unknown as {
        getCollectionBySlug(
          slug: string
        ): Promise<{ tableName: string } | null>;
      };
      const table = (await registry.getCollectionBySlug(ARTICLES))!.tableName;
      const planted = pageWith(nodes);
      await t.adapter.update(
        table,
        { content: dialect === "sqlite" ? JSON.stringify(planted) : planted },
        { and: [{ column: "id", op: "=", value: id }] }
      );
      await t.nextly.update({
        collection: ARTICLES,
        id,
        data: asOverwrite({ title: "Launch day", content: planted }),
        overrideAccess: true,
      });
      await pass();
      return codesOf(await rowOf(id)).sort();
    }

    it.each([
      [
        "a Single's field renamed",
        [
          {
            id: "h",
            type: "core/heading",
            version: 1,
            props: { text: "Own", level: 2 },
            bindings: {
              text: {
                $bind: "slogan",
                source: "single",
                sourceKey: BRAND,
                fallback: "Made with care",
              },
            },
          },
        ],
        ["binding-field-missing"],
      ],
      [
        "a bound prop that became a number, its text fallback no longer fitting",
        [
          {
            id: "s",
            type: STAT,
            version: 1,
            props: { value: 3, caption: "Visits" },
            bindings: { value: { $bind: "title", fallback: "n/a" } },
          },
        ],
        ["binding-fallback-invalid", "binding-type-misfit"],
      ],
      [
        "a bound prop removed from the block",
        [
          {
            id: "s",
            type: STAT,
            version: 1,
            props: { value: 3, caption: "Visits" },
            bindings: { subtitle: { $bind: "title" } },
          },
        ],
        ["binding-prop-missing"],
      ],
      [
        "a field renamed in the collection a list shows",
        [listOf({ collection: ARTICLES }, "headline")],
        ["binding-field-missing"],
      ],
      [
        "a named query's rows no longer declaring a field",
        [listOf({ namedQuery: { name: "bri.deals", params: {} } }, "title")],
        ["binding-field-missing"],
      ],
    ] as const)(
      "lists the document after %s",
      async (_change, nodes, codes) => {
        expect(await reportedAfterChange([...nodes] as Node[])).toEqual([
          ...codes,
        ]);
      }
    );
  }
);
