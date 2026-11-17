/**
 * Page settings in a browser, at 1280 × 720: one row of tabs titled by the
 * page, with "Site settings" apart for a manager; General's title, address
 * and header & footer; a field a site adds to Pages (the fixture's Summary)
 * on Fields with no change to the builder, the title not repeated there; the
 * row in view while a tab scrolls; Enter in a Fields field saving nothing;
 * closing keeping the change unsaved and focus going back to Settings; the
 * arrow keys moving between tabs; no axe violation on any tab; and a Publish
 * refused for a field on Fields offering "Show me", which opens Fields with
 * the field focused.
 *
 * @module tests/builder-page-settings-tabs.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { test } from "./support/test";

const API = "/admin/api";
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;

/** What the fixture's Summary rule says when a save refuses it. */
const SUMMARY_RULE = "A summary can't hold < or >.";

/** A page of its own, so no other spec meets its title or address. */
async function seedPage(page: Page, name: string): Promise<string> {
  await gotoAdmin(page, "/");
  const made = await page.request.post(`${API}/collections/pages/entries`, {
    data: {
      title: `${name} ${STAMP}`,
      slug: `${name.toLowerCase().replaceAll(" ", "-")}-${STAMP}`,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "lead",
            type: "core/heading",
            version: 1,
            props: { text: "Our plans", level: "h2" },
          },
        ],
      },
    },
  });
  expect(made.ok(), `creating the page: ${made.status()}`).toBe(true);
  return ((await made.json()) as { item: { id: string } }).item.id;
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
}

const railSettings = (page: Page): Locator =>
  page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Settings" });

const pageSettings = (page: Page): Locator =>
  page.getByRole("dialog", { name: /^Page settings · / });

