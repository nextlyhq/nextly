/**
 * Slot locks hold for every writer that reaches a save.
 *
 * The engine suites judge a document against the registry. What only a server
 * can show is that every write path asks: the Direct API a REST request and an
 * agent both arrive through, a batch import that skips hooks, and a page
 * placing a component, whose composition is judged as the page finally draws.
 *
 * Per dialect, because the batch path's reads are on its own transaction.
 *
 * @module __tests__/slot-locks.integration.test
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  expandSlotDefaults,
  hasBlock,
  makeNode,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
  type BlockNode,
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

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

/**
 * The defaults of a headline whose block author changes them after pages
 * store it. Held here so a case can change them as a new release would.
 */
const DRIFTING_DEFAULTS: Record<string, unknown> = {
  text: "Title",
  align: "left",
};

/**
 * The blocks under test, registered once per process: the registry refuses a
 * name registered twice, and it outlives each booted instance.
 */
function registerLockedBlocks(): void {
  if (hasBlock("acme/sealed-card")) return;
  registerBlocks(
    [
      {
        ...base,
        name: "acme/headline",
        props: {
          text: { type: "text", role: "content" },
          align: { type: "select" },
        },
        defaultProps: { text: "Title", align: "left" },
      },
      {
        ...base,
        name: "acme/sealed-card",
        slots: {
          body: {
            defaultBlock: [{ type: "acme/headline" }],
            lock: "contentOnly",
          },
        },
      },
      {
        ...base,
        name: "acme/drifting-headline",
        props: {
          text: { type: "text", role: "content" },
          align: { type: "select" },
        },
        defaultProps: DRIFTING_DEFAULTS,
      },
      {
        ...base,
        name: "acme/drifting-card",
        slots: {
          body: {
            defaultBlock: [{ type: "acme/drifting-headline" }],
            lock: "contentOnly",
          },
        },
      },
      {
        ...base,
        name: "acme/hero",
        slots: {
          content: {
            defaultBlock: [
              { type: "acme/headline" },
              { type: "acme/headline" },
            ],
            lock: "all",
          },
        },
      },
    ] as never,
    { source: "acme" }
  );
}

/** A block as inserting it places it. */
function placed(type: string): BlockNode {
  return makeNode(
    type,
    1,
    {},
    expandSlotDefaults(type, registryBlockSource(), registryNestingSource())
  );
}

