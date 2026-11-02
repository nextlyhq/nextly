/**
 * The second sidebar panel and the main column beside it.
 *
 * On the wide layout the panel's track is held at the open panel's width on every screen, so a
 * collection reached by navigating from the dashboard is drawn at the geometry a direct load of it
 * draws, with the panel's links in reach. On a phone the panel opens over the main column, inside
 * the navigation drawer, and the column keeps its place and width.
 *
 * The round trip's layout shift and the column's box across it are measured in
 * `dashboard-layout-shift.spec.ts`, beside the dashboard's own.
 *
 * @module tests/admin-shell-panel.spec
 */
import { expect } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { mainColumnBox, waitForShellAnswers } from "./support/shell-geometry";

test("draws a collection reached from the dashboard as a direct load draws it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const panel = page.getByTestId("sub-sidebar");
  await gotoAdmin(page, "/collections/posts");
  await waitForShellAnswers(page);
  await expect(panel.getByRole("link", { name: "Posts" })).toBeVisible();
  const direct = await mainColumnBox(page);

  await gotoAdmin(page, "/");
  await waitForShellAnswers(page);
  // One geometry on every surface: the dashboard owns no panel, and its column starts where a
  // collection's does.
  expect(await mainColumnBox(page)).toEqual(direct);

  // On the wide layout the rail's Content entry opens its panel in place; the column stays put.
  // Found in the navigation: a dashboard card's title is the button that opens its quick
  // settings, so the Content card draws a second button named "Content" in the main column.
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Content", exact: true })
    .click();
  const posts = panel.getByRole("link", { name: "Posts" });
  await expect(posts).toBeVisible();
  expect(await mainColumnBox(page)).toEqual(direct);

  // The panel's link is followed, and the collection is drawn as its direct load drew it.
  await posts.click();
  await page.waitForURL(/\/admin\/collections\/posts/);
  await waitForShellAnswers(page);
  await expect(posts).toHaveAttribute("data-active", "true");
  expect(await mainColumnBox(page)).toEqual(direct);

  // And the panel's other links stay in reach from there.
  await panel.getByRole("link", { name: "Categories" }).click();
  await page.waitForURL(/\/admin\/collections\/categories/);
  expect(await mainColumnBox(page)).toEqual(direct);
});

test("opens the second panel over the main column on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoAdmin(page, "/");
  await waitForShellAnswers(page);
  const before = await mainColumnBox(page);

  await page.getByRole("button", { name: "Toggle mobile menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation menu" });
  // On a phone the rail's Content entry opens its panel in the drawer rather than navigating.
  await drawer.getByRole("button", { name: "Content" }).click();
  const posts = drawer
    .getByTestId("sub-sidebar")
    .getByRole("link", { name: "Posts" });
  await expect(posts).toBeVisible();

  expect(await mainColumnBox(page)).toEqual(before);

  await posts.click();
  await page.waitForURL(/\/admin\/collections\/posts/);
  // The drawer closes on the way, and the column is where it was.
  await expect(drawer).toBeHidden();
  expect(await mainColumnBox(page)).toEqual(before);
});
