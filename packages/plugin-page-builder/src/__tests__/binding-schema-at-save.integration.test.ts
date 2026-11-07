/**
 * A page's bindings, judged on a real save against the declared schema of
 * what they read, after a schema change broke one.
 *
 * Each case stores a page holding a binding that no longer fits, planted past
 * every check, as a page saved before the change is left: a field the page
 * binds renamed, a Single's field renamed, a bound prop's type changed from
 * text to number with a text fallback, a bound prop removed. Saving the page
 * again keeps that binding, since a schema change nobody made to the page
 * must not make it unsavable, and adding the same binding to another block is
 * refused, since that problem is the write's own.
 *
 * What only a server shows: the save reads the declared fields of each source
 * the page binds from the running registry, and the stored page from the
 * database, which no unit test holds.
 *
 * @module __tests__/binding-schema-at-save.integration.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  hasBlock,
  registerBlocks,
} from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, defineSingle, text } from "nextly/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asOverwrite } from "../document-version";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";

type Node = Record<string, unknown>;

const ARTICLES = "bsc_articles";
const BRAND = "bsc_brand";
const STAT = "bsc/stat";

const pageOf = (nodes: Node[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/** A heading whose text is bound as `binding` says. */
const heading = (id: string, binding?: Node): Node => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: `Heading ${id}`, level: 2 },
  ...(binding === undefined ? {} : { bindings: { text: binding } }),
});

/** A stat whose `prop` is bound as `binding` says. */
const stat = (id: string, prop: string, binding: Node): Node => ({
  id,
  type: STAT,
  version: 1,
  props: { value: 3, caption: "Visits" },
  bindings: { [prop]: binding },
});

/**
 * A stat block as it is declared now: `value` became a number, and the
 * `subtitle` it once had is gone.
 */
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

/**
 * The validation issue codes a refused write carries, sorted, or none for a
 * write that saved. Any other failure is rethrown, so a write that failed for
 * another reason never reads as a save.
 */
async function refusalCodes(write: Promise<unknown>): Promise<string[]> {
  try {
    await write;
    return [];
  } catch (error) {
    const errors = (
      error as { publicData?: { errors?: Array<{ code: string }> } }
    ).publicData?.errors;
    if (errors === undefined) throw error;
    return errors.map(issue => issue.code).sort();
  }
}

describe.each(getConfiguredTestDialects())(
  "a binding a schema change broke, on a save (%s)",
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
              // Once `headline`: pages saved before the rename bind that.
              text({ name: "title" }),
              // Declared, but visitors may not read it.
              text({ name: "internalNote", access: { read: () => false } }),
              { name: "content", type: BLOCKS_TYPE } as never,
            ],
          }),
        ],
        singles: [
          defineSingle({
            slug: BRAND,
            // Once `slogan`.
            fields: [text({ name: "motto" })],
          }),
        ],
      });
      registerStat();
    });

    afterAll(async () => {
      await t?.destroy();
    });

    /** An article saved with a page that fits, so it is stored. */
    async function article(): Promise<string> {
      const created = await t.nextly.create({
        collection: ARTICLES,
        data: { title: "Launch", content: pageOf([heading("intro")]) },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    /**
     * Write the article's page straight to its row, past every check, as a
     * save made before the schema changed left it.
     */
    async function plant(id: string, nodes: Node[]): Promise<void> {
      const registry = t.getService("collectionRegistryService") as unknown as {
        getCollectionBySlug(
          slug: string
        ): Promise<{ tableName: string } | null>;
      };
      const table = (await registry.getCollectionBySlug(ARTICLES))!.tableName;
      const planted = pageOf(nodes);
      await t.adapter.update(
        table,
        // SQLite stores a JSON column as text; the others take the value.
        { content: dialect === "sqlite" ? JSON.stringify(planted) : planted },
        { and: [{ column: "id", op: "=", value: id }] }
      );
    }

    function save(id: string, nodes: Node[]) {
      return t.nextly.update({
        collection: ARTICLES,
        id,
        data: asOverwrite({ content: pageOf(nodes) }),
        overrideAccess: true,
      });
    }

    /** The article's page as stored, as text. */
    async function storedPage(id: string): Promise<string> {
      const found = (await t.nextly.findByID({
        collection: ARTICLES,
        id,
        depth: 0,
        overrideAccess: true,
      })) as { content?: unknown };
      return typeof found.content === "string"
        ? found.content
        : JSON.stringify(found.content);
    }

    /**
     * The planted page saves again with an edit beside the broken binding,
     * which it keeps; the same binding added to a new block is refused with
     * `codes`.
     */
    async function keptButNotAdded(
      broken: (id: string) => Node,
      kept: string,
      codes: string[]
    ): Promise<void> {
      const id = await article();
      await plant(id, [broken("held")]);

      // An edit elsewhere on the page.
      expect(
        await refusalCodes(save(id, [broken("held"), heading("added")]))
      ).toEqual([]);
      expect(await storedPage(id)).toContain(kept);

      expect(
        await refusalCodes(
          save(id, [broken("held"), heading("added"), broken("again")])
        )
      ).toEqual(codes);
    }

    it("keeps a binding to a field renamed after the page was saved, and refuses a new one", async () => {
      await keptButNotAdded(
        id => heading(id, { $bind: "headline", fallback: "Untitled" }),
        '"$bind":"headline"',
        ["binding-field-missing"]
      );
    });

    it("keeps a binding to a Single's renamed field, and refuses a new one", async () => {
      await keptButNotAdded(
        id =>
          heading(id, {
            $bind: "slogan",
            source: "single",
            sourceKey: BRAND,
            fallback: "Made with care",
          }),
        '"$bind":"slogan"',
        ["binding-field-missing"]
      );
    });

    it("keeps a binding whose prop became a number, its text fallback no longer fitting, and refuses a new one", async () => {
      await keptButNotAdded(
        id => stat(id, "value", { $bind: "title", fallback: "n/a" }),
        '"fallback":"n/a"',
        ["binding-fallback-invalid", "binding-type-misfit"]
      );
    });

    it("keeps a binding to a removed prop, and refuses a new one", async () => {
      await keptButNotAdded(
        id => stat(id, "subtitle", { $bind: "title" }),
        '"subtitle"',
        ["binding-prop-missing"]
      );
    });

    it("saves a binding to a declared field visitors may not read", async () => {
      // Declared, not public: the published page shows the fallback.
      const id = await article();
      expect(
        await refusalCodes(
          save(id, [
            heading("note", { $bind: "internalNote", fallback: "Soon" }),
          ])
        )
      ).toEqual([]);
      expect(await storedPage(id)).toContain('"$bind":"internalNote"');
    });

    it("refuses a binding to a field no source declares on a new page", async () => {
      expect(
        await refusalCodes(
          t.nextly.create({
            collection: ARTICLES,
            data: {
              title: "Fresh",
              content: pageOf([heading("h", { $bind: "headline" })]),
            },
            overrideAccess: true,
          })
        )
      ).toEqual(["binding-field-missing"]);
    });
  }
);