async function openSettings(page: Page): Promise<Locator> {
  await railSettings(page).click();
  const dialog = pageSettings(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

const tab = (dialog: Locator, name: string): Locator =>
  dialog.getByRole("tab", { name, exact: true });

test.describe("Page settings", () => {
  test("is one row of tabs titled by the page, with Site settings apart, and the site's own field on Fields", async ({
    page,
  }) => {
    const id = await seedPage(page, "Tab row");
    await openBuilder(page, id);
    const dialog = await openSettings(page);
    await expect(dialog).toHaveAccessibleName(
      `Page settings · Tab row ${STAMP}`
    );

    // One row: General first, then Fields, then what plugins add.
    await expect(dialog.getByRole("tablist")).toHaveCount(1);
    const names = await dialog.getByRole("tab").allTextContents();
    expect(names.slice(0, 2)).toEqual(["General", "Fields"]);
    // Apart from the tabs, for a manager.
    const site = dialog.getByRole("button", { name: "Site settings" });
    await expect(site).toBeVisible();
    await expect(
      dialog.getByRole("tablist").getByText("Site settings")
    ).toHaveCount(0);

    // General: the title, then the address with copy and edit, then the
    // header & footer.
    await expect(tab(dialog, "General")).toHaveAttribute(
      "aria-selected",
      "true"
    );
    const title = dialog.getByRole("textbox", { name: "Title", exact: true });
    const address = dialog.getByRole("group", { name: "Address" });
    await expect(title).toHaveValue(`Tab row ${STAMP}`);
    await expect(
      address.getByRole("button", { name: "Copy address" })
    ).toBeVisible();
    await expect(
      address.getByRole("button", { name: "Edit address" })
    ).toBeVisible();
    await expect(
      dialog.getByRole("combobox", { name: "Header & footer" })
    ).toBeVisible();
    await expect(
      dialog.getByText("Saved with the page when you Save or Publish.")
    ).toBeVisible();
    await expectNoAxeViolations(page, { include: '[role="dialog"]' });

    // Fields: the fixture's Summary, which the builder knows nothing of, and
    // the title not repeated.
    await tab(dialog, "Fields").click();
    await expect(
      dialog.getByRole("textbox", { name: "Summary" })
    ).toBeVisible();
    await expect(
      dialog
        .getByRole("tabpanel", { name: "Fields" })
        .getByRole("textbox", { name: "Title", exact: true })
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Open as form" })
    ).toBeVisible();
    await expectNoAxeViolations(page, { include: '[role="dialog"]' });

    // No sideways scrolling at this size.
    const sideways = await dialog.evaluate(
      element => element.scrollWidth > element.clientWidth
    );
    expect(sideways, "Page settings scrolls sideways at 1280 × 720").toBe(
      false
    );

    // Site settings opens over it, saying it applies at once.
    await site.click();
    const siteDialog = page.getByRole("dialog", { name: "Site settings" });
    await expect(
      siteDialog.getByText("Changes here apply to the live site immediately.")
    ).toBeVisible();
  });

  test("keeps the tab row in view while a tab's content scrolls, and moves between tabs by the arrow keys", async ({
    page,
  }) => {
    const id = await seedPage(page, "Scrolled");
    await openBuilder(page, id);
    const dialog = await openSettings(page);
    const row = dialog.getByRole("tablist");
    const before = await row.boundingBox();
    // Scrolled to its end, the content moves under the row; the row stays.
    await dialog
      .locator("[data-settings-body]")
      .evaluate(body => body.scrollTo({ top: body.scrollHeight }));
    await expect(row).toBeInViewport();
    expect(await row.boundingBox()).toEqual(before);

    await tab(dialog, "General").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(dialog, "Fields")).toBeFocused();
    await expect(tab(dialog, "Fields")).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await page.keyboard.press("ArrowLeft");
    await expect(tab(dialog, "General")).toBeFocused();
  });

  test("never saves on Enter in a Fields field, and closing keeps the change unsaved and returns focus", async ({
    page,
  }) => {
    const id = await seedPage(page, "Enter kept");
    await openBuilder(page, id);
    const dialog = await openSettings(page);
    await tab(dialog, "Fields").click();

    let wrote = false;
    page.on("request", request => {
      if (
        new URL(request.url()).pathname.endsWith(`/entries/${id}`) &&
        ["PATCH", "PUT"].includes(request.method())
      ) {
        wrote = true;
      }
    });
    const summary = dialog.getByRole("textbox", { name: "Summary" });
    await summary.fill("Fixed quotes for every survey.");
    await summary.press("Enter");
    await page.waitForTimeout(1500);
    expect(wrote, "Enter in a Page settings field must not save the page").toBe(
      false
    );
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(railSettings(page)).toBeFocused();
    const save = page
      .locator('[data-topbar="end"]')
      .getByRole("button", { name: /^Save( draft)?$/ })
      .first();
    await expect(save).toBeEnabled();

    // Opened again, the change is still there, unsaved.
    await railSettings(page).click();
    await tab(pageSettings(page), "Fields").click();
    await expect(
      pageSettings(page).getByRole("textbox", { name: "Summary" })
    ).toHaveValue("Fixed quotes for every survey.");
  });

  test("offers Show me for a field a Publish refused, opening Fields with it focused", async ({
    page,
  }) => {
    const id = await seedPage(page, "Show me");
    await openBuilder(page, id);
    const dialog = await openSettings(page);
    await tab(dialog, "Fields").click();
    await dialog.getByRole("textbox", { name: "Summary" }).fill("<b>Big</b>");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page
      .locator('[data-topbar="end"]')
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    const showMe = page.getByRole("button", { name: "Show me Summary" });
    await expect(showMe).toBeVisible();
    await expect(page.getByText(SUMMARY_RULE).first()).toBeVisible();
    await showMe.click();

    await expect(pageSettings(page)).toBeVisible();
    await expect(tab(pageSettings(page), "Fields")).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(
      pageSettings(page).getByRole("textbox", { name: "Summary" })
    ).toBeFocused();
  });
});
