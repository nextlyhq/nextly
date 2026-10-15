/**
 * A composed document is judged on every path a write can take.
 *
 * The unit suites judge the composition against an in-memory store. What only
 * a database can show is the part core contributes: that the field's
 * validation runs on the batch path with hooks skipped, that its reads are on
 * the batch's own transaction — so a row an earlier entry of the same batch
 * wrote is seen — that a status-only publish is judged on the document it
 * promotes, and that a component save finds the pages placing it through the
 * usage index the page writes maintain.
 *
 * Per dialect, because the transaction a read joins is the adapter's.
 *
 * @module __tests__/composition-on-every-write.integration.test
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { pageBuilder } from "../plugin";

type Node = Record<string, unknown>;

const text = (id: string): Node => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
});

const box = (id: string, children: Node[]): Node => ({
  id,
  type: "core/box",
  version: 1,
  props: {},
  slots: { children },
});

const placing = (id: string, componentId: string, extra: Node = {}): Node => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
  ...extra,
});

const document = (
  kind: "page" | "component",
  nodes: Node[],
  envelope: Node = {}
) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind,
  nodes,
  ...envelope,
});

/** The validation issues a refused write carries. */
function issuesOf(error: unknown): Array<{ code: string; message: string }> {
  return (
    (
      error as {
        publicData?: { errors?: Array<{ code: string; message: string }> };
      }
    ).publicData?.errors ?? []
  );
}

const codesOf = (error: unknown) => issuesOf(error).map(issue => issue.code);

/** What a write threw, or `undefined` when it went through. */
async function refusalOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
    return undefined;
  } catch (error) {
    return error;
  }
}

/** The batch worker behind every bulk write, imports included. */
interface BatchEntries {
  updateEntries(
    params: { collectionName: string; overrideAccess?: boolean },
    entries: { id: string; data: Record<string, unknown> }[],
    options?: { skipHooks?: boolean }
  ): Promise<{
    successful: number;
    failed: number;
    errors: { error: string }[];
  }>;
}

function batchOf(t: TestNextly): BatchEntries {
  const handler = t.getService("collectionsHandler") as unknown as {
    getEntryService(): BatchEntries;
  };
  return handler.getEntryService();
}

