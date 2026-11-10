/**
 * The placement rule on a save: a break a write introduces is refused, and a
 * break the stored page already held is kept, so a page saved before the rule
 * still saves its other changes without losing a block.
 *
 * A page "from before the rule" is made the way such pages came about: saved
 * while the rule did not reach it, then judged once it does. The blocks read a
 * switch for that, as `slot-locks` drifts a block's defaults after a save.
 *
 * Per dialect, because the stored page is read back from each one's tables.
 *
 * @module __tests__/placement.integration.test
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  hasBlock,
  registerBlocks,
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
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

/**
 * Whether the rule reaches the blocks below yet. Off, a linked box refuses
 * nothing and the aside slot is declared, which is how a page stored before
 * the rule held what it holds.
 */
const RULE = { on: false };

/** The box's slots, so turning the rule on can withdraw the aside. */
const BOX_SLOTS: Record<string, object> = { children: {}, aside: {} };

function registerPlacementBlocks(): void {
  if (hasBlock("acme/linkbox")) return;
  registerBlocks(
    [
      {
        ...base,
        name: "acme/linkbox",
        slots: BOX_SLOTS,
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
        name: "acme/cta",
        contentModel: () => ({ is: ["flow", "phrasing", "interactive"] }),
      },
      { ...base, name: "acme/note" },
    ] as never,
    { source: "acme" }
  );
}

function ruleOn(): void {
  RULE.on = true;
  delete BOX_SLOTS.aside;
}

function ruleOff(): void {
  RULE.on = false;
  BOX_SLOTS.aside = {};
}

