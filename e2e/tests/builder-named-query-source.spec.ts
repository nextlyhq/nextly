/**
 * A collection list's custom source, chosen in the real editor.
 *
 * The list starts over `bound-entries`. In the Content tab the author opens
 * Source and picks "Posts by title", one of the playground's named queries
 * (`apps/playground/src/named-queries.ts`), whose one input it needs. Then:
 *
 * 1. The Source menu lists it under Custom sources, above the collections,
 *    tagged Needs input.
 * 2. Picked, it is chosen on screen and nothing is written: the input says
 *    what it needs, and the canvas keeps drawing the stored list, tagged
 *    "Still showing Blog posts".
 * 3. Its input given, the canvas draws the query's rows, run on the server,
 *    the tag is gone, and Filters and sort is one line set by the query.
 * 4. Saved, the list stores the custom source alone, its input with it.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  canvasRoot,
  layerRow,
  openLayers,
  pressSave,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const ENTRIES = "/admin/api/collections/bound-entries/entries";

const LIST = "00000000-0000-4000-8000-0000000996b1";
const TITLE = "00000000-0000-4000-8000-0000000996b2";
const NONE = "00000000-0000-4000-8000-0000000996b3";

async function created(
  api: APIRequestContext,
  endpoint: string,
  data: Record<string, unknown>
): Promise<string> {
  const response = await api.post(endpoint, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

/** The page: one list over bound entries, its template bound to each title. */
function pageDocument(): Record<string, unknown> {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: LIST,
        type: "core/collection-loop",
        version: 1,
        props: { collection: "bound-entries", limit: 10, sort: "title" },
        slots: {
          children: [
            {
              id: TITLE,
              type: "core/heading",
              version: 1,
              props: { text: "Entry", level: "h3" },
              bindings: { text: { $bind: "title", source: "item" } },
            },
          ],
          empty: [
            {
              id: NONE,
              type: "core/heading",
              version: 1,
              props: { text: "Nothing yet", level: "h3" },
            },
          ],
        },
      },
    ],
  };
}

async function storedList(
  api: APIRequestContext,
  id: string
): Promise<Record<string, unknown>> {
  const nodes = await storedPageNodes(api, PAGES, id);
  const list = nodes.find(node => node.id === LIST);
  return (list?.props ?? {}) as Record<string, unknown>;
}

/** The list's root on the canvas. */
async function canvasList(page: Page) {
  return (await canvasRoot(page)).locator(`[data-nx-node="${LIST}"]`);
}

async function canvasTitles(page: Page): Promise<string[]> {
  return (await canvasList(page)).locator("h3").allTextContents();
}

test("chooses a named query as a list's source, writing it only once it can run", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await gotoAdmin(page, "/");
  const api = page.request;
  const mark = `N${Date.now().toString(36)}`;
  for (const title of [`${mark} Alder`, `${mark} Birch`]) {
    await created(api, ENTRIES, { title, status: "published" });
  }
  const pageId = await created(api, PAGES, {
    title: `Named source ${mark}`,
    slug: `named-source-${mark.toLowerCase()}`,
    status: "draft",
    content: pageDocument(),
  });

  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(() => canvasTitles(page), { timeout: 30_000 })
    .not.toEqual([]);
  const before = await canvasTitles(page);
  await openLayers(page);
  await layerRow(page, LIST).click();
  const inspector = page.locator(".nx-inspector");

  // 1. Under Custom sources, above the collections, tagged.
  await inspector.getByRole("button", { name: "Source Blog posts" }).click();
  const sources = page.getByRole("listbox", { name: "Sources" });
  await expect(
    sources.getByRole("group", { name: "Custom sources" })
  ).toBeVisible();
  const groups = await sources
    .getByRole("group")
    .evaluateAll(each => each.map(group => group.getAttribute("aria-label")));
  expect(groups.indexOf("Custom sources")).toBeLessThan(
    groups.indexOf("Collections")
  );
  const option = sources.getByRole("option", { name: /^Posts by title/ });
  await expect(option).toContainText("Needs input");
  await option.click();

  // 2. Chosen on screen, nothing written, the canvas tagged.
  await expect(
    inspector.getByRole("button", { name: "Source Posts by title" })
  ).toBeVisible();
  await expect(
    inspector.getByText("Enter title words. Posts by title needs it to run.")
  ).toBeVisible();
  await expect(await canvasList(page)).toHaveAttribute(
    "data-nx-list-still",
    "Still showing Blog posts"
  );
  expect(await canvasTitles(page)).toEqual(before);
  expect(await storedList(api, pageId)).toMatchObject({
    collection: "bound-entries",
  });

  // 3. Its input given: the query's rows, run on the server.
  const words = inspector.getByRole("textbox", { name: "Title words" });
  await words.fill(mark);
  await words.press("Enter");
  await expect
    .poll(() => canvasTitles(page), { timeout: 30_000 })
    .toEqual([`${mark} Alder`, `${mark} Birch`]);
  await expect(await canvasList(page)).not.toHaveAttribute(
    "data-nx-list-still"
  );
  await expect(
    inspector.getByText(
      "Set by Posts by title: it decides which entries show, and their order."
    )
  ).toBeVisible();
  await expect(
    inspector.getByRole("button", { name: "Add filter" })
  ).toHaveCount(0);

  // 4. Saved as the engine reads it: the custom source alone.
  await pressSave(page);
  await expect
    .poll(() => storedList(api, pageId), { timeout: 15_000 })
    .toEqual({
      namedQuery: { name: "e2e.blog-posts", params: { match: mark } },
      limit: 10,
    });
});
