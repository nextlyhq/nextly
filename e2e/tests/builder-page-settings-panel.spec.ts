/**
 * The right panel with nothing selected: the page's own settings, never a
 * dead note. Its rows edit the same fields Settings does, the top bar and
 * Save follow at once, and the panel and the canvas keep their size as the
 * selection comes and goes.
 *
 * The playground runs the SEO plugin, which leaves the Page Builder's pages
 * out, so the search result row says SEO is turned off for them. Without the
 * plugin the row is the builder's own summary, and where it edits a page's
 * type it is the plugin's own answer; the panel's and the plugin's
 * component tests cover both, and builder-seo-tab.spec.ts the latter.
 *
 * @module tests/builder-page-settings-panel.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import {
  canvasRoot,
  clearSelection,
  pressSave,
  selection,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const API = "/admin/api";
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;

/** A page of its own, so no other spec meets its title or address. */
async function seedPage(
  page: Page,
  name: string
): Promise<{
  id: string;
  title: string;
  slug: string;
}> {
  await gotoAdmin(page, "/");
  const title = `${name} ${STAMP}`;
  const slug = `${name.toLowerCase().replaceAll(" ", "-")}-${STAMP}`;
  const made = await page.request.post(`${API}/collections/pages/entries`, {
    data: {
      title,
      slug,
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
  const id = ((await made.json()) as { item: { id: string } }).item.id;
  return { id, title, slug };
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
}

const inspector = (page: Page): Locator =>
  page.getByRole("complementary", { name: "Inspector" });

const pageSettings = (page: Page): Locator =>
  inspector(page).getByRole("region", { name: "Page settings" });

const heading = async (page: Page): Promise<Locator> =>
  (await canvasRoot(page)).getByText("Our plans");

/** Esc until nothing is selected, as an author leaves a block. */
async function deselect(page: Page): Promise<void> {
  for (let press = 0; press < 4; press += 1) {
    if ((await selection(page)).length === 0) return;
    await page.keyboard.press("Escape");
  }
  await expect.poll(() => selection(page)).toEqual([]);
}

/** The page as stored, its draft included, as the entry form reads it. */
async function storedTitle(page: Page, id: string): Promise<unknown> {
  const read = (await (
    await page.request.get(
      `${API}/collections/pages/entries/${id}?depth=0&draft=true&status=all`
    )
  ).json()) as { item?: { title?: unknown }; title?: unknown };
  return (read.item ?? read).title;
}

test("with nothing selected, the right panel shows the page's settings", async ({
  page,
  context,
}) => {
  const seeded = await seedPage(page, "Settings panel");
  await openBuilder(page, seeded.id);
  await clearSelection(page);

  const panel = pageSettings(page);
  await expect(panel).toBeVisible();
  await expect(inspector(page)).not.toContainText("Select a block");
  await expect(panel.getByRole("textbox", { name: "Title" })).toHaveValue(
    seeded.title
  );
  await expect(panel.getByRole("textbox", { name: "Address" })).toHaveValue(
    seeded.slug
  );
  await expect(
    panel.getByRole("combobox", { name: "Header & footer" })
  ).toBeVisible();
  // The SEO plugin is installed and leaves these pages out, so the row says
  // so, and draws no summary that could stand for the plugin's.
  await expect(panel.getByText("SEO is turned off for Pages.")).toBeVisible();
  await expect(
    panel.getByRole("region", { name: "Search result" })
  ).toHaveCount(0);

  // Copy puts the page's address on the clipboard.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await panel
    .getByRole("button", { name: `Copy address /${seeded.slug}` })
    .click();
  await expect(
    panel.getByRole("button", { name: "Address copied" })
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `/${seeded.slug}`
  );

  // "All page settings…" opens Page settings on General, whichever tab it
  // was left on, among the tabs other plugins add to the same row.
  const all = panel.getByRole("button", { name: "All page settings…" });
  const dialog = page.getByRole("dialog", { name: /^Page settings · / });
  const general = dialog.getByRole("tab", { name: "General" });
  await all.click();
  await expect(general).toHaveAttribute("aria-selected", "true");
  await dialog.getByRole("tab", { name: "Fields" }).click();
  await expect(general).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await all.click();
  await expect(general).toHaveAttribute("aria-selected", "true");
});

test("a rename in the panel is the page's title everywhere, saved with its draft", async ({
  page,
}) => {
  const seeded = await seedPage(page, "Renamed in panel");
  await openBuilder(page, seeded.id);
  await clearSelection(page);

  // Nothing to save yet.
  const end = page.locator('[data-topbar="end"]');
  await expect(end.getByRole("button", { name: "Saved" })).toBeVisible();

  const renamed = `Plans ${STAMP}`;
  await pageSettings(page)
    .getByRole("textbox", { name: "Title" })
    .fill(renamed);

  // The top bar follows at once, and there is something to save.
  await expect(
    page
      .locator('[data-topbar="start"]')
      .getByRole("button", { name: `${renamed}: switch page` })
  ).toBeVisible();
  await expect(end.getByRole("button", { name: "Saved" })).toHaveCount(0);
  const save = end.getByRole("button", { name: /^Save( draft)?$/ }).first();
  await expect(save).toBeEnabled();
  await expect(save).not.toHaveAttribute("aria-disabled", "true");

  // Settings shows the same value.
  await pageSettings(page)
    .getByRole("button", { name: "All page settings…" })
    .click();
  const dialog = page.getByRole("dialog", { name: /^Page settings · / });
  await expect(
    dialog.getByRole("textbox", { name: "Title", exact: true })
  ).toHaveValue(renamed);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await pressSave(page);
  await expect(end.getByRole("button", { name: "Saved" })).toBeVisible();
  await expect
    .poll(() => storedTitle(page, seeded.id), { timeout: 15_000 })
    .toBe(renamed);
});

test("the panel and the canvas keep their size as the selection comes and goes", async ({
  page,
}) => {
  const seeded = await seedPage(page, "Steady panel");
  await openBuilder(page, seeded.id);
  await clearSelection(page);

  const frame = page.locator("[data-nx-canvas-frame-box]");
  const sizes = async () => {
    const canvas = await frame.boundingBox();
    const side = await inspector(page).boundingBox();
    return {
      canvas: canvas === null ? null : Math.round(canvas.width),
      panel: side === null ? null : Math.round(side.width),
    };
  };
  const before = await sizes();
  expect(before.canvas).not.toBeNull();
  expect(before.panel).not.toBeNull();

  for (let round = 0; round < 3; round += 1) {
    await (await heading(page)).click();
    await expect(
      inspector(page).getByRole("tab", { name: "Content" })
    ).toBeVisible();
    expect(await sizes()).toEqual(before);
    await deselect(page);
    await expect(pageSettings(page)).toBeVisible();
    expect(await sizes()).toEqual(before);
  }
});