const pageOf = (nodes: unknown[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

const cta = (id: string): BlockNode => ({
  id,
  type: "acme/cta",
  version: 1,
  props: {},
});
const note = (id: string): BlockNode => ({
  id,
  type: "acme/note",
  version: 1,
  props: {},
});

/** A linked box holding a call to action, and a note in its aside. */
function brokenBox(): BlockNode {
  return {
    id: "box",
    type: "acme/linkbox",
    version: 1,
    props: { link: "/go" },
    slots: { children: [cta("cta")], aside: [note("aside-note")] },
  };
}

function issuesOf(error: unknown): Array<{ code: string; message: string }> {
  return (
    (
      error as {
        publicData?: { errors?: Array<{ code: string; message: string }> };
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
  "the placement rule on a save (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      ruleOff();
      await current?.destroy();
      current = undefined;
    });

    const warnings: string[] = [];
    const warned: unknown[] = [];
    const logger = {
      debug() {},
      info() {},
      warn(message: string, meta?: unknown) {
        warnings.push(message);
        warned.push(meta);
      },
      error() {},
    };

    async function boot(
      options: { translated?: boolean } = {}
    ): Promise<TestNextly> {
      warnings.length = 0;
      warned.length = 0;
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        logger,
        ...(options.translated
          ? {
              collections: [
                {
                  slug: "articles",
                  localized: true,
                  fields: [
                    { name: "title", type: "text", localized: true },
                    { name: "content", type: BLOCKS_TYPE, localized: true },
                  ],
                } as never,
              ],
              localization: { locales: ["en", "de"], defaultLocale: "en" },
            }
          : {}),
      });
      registerPlacementBlocks();
      return current;
    }

    async function storedPage(t: TestNextly): Promise<string> {
      const saved = await t.nextly.create({
        collection: "pages",
        data: {
          title: "Home",
          slug: `home-${String(Math.random()).slice(2, 8)}`,
          content: pageOf([brokenBox()]),
        },
        overrideAccess: true,
      });
      return String(saved.item.id);
    }

    function update(t: TestNextly, id: string, nodes: unknown[]) {
      return t.nextly.update({
        collection: "pages",
        id,
        data: { content: pageOf(nodes), _overwrite: true },
        overrideAccess: true,
      });
    }

    it("refuses a new page that puts a call to action inside a link", async () => {
      const t = await boot();
      ruleOn();
      const box = { ...brokenBox(), slots: { children: [cta("cta")] } };
      const issues = issuesOf(
        await refusalOf(
          t.nextly.create({
            collection: "pages",
            data: { title: "Home", slug: "new-break", content: pageOf([box]) },
            overrideAccess: true,
          })
        )
      );
      expect(issues.map(issue => issue.code)).toEqual(["content-model"]);
    });

    it("saves an unrelated edit to a stored page that already breaks the rule, losing no block", async () => {
      const t = await boot();
      const id = await storedPage(t);
      ruleOn();

      // A note added beside the box: the box's breaks are where they were,
      // a call to action under its link and a note in a slot it no longer
      // declares.
      const saved = await update(t, id, [brokenBox(), note("added")]);
      const content = (saved.item as { content?: { nodes?: BlockNode[] } })
        .content;
      expect(content?.nodes?.map(n => n.id)).toEqual(["box", "added"]);
      expect(content?.nodes?.[0]?.slots?.aside?.map(n => n.id)).toEqual([
        "aside-note",
      ]);
      expect(content?.nodes?.[0]?.slots?.children?.map(n => n.id)).toEqual([
        "cta",
      ]);
    });

    it("refuses an edit to that page that adds a break of its own", async () => {
      const t = await boot();
      const id = await storedPage(t);
      ruleOn();

      const box = brokenBox();
      box.slots!.children!.push(cta("second"));
      const issues = issuesOf(await refusalOf(update(t, id, [box])));
      expect(issues.map(issue => issue.code)).toEqual(["content-model"]);
    });

    /** A component whose only block is a call to action. */
    async function ctaComponent(t: TestNextly): Promise<string> {
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: "Call to action",
          slug: `cta-${String(Math.random()).slice(2, 8)}`,
          content: {
            formatVersion: DOCUMENT_FORMAT_VERSION,
            kind: "component",
            nodes: [cta("inside")],
          },
        },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    const linkedPlacing = (componentId: string): BlockNode => ({
      id: "box",
      type: "acme/linkbox",
      version: 1,
      props: { link: "/go" },
      slots: {
        children: [
          {
            id: "placed",
            type: COMPONENT_INSTANCE_TYPE,
            version: 1,
            props: { componentId },
          },
        ],
      },
    });

    it("refuses a page that places a component's call to action inside a link", async () => {
      const t = await boot();
      const componentId = await ctaComponent(t);
      ruleOn();

      const issues = issuesOf(
        await refusalOf(
          t.nextly.create({
            collection: "pages",
            data: {
              title: "Home",
              slug: "composed-break",
              content: pageOf([linkedPlacing(componentId)]),
            },
            overrideAccess: true,
          })
        )
      );
      expect(issues.map(issue => issue.code)).toEqual(["content-model"]);
    });

    it("saves an unrelated edit to a page that already composed to that break", async () => {
      const t = await boot();
      const componentId = await ctaComponent(t);
      const saved = await t.nextly.create({
        collection: "pages",
        data: {
          title: "Home",
          slug: `composed-${String(Math.random()).slice(2, 8)}`,
          content: pageOf([linkedPlacing(componentId)]),
        },
        overrideAccess: true,
      });
      ruleOn();

      await expect(
        update(t, String(saved.item.id), [
          linkedPlacing(componentId),
          note("added"),
        ])
      ).resolves.toBeDefined();
    });

    it("refuses a new break in a translated field, judged against the stored translation", async () => {
      const t = await boot({ translated: true });
      ruleOn();
      // The localized field's stored value is read in the language written,
      // so a break the stored page never held is the write's own.
      const created = await t.nextly.create({
        collection: "articles",
        data: { title: "Hello", content: pageOf([note("first")]) },
        overrideAccess: true,
      });
      const box = { ...brokenBox(), slots: { children: [cta("cta")] } };

      const issues = issuesOf(
        await refusalOf(
          t.nextly.update({
            collection: "articles",
            id: String(created.item.id),
            data: { content: pageOf([box]), _overwrite: true },
            overrideAccess: true,
          })
        )
      );
      expect(issues.map(issue => issue.code)).toEqual(["content-model"]);
    });

    it("keeps a break the stored translation already holds, so an unrelated edit saves", async () => {
      const t = await boot({ translated: true });
      // Stored before the rule applied, as a page written earlier was.
      ruleOff();
      const created = await t.nextly.create({
        collection: "articles",
        data: { title: "Hello", content: pageOf([brokenBox()]) },
        overrideAccess: true,
      });
      ruleOn();

      const saved = await t.nextly.update({
        collection: "articles",
        id: String(created.item.id),
        data: {
          content: pageOf([brokenBox(), note("added")]),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      const content = (saved.item as { content?: { nodes?: BlockNode[] } })
        .content;
      expect(content?.nodes?.map(n => n.id)).toEqual(["box", "added"]);
    });
  }
);
