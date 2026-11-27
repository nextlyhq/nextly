/**
 * The command palette, as the admin mounts it.
 *
 * The playground mounts no palette of its own, as an app made from the
 * template doesn't: the admin's root mounts it. ⌘K opens it fully inside the
 * window near its top at a phone, a laptop and a desktop width, in light and
 * dark; the rail's Search button and the phone drawer's open the same one;
 * picking a collection, a Single or a Settings page opens it where the menus
 * would; and inside the Page Builder's editor, which takes the whole window,
 * ⌘K is the editor's own, and back in the admin the rail's Search button
 * opens the admin's.
 *
 * @module tests/command-palette.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin, type Theme } from "./support/admin";
import { createPage, openBuilder } from "./support/builder-chrome";
import { waitForShellAnswers } from "./support/shell-geometry";
import { test } from "./support/test";

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;
const SCHEMES: readonly Theme[] = ["light", "dark"];

/** The admin's palette, told apart from the editor's by its field. */
function adminPalette(page: Page): Locator {
  return page.getByRole("dialog").filter({
    has: page.getByPlaceholder("Search or jump to…"),
  });
}

async function pressModK(page: Page): Promise<void> {
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+k" : "Control+k"
  );
}

/** The dialog's box lies wholly inside the window, its top in the upper quarter. */
async function expectInsideWindow(page: Page, dialog: Locator): Promise<void> {
  await expect(dialog).toBeVisible();
  // Once the opening animation has settled, so the box measured is the one
  // the person sees.
  await expect
    .poll(() => dialog.evaluate(element => element.getAnimations().length))
    .toBe(0);
  const box = await dialog.boundingBox();
  const window = page.viewportSize();
  expect(box, "the dialog has no box").not.toBeNull();
  expect(window).not.toBeNull();
  if (!box || !window) return;
  expect(box.x, "starts left of the window").toBeGreaterThanOrEqual(0);
  expect(box.y, "starts above the window").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "ends right of the window").toBeLessThanOrEqual(
    window.width
  );
  expect(box.y + box.height, "ends below the window").toBeLessThanOrEqual(
    window.height
  );
  expect(box.y, "not near the window's top").toBeLessThan(window.height / 4);
}

for (const viewport of VIEWPORTS) {
  for (const theme of SCHEMES) {
    test(`⌘K opens the palette inside the window at ${viewport.width}px, ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await gotoAdmin(page, "/", theme);
      await waitForShellAnswers(page);
      await pressModK(page);
      await expectInsideWindow(page, adminPalette(page));
      // One palette: the host app mounts none of its own.
      await expect(page.getByPlaceholder("Search or jump to…")).toHaveCount(1);
    });
  }
}

test("the rail's Search button opens the palette and gets focus back on Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, "/");
  await waitForShellAnswers(page);
  const search = page
    .locator("aside")
    .getByRole("button", { name: "Search (⌘K)" });
  await search.click();
  await expect(adminPalette(page)).toBeVisible();
  await expect(page.getByPlaceholder("Search or jump to…")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(adminPalette(page)).toBeHidden();
  await expect(search).toBeFocused();
});

test("on a phone, Search at the top of the menu drawer opens the palette", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoAdmin(page, "/");
  await page.getByRole("button", { name: "Open the navigation menu" }).click();
  // The drawer draws the whole rail, so its Search is the rail's, under the
  // logo and above the first menu entry.
  const drawer = page.getByRole("dialog", {
    name: "Navigation menu",
    exact: true,
  });
  await expect(drawer).toBeVisible();
  const search = drawer.getByRole("button", { name: "Search (⌘K)" });
  const searchBox = await search.boundingBox();
  const firstEntry = await drawer
    .getByRole("link", { name: "Dashboard", exact: true })
    .boundingBox();
  expect(searchBox && firstEntry && searchBox.y < firstEntry.y).toBe(true);
  await search.click();
  await expectInsideWindow(page, adminPalette(page));
  await expect(page.getByPlaceholder("Search or jump to…")).toBeFocused();
  // Escape closes the palette alone: the drawer is still open under it, and
  // focus is back on its Search.
  await page.keyboard.press("Escape");
  await expect(adminPalette(page)).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(search).toBeFocused();
});

test("picking a collection, a Single or a Settings page opens it where the menus would", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, "/");
  await waitForShellAnswers(page);

  const pick = async (typed: string, option: RegExp, url: RegExp) => {
    await pressModK(page);
    const field = page.getByPlaceholder("Search or jump to…");
    await field.fill(typed);
    await adminPalette(page)
      .getByRole("option", { name: option })
      .first()
      .click();
    await expect(adminPalette(page)).toBeHidden();
    await expect(page).toHaveURL(url);
  };

  await pick("posts", /^Posts$/, /\/admin\/collections\/posts(\?|$)/);
  await pick(
    "contact",
    /^Contact details$/,
    /\/admin\/singles\/contact-details/
  );
  await pick("general", /^General/, /\/admin\/settings(\?|$)/);
});

test("in the Page Builder's editor ⌘K is the editor's, and back in the admin the rail's Search opens the admin's", async ({
  page,
  request,
}) => {
  const { id } = await createPage(request);
  await openBuilder(page, id, { width: 1440, height: 900 });
  await pressModK(page);
  await expect(
    page.getByPlaceholder("Search blocks, this page, pages and commands…")
  ).toBeVisible();
  await expect(adminPalette(page)).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The editor takes the whole window, the admin's rail with it; its own back
  // arrow is the way out, and the rail's Search is there again once out.
  await expect(page.getByRole("button", { name: "Search (⌘K)" })).toHaveCount(
    0
  );
  await page
    .getByRole("button", { name: "Back to Pages", exact: true })
    .click();
  await page
    .locator("aside")
    .getByRole("button", { name: "Search (⌘K)" })
    .click();
  await expect(adminPalette(page)).toBeVisible();
});
