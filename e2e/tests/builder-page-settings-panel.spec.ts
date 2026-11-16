/**
 * The right panel with nothing selected: the page's own settings, never a
 * dead note. Its rows edit the same fields Settings does, the top bar and
 * Save follow at once, and the panel and the canvas keep their size as the
 * selection comes and goes.
 *
 * The playground runs the SEO plugin, which leaves the Page Builder's pages
 * out, so these pages show the builder's own search result. Where the SEO
 * plugin edits a page's type the row is its own to draw, which the panel's
 * component test covers.
 *
 * @module tests/builder-page-settings-panel.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { canvasRoot, clearSelection, pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const API = "/admin/api";
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;

/** A page of its own, so no other spec meets its title or address. */
async function seedPage(page: Page, name: string): Promise<{
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
  // The SEO plugin leaves these pages out, so the builder's own summary.
  const result = panel.getByRole("region", { name: "Search result" });
  await expect(result).toContainText(seeded.title);
  await expect(result).toContainText(`/${seeded.slug}`);

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

  // "All page settings…" opens Settings on the page's own General tab,
  // even after it was left on another tab.
  await panel.getByRole("button", { name: "All page settings…" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "This page" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  const seo = dialog.getByRole("tab", { name: "SEO" });
  if ((await seo.count()) > 0) {
    await seo.click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await panel.getByRole("button", { name: "All page settings…" }).click();
    await expect(dialog.getByRole("tab", { name: "General" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  }
});

test("a rename in the panel is the page's title everywhere, saved with its draft", async ({
  page,
}) => {
  const seeded = await seedPage(page, "Renamed in panel");
  await openBuilder(page, seeded.id);
  await clearSelection(page);

  const renamed = `Plans ${STAMP}`;
  await pageSettings(page).getByRole("textbox", { name: "Title" }).fill(renamed);

  // The top bar follows at once, and there is something to save.
  await expect(
    page
      .locator('[data-topbar="start"]')
      .getByRole("button", { name: `${renamed}: switch page` })
  ).toBeVisible();
  const save = page
    .locator('[data-topbar="end"]')
    .getByRole("button", { name: /^Save( draft)?$/ });
  await expect(save.first()).toBeVisible();
  await expect(save.first()).not.toHaveAttribute("aria-disabled", "true");

  // Settings shows the same value.
  await pageSettings(page)
    .getByRole("button", { name: "All page settings…" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    renamed
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await pressSave(page);
  await expect
    .poll(
      async () => {
        const read = (await (
          await page.request.get(
            `${API}/collections/pages/entries/${seeded.id}?depth=0`
          )
        ).json()) as { item?: { title?: string }; title?: string };
        return (read.item ?? read).title;
      },
      { timeout: 15_000 }
    )
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
    await clearSelection(page);
    await expect(pageSettings(page)).toBeVisible();
    expect(await sizes()).toEqual(before);
  }
});
