/**
 * "Inside its parent" in the real editor: a block's Width, Fill, Fit or
 * Fixed, laid out on the canvas as each says, by the parent's arrangement at
 * the device being edited.
 *
 * - In a Row, Fill takes the rest of the row beside a block that fits.
 * - Under a Row stacked on Mobile, Fill at Mobile fills the width for a
 *   block given a Fixed width at Desktop.
 *
 * Each test makes its own page, on the site's own devices, so no lock is
 * needed.
 *
 * @module tests/builder-inside-parent.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasBlock } from "./support/canvas-frame";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const BOX = "00000000-0000-4000-8000-00000000b110";
const FIRST = "00000000-0000-4000-8000-00000000b11a";
const SECOND = "00000000-0000-4000-8000-00000000b11b";

/** A page holding a Row of two Buttons in a padded Box. */
async function createPage(request: APIRequestContext): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const button = (id: string, label: string) => ({
    id,
    type: "core/button",
    version: 1,
    props: { label, href: "/" },
  });
  const created = await request.post(ENTRIES, {
    data: {
      title: `Inside ${stamp}`,
      slug: `inside-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: BOX,
            type: "core/box",
            version: 1,
            props: { as: "div" },
            styles: {
              base: {
                base: {
                  display: "flex",
                  padding: {
                    blockStart: "24px",
                    blockEnd: "24px",
                    inlineStart: "24px",
                    inlineEnd: "24px",
                  },
                },
              },
            },
            slots: {
              children: [button(FIRST, "First"), button(SECOND, "Second")],
            },
          },
        ],
      },
    },
  });
  if (!created.ok()) {
    throw new Error(
      `creating a page failed: ${created.status()} ${await created.text()}`
    );
  }
  const id = ((await created.json()) as { item?: { id?: string } }).item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return id;
}

async function openEditor(page: Page, id: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** Select a block on the canvas and open a Style section. */
async function select(page: Page, block: string, section: string) {
  await canvasBlock(page, block)
    .first()
    .click({ position: { x: 4, y: 4 } });
  await expect(page.locator("[data-block-card]")).toBeVisible();
  await page
    .getByTestId("inspector")
    .getByRole("tab", { name: /^Style/ })
    .click();
  const header = page
    .getByTestId("inspector")
    .locator(`[data-section="${section}"] [data-slot="accordion-trigger"]`);
  if ((await header.getAttribute("aria-expanded")) !== "true") {
    await header.click();
  }
}

function width(page: Page) {
  return page
    .getByTestId("inspector")
    .locator('[data-control="inside-parent"]')
    .getByRole("radiogroup", { name: "Width", exact: true });
}

async function box(page: Page, block: string) {
  const found = await canvasBlock(page, block).first().boundingBox();
  if (found === null) throw new Error(`${block} has no box`);
  return found;
}

test.describe("a block inside its parent", () => {
  test.describe.configure({ timeout: 180_000 });

  test("in a Row, Fill takes the rest of the row", async ({ page }) => {
    const id = await createPage(page.request);
    await openEditor(page, id);
    await select(page, FIRST, "inside-parent");
    await width(page).getByRole("radio", { name: "Fill" }).click();
    await expect(
      width(page).getByRole("radio", { name: "Fill" })
    ).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => {
        const row = await box(page, BOX);
        const first = await box(page, FIRST);
        const second = await box(page, SECOND);
        // The first reaches the second, which still sits at the row's end.
        return (
          Math.abs(first.x + first.width - second.x) < 2 &&
          Math.abs(second.x + second.width - (row.x + row.width - 24)) < 2
        );
      })
      .toBe(true);
  });

  test("under a Row stacked on Mobile, Fill there fills a width fixed at Desktop", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openEditor(page, id);
    // The Row stacks on Mobile.
    await select(page, BOX, "layout");
    const stackOn = page
      .getByTestId("inspector")
      .locator('[data-control="arrange"]')
      .getByLabel("Stack on");
    const mobile = await stackOn
      .locator("option", { hasText: /^Mobile/ })
      .getAttribute("value");
    await stackOn.selectOption(mobile ?? "");

    // The first Button is 160px wide at Desktop.
    await select(page, FIRST, "inside-parent");
    await width(page).getByRole("radio", { name: "Fixed" }).click();
    const size = page.getByTestId("inspector").getByLabel("Width set");
    await size.fill("160px");
    await size.press("Enter");
    await expect
      .poll(async () => (await box(page, FIRST)).width)
      .toBeCloseTo(160, 0);

    // At Mobile it is stacked: Fill there takes the column's width.
    await page
      .getByRole("radiogroup", { name: "Device" })
      .getByRole("radio", { name: /^Mobile/ })
      .click();
    await select(page, FIRST, "inside-parent");
    await expect(
      page
        .getByTestId("inspector")
        .locator('[data-control="inside-parent"]')
        .getByRole("radiogroup", { name: "Height", exact: true })
    ).toHaveCount(0);
    await width(page).getByRole("radio", { name: "Fill" }).click();
    await expect
      .poll(async () => {
        const column = await box(page, BOX);
        const first = await box(page, FIRST);
        return Math.abs(first.width - (column.width - 48)) < 2;
      })
      .toBe(true);
  });
});
