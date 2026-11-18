/**
 * The entry and settings screens by keyboard alone, from a page's first load:
 * every step is a key, never a click or a programmatic focus, and each
 * control reached shows where the focus is.
 *
 * - From the Pages list, Tab reaches "+ New page", Enter opens the dialog
 *   with the title focused, and typing a title then Tab to "Create and open
 *   builder" and Enter makes a draft and opens it in the builder.
 * - In the builder, Tab reaches the top bar's ⋯, the arrow keys reach "Open
 *   as form", and Enter opens the page's form; there Tab reaches the
 *   document bar's "Open in builder", which opens the builder again, and its
 *   "Back to Pages" goes back to the list.
 *
 * @module tests/entry-and-settings-keyboard.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { createEntry } from "./support/runtime-collection";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const RUN = Date.now().toString(36);

const builderAt = (id: string) =>
  new RegExp(`/admin/collections/pages/${id}/builder\\?field=content$`);
const formAt = (id: string) => new RegExp(`/admin/collections/pages/${id}$`);

/** What has focus, named as a person would read it, for a failure message. */
function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) return "(body)";
    return (
      active.getAttribute("aria-label") ??
      active.textContent?.trim().slice(0, 40) ??
      active.tagName
    );
  });
}

/**
 * Presses `key` until `target` has focus, as a keyboard reader moves to a
 * control, failing with where focus went if it never arrives.
 */
async function pressUntilFocused(
  page: Page,
  target: Locator,
  key = "Tab",
  max = 200
): Promise<void> {
  const visited: string[] = [];
  for (let at = 0; at < max; at += 1) {
    if (await target.evaluate(node => node === document.activeElement)) return;
    await page.keyboard.press(key);
    visited.push(await focusedName(page));
  }
  throw new Error(
    `${key} never reached ${String(target)}; focus went through:\n${visited.slice(-40).join("\n")}`
  );
}

/**
 * `target` holds focus and draws a mark of it: an outline with a width, or a
 * ring its box shadow spreads. Polled, since a ring can ease in.
 */
async function expectFocusShown(target: Locator): Promise<void> {
  await expect(target).toBeFocused();
  await expect
    .poll(
      () =>
        target.evaluate(node => {
          const style = getComputedStyle(node);
          const outline =
            style.outlineStyle !== "none" &&
            Number.parseFloat(style.outlineWidth) > 0;
          // A ring is a shadow layer with a spread (its fourth length).
          const ring = style.boxShadow.split(/,(?![^(]*\))/).some(layer => {
            const lengths = layer.match(/-?[\d.]+px/g) ?? [];
            return Number.parseFloat(lengths[3] ?? "0") > 0;
          });
          return outline || ring;
        }),
      { message: `${String(target)} shows no focus mark` }
    )
    .toBe(true);
}

/** Tab to `target`, then see that it shows the focus. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  await pressUntilFocused(page, target);
  await expectFocusShown(target);
}

/** The stored pages titled `title`, every status. */
async function storedTitled(
  page: Page,
  title: string
): Promise<Array<{ status?: string }>> {
  const response = await page.request.get(
    `${ENTRIES}?status=all&limit=5&where[title][equals]=${encodeURIComponent(title)}`
  );
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { items: Array<{ status?: string }> })
    .items;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("creates a page from the Pages list by keyboard alone", async ({
  page,
}) => {
  const title = `Keyboard page ${RUN}`;
  await gotoAdmin(page, "/collections/pages");

  const opener = page.getByRole("button", { name: /^New / });
  await tabTo(page, opener);
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "New page" });
  await expect(dialog.getByRole("textbox", { name: "Title" })).toBeFocused();
  // The Header & footer menu takes focus once its choices have arrived.
  await expect(
    dialog.getByRole("combobox", { name: "Header & footer" })
  ).toBeEnabled();
  await page.keyboard.type(title);
  // The address is made from the title as it is typed.
  await expect(dialog).toContainText(`/keyboard-page-${RUN}`);

  const create = dialog.getByRole("button", {
    name: "Create and open builder",
  });
  await tabTo(page, create);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/builder\?field=content$/, {
    timeout: 60_000,
  });
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  const stored = await storedTitled(page, title);
  expect(stored).toHaveLength(1);
  expect(stored[0]?.status).toBe("draft");
});

test("opens a page as a form from the builder and back, by keyboard alone", async ({
  page,
}) => {
  const id = await createEntry(page.request, "pages", {
    title: `Keyboard form ${RUN}`,
    slug: `keyboard-form-${RUN}`,
    status: "draft",
    content: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "00000000-0000-4000-8000-00000000f101",
          type: "core/heading",
          version: 1,
          props: { text: "By keyboard", level: "h2" },
        },
      ],
    },
  });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });

  // The top bar's ⋯, then down its menu to "Open as form".
  const more = page
    .locator('[data-topbar="end"]')
    .getByRole("button", { name: "More actions" });
  await tabTo(page, more);
  await page.keyboard.press("Enter");
  const asForm = page.getByRole("menuitem", { name: "Open as form" });
  await expect(asForm).toBeVisible();
  await pressUntilFocused(page, asForm, "ArrowDown", 20);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(formAt(id));

  // The form's own way back, in its document bar.
  const inBuilder = page
    .getByTestId("document-bar")
    .getByRole("link", { name: "Open in builder", exact: true });
  await expect(inBuilder).toBeVisible({ timeout: 30_000 });
  await tabTo(page, inBuilder);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(builderAt(id));
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });

  // And out to the list by the builder's back arrow.
  const back = page.getByRole("button", {
    name: "Back to Pages",
    exact: true,
  });
  await tabTo(page, back);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/collections\/pages(\?|$)/);
});
