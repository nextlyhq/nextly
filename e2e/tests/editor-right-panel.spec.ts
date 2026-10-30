/**
 * The editor's document panel at the widths an editor is used at, laid out by
 * a real browser.
 *
 * At 1440px it is a column beside the fields, reading Status, Publishing,
 * Language and Details, and it shares the right side with the preview pane:
 * opening the preview folds it, and showing it closes the preview. At 860px
 * it floats over the fields when asked for, with its own close button. At
 * 390px it is a sheet from the bottom, and History, the preview and the panel
 * toggle are rows of the document's menu.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

/** The site's address, which a preview is built on. */
async function useThisSite(page: Page, baseURL: string): Promise<void> {
  const saved = await page.request.patch("/admin/api/general-settings", {
    data: { siteUrl: baseURL },
  });
  expect(saved.ok(), `saving the site URL: ${saved.status()}`).toBe(true);
}

/** A saved entry, opened at the page's present width. */
async function openEntry(page: Page): Promise<void> {
  const created = await page.request.post(
    "/admin/api/collections/block-pages/entries",
    {
      data: {
        title: "Right panel",
        slug: `right-panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      },
    }
  );
  expect(created.ok()).toBe(true);
  const { item } = (await created.json()) as { item: { id: string } };
  await gotoAdmin(page, `/collections/block-pages/${item.id}`);
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true })
  ).toHaveValue("Right panel", { timeout: 30_000 });
}

const panel = (page: Page): Locator =>
  page.getByRole("complementary", { name: "Document panel" });

/** Nothing on the page scrolls sideways. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("docks the panel beside the fields at 1440px, sharing the right side with the preview", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await useThisSite(page, testInfo.project.use.baseURL!);
  await openEntry(page);
  // The author's choice is kept between visits; start from it shown.
  await page.evaluate(() =>
    window.localStorage.setItem("nextly:admin:entry-rail-collapsed", "0")
  );
  await page.reload();

  await expect(panel(page)).toHaveAttribute("data-document-panel", "docked");
  const sections = panel(page).locator("[data-panel-section]");
  await expect(sections).toHaveCount(3);
  expect(
    await sections.evaluateAll(all =>
      all.map(el => el.getAttribute("data-panel-section"))
    )
  ).toEqual(["Status", "Publishing", "Details"]);

  // Beside the fields, not over them.
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  const [fields, beside] = await Promise.all([
    title.boundingBox(),
    panel(page).boundingBox(),
  ]);
  expect(fields!.x + fields!.width).toBeLessThanOrEqual(beside!.x + 1);

  // The preview folds it...
  await page.getByRole("button", { name: /^show preview$/i }).click();
  await expect(page.locator('[data-preview-split="open"]')).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  // ...and showing it closes the preview. The preview leaves the editor under
  // 600px wide, so the bar has folded its toggle into the document's menu.
  await expect(page.locator("[data-document-editor-frame]")).toHaveAttribute(
    "data-panel-mode",
    "sheet"
  );
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Show document panel" }).click();
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('[data-preview-split="open"]')).toHaveCount(0);
  await expectNoSidewaysScroll(page);
});

test("floats the panel over the fields at 860px, with its own close button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 860, height: 900 });
  await openEntry(page);

  // Closed on arrival: the fields keep the width.
  await expect(panel(page)).toHaveCount(0);
  const toggle = page.getByRole("button", { name: "Show document panel" });
  await toggle.click();
  await expect(panel(page)).toHaveAttribute("data-document-panel", "floating");
  await expect(panel(page)).toBeFocused();

  // Over the fields' right edge, under the bar, and inside the window.
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  const [fields, over, bar] = await Promise.all([
    title.boundingBox(),
    panel(page).boundingBox(),
    page.getByTestId("document-bar").boundingBox(),
  ]);
  expect(over!.x).toBeLessThan(fields!.x + fields!.width);
  expect(over!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1);
  expect(over!.x + over!.width).toBeLessThanOrEqual(860);
  // Its last section is on screen, whatever the document's length: a short
  // document's row must not cut the panel off.
  await expect(
    panel(page).getByRole("region", { name: "Details" })
  ).toBeInViewport();
  await expectNoSidewaysScroll(page);

  // Escape inside it closes it, and leaves the editor where it was.
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/collections\/block-pages\/[^/]+$/);
  await expect(toggle).toBeFocused();

  // So does its close button.
  await toggle.click();
  await panel(page)
    .getByRole("button", { name: "Close document panel" })
    .click();
  await expect(panel(page)).toHaveCount(0);
});

test("opens the panel as a sheet at 390px, with History, the preview and the toggle in the menu", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useThisSite(page, testInfo.project.use.baseURL!);
  await openEntry(page);

  // Out of the bar...
  const bar = page.getByTestId("document-bar");
  await expect(bar.getByRole("button", { name: "History" })).toHaveCount(0);
  await expect(
    bar.getByRole("button", { name: /document panel$/i })
  ).toHaveCount(0);

  // ...and rows of the document's menu.
  await page.getByRole("button", { name: "More actions" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "History" })).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Show preview pane" })
  ).toBeVisible();
  await menu.getByRole("menuitem", { name: "Show document panel" }).click();

  const sheet = page.getByRole("dialog", { name: "Document" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("data-document-panel", "sheet");
  // From the bottom of the screen, as wide as it.
  const box = await sheet.boundingBox();
  expect(Math.abs(box!.y + box!.height - 844)).toBeLessThanOrEqual(1);
  expect(Math.round(box!.width)).toBe(390);
  await expect(sheet.getByRole("region", { name: "Details" })).toBeVisible();
  await expectNoSidewaysScroll(page);

  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/\/collections\/block-pages\/[^/]+$/);

  // The preview, from the same menu, takes the whole screen: two panes side
  // by side leave neither readable on a phone.
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Show preview pane" }).click();
  await expect(page.locator('[data-preview-split="open"]')).toBeVisible();
  await expect(title).toBeHidden();
  await expectNoSidewaysScroll(page);
  await page.getByRole("button", { name: "Close the preview" }).click();
  // The editor comes back as it was left.
  await expect(title).toHaveValue("Right panel");
});
