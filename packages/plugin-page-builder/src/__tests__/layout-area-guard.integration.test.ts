/**
 * A Layout can never be saved pointing at a component that does not exist,
 * and one already stored that way is drawn without the area and cleaned by
 * its next save.
 *
 * `layout-area-guard.test.ts` pins the guard's reading against fakes. What
 * only a server shows: that the refusal survives the envelope naming the
 * area and stores nothing; that a dangling id already stored (left by a delete
 * no hook saw, planted here past every hook) renders as an empty area rather
 * than an error; that the next save of the areas drops it and keeps the
 * others; and that a save failing inside its transaction leaves it as it was.
 *
 * The delete racing a Layout save is driven through Delete component itself,
 * in `component-delete-job.integration.test.ts`.
 *
 * Per dialect, because the checks read on the adapter's own connection and
 * the cleanup is stored through it.
 *
 * @module __tests__/layout-area-guard.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createPublicBlocksPage } from "@nextlyhq/blocks-react/next";
import { definePlugin, NextlyError } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { LAYOUT_COMPONENT_MISSING } from "../layout-area-guard";
import { pageBuilderLayouts } from "../page-layouts";
import { pageBuilder } from "../plugin";

const idOf = (created: unknown) =>
  String((created as { item: { id: string | number } }).item.id);

const heading = (id: string, text: string) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h2" },
});

/** The title that makes the failing plugin abort a Layout save. */
const FAILS = "Fails inside its transaction";

/**
 * A plugin aborting one Layout save inside its transaction, after the page
 * builder's own handlers ran: a save that fails once its write is made.
 */
const failing = definePlugin({
  name: "@test/failing-layout-save",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init(ctx) {
    ctx.hooks.onInTransaction(LAYOUTS_SLUG, write => {
      if ((write.data as { title?: unknown } | undefined)?.title === FAILS) {
        throw NextlyError.conflict({ message: "This save fails." });
      }
    });
  },
});

async function refusalOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
    return undefined;
  } catch (error) {
    return error;
  }
}

/** A refusal's issues, as the envelope carries them. */
function issuesOf(error: unknown): unknown {
  return (error as { publicData?: { errors?: unknown } } | undefined)
    ?.publicData?.errors;
}

