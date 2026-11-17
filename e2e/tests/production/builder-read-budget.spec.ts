/**
 * The editor's page data meter: the top bar shows it from 80% of the limit
 * and names the blocks that come up empty past it; Page settings shows the
 * count at every level.
 *
 * Each page is a list of 10 posts whose template holds lists of its own, one
 * read per entry each: forty of them make 401 reads, past the 400 the editor
 * warns from; fifty make 501, past the 500 a page may make, so the last reads
 * are refused and their lists named.
 *
 * A page made published a moment before it is opened, and opened at one of
 * its blocks, is counted too: Page settings says what it reads, never
 * "counting" for good.
 *
 * @module tests/builder-read-budget.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "../support/admin";
import { test } from "../support/visible";
import { signIn } from "../support/production-sign-in";

/** The seeded user the production suite signs in as. */
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

/** The heading a published page is opened at. */
const HEADING = "00000000-0000-4000-8000-000000000a01";

/** A page of a heading and a text, made published through the API. */
async function seedPublished(
  api: APIRequestContext,
  mark: string
): Promise<string> {
  const response = await api.post(PAGES, {
    data: {
      title: `${mark} published`,
      slug: `read-budget-${mark.toLowerCase()}-published`,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: HEADING,
            type: "core/heading",
            version: 1,
            name: "Published heading",
            props: { text: "A published page", level: "h2" },
          },
          {
            id: "00000000-0000-4000-8000-000000000a02",
            type: "core/text",
            version: 1,
            props: { text: "Read nothing." },
          },
        ],
      },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

async function openBuilder(page: Page, id: string, at?: string): Promise<void> {
  const block = at === undefined ? "" : `&block=${at}`;
  await gotoAdmin(
    page,
    `/collections/pages/${id}/builder?field=content${block}`
  );
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** The page data meter in the top bar, shown from 80% of the limit. */
function meter(page: Page) {
  return page.locator('.nx-read-meter[data-place="bar"]');
}

/** The page data line in Page settings, shown at every level. */
function settingsLine(page: Page) {
  return page
    .getByRole("complementary", { name: "Inspector" })
    .getByRole("region", { name: "Page settings" })
    .getByRole("button", { name: /^Page data:/ });
}

test.describe("the page data meter", () => {
  test.describe.configure({ timeout: 300_000 });

  test("shows in the top bar from 80% of the limit, and explains itself", async ({
    page,
  }) => {
    await signIn(page);
    const mark = `R${Date.now().toString(36)}`;
    await ensurePosts(page.request, mark);
    await openBuilder(page, await seed(page.request, mark, 40));
    // One read for the posts, and one for each of the forty inner lists of
    // each of the 10 posts.
    await expect(meter(page)).toHaveAccessibleName(
      "Page data: 401 of 500, near the limit. What's this?",
      { timeout: 60_000 }
    );
    // Its tooltip says the same, for the shorter form a crowded bar draws.
    await expect(meter(page)).toHaveAttribute(
      "title",
      "Page data: 401 of 500, near the limit. What's this?"
    );
    await expect(meter(page)).toHaveAttribute("data-standing", "near");
    await meter(page).click();
    const panel = page.getByRole("dialog", { name: "Page data" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Near the limit")).toBeVisible();
    await expect(panel.getByText("Warning from 400")).toBeVisible();
    // The site sets no limit of its own, so it is the default, said so.
    await expect(panel.getByText("Limit 500 (the default)")).toBeVisible();
    await expect(panel.getByText("List entries")).toBeVisible();
    // CONTROL: within the limit, no block is named as coming up empty.
    await expect(panel.getByText(/come(s)? up empty$/)).toHaveCount(0);
  });

  test("over the limit, names each block that comes up empty, and selects it", async ({
    page,
  }) => {
    await signIn(page);
    const mark = `R${Date.now().toString(36)}`;
    await ensurePosts(page.request, mark);
    await openBuilder(page, await seed(page.request, mark, 50));
    await expect(meter(page)).toHaveAccessibleName(
      "Page data: 500 of 500, over the limit. What's this?",
      { timeout: 60_000 }
    );
    await expect(meter(page)).toHaveAttribute("data-standing", "over");
    await meter(page).click();
    const panel = page.getByRole("dialog", { name: "Page data" });
    await expect(panel.getByText("Over the limit")).toBeVisible();
    await expect(
      panel.getByText(/^500 of 500 · (1 block comes|\d+ blocks come) up empty$/)
    ).toBeVisible();
    // The last of each entry's lists is the one past the limit.
    const unread = panel.getByRole("button", { name: /^Inner list \d/ });
    await expect(unread.first()).toBeVisible();
    await expect(unread.first()).toContainText("Its entries don't load");
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

  test("counts a page made published a moment before, opened at one of its blocks", async ({
    page,
  }) => {
    await signIn(page);
    const mark = `R${Date.now().toString(36)}`;
    await openBuilder(page, await seedPublished(page.request, mark), HEADING);
    // Opened at the heading: the breadcrumb ends on it.
    await expect(
      page
        .getByRole("list", { name: "Current location" })
        .getByRole("button", { name: "Published heading" })
    ).toHaveAttribute("aria-current", "true", { timeout: 30_000 });
    // Leaving the heading shows Page settings, where the count always is.
    await page.keyboard.press("Escape");
    // Counted a moment after the canvas drew it: a heading and a text read
    // nothing.
    await expect(settingsLine(page)).toHaveAccessibleName(
      "Page data: 0 of 500, within the limit. What's this?",
      { timeout: 20_000 }
    );
  });

  test("shows the count in Page settings on a page well under the limit, with the same explanation", async ({
    page,
  }) => {
    await signIn(page);
    const mark = `R${Date.now().toString(36)}`;
    await openBuilder(page, await seedPublished(page.request, mark));
    await expect(settingsLine(page)).toHaveAccessibleName(
      "Page data: 0 of 500, within the limit. What's this?",
      { timeout: 30_000 }
    );
    await expect(settingsLine(page)).toHaveText("Page data: 0 of 500");
    // Well under the limit, the top bar shows no meter.
    await expect(meter(page)).toHaveCount(0);
    // CONTROL: neither still counting nor a count that could not be made.
    await expect(
      page.getByRole("button", { name: /^Page data: (counting|couldn't)/ })
    ).toHaveCount(0);
    await settingsLine(page).click();
    const panel = page.getByRole("dialog", { name: "Page data" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Within the limit")).toBeVisible();
    await expect(panel.getByText("Limit 500 (the default)")).toBeVisible();
  });
});
