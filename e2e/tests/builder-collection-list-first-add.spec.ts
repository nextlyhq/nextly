/**
 * A Collection list added in two clicks: "Show entries from" on the canvas,
 * then a starting layout, and the list fills with real entries as one step.
 *
 * - The first step lists the collections, and the panel says to choose on
 *   the canvas.
 * - Posts, then "Cards, 3 across": the newest posts show at once, each a
 *   card with its own title; one Undo takes the whole list away.
 * - "Titles only" and "Skip", each on its own page: a linked title per
 *   entry, and an empty item that still has room on the canvas.
 * - The keyboard: the first source is focused, the arrows move, Enter picks,
 *   Escape on the layouts goes back and on the sources leaves a blank list.
 *
 * Each test makes its own page and its own posts, named uniquely, so no
 * lock is needed.
 *
 * @module tests/builder-collection-list-first-add.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { pressSave, selection } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const POSTS = "/admin/api/collections/posts/entries";

/** A unique suffix for this run's names. */
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Three posts of this run's own, newest last, and their titles. */
async function threePosts(request: APIRequestContext): Promise<string[]> {
  const run = stamp();
  const titles: string[] = [];
  for (const n of [1, 2, 3]) {
    const title = `First add post ${String(n)} ${run}`;
    const created = await request.post(POSTS, {
      data: {
        title,
        slug: `first-add-${String(n)}-${run}`,
        excerpt: `The summary of post ${String(n)}.`,
        status: "published",
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    titles.push(title);
  }
  return titles;
}

/** A draft page of its own, empty, and its id. */
async function createPage(request: APIRequestContext): Promise<string> {
  const run = stamp();
  const created = await request.post(PAGES, {
    data: {
      title: `Collection list first add ${run}`,
      slug: `collection-list-first-add-${run}`,
      status: "draft",
      content: { formatVersion: 1, kind: "page", nodes: [] },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** Add a Collection list from the Add panel, and answer its id. */
async function addList(page: Page): Promise<string> {
  const add = page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Add", exact: true });
  if ((await add.getAttribute("aria-pressed")) !== "true") await add.click();
  await expect(
    page.getByRole("combobox", { name: "Insert a block" })
  ).toBeVisible();
  await page.getByRole("option", { name: "Collection list", exact: true }).click();
  await expect.poll(async () => (await selection(page)).length).toBe(1);
  const [id] = await selection(page);
  if (id === undefined) throw new Error("no new list");
  return id;
}

/** The chooser drawn over the canvas. */
function chooser(page: Page) {
  return page.locator(".nx-first-add__plate");
}

test.describe("a Collection list in two clicks", () => {
  test.describe.configure({ timeout: 180_000 });

  test("lists the collections, then fills with the newest posts as one undo step", async ({
    page,
  }) => {
    const titles = await threePosts(page.request);
    await openBuilder(page, await createPage(page.request));
    const list = await addList(page);

    const sources = chooser(page).getByRole("group", { name: "Show entries from" });
    await expect(sources).toBeVisible();
    await expect(sources.getByRole("button", { name: "Posts", exact: true })).toBeVisible();
    await expect(page.getByText("Choose on the canvas to start.")).toBeVisible();

    await sources.getByRole("button", { name: "Posts", exact: true }).click();
    const layouts = chooser(page).getByRole("group", {
      name: "Posts · choose a starting layout",
    });
    await expect(layouts).toBeVisible();
    await layouts.getByRole("button", { name: "Cards, 3 across" }).click();

    // The newest three, each its own entry's title, at once.
    const canvas = canvasFrame(page);
    for (const title of titles) {
      await expect(canvas.getByRole("heading", { name: title })).toBeVisible();
    }
    await expect(chooser(page)).toHaveCount(0);

    // One undo takes the whole list away, not just its layout.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(canvas.locator(`[data-nx-node="${list}"]`)).toHaveCount(0);
  });

  test("Titles only draws a linked title per entry, stored on the list", async ({
    page,
  }) => {
    const titles = await threePosts(page.request);
    const id = await createPage(page.request);
    await openBuilder(page, id);

    const titled = await addList(page);
    await chooser(page).getByRole("button", { name: "Posts", exact: true }).click();
    await chooser(page).getByRole("button", { name: "Titles only" }).click();
    await expect(
      canvasFrame(page).getByRole("heading", { name: titles[2] ?? "" })
    ).toBeVisible();

    await pressSave(page);
    await expect
      .poll(async () => {
        const nodes = await storedPageNodes(page.request, PAGES, id);
        return nodes.map(node => [node.id, node.props?.collection]);
      })
      .toEqual([[titled, "posts"]]);
  });

  test("Skip sets the source and leaves an empty item that still has room", async ({
    page,
  }) => {
    await threePosts(page.request);
    const id = await createPage(page.request);
    await openBuilder(page, id);

    const skipped = await addList(page);
    await chooser(page).getByRole("button", { name: "Posts", exact: true }).click();
    await chooser(page).getByRole("button", { name: "Skip" }).click();
    const box = await canvasFrame(page)
      .locator(`[data-nx-node="${skipped}"]`)
      .boundingBox();
    // Never a 0px line: the empty item draws its start.
    expect(box?.height ?? 0).toBeGreaterThan(24);

    await pressSave(page);
    await expect
      .poll(async () => {
        const nodes = await storedPageNodes(page.request, PAGES, id);
        return nodes.map(node => [node.id, node.props?.collection]);
      })
      .toEqual([[skipped, "posts"]]);
  });

  test("works from the keyboard, and Escape leaves a blank list", async ({
    page,
  }) => {
    await threePosts(page.request);
    await openBuilder(page, await createPage(page.request));
    await addList(page);

    const sources = chooser(page).getByRole("group", { name: "Show entries from" });
    await expect(sources).toBeVisible();
    // The first source has the focus; the arrows walk to Posts.
    await expect(sources.getByRole("button").first()).toBeFocused();
    for (let step = 0; step < 20; step += 1) {
      const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
      if (focused === "Posts") break;
      await page.keyboard.press("ArrowRight");
    }
    await page.keyboard.press("Enter");
    const layouts = chooser(page).getByRole("group", {
      name: "Posts · choose a starting layout",
    });
    await expect(layouts).toBeVisible();
    await expect(layouts.getByRole("button", { name: "Cards, 3 across" })).toBeFocused();

    // Escape goes back, then leaves the list blank.
    await page.keyboard.press("Escape");
    await expect(sources).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(chooser(page)).toHaveCount(0);
  });
});
