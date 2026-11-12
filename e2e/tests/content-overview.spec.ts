/**
 * The Content overview: the rail's Content entry opens it at /admin/content
 * with the Content panel beside it, and /admin/collections and /admin/singles
 * show the overview with that one table, staying at their own address.
 *
 * Reads only that the tables and their known rows are there, never how many
 * rows a table holds, so it needs no lock against specs adding collections.
 *
 * @module tests/content-overview.spec
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { waitForShellAnswers } from "./support/shell-geometry";

/** A table of the overview: named for its kind, or for its kind and group. */
function tableOf(page: Page, kind: "Collections" | "Singles") {
  return page
    .locator("main")
    .getByRole("table", { name: new RegExp(`^${kind}`) });
}

test("the rail's Content entry opens the overview with the panel beside it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, "/");
  await waitForShellAnswers(page);

  // Found in the navigation: the dashboard's Content card draws a control of
  // the same name in the main column.
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Content", exact: true })
    .click();
  await page.waitForURL(/\/admin\/content$/);

  await expect(
    page.getByRole("heading", { level: 1, name: "Content" })
  ).toBeVisible();
  await expect(tableOf(page, "Collections").first()).toBeVisible();
  await expect(tableOf(page, "Singles")).toBeVisible();
  await expect(
    tableOf(page, "Singles").getByRole("link", {
      name: "Homepage",
      exact: true,
    })
  ).toBeVisible();
  // The panel is open beside it, with both headings.
  const panel = page
    .getByTestId("sub-sidebar")
    .getByRole("navigation", { name: "Content" });
  await expect(
    panel.getByRole("button", { name: /^Collections, \d+$/ })
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /^Singles, \d+$/ })
  ).toBeVisible();
});

for (const { address, shows, hides } of [
  { address: "/collections", shows: "Collections", hides: "Singles" },
  { address: "/singles", shows: "Singles", hides: "Collections" },
] as const) {
  test(`${address} shows the ${shows} table alone and stays`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(page, address);
    await waitForShellAnswers(page);

    await expect(
      page.getByRole("heading", { level: 1, name: shows })
    ).toBeVisible();
    await expect(tableOf(page, shows).first()).toBeVisible();
    await expect(tableOf(page, hides)).toHaveCount(0);
    // No redirect: still at the address asked for.
    expect(new URL(page.url()).pathname).toBe(`/admin${address}`);
  });
}
