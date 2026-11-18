/**
 * A placement's setting bound to data, from the placement's own inspector.
 *
 * A Card component's heading is its Headline setting, and a blog-posts list
 * places the Card in each entry. Binding the placement's Headline to each
 * post's title shows every post's own title on the canvas; a page stored with
 * that binding shows the same to a visitor.
 *
 * @module tests/builder-component-setting-binding.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const POSTS = "/admin/api/collections/bound-entries/entries";
const COMPONENTS = "/admin/api/collections/components/entries";

const LIST = "00000000-0000-4000-8000-0000002008f1";
const PLACEMENT = "00000000-0000-4000-8000-0000002008f2";

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
 * Two published posts of this run, a published Card whose heading is its
 * Headline setting, and a page whose posts list places the Card, its
 * Headline bound as given.
 */
async function seed(
  api: APIRequestContext,
  mark: string,
  binding: Record<string, unknown> | undefined
): Promise<{ id: string; slug: string; posts: string[] }> {
  const posts = ["Alder", "Birch"].map(name => `${mark} post ${name}`);
  for (const title of posts) {
    await created(api, POSTS, { title, status: "published" });
  }
  const card = await created(api, COMPONENTS, {
    title: `${mark} card`,
    slug: `setting-card-${mark.toLowerCase()}`,
    status: "published",
    content: {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "card-heading",
          type: "core/heading",
          version: 1,
          props: { text: "Plain card", level: "h3" },
        },
      ],
      exposed: [
        {
          id: "headline",
          label: "Headline",
          nodeId: "card-heading",
          propPath: "text",
          type: "text",
        },
      ],
    },
  });
  const slug = `setting-binding-${mark.toLowerCase()}${binding === undefined ? "" : "-bound"}`;
  const id = await created(api, PAGES, {
    title: `${mark} setting binding page`,
    slug,
    status: "published",
    content: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: LIST,
          type: "core/collection-loop",
          version: 1,
          props: {
            collection: "bound-entries",
            limit: 10,
            sort: "title",
            filters: [{ field: "title", op: "contains", value: mark }],
          },
          slots: {
            children: [
              {
                id: PLACEMENT,
                type: "nextly/component-instance",
                version: 1,
                props: { componentId: card },
                ...(binding === undefined
                  ? {}
                  : { bindings: { "overrides.headline": binding } }),
              },
            ],
          },
        },
      ],
    },
  });
  return { id, slug, posts };
}

/** The Card's headings the canvas draws, in order. */
async function canvasTitles(page: Page): Promise<string[]> {
  const root = await canvasRoot(page);
  return root
    .locator(
      `[data-nx-instance="${PLACEMENT}"][data-nx-prop="text"], [data-nx-instance="${PLACEMENT}"] [data-nx-prop="text"]`
    )
    .allTextContents();
}

test.describe("a placement's setting bound to data", () => {
  test.describe.configure({ timeout: 240_000 });

  test("binding the Headline to each post's title shows each post's own on the canvas", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `S${Date.now().toString(36)}`;
    const { id, posts } = await seed(page.request, mark, undefined);
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect
      .poll(() => canvasTitles(page), { timeout: 60_000 })
      .toEqual(["Plain card", "Plain card"]);

    const root = await canvasRoot(page);
    await root
      .locator(
        `[data-nx-instance="${PLACEMENT}"][data-nx-prop="text"], [data-nx-instance="${PLACEMENT}"] [data-nx-prop="text"]`
      )
      .first()
      .click();
    await page
      .getByRole("button", { name: "Bind Headline to a field" })
      .click();
    const picker = page.getByRole("listbox", { name: "Fields for Headline" });
    await expect(picker.getByRole("group").first()).toHaveAttribute(
      "aria-label",
      "Each blog post in the list"
    );
    await picker
      .getByRole("group", { name: "Each blog post in the list" })
      .getByRole("option", { name: /^Title/ })
      .click();

    await expect(
      page.getByRole("button", {
        name: /^Headline: bound to Title of each blog post/,
      })
    ).toBeVisible();
    // Each post's entry shows that post's own title.
    await expect
      .poll(() => canvasTitles(page), { timeout: 30_000 })
      .toEqual(posts);
  });

  test("a published page fills a placement's bound setting from each entry", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `T${Date.now().toString(36)}`;
    const { slug, posts } = await seed(page.request, mark, {
      $bind: "title",
      source: "item",
      fallback: "No post",
    });
    await page.goto(`/${slug}`);
    const titles = page.locator(".nx-pb-page h3");
    await expect(titles.first()).toBeVisible({ timeout: 60_000 });
    await expect(titles).toHaveText(posts);
  });
});