describe.each(getConfiguredTestDialects())(
  "composition judged on every write path (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** Boot with a small depth limit, so a too-deep document stays readable. */
    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder({ limits: { ...DEFAULT_LIMITS, maxDepth: 4 } })],
      });
      return current;
    }

    async function component(
      t: TestNextly,
      slug: string,
      nodes: Node[],
      envelope: Node = {}
    ) {
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: slug,
          slug,
          content: document("component", nodes, envelope),
        },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    async function storedContent(t: TestNextly, id: string): Promise<unknown> {
      const row = await t.nextly.findByID({
        collection: COMPONENTS_SLUG,
        id,
        depth: 0,
        status: "all",
        draft: true,
        overrideAccess: true,
      });
      return (row as Record<string, unknown>).content;
    }

    it("refuses a loop an import writes with hooks skipped", async () => {
      const t = await boot();
      const a = await component(t, "a", [text("t1")]);
      const b = await component(t, "b", [placing("n1", a)]);

      const result = await batchOf(t).updateEntries(
        { collectionName: COMPONENTS_SLUG, overrideAccess: true },
        [
          {
            id: a,
            data: { content: document("component", [placing("n2", b)]) },
          },
        ],
        { skipHooks: true }
      );

      expect(result.failed, JSON.stringify(result)).toBe(1);
      // And nothing landed: `a` still holds only its text.
      expect(JSON.stringify(await storedContent(t, a))).not.toContain(b);
    });

    it("refuses the second half of a loop two entries of one batch close", async () => {
      // Each entry alone closes nothing against the library as committed. Only
      // a read on the batch's own transaction sees the first entry's row when
      // the second is judged.
      const t = await boot();
      const a = await component(t, "a", [text("t1")]);
      const b = await component(t, "b", [text("t2")]);

      const result = await batchOf(t).updateEntries(
        { collectionName: COMPONENTS_SLUG, overrideAccess: true },
        [
          {
            id: a,
            data: { content: document("component", [placing("n1", b)]) },
          },
          {
            id: b,
            data: { content: document("component", [placing("n2", a)]) },
          },
        ],
        { skipHooks: true }
      );

      expect(result.successful, JSON.stringify(result)).toBe(1);
      expect(result.failed).toBe(1);
      expect(JSON.stringify(await storedContent(t, b))).not.toContain(a);
    });

    it("refuses a status-only publish whose pending draft closes a loop", async () => {
      // The loop is planted in storage directly, as an older writer could have
      // left it: `b`'s live row places `a`, and `a`'s pending draft places `b`.
      // Publishing `a` by status alone promotes that draft, and is what is judged.
      const t = await boot();
      const a = await component(t, "a", [text("t1")]);
      const b = await component(t, "b", [text("t2")]);
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id: a,
        data: { status: "published" },
        overrideAccess: true,
      });
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id: a,
        data: { content: document("component", [placing("n1", b)]) },
        overrideAccess: true,
      });
      const registry = t.getService("collectionRegistryService") as unknown as {
        getCollectionBySlug(
          slug: string
        ): Promise<{ tableName: string } | null>;
      };
      const table = (await registry.getCollectionBySlug(COMPONENTS_SLUG))!
        .tableName;
      const planted = document("component", [placing("n2", a)]);
      await t.adapter.update(
        table,
        // SQLite stores a JSON column as text; the others take the value.
        { content: dialect === "sqlite" ? JSON.stringify(planted) : planted },
        { and: [{ column: "id", op: "=", value: b }] }
      );

      const refused = await refusalOf(
        t.nextly.update({
          collection: COMPONENTS_SLUG,
          id: a,
          data: { status: "published" },
          overrideAccess: true,
        })
      );

      expect(codesOf(refused)).toEqual(["COMPONENT_CYCLE"]);
    });

    it("refuses a page that composes past the depth limit", async () => {
      const t = await boot();
      const deep = await component(t, "deep", [box("d1", [text("d2")])]);

      // Placed four deep and two deep inside: five, past the limit of four,
      // while the page alone is four and the component alone two.
      const pastLimit = page(t, [
        box("p1", [box("p2", [box("p3", [placing("i1", deep)])])]),
      ]);
      expect(codesOf(await refusalOf(pastLimit))).toEqual(["depth-exceeded"]);

      // CONTROL: one level higher ends exactly at the limit, which fits.
      await expect(
        page(t, [box("p1", [box("p2", [placing("i1", deep)])])])
      ).resolves.toBeDefined();
    });

    it("refuses page content a placement puts where the component cannot hold it", async () => {
      const t = await boot();
      const row = await component(
        t,
        "row",
        [
          {
            id: "c",
            type: "core/columns",
            version: 1,
            props: {},
            slots: { children: [] },
          },
        ],
        { slots: { cells: { label: "Cells", nodeId: "c", slot: "children" } } }
      );

      const refused = await refusalOf(
        page(t, [
          placing("i1", row, { slots: { cells: [text("not-a-column")] } }),
        ])
      );

      expect(codesOf(refused)).toContain("not-allowed-in-slot");
    });

    it("refuses deepening a component a page places at the depth limit", async () => {
      const t = await boot();
      const deep = await component(t, "deep", [box("d1", [text("d2")])]);
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id: deep,
        data: { status: "published" },
        overrideAccess: true,
      });
      // Placed three deep and two deep inside: exactly the limit of four.
      const home = await page(t, [
        box("p1", [box("p2", [placing("i1", deep)])]),
      ]);
      // The usage index is maintained once the page's write commits.
      await t.events.settle();

      const refused = await refusalOf(
        t.nextly.update({
          collection: COMPONENTS_SLUG,
          id: deep,
          data: {
            status: "published",
            content: document("component", [
              box("d1", [box("d2", [text("d3")])]),
            ]),
          },
          overrideAccess: true,
        })
      );

      expect(codesOf(refused)).toEqual(["COMPONENT_HOST_BROKEN"]);
      // How many and which rule; the page itself is named only to the server
      // log, since it was found and read as the system.
      expect(issuesOf(refused)[0]!.message).toContain("break 1 document");
      expect(issuesOf(refused)[0]!.message).not.toContain(String(home.item.id));
    });

    function page(t: TestNextly, nodes: Node[]) {
      return t.nextly.create({
        collection: "pages",
        data: {
          title: "Home",
          slug: `home-${String(Math.random()).slice(2, 8)}`,
          content: document("page", nodes),
        },
        overrideAccess: true,
      });
    }
  }
);
