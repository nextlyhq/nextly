/**
 * The Content panel is one list: the rail's Content item opens it with the
 * collections under a Collections heading and the Singles under a Singles
 * heading, each with its count. One search filters both, and a heading the
 * person folds stays folded after a reload.
 *
 * Reads the whole collection set (each heading's count), so it holds the
 * schema lock against a spec creating collections meanwhile.
 *
 * @module tests/content-panel.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { waitForShellAnswers } from "./support/shell-geometry";

test.describe.configure({ lock: [LOCK.schema] });

/** The panel's list of content, where its headings and links are. */
function contentList(page: Page): Locator {
  return page
    .getByTestId("sub-sidebar")
    .getByRole("navigation", { name: "Content" });
}

/** A heading's button: named by its label and its count. */
function heading(page: Page, label: "Collections" | "Singles"): Locator {
  return contentList(page).getByRole("button", {
    name: new RegExp(`^${label}, \\d+$`),
  });
}

/**
 * The count a heading shows, read from its name. A heading whose list is still
 * arriving is named without a count, so this waits for the settled one.
 */
async function countOf(page: Page, label: "Collections" | "Singles") {
  await expect(heading(page, label)).toHaveAccessibleName(
    new RegExp(`^${label}, \\d+$`)
  );
  const name = await heading(page, label).getAttribute("aria-label");
  return Number(name?.split(", ")[1]);
}

/** Both headings' counts settled: each list has fully arrived. */
async function countsSettled(page: Page) {
  for (const label of ["Collections", "Singles"] as const) {
    await expect(
      contentList(page).getByRole("button", {
        name: new RegExp(`^${label}, \\d+$`),
      })
    ).toBeVisible();
  }
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, "/");
  await waitForShellAnswers(page);
  // Found in the navigation: a dashboard card's title is the button that
  // opens its quick settings, so the Content card draws a second "Content".
  // The rail's entry opens the Content overview, with the panel beside it.
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Content", exact: true })
    .click();
  await page.waitForURL(/\/admin\/content$/);
});

test("lists Collections then Singles, each heading with its count", async ({
  page,
}) => {
  const collections = heading(page, "Collections");
  const singles = heading(page, "Singles");
  await expect(collections).toBeVisible();
  await expect(singles).toBeVisible();
  // Collections first, in one list with no switch between the kinds.
  const top = async (locator: Locator) => (await locator.boundingBox())?.y;
  expect(await top(collections)).toBeLessThan((await top(singles)) ?? 0);
  await expect(
    page.getByRole("navigation", { name: "Content type" })
  ).toHaveCount(0);

  expect(await countOf(page, "Collections")).toBeGreaterThan(0);
  expect(await countOf(page, "Singles")).toBeGreaterThan(0);
  await expect(
    contentList(page).getByRole("link", { name: "Posts", exact: true })
  ).toBeVisible();
  await expect(
    contentList(page).getByRole("link", { name: "Homepage", exact: true })
  ).toBeVisible();
});

test("one search filters both headings", async ({ page }) => {
  // Read only once both lists have arrived: a heading still loading shows no
  // count, and one read then would not be the count the search narrows.
  await countsSettled(page);
  const before = {
    collections: await countOf(page, "Collections"),
    singles: await countOf(page, "Singles"),
  };

  // "page" names collections (Block Pages) and Singles (Homepage, Landing
  // Page), and not Posts.
  await page
    .getByTestId("sub-sidebar")
    .getByRole("textbox", { name: "Search content" })
    .fill("page");

  await expect(
    contentList(page).getByRole("link", { name: "Block Pages", exact: true })
  ).toBeVisible();
  await expect(
    contentList(page).getByRole("link", { name: "Homepage", exact: true })
  ).toBeVisible();
  await expect(
    contentList(page).getByRole("link", { name: "Posts", exact: true })
  ).toHaveCount(0);
  const after = {
    collections: await countOf(page, "Collections"),
    singles: await countOf(page, "Singles"),
  };
  expect(after.collections).toBeGreaterThan(0);
  expect(after.collections).toBeLessThan(before.collections);
  expect(after.singles).toBeGreaterThan(0);
  expect(after.singles).toBeLessThanOrEqual(before.singles);

  // And a search nothing matches says so.
  await page
    .getByTestId("sub-sidebar")
    .getByRole("textbox", { name: "Search content" })
    .fill("no content is named this");
  await expect(page.getByTestId("sub-sidebar").getByRole("status")).toHaveText(
    "Nothing matches “no content is named this”."
  );
});

test("a folded heading stays folded after a reload", async ({ page }) => {
  const singles = heading(page, "Singles");
  const homepage = contentList(page).getByRole("link", {
    name: "Homepage",
    exact: true,
  });
  await expect(homepage).toBeVisible();

  await singles.click();
  await expect(singles).toHaveAttribute("aria-expanded", "false");
  await expect(homepage).toBeHidden();

  // The overview's own address opens the panel beside it.
  await page.reload();
  await waitForShellAnswers(page);
  await expect(heading(page, "Singles")).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await expect(homepage).toBeHidden();
  // Only the folded heading: Collections stays open.
  await expect(heading(page, "Collections")).toHaveAttribute(
    "aria-expanded",
    "true"
  );
  await expect(
    contentList(page).getByRole("link", { name: "Posts", exact: true })
  ).toBeVisible();
});
