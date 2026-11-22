/**
 * Binding to an OUTER list's entry, for a block in a list inside another.
 *
 * A Stories list holds a blog-posts list, which holds a heading. The picker
 * lists the posts' entries first, then the stories'; a pick from the
 * stories' group binds the heading to that list, so each story's rows show
 * the story's title on the canvas. The published page reads the same: a
 * page stored with that binding shows each story's title to a visitor.
 *
 * @module tests/builder-data-picker-outer-list.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { block, canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const POSTS = "/admin/api/collections/bound-entries/entries";
const STORIES = "/admin/api/collections/list-stories/entries";

const STORY_LIST = "00000000-0000-4000-8000-0000002008e1";
const POST_LIST = "00000000-0000-4000-8000-0000002008e2";
const HEADING = "00000000-0000-4000-8000-0000002008e3";

async function created(
  api: APIRequestContext,
  endpoint: string,
  data: Record<string, unknown>
): Promise<string> {
  const response = await api.post(endpoint, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

/**
 * Two published stories and one published post of this run, and a page
 * whose Stories list holds a posts list holding a heading bound as given.
 */
async function seed(
  api: APIRequestContext,
  mark: string,
  binding: Record<string, unknown> | undefined
): Promise<{ id: string; slug: string; stories: string[] }> {
  const stories = ["Alder", "Birch"].map(name => `${mark} story ${name}`);
  for (const title of stories) {
    await created(api, STORIES, { title, status: "published" });
  }
  await created(api, POSTS, { title: `${mark} post`, status: "published" });
  const slug = `outer-list-${mark.toLowerCase()}${binding === undefined ? "" : "-bound"}`;
  const id = await created(api, PAGES, {
    title: `${mark} outer list page`,
    slug,
    status: "published",
    content: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: STORY_LIST,
          type: "core/collection-loop",
          version: 1,
          props: {
            collection: "list-stories",
            limit: 10,
            sort: "title",
            filters: [{ field: "title", op: "contains", value: mark }],
          },
          slots: {
            children: [
              {
                id: POST_LIST,
                type: "core/collection-loop",
                version: 1,
                props: {
                  collection: "bound-entries",
                  limit: 10,
                  filters: [
                    { field: "title", op: "contains", value: `${mark} post` },
                  ],
                },
                slots: {
                  children: [
                    {
                      id: HEADING,
                      type: "core/heading",
                      version: 1,
                      props: { text: "A section title", level: "h3" },
                      ...(binding === undefined
                        ? {}
                        : { bindings: { text: binding } }),
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  });
  return { id, slug, stories };
}

/** The headings the canvas draws, in order. */
async function canvasTitles(page: Page): Promise<string[]> {
  const root = await canvasRoot(page);
  return root.locator(`[data-nx-node="${HEADING}"]`).allTextContents();
}

test.describe("binding to an outer list's entry", () => {
  test.describe.configure({ timeout: 240_000 });

  test("the picker lists the outer list second, and a pick shows each story's title", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `O${Date.now().toString(36)}`;
    const { id, stories } = await seed(page.request, mark, undefined);
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect
      .poll(() => canvasTitles(page), { timeout: 60_000 })
      .toEqual(["A section title", "A section title"]);

    const first = (await block(page, HEADING)).first();
    const box = await first.boundingBox();
    if (box === null) throw new Error("[e2e] the heading drew no box");
    await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
    await page.getByRole("button", { name: "Bind Text to a field" }).click();
    const picker = page.getByRole("listbox", { name: "Fields for Text" });
    const groups = picker.getByRole("group");
    await expect(groups.first()).toHaveAttribute(
      "aria-label",
      "Each blog post in the list"
    );
    await expect(groups.nth(1)).toHaveAttribute(
      "aria-label",
      "Each story in the list"
    );
    await picker
      .getByRole("group", { name: "Each story in the list" })
      .getByRole("option", { name: /^Title/ })
      .click();

    await expect(
      page.getByRole("button", { name: /^Text: bound to Title of each story/ })
    ).toBeVisible();
    // Each story's row shows the story's own title.
    await expect
      .poll(() => canvasTitles(page), { timeout: 30_000 })
      .toEqual(stories);
  });

  test("a published page fills an outer list's binding from that list's entries", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `P${Date.now().toString(36)}`;
    const { slug, stories } = await seed(page.request, mark, {
      $bind: "title",
      source: "item",
      list: STORY_LIST,
      fallback: "No story",
    });
    await page.goto(`/${slug}`);
    const titles = page.locator(".nx-pb-page h3");
    await expect(titles.first()).toBeVisible({ timeout: 60_000 });
    await expect(titles).toHaveText(stories);
  });
});
