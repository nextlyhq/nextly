/**
 * The second sidebar panel and the main column beside it.
 *
 * On the wide layout the panel's track is held on a page whose section owns a panel, from its
 * first paint, and absent on a page without one: the dashboard draws no empty column beside the
 * rail. Every page reached by navigating is drawn at the geometry a direct load of it draws, with
 * the panel's links in reach. On a phone the panel opens over the main column, inside the
 * navigation drawer, and the column keeps its place and width.
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
  await expect(
    panel.getByRole("link", { name: "Posts", exact: true })
  ).toBeVisible();
  const direct = await mainColumnBox(page);

  await gotoAdmin(page, "/");
  await waitForShellAnswers(page);
  // The dashboard owns no panel, so it draws no empty column: its main column starts at the
  // rail's edge, a panel's width (256px) before a collection's, and is that much wider.
  const dashboard = await mainColumnBox(page);
  expect(dashboard.x).toBe(direct.x - 256);
  expect(dashboard.width).toBe(direct.width + 256);

  // On the wide layout the rail's Content entry opens the Content overview with its panel
  // beside the column, which then stands where a collection's does.
  // Found in the navigation: a dashboard card's title is the button that opens its quick
  // settings, so the Content card draws a second control named "Content" in the main column.
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Content", exact: true })
    .click();
  await page.waitForURL(/\/admin\/content$/);
  const posts = panel.getByRole("link", { name: "Posts", exact: true });
  await expect(posts).toBeVisible();
  expect(await mainColumnBox(page)).toEqual(direct);

  // The panel's link is followed, and the collection is drawn as its direct load drew it.
  await posts.click();
  await page.waitForURL(/\/admin\/collections\/posts/);
  await waitForShellAnswers(page);
  await expect(posts).toHaveAttribute("data-active", "true");
  expect(await mainColumnBox(page)).toEqual(direct);

  // And the panel's other links stay in reach from there.
  await panel.getByRole("link", { name: "Categories", exact: true }).click();
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

  await page.getByRole("button", { name: "Open the navigation menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation menu" });
  // On a phone the rail's Content entry opens its panel in the drawer rather than navigating.
  await drawer.getByRole("button", { name: "Content" }).click();
  const posts = drawer
    .getByTestId("sub-sidebar")
    .getByRole("link", { name: "Posts", exact: true });
  await expect(posts).toBeVisible();

  expect(await mainColumnBox(page)).toEqual(before);

  await posts.click();
  await page.waitForURL(/\/admin\/collections\/posts/);
  // The drawer closes on the way, and the column is where it was.
  await expect(drawer).toBeHidden();
  expect(await mainColumnBox(page)).toEqual(before);
});
