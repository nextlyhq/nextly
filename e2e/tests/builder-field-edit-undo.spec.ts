/**
 * One field edit is one Undo, and Escape in a field puts the old value back.
 *
 * - A sentence typed into a Text's words in the panel, which the canvas
 *   follows as it is typed, is taken back whole by one Undo.
 * - Escape in a field being edited puts back the value from before the edit,
 *   in the field and on the canvas, and records nothing: Undo stays off. The
 *   next Escape leaves the field, and the block stays selected.
 *
 * Its own page, named uniquely, so no page lock is needed.
 *
 * @module tests/builder-field-edit-undo.spec
 */
import { expect, type Page } from "@playwright/test";

import { selection } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasBlock } from "./support/canvas-frame";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const TEXT = "00000000-0000-4000-8000-00000000f101";
const BUTTON = "00000000-0000-4000-8000-00000000f102";

/** A draft page holding a Text and a Button, and its id. */
async function createPage(page: Page): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Field edit undo ${stamp}`,
      slug: `field-edit-undo-${stamp}`,
      status: "draft",
      // Without the site's header and footer, whose regions on the canvas
      // would take the clicks meant for the blocks.
      noHeaderFooter: true,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: TEXT,
            type: "core/text",
            version: 1,
            props: { text: "Before." },
          },
          {
            id: BUTTON,
            type: "core/button",
            version: 1,
            props: { label: "Get started", href: "/signup" },
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

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(canvasBlock(page, TEXT).first()).toBeVisible({
    timeout: 60_000,
  });
}

function inspectorField(page: Page, name: string) {
  return page
    .locator(".nx-inspector")
    .getByRole("textbox", { name, exact: true });
}

test.describe("one field edit, one Undo", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a sentence typed into a field is taken back by one Undo", async ({
    page,
  }) => {
    await openBuilder(page, await createPage(page));
    await canvasBlock(page, TEXT).first().click();
    const passage = inspectorField(page, "Text");
    await passage.click();
    // Editable once the shared editor has attached to it.
    await expect(passage).toHaveAttribute("contenteditable", "true");
    await page.keyboard.press("End");
    await page.keyboard.type(" Then a whole sentence, typed in one go.");
    await passage.blur();
    await expect(canvasBlock(page, TEXT).first()).toContainText(
      "Then a whole sentence, typed in one go."
    );

    const undo = page.getByRole("button", { name: "Undo", exact: true });
    await undo.click();
    await expect(canvasBlock(page, TEXT).first()).toHaveText("Before.");
    // One step: there is nothing before it.
    await expect(undo).toBeDisabled();
  });

  test("Escape puts the old value back and records nothing", async ({
    page,
  }) => {
    await openBuilder(page, await createPage(page));
    await canvasBlock(page, BUTTON).first().click();
    await expect.poll(() => selection(page)).toEqual([BUTTON]);
    const label = inspectorField(page, "Label");
    await label.click();
    await label.fill("Half typed");
    await page.keyboard.press("Escape");

    await expect(label).toHaveValue("Get started");
    await expect(label).toBeFocused();
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    await expect(undo).toBeDisabled();

    // The next Escape leaves the field; the block is still selected, and
    // leaving the field writes nothing.
    await page.keyboard.press("Escape");
    await expect(label).not.toBeFocused();
    await expect.poll(() => selection(page)).toEqual([BUTTON]);
    await expect(canvasBlock(page, BUTTON).first()).toContainText(
      "Get started"
    );
    await expect(undo).toBeDisabled();
  });
});
