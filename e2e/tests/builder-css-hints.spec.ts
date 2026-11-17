/**
 * A panel control's "what it writes" tooltip, in a real browser: it shows on
 * hover, stays while the pointer is over it, closes on Escape with the block
 * still selected, moves nothing in the panel, and meets WCAG 2.2 AA. And the
 * "Show CSS names" preference, kept across a reload.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasBlock } from "./support/canvas-frame";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SECTION = "00000000-0000-4000-8000-00000000c710";

async function createPage(request: APIRequestContext): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Hints ${stamp}`,
      slug: `hints-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: SECTION,
            type: "core/section",
            version: 1,
            props: { as: "section", contained: true },
            styles: { base: { base: { minHeight: "120px" } } },
            slots: { children: [] },
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
  const body = (await created.json()) as { item?: { id?: string } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return id;
}

/** The editor on a new page, the section selected, its Style tab open. */
async function openStyle(page: Page, id: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await canvasBlock(page, SECTION)
    .first()
    .click({ position: { x: 4, y: 4 } });
  await expect(page.locator("[data-block-card]")).toBeVisible();
  await page
    .getByTestId("inspector")
    .getByRole("tab", { name: "Style", exact: true })
    .click();
}

/** The Min height field, which holds the section's 120px. */
function minHeightField(page: Page) {
  return page
    .getByTestId("inspector")
    .locator(".nx-inspector__field")
    .filter({
      has: page.locator(".nx-style-inspector__field-label-text", {
        hasText: /^Min height$/,
      }),
    })
    .first();
}

/** Every control's box in the inspector, in order. */
async function controlBoxes(page: Page): Promise<string[]> {
  return page
    .getByTestId("inspector")
    .locator("input, button, [role='radio'], [role='combobox']")
    .evaluateAll(nodes =>
      nodes.map(node => {
        const box = node.getBoundingClientRect();
        return [box.x, box.y, box.width, box.height]
          .map(n => n.toFixed(1))
          .join(",");
      })
    );
}

test("a control's tooltip says what it writes, stays while hovered, and moves nothing", async ({
  page,
}) => {
  const id = await createPage(page.request);
  await openStyle(page, id);
  const field = minHeightField(page);
  await expect(field).toBeVisible();
  // In view first, so a scroll to reach it is not counted as a move.
  await field.scrollIntoViewIfNeeded();
  const before = await controlBoxes(page);

  await field.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("min-height: 120px");
  // Nothing in the panel moved: the tooltip is a layer.
  expect(await controlBoxes(page)).toEqual(before);

  // The pointer on the tooltip itself: it stays.
  const shown = page
    .locator(
      "[data-slot='tooltip-content'], [data-radix-popper-content-wrapper]"
    )
    .first();
  const box = await shown.boundingBox();
  if (box === null) throw new Error("the tooltip has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 4,
  });
  await page.waitForTimeout(400);
  await expect(tooltip).toBeVisible();

  // WCAG 2.2 AA, with the tooltip on screen.
  const results = await new AxeBuilder({ page }).withTags(AA_TAGS).analyze();
  expect(results.violations.map(v => v.id)).toEqual([]);

  // Escape closes it, and the section stays selected.
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await expect(page.locator("[data-block-card]")).toBeVisible();
});

test("Show CSS names prints them under each label, and is kept across a reload", async ({
  page,
}) => {
  const id = await createPage(page.request);
  await openStyle(page, id);
  const field = minHeightField(page);
  await expect(field.locator(".nx-css-names")).toHaveCount(0);

  await page.getByRole("button", { name: "Panel options" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show CSS names" }).click();
  await expect(field.locator(".nx-css-names")).toHaveText("min-height");

  await page.reload();
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await canvasBlock(page, SECTION)
    .first()
    .click({ position: { x: 4, y: 4 } });
  await page
    .getByTestId("inspector")
    .getByRole("tab", { name: "Style", exact: true })
    .click();
  await expect(minHeightField(page).locator(".nx-css-names")).toHaveText(
    "min-height"
  );
});
