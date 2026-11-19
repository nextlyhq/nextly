/**
 * A page's own code is never drawn on a draft read of the page: a working
 * draft of a published page, or a page never published, as a signed-in
 * preview route reads them through its draft gate (`pages.draft`). That route
 * can serve a draft without Next's draft-mode cookie, so draft mode alone
 * can't keep unpublished code off it: what is drawn around the page is told
 * which entry it was read as, and draws page code for a published read only.
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { pageBuilderContent } from "../page-content";
import { pageBuilder } from "../plugin";

/** Code a page adds to its own head: harmless, and easy to find. */
const LIVE_CODE = { head: "<script>window.liveCode = 1</script>", body: "" };
const DRAFT_CODE = { head: "<script>window.draftCode = 1</script>", body: "" };

/** A page document carrying `code`. */
function page(code: Record<string, string>): Record<string, unknown> {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "t1", type: "core/text", version: 1, props: { text: "Hello" } },
    ],
    settings: { code },
  };
}

describe.each(getConfiguredTestDialects())(
  "page code on a draft read (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        seedPublic: true,
      });
      return current;
    }

    /** The page as a read gives it: published, or its draft. */
    async function read(
      t: TestNextly,
      id: string,
      draft: boolean
    ): Promise<Record<string, unknown>> {
      return (await t.nextly.findByID({
        collection: "pages",
        id,
        overrideAccess: true,
        status: "all",
        depth: 0,
        ...(draft ? { draft: true } : {}),
      })) as unknown as Record<string, unknown>;
    }

    /** What the route draws in the head around `entry`. */
    async function headAround(entry: Record<string, unknown>): Promise<string> {
      const { before } = await pageBuilderContent().around({
        document: entry.content,
        entry,
      });
      return before === undefined || before === null
        ? ""
        : renderToStaticMarkup(before as never);
    }

    async function created(
      t: TestNextly,
      status: "published" | "draft",
      code: Record<string, string>
    ): Promise<string> {
      const made = (await t.nextly.create({
        collection: "pages",
        data: {
          title: "Pricing",
          slug: "pricing",
          status,
          content: page(code),
        },
        overrideAccess: true,
      })) as unknown as { item?: { id: string }; id?: string };
      return String(made.item?.id ?? made.id);
    }

    it("draws the live code on the published read, and none on its working draft", async () => {
      const t = await boot();
      const id = await created(t, "published", LIVE_CODE);
      await t.nextly.update({
        collection: "pages",
        id,
        data: { content: page(DRAFT_CODE), _overwrite: true },
        draft: true,
        overrideAccess: true,
      } as never);

      const live = await read(t, id, false);
      expect(await headAround(live)).toContain("window.liveCode = 1");

      // The working draft, as a preview route's draft gate reads it.
      const draft = await read(t, id, true);
      expect(JSON.stringify(draft.content)).toContain("draftCode");
      expect(draft._isWorkingDraft).toBe(true);
      expect(await headAround(draft)).toBe("");
    });

    it("draws no code for a page never published, read as a draft", async () => {
      const t = await boot();
      const id = await created(t, "draft", DRAFT_CODE);
      const draft = await read(t, id, true);
      expect(draft.status).toBe("draft");
      expect(await headAround(draft)).toBe("");
    });
  }
);
