/**
 * Dragging a number field's label in the Style tab changes its value.
 *
 * - The label shows the resize cursor, and a plain click on it still focuses
 *   the field.
 * - A drag shows the value live in the field and on the canvas only once
 *   released, and one Undo takes the whole drag back.
 * - Escape during a drag puts the value back and writes nothing.
 * - Shift drags in steps of ten, and the result is what the page saves.
 *
 * Its own page, named uniquely, so no page lock is needed.
 *
 * @module tests/builder-label-scrub.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasBlock } from "./support/canvas-frame";
import { LOCK } from "./support/locks";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

// Reads the site's devices, which a spec storing breakpoints changes.
test.describe.configure({ lock: [LOCK.siteStyle] });

const ENTRIES = "/admin/api/collections/pages/entries";
const HEADING = "00000000-0000-4000-8000-00000000b501";

/** A draft page holding one heading at 16px, and its id. */
async function createPage(page: Page): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Label scrub ${stamp}`,
      slug: `label-scrub-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: HEADING,
            type: "core/heading",
            version: 1,
            props: { text: "A heading to size", level: "h2" },
            styles: { base: { base: { fontSize: "16px" } } },
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const body = (await created.json()) as { item?: { id?: string } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return id;
}

/** The heading's font size as the canvas draws it. */
function canvasFontSize(page: Page): Promise<string> {
  return canvasBlock(page, HEADING)
    .first()
    .evaluate(element => getComputedStyle(element).fontSize);
}

/** The Font size field and the label that names it. */
async function fontSize(
  page: Page
): Promise<{ field: Locator; label: Locator }> {
  // Named by its label and the provenance after it ("Font size Set here").
  const field = page
    .getByTestId("inspector")
    .getByRole("textbox", { name: /^Font size\b/ });
  await expect(field).toBeVisible();
  const id = await field.getAttribute("id");
  if (id === null) throw new Error("the Font size field has no id");
  return { field, label: page.locator(`label[for="${id}"]`) };
}

/** Press on the label's centre and move `dx` pixels right, not yet released. */
async function pressAndMove(
  page: Page,
  label: Locator,
  dx: number
): Promise<void> {
  const box = await label.boundingBox();
  if (box === null) throw new Error("the label has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
}

test("a number field's label drags its value, as one undo step", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const id = await createPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(canvasBlock(page, HEADING).first()).toBeVisible({
    timeout: 60_000,
  });
  await canvasBlock(page, HEADING).first().click();
  await page
    .getByTestId("inspector")
    .getByRole("tab", { name: "Style" })
    .click();
  const section = page.getByRole("button", { name: /^Typography/ }).first();
  if ((await section.getAttribute("aria-expanded")) !== "true") {
    await section.click();
  }
  const { field, label } = await fontSize(page);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(field).toHaveValue("16");
  await expect(undo).toBeDisabled();

  // The label says it drags, and a click on it is still a click.
  expect(
    await label.evaluate(element => getComputedStyle(element).cursor)
  ).toBe("ew-resize");
  await label.click();
  await expect(field).toBeFocused();
  await expect(undo).toBeDisabled();

  // Live in the field while the pointer is down; written once on release.
  await pressAndMove(page, label, 10);
  await expect(field).toHaveValue("26");
  await page.mouse.up();
  await expect(field).toHaveValue("26");
  await expect.poll(() => canvasFontSize(page)).toBe("26px");

  // One undo takes the whole drag back, and there is nothing before it.
  await undo.click();
  await expect(field).toHaveValue("16");
  await expect.poll(() => canvasFontSize(page)).toBe("16px");
  await expect(undo).toBeDisabled();

  // Escape abandons a drag: the value goes back and nothing is written.
  await pressAndMove(page, label, 20);
  await expect(field).toHaveValue("36");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(field).toHaveValue("16");
  await expect(undo).toBeDisabled();

  // Shift drags in steps of ten, and the page saves what the drag wrote.
  await page.keyboard.down("Shift");
  await pressAndMove(page, label, 5);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(field).toHaveValue("66");
  await expect.poll(() => canvasFontSize(page)).toBe("66px");

  await pressSave(page);
  await expect(page.locator('[data-topbar="end"]')).not.toContainText(/Saving/);
  await expect
    .poll(async () => {
      const nodes = await storedPageNodes(page.request, ENTRIES, id);
      const styles = nodes[0]?.styles as
        | { base?: { base?: { fontSize?: unknown } } }
        | undefined;
      return styles?.base?.base?.fontSize;
    })
    .toBe("66px");
});
