/**
 * Custom CSS reaches the page and only the page.
 *
 * A page's CSS styling `body` and a block's CSS scoped by `selector` are drawn
 * on the published page and on the canvas, where the page sits in a frame of
 * its own, so the builder's panels around it keep their own background. A
 * block's CSS the checker refuses is drawn on neither.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasBlock, canvasFrame } from "./support/canvas-frame";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const BORDERED = "00000000-0000-4000-8000-00000000c551";
const REFUSED = "00000000-0000-4000-8000-00000000c552";
const PALE_YELLOW = "rgb(254, 243, 199)";
const BLUE = "rgb(0, 0, 255)";

/** A published page whose CSS styles `body`, with one block's CSS of its own. */
async function seed(page: Page): Promise<{ id: string; slug: string }> {
  const slug = `custom-css-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const created = await page.request.post(PAGES, {
    data: {
      title: "Custom CSS",
      slug,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "page",
        settings: { customCss: `body { background-color: ${PALE_YELLOW}; }` },
        nodes: [
          {
            id: BORDERED,
            type: "core/text",
            version: 2,
            props: { text: "Bordered words" },
            customCss: `selector { border: 4px solid ${BLUE}; }`,
          },
          {
            id: REFUSED,
            type: "core/text",
            version: 2,
            props: { text: "Plain words" },
            // Does not start from `selector`, so it cannot be scoped: refused.
            customCss: `p { border: 4px solid ${BLUE}; }`,
          },
        ],
      },
    },
  });
  expect(created.ok(), `seeding the page: ${created.status()}`).toBe(true);
  const id = ((await created.json()) as { item: { id: string } }).item.id;
  return { id, slug };
}

const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe("custom CSS", () => {
  test.describe.configure({ timeout: 180_000 });

  test("is drawn on the published page: the page's, and the block's on that block", async ({
    page,
  }) => {
    const { slug } = await seed(page);
    await page.goto(`/${slug}`);
    await expect(page.getByText("Bordered words")).toBeVisible();
    expect(await background(page)).toBe(PALE_YELLOW);
    await expect(page.getByText("Bordered words")).toHaveCSS(
      "border-top-color",
      BLUE
    );
    // The refused block's CSS is drawn nowhere.
    await expect(page.getByText("Plain words")).not.toHaveCSS(
      "border-top-color",
      BLUE
    );
  });

  test("styles the canvas page, never the builder around it", async ({
    page,
  }) => {
    const { id } = await seed(page);
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect(canvasBlock(page, BORDERED)).toBeVisible({ timeout: 30_000 });

    const frameBody = canvasFrame(page).locator("body");
    await expect(frameBody).toHaveCSS("background-color", PALE_YELLOW);
    await expect(canvasBlock(page, BORDERED)).toHaveCSS(
      "border-top-color",
      BLUE
    );
    await expect(canvasBlock(page, REFUSED)).not.toHaveCSS(
      "border-top-color",
      BLUE
    );
    // The admin's own page, the panels and the rail, keeps its background.
    expect(await background(page)).not.toBe(PALE_YELLOW);
  });
});
