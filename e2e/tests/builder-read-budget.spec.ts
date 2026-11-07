/**
 * The editor shows what a page costs to read against its allowance, warns
 * from 80% of it, and names the blocks that went unread past it.
 *
 * Each page is a list of 10 posts whose template holds lists of its own, one
 * read per entry each: forty of them make 401 reads, past the 400 the editor
 * warns from; fifty make 501, past the 500 a page may make, so the last reads
 * are refused and their lists named.
 *
 * @module tests/builder-read-budget.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const POSTS = "/admin/api/collections/posts/entries";

/** At least this many posts, so the outer list draws this many entries. */
const ENTRIES = 10;

async function ensurePosts(
  api: APIRequestContext,
  mark: string
): Promise<void> {
  const counted = await api.get(`${POSTS}?limit=1`);
  expect(counted.ok(), await counted.text()).toBe(true);
  const total = ((await counted.json()) as { meta: { total: number } }).meta
    .total;
  for (let made = total; made < ENTRIES; made += 1) {
    const response = await api.post(POSTS, {
      data: {
        title: `Read post ${String(made)}`,
        slug: `read-post-${mark}-${String(made)}`,
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
}

/** A list of posts whose template holds `inner` lists of one post each. */
async function seed(
  api: APIRequestContext,
  mark: string,
  inner: number
): Promise<string> {
  const lists = Array.from({ length: inner }, (_, index) => ({
    id: `inner-${String(index + 1)}`,
    type: "core/collection-loop",
    version: 1,
    name: `Inner list ${String(index + 1)}`,
    props: { collection: "posts", limit: 1 },
    slots: { children: [] },
  }));
  const response = await api.post(PAGES, {
    data: {
      title: `${mark} reads ${String(inner)}`,
      slug: `read-budget-${mark.toLowerCase()}-${String(inner)}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "outer",
            type: "core/collection-loop",
            version: 1,
            name: "All posts",
            props: { collection: "posts", limit: ENTRIES },
            slots: { children: lists },
          },
        ],
      },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** The meter in the top bar, once it has counted. */
function meter(page: Page) {
  return page.getByRole("button", { name: /^Page reads: (?!counting)/ });
}

test.describe("the page reads meter", () => {
  test.describe.configure({ timeout: 300_000 });

  test("counts a page's reads, and warns from 80% of the allowance", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `R${Date.now().toString(36)}`;
    await ensurePosts(page.request, mark);
    await openBuilder(page, await seed(page.request, mark, 40));
    // One read for the posts, and one for each of the forty inner lists of
    // each of the 10 posts.
    await expect(meter(page)).toHaveAccessibleName(
      "Page reads: 401 of 500, near the limit",
      { timeout: 60_000 }
    );
    await meter(page).click();
    const panel = page.getByRole("dialog", { name: "Page reads" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Near the limit")).toBeVisible();
    await expect(panel.getByText("Warns from 400")).toBeVisible();
    await expect(panel.getByText("List entries")).toBeVisible();
    // CONTROL: within the limit, nothing is named as unread.
    await expect(panel.getByText(/not read/)).toHaveCount(0);
  });

  test("over the allowance, names each block that went unread, and selects it", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `R${Date.now().toString(36)}`;
    await ensurePosts(page.request, mark);
    await openBuilder(page, await seed(page.request, mark, 50));
    await expect(meter(page)).toHaveAccessibleName(
      /^Page reads: over the limit of 500, \d+ blocks? not read$/,
      { timeout: 60_000 }
    );
    await meter(page).click();
    const panel = page.getByRole("dialog", { name: "Page reads" });
    await expect(panel.getByText("Over the limit")).toBeVisible();
    await expect(
      panel.getByText(/^500 of 500 reads used · \d+ blocks? not read$/)
    ).toBeVisible();
    // The last of each entry's lists is the one past the allowance.
    const unread = panel.getByRole("button", { name: /^Inner list \d/ });
    await expect(unread.first()).toBeVisible();
    const name = (await unread.first().textContent()) ?? "";
    const list = /Inner list \d/.exec(name)?.[0];
    expect(list).toBeDefined();
    await unread.first().click();
    await expect(panel).toBeHidden();
    // Selected: the breadcrumb ends on it.
    await expect(
      page.getByRole("list", { name: "Current location" }).getByRole("button", {
        name: list,
      })
    ).toHaveAttribute("aria-current", "true");
  });
});
