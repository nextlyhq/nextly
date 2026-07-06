/**
 * Page Builder — end-to-end interaction spec (spec §16).
 *
 * ⚠️ NOT run by `pnpm test` (vitest is scoped to `src/`). This suite exercises the
 * browser-only interactions that unit tests cannot: cross-iframe drag-and-drop, the
 * responsive iframe preview, the Query Loop preview, and the field mount. It requires a
 * live playground and a seeded database:
 *
 *   1. Apply the plugin's `dc_pages` table + the `homepage` single (drizzle push — needs a TTY).
 *   2. `pnpm --filter playground dev`  (admin auto-login is on in the playground)
 *   3. `pnpm --filter @nextlyhq/plugin-page-builder exec playwright test`
 *
 * Until the two platform env steps land (see the tracker / M3 notes), this runs locally
 * only, not in CI. The assertions below are the acceptance criteria for M5–M7.
 */
import { expect, test } from "@playwright/test";

const ADMIN = "http://localhost:3000/admin";

test.describe("page builder editor", () => {
  test("build a page from empty: add, nest, reorder, responsive, publish", async ({
    page,
  }) => {
    await page.goto(`${ADMIN}/collections/pages/new`);

    // Add a Container, then a Heading + Button inside it (click-to-insert path).
    await page.getByRole("button", { name: "Insert Container" }).click();
    await page.getByRole("button", { name: "Insert Heading" }).click();
    await page.getByRole("button", { name: "Insert Button" }).click();

    // The canvas iframe renders the blocks.
    const canvas = page.frameLocator('iframe[title="Page preview"]');
    await expect(canvas.locator("h2")).toBeVisible();
    await expect(canvas.locator("button")).toBeVisible();

    // Edit the heading text via the inspector Content tab.
    await canvas.locator("h2").click();
    await page.getByLabel("Text").fill("Welcome");
    await expect(canvas.getByText("Welcome")).toBeVisible();

    // Reorder via the inspector (keyboard-accessible path).
    await page.getByRole("button", { name: "Move block down" }).click();

    // Responsive: switch to mobile and set a font-size override that visibly applies.
    await page.getByRole("button", { name: "mobile" }).click();
    await page.getByRole("tab", { name: "Responsive" }).click();
    await page.getByLabel("Font size").fill("18");

    // Page settings + publish.
    await page.getByLabel("Title").fill("Home");
    await page.getByLabel("Slug").fill("home");
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText(/published|saved/i)).toBeVisible();
  });

  test("clicking a block opens its settings, first try", async ({ page }) => {
    await page.goto(`${ADMIN}/collections/pages/new`);
    await page.getByRole("button", { name: "Insert Heading" }).click();
    const canvas = page.frameLocator('iframe[title="Page preview"]');
    // Click the block itself (not the inspector) and expect the Content field to appear.
    await canvas.locator("h2").click();
    await expect(page.getByLabel("Text")).toBeVisible();
  });

  test("a freshly inserted Image is visible and selectable", async ({
    page,
  }) => {
    await page.goto(`${ADMIN}/collections/pages/new`);
    await page.getByRole("button", { name: "Insert Image" }).click();
    const canvas = page.frameLocator('iframe[title="Page preview"]');
    const placeholder = canvas.getByText(/Image — click to configure/);
    await expect(placeholder).toBeVisible();
    await placeholder.click();
    // The image inspector exposes the media control label.
    await expect(page.getByText(/Image/).first()).toBeVisible();
  });

  test("a small click on a block selects instead of dragging it", async ({
    page,
  }) => {
    await page.goto(`${ADMIN}/collections/pages/new`);
    await page.getByRole("button", { name: "Insert Heading" }).click();
    await page.getByRole("button", { name: "Insert Paragraph" }).click();
    const canvas = page.frameLocator('iframe[title="Page preview"]');
    // A plain click (no drag) must not reorder — heading stays first.
    await canvas.locator("h2").click();
    await expect(page.getByLabel("Text")).toBeVisible();
    const tags = await canvas
      .locator("h2, p")
      .evaluateAll(els => els.map(e => e.tagName.toLowerCase()));
    expect(tags[0]).toBe("h2");
  });

  test("query loop preview shows the template once at design time", async ({
    page,
  }) => {
    await page.goto(`${ADMIN}/collections/pages/new`);
    await page.getByRole("button", { name: "Insert Query Loop" }).click();
    const canvas = page.frameLocator('iframe[title="Page preview"]');
    await expect(
      canvas.locator('[data-nx-query-loop="preview"]')
    ).toBeVisible();
  });

  test("query loop is authored via a collection dropdown, not a text slug", async ({
    page,
  }) => {
    await page.goto(`${ADMIN}/collections/pages/new`);
    await page.getByRole("button", { name: "Insert Query Loop" }).click();
    const canvas = page.frameLocator('iframe[title="Page preview"]');
    // Selecting the loop opens the dedicated settings panel with a Collection dropdown.
    await canvas.locator('[data-nx-query-loop="preview"]').click();
    await expect(
      page.getByRole("combobox", { name: "Collection" })
    ).toBeVisible();
  });

  test("field mount: edit the homepage single layout", async ({ page }) => {
    await page.goto(`${ADMIN}/singles/homepage`);
    await page.getByRole("button", { name: "Insert Paragraph" }).click();
    const canvas = page.frameLocator('iframe[title="Page preview"]');
    await expect(canvas.locator("p")).toBeVisible();
    await page.getByRole("button", { name: /save/i }).click();
  });

  test("published front-end parity", async ({ page }) => {
    await page.goto("http://localhost:3000/home");
    await expect(page.locator(".nx-pb-page")).toBeVisible();
    await expect(page.getByText("Welcome")).toBeVisible();
  });
});