describe.each(getConfiguredTestDialects())(
  "a Layout's areas never name a missing component (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot() {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder(), failing],
        seedPublic: true,
      });
      return current;
    }

    async function component(t: TestNextly, slug: string, text: string) {
      return idOf(
        await t.nextly.create({
          collection: COMPONENTS_SLUG,
          data: {
            title: slug,
            slug,
            content: {
              formatVersion: 1,
              kind: "component",
              nodes: [heading(`${slug}-h`, text)],
            },
            status: "published",
          },
          overrideAccess: true,
        })
      );
    }

    const createLayout = (
      t: TestNextly,
      slug: string,
      areas: { area: string; component: string }[]
    ) =>
      t.nextly.create({
        collection: LAYOUTS_SLUG,
        data: { title: slug, slug, areas, status: "published" },
        overrideAccess: true,
      });

    const saveLayout = (
      t: TestNextly,
      id: string,
      data: Record<string, unknown>
    ) =>
      t.nextly.update({
        collection: LAYOUTS_SLUG,
        id,
        // Published, so the live row is what changes: a save of a
        // published Layout without a status is held as its pending edit.
        data: { ...data, status: "published", _overwrite: true },
        overrideAccess: true,
      });

    /** The component ids a stored Layout's areas name, by area. */
    async function storedAreas(
      t: TestNextly,
      id: string
    ): Promise<Record<string, string>> {
      const row = (await t.nextly.findByID({
        collection: LAYOUTS_SLUG,
        id,
        depth: 0,
        status: "all",
        overrideAccess: true,
      })) as { areas?: { area: string; component: unknown }[] } | null;
      return Object.fromEntries(
        (row?.areas ?? []).map(row => [
          row.area,
          typeof row.component === "string"
            ? row.component
            : String((row.component as { id?: unknown }).id),
        ])
      );
    }

    /**
     * Remove a component's row past every hook: the dangling id a delete no
     * check saw would leave in a Layout.
     */
    async function removePastHooks(t: TestNextly, id: string) {
      const registry = t.getService("collectionRegistryService") as unknown as {
        getCollectionBySlug(
          slug: string
        ): Promise<{ tableName: string } | null>;
      };
      const table = (await registry.getCollectionBySlug(COMPONENTS_SLUG))!
        .tableName;
      await t.adapter.delete(table, {
        and: [{ column: "id", op: "=", value: id }],
      });
      const found = await t.nextly.find({
        collection: COMPONENTS_SLUG,
        where: { id: { equals: id } },
        status: "all",
        depth: 0,
        overrideAccess: true,
      });
      expect(found.items).toHaveLength(0);
    }

    /** A Layout naming a header that is gone and a footer that is there. */
    async function danglingSite() {
      const t = await boot();
      const goneHeader = await component(t, "old-header", "Old header");
      const footer = await component(t, "site-footer", "Site footer");
      const layout = idOf(
        await createLayout(t, "main", [
          { area: "header", component: goneHeader },
          { area: "footer", component: footer },
        ])
      );
      await removePastHooks(t, goneHeader);
      return { t, goneHeader, footer, layout };
    }

    it("refuses creating a Layout naming a component that doesn't exist, naming the area, and stores nothing", async () => {
      const t = await boot();
      const header = await component(t, "site-header", "Site header");

      const refused = await refusalOf(
        createLayout(t, "broken", [
          { area: "header", component: header },
          { area: "footer", component: "no-such-component" },
        ])
      );

      expect(issuesOf(refused)).toEqual([
        {
          path: "areas[1].component",
          code: LAYOUT_COMPONENT_MISSING,
          message:
            "The footer names a component that doesn't exist. Choose another component for the footer.",
        },
      ]);
      const stored = await t.nextly.find({
        collection: LAYOUTS_SLUG,
        where: { slug: { equals: "broken" } },
        status: "all",
        overrideAccess: true,
      });
      expect(stored.items).toHaveLength(0);
    });

    it("refuses changing an area to a component that doesn't exist, and keeps what was stored", async () => {
      const t = await boot();
      const header = await component(t, "site-header", "Site header");
      const layout = idOf(
        await createLayout(t, "main", [{ area: "header", component: header }])
      );

      const refused = await refusalOf(
        saveLayout(t, layout, {
          areas: [{ area: "header", component: "no-such-component" }],
        })
      );

      expect(issuesOf(refused)).toEqual([
        expect.objectContaining({
          path: "areas[0].component",
          code: LAYOUT_COMPONENT_MISSING,
        }),
      ]);
      expect(await storedAreas(t, layout)).toEqual({ header });
    });

    it("saves a Layout naming components that exist", async () => {
      // The control: a guard refusing every Layout would pass both cases above.
      const t = await boot();
      const header = await component(t, "site-header", "Site header");
      const footer = await component(t, "site-footer", "Site footer");
      const layout = idOf(
        await createLayout(t, "main", [{ area: "header", component: header }])
      );

      await saveLayout(t, layout, {
        areas: [
          { area: "header", component: header },
          { area: "footer", component: footer },
        ],
      });

      expect(await storedAreas(t, layout)).toEqual({ header, footer });
    });

    it("draws a page in a Layout whose header is gone with no header, and its footer, without an error", async () => {
      const { t, layout } = await danglingSite();
      await t.nextly.create({
        collection: "pages",
        data: {
          title: "Home",
          slug: "home",
          content: {
            formatVersion: 1,
            kind: "page",
            nodes: [heading("body", "Body of home")],
          },
          layout,
          status: "published",
        },
        overrideAccess: true,
      });
      const route = createPublicBlocksPage({
        collections: ["pages"],
        field: "content",
        nextly: t.nextly as never,
        blocks: createBlockResolver(coreBlocks),
        layouts: pageBuilderLayouts({ nextly: t.nextly }),
      });

      const html = renderToStaticMarkup(
        (await route.ContentPage({
          params: { slug: ["home"] },
        })) as ReactElement
      );

      expect(html).toContain("Body of home");
      expect(html).toContain("Site footer");
      expect(html).not.toContain("Old header");
    });

    it("drops the dangling area at the next save of the areas, keeping the others", async () => {
      const { t, goneHeader, footer, layout } = await danglingSite();
      expect(await storedAreas(t, layout)).toEqual({
        header: goneHeader,
        footer,
      });

      // The areas sent as the admin's form sends them: as they are stored.
      await saveLayout(t, layout, {
        title: "Main, renamed",
        areas: [
          { area: "header", component: goneHeader },
          { area: "footer", component: footer },
        ],
      });

      expect(await storedAreas(t, layout)).toEqual({ footer });
    });

    it("leaves the dangling area as it was when the save fails inside its transaction", async () => {
      const { t, goneHeader, footer, layout } = await danglingSite();

      const refused = await refusalOf(
        saveLayout(t, layout, {
          title: FAILS,
          areas: [
            { area: "header", component: goneHeader },
            { area: "footer", component: footer },
          ],
        })
      );

      expect(refused).toBeInstanceOf(Error);
      expect(await storedAreas(t, layout)).toEqual({
        header: goneHeader,
        footer,
      });
    });

    it("lets a save that leaves the areas alone through, changing none of them", async () => {
      const { t, goneHeader, footer, layout } = await danglingSite();

      await saveLayout(t, layout, { title: "Main, retitled" });

      expect(await storedAreas(t, layout)).toEqual({
        header: goneHeader,
        footer,
      });
    });
  }
);