const pageOf = (nodes: unknown[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

function issuesOf(
  error: unknown
): Array<{ path: string; code: string; message: string }> {
  return (
    (
      error as {
        publicData?: {
          errors?: Array<{ path: string; code: string; message: string }>;
        };
      }
    ).publicData?.errors ?? []
  );
}

async function refusalOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe.each(getConfiguredTestDialects())(
  "slot locks on every write path (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
      registerLockedBlocks();
      return current;
    }

    function savePage(t: TestNextly, nodes: unknown[]) {
      return t.nextly.create({
        collection: "pages",
        data: {
          title: "Home",
          slug: `home-${String(Math.random()).slice(2, 8)}`,
          content: pageOf(nodes),
        },
        overrideAccess: true,
      });
    }

    it("refuses an API save whose slot locked all lost a block, naming the slot and the rule", async () => {
      const t = await boot();
      // CONTROL: as inserted, the page saves.
      await expect(savePage(t, [placed("acme/hero")])).resolves.toBeDefined();

      const hero = placed("acme/hero");
      hero.slots!.content!.pop();
      const issues = issuesOf(await refusalOf(savePage(t, [hero])));

      expect(issues).toEqual([
        expect.objectContaining({
          path: "content",
          code: "locked-slot-altered",
        }),
      ]);
      expect(issues[0]!.message).toContain('"content"');
      expect(issues[0]!.message).toContain('"all"');
    });

    it("accepts an API save that changes only content inside contentOnly", async () => {
      const t = await boot();
      const card = placed("acme/sealed-card");
      card.slots!.body![0]!.props.text = "Spring sale";
      await expect(savePage(t, [card])).resolves.toBeDefined();
    });

    it.each([
      [
        "a prop that is not content",
        (n: BlockNode) => (n.props.align = "right"),
      ],
      [
        "its styles",
        (n: BlockNode) => (n.styles = { base: { base: { color: "#ff0000" } } }),
      ],
      ["its classes", (n: BlockNode) => (n.classes = ["promo"])],
      [
        "its visibility",
        (n: BlockNode) => (n.visibility = { devices: { base: false } }),
      ],
      ["its custom CSS", (n: BlockNode) => (n.customCss = "color: red;")],
      ["its own lock", (n: BlockNode) => (n.locked = true)],
    ])(
      "refuses an API save that changes %s inside contentOnly",
      async (_kind, change) => {
        const t = await boot();
        const card = placed("acme/sealed-card");
        change(card.slots!.body![0]!);

        const issues = issuesOf(await refusalOf(savePage(t, [card])));

        expect(issues.map(issue => issue.code)).toEqual([
          "locked-slot-content-only",
        ]);
      }
    );

    it("keeps what a block's changed defaults left behind, accepts the repair, and refuses a third value", async () => {
      const t = await boot();
      const card = placed("acme/drifting-card");
      const saved = await savePage(t, [card]);
      const id = String(saved.item.id);
      const withAlign = (align: string) => {
        const next = structuredClone(card);
        next.slots!.body![0]!.props.align = align;
        return pageOf([next]);
      };
      const update = (content: unknown) =>
        t.nextly.update({
          collection: "pages",
          id,
          data: { content },
          overrideAccess: true,
        });

      // A new release of the headline aligns it centre by default. The page
      // still holds "left", which nobody changed.
      DRIFTING_DEFAULTS.align = "center";
      try {
        // CONTROL: a page never stored holding "left" is now refused, so the
        // changed default is what every save below is measured against.
        expect(
          issuesOf(await refusalOf(savePage(t, [card]))).map(i => i.code)
        ).toEqual(["locked-slot-content-only"]);

        await expect(update(pageOf([card]))).resolves.toBeDefined();
        const third = issuesOf(await refusalOf(update(withAlign("right"))));
        expect(third.map(issue => issue.code)).toEqual([
          "locked-slot-content-only",
        ]);
        await expect(update(withAlign("center"))).resolves.toBeDefined();
      } finally {
        DRIFTING_DEFAULTS.align = "left";
      }
    });

    it("refuses an import that skips hooks and breaks a lock", async () => {
      const t = await boot();
      const saved = await savePage(t, [placed("acme/sealed-card")]);
      const card = placed("acme/sealed-card");
      card.slots!.body![0]!.props.align = "right";
      const entries = (
        t.getService("collectionsHandler") as unknown as {
          getEntryService(): {
            updateEntries(
              params: { collectionName: string; overrideAccess?: boolean },
              entries: { id: string; data: Record<string, unknown> }[],
              options?: { skipHooks?: boolean }
            ): Promise<{ successful: number; failed: number }>;
          };
        }
      ).getEntryService();

      const result = await entries.updateEntries(
        { collectionName: "pages", overrideAccess: true },
        [{ id: String(saved.item.id), data: { content: pageOf([card]) } }],
        { skipHooks: true }
      );

      expect(result.failed, JSON.stringify(result)).toBe(1);
    });

    describe("a page placing a component that holds a lock", () => {
      async function promo(t: TestNextly): Promise<string> {
        const card = placed("acme/sealed-card");
        const headline = card.slots!.body![0]!;
        const hero = placed("acme/hero");
        const created = await t.nextly.create({
          collection: COMPONENTS_SLUG,
          data: {
            title: "Promo",
            slug: "promo",
            content: {
              formatVersion: DOCUMENT_FORMAT_VERSION,
              kind: "component",
              nodes: [card, hero],
              exposed: [
                {
                  id: "title",
                  label: "Title",
                  nodeId: headline.id,
                  propPath: "text",
                  type: "text",
                },
              ],
              slots: {
                extra: { label: "Extra", nodeId: hero.id, slot: "content" },
              },
            },
            status: "published",
          },
          overrideAccess: true,
        });
        return String(created.item.id);
      }

      const placing = (
        componentId: string,
        extra: Record<string, unknown> = {}
      ) => ({
        id: "i1",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId },
        ...extra,
      });

      it("refuses content supplied to an exposed slot that a lock holds", async () => {
        const t = await boot();
        const id = await promo(t);
        // CONTROL: placed as it is, the page saves.
        await expect(savePage(t, [placing(id)])).resolves.toBeDefined();

        const issues = issuesOf(
          await refusalOf(
            savePage(t, [
              placing(id, {
                slots: {
                  extra: [
                    makeNode("acme/headline", 1, { text: "One" }),
                    makeNode("acme/headline", 1, { text: "Two" }),
                    makeNode("acme/headline", 1, { text: "Three" }),
                  ],
                },
              }),
            ])
          )
        );

        expect(issues.map(issue => issue.code)).toEqual([
          "locked-slot-altered",
        ]);
      });

      it("accepts a content value on a placement and refuses a design value on the same placement", async () => {
        const t = await boot();
        const id = await promo(t);
        // An exposure of the headline's alignment, stored before saves refused
        // one, as an older writer could have left it: a component cannot save
        // a new one now.
        await plantExposure(t, id, {
          id: "side",
          label: "Alignment",
          propPath: "align",
          type: "select",
          options: [{ value: "right", label: "Right" }],
        });

        await expect(
          savePage(t, [
            placing(id, {
              props: { componentId: id, overrides: { title: "Sale" } },
            }),
          ])
        ).resolves.toBeDefined();
        const issues = issuesOf(
          await refusalOf(
            savePage(t, [
              placing(id, {
                props: {
                  componentId: id,
                  overrides: { title: "Sale", side: "right" },
                },
              }),
            ])
          )
        );
        expect(issues.map(issue => issue.code)).toEqual([
          "locked-slot-content-only",
        ]);
      });

      /** Add an exposure of the sealed headline to the stored component, past every check. */
      async function plantExposure(
        t: TestNextly,
        id: string,
        exposure: Record<string, unknown>
      ): Promise<void> {
        const registry = t.getService(
          "collectionRegistryService"
        ) as unknown as {
          getCollectionBySlug(
            slug: string
          ): Promise<{ tableName: string } | null>;
        };
        const table = (await registry.getCollectionBySlug(COMPONENTS_SLUG))!
          .tableName;
        const row = await t.nextly.findByID({
          collection: COMPONENTS_SLUG,
          id,
          depth: 0,
          overrideAccess: true,
        });
        const content = (row as { content: Record<string, unknown> }).content;
        const exposed = content.exposed as Array<{ nodeId: string }>;
        const planted = {
          ...content,
          exposed: [...exposed, { ...exposure, nodeId: exposed[0]!.nodeId }],
        };
        await t.adapter.update(
          table,
          // SQLite stores a JSON column as text; the others take the value.
          { content: dialect === "sqlite" ? JSON.stringify(planted) : planted },
          { and: [{ column: "id", op: "=", value: id }] }
        );
      }
    });
  }
);
