/**
 * A blocks field inside a named group is judged against what the page already
 * stores, as a top-level one is.
 *
 * A `contentOnly` part a block's changed defaults left behind, and a placement
 * break a page held before the rule reached it, are kept rather than refused,
 * which needs the field's stored value. Inside a named group that value is
 * read by the field's path (`hero.body`), through the group's own column. Read
 * as a top-level name, the read is refused and the save fails as a whole.
 *
 * Per dialect, because a group's value is stored as `jsonb`, `json` or text.
 *
 * @module __tests__/blocks-field-in-a-named-group.integration.test
 */
import {
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
import { group, text } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { blocks } from "../fields/blocksHelper";
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
 * Whether the placement rule reaches the linked box yet. Off, a linked box
 * refuses nothing, which is how a page stored before the rule held a break.
 */
const RULE = { on: false };

/**
 * The blocks under test, registered once per process: the registry refuses a
 * name registered twice, and it outlives each booted instance.
 */
function registerGroupBlocks(): void {
  if (hasBlock("grp/drifting-card")) return;
  registerBlocks(
    [
      {
        ...base,
        name: "grp/drifting-headline",
        props: {
          text: { type: "text", role: "content" },
          align: { type: "select" },
        },
        defaultProps: DRIFTING_DEFAULTS,
      },
      {
        ...base,
        name: "grp/drifting-card",
        slots: {
          body: {
            defaultBlock: [{ type: "grp/drifting-headline" }],
            lock: "contentOnly",
          },
        },
      },
      {
        ...base,
        name: "grp/linkbox",
        slots: { children: {} },
        contentModel: (props: { link?: string }) =>
          RULE.on && props.link
            ? {
                is: ["flow", "interactive"],
                accepts: { without: ["interactive"] },
              }
            : { is: ["flow"] },
      },
      {
        ...base,
        name: "grp/cta",
        contentModel: () => ({ is: ["flow", "phrasing", "interactive"] }),
      },
      { ...base, name: "grp/note" },
    ] as never,
    { source: "grp" }
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

const leaf = (id: string, type: string): BlockNode => ({
  id,
  type,
  version: 1,
  props: {},
});

/** A linked box holding the calls to action it is given. */
const linkbox = (ctas: string[]): BlockNode => ({
  id: "box",
  type: "grp/linkbox",
  version: 1,
  props: { link: "/go" },
  slots: { children: ctas.map(id => leaf(id, "grp/cta")) },
});

/**
 * The validation issue codes a refused write carries, or none for a write
 * that saved. Any other failure is rethrown, so a write that failed for
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
    return errors.map(issue => issue.code);
  }
}

describe.each(getConfiguredTestDialects())(
  "a blocks field inside a named group (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      DRIFTING_DEFAULTS.align = "left";
      RULE.on = false;
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        collections: [
          {
            slug: "features",
            fields: [
              text({ name: "title" }),
              group({
                name: "hero",
                fields: [
                  blocks({ name: "body" }),
                  // A group in a group: the path is walked to any depth.
                  group({ name: "inner", fields: [blocks({ name: "body" })] }),
                ],
              }),
            ],
          } as never,
        ],
        singles: [
          {
            slug: "frontpage",
            fields: [
              group({ name: "hero", fields: [blocks({ name: "body" })] }),
            ],
          } as never,
        ],
      });
      registerGroupBlocks();
      return current;
    }

    /** The card with its headline aligned `align`. */
    function cardAligned(card: BlockNode, align: string): BlockNode {
      const next = structuredClone(card);
      next.slots!.body![0]!.props.align = align;
      return next;
    }

    it.each([
      ["hero.body", (body: unknown) => ({ hero: { body } })],
      ["hero.inner.body", (body: unknown) => ({ hero: { inner: { body } } })],
    ])(
      "keeps what a block's changed defaults left behind in %s, and refuses a third value",
      async (_path, at) => {
        const t = await boot();
        const card = placed("grp/drifting-card");
        const saved = await t.nextly.create({
          collection: "features" as never,
          data: { title: "Feature", ...at(pageOf([card])) } as never,
          overrideAccess: true,
        });
        const id = String(saved.item.id);
        const update = (nodes: BlockNode[]) =>
          t.nextly.update({
            collection: "features" as never,
            id,
            data: { ...at(pageOf(nodes)), _overwrite: true } as never,
            overrideAccess: true,
          });

        // A new release of the headline aligns it centre by default. The page
        // still holds "left", which nobody changed.
        DRIFTING_DEFAULTS.align = "center";

        // CONTROL: a page never stored holding "left" is now refused, so the
        // changed default is what every save below is measured against.
        expect(
          await refusalCodes(
            t.nextly.create({
              collection: "features" as never,
              data: { title: "New", ...at(pageOf([card])) } as never,
              overrideAccess: true,
            })
          )
        ).toEqual(["locked-slot-content-only"]);

        // Kept: the stored page holds it.
        expect(await refusalCodes(update([card]))).toEqual([]);
        // A third value is still refused: the stored page is a baseline, not
        // a pass.
        expect(
          await refusalCodes(update([cardAligned(card, "right")]))
        ).toEqual(["locked-slot-content-only"]);
      }
    );

    it("keeps what a Single's stored page holds in a named group", async () => {
      const t = await boot();
      const card = placed("grp/drifting-card");
      const save = (nodes: BlockNode[]) =>
        t.nextly.updateSingle({
          slug: "frontpage" as never,
          data: { hero: { body: pageOf(nodes) }, _overwrite: true } as never,
          overrideAccess: true,
        } as never);
      await save([card]);

      DRIFTING_DEFAULTS.align = "center";
      expect(await refusalCodes(save([card]))).toEqual([]);
      expect(await refusalCodes(save([cardAligned(card, "right")]))).toEqual([
        "locked-slot-content-only",
      ]);
    });

    it("keeps a placement break the stored page already held, and refuses a new one", async () => {
      const t = await boot();
      // Saved before the rule reached the box: a call to action under a link.
      const saved = await t.nextly.create({
        collection: "features" as never,
        data: {
          title: "Feature",
          hero: { body: pageOf([linkbox(["cta"])]) },
        } as never,
        overrideAccess: true,
      });
      const id = String(saved.item.id);
      const update = (nodes: BlockNode[]) =>
        t.nextly.update({
          collection: "features" as never,
          id,
          data: { hero: { body: pageOf(nodes) }, _overwrite: true } as never,
          overrideAccess: true,
        });
      RULE.on = true;

      // An unrelated edit beside the box saves: the break is the page's own.
      expect(
        await refusalCodes(
          update([linkbox(["cta"]), leaf("added", "grp/note")])
        )
      ).toEqual([]);
      // A second call to action under the link is a break of the write's own.
      expect(await refusalCodes(update([linkbox(["cta", "second"])]))).toEqual([
        "content-model",
      ]);
    });
  }
);
