/**
 * The spacing box in the Style tab, in a real browser: its keyboard order,
 * its reset key, and its shape at the widths the inspector really has.
 *
 * - Tab goes round the box as the CSS shorthand reads, margin then padding,
 *   each Top, Right, Bottom, Left, and never stops on a side's reset.
 * - Alt+Backspace resets the focused side.
 * - The box stays a box at the inspector's default and minimum widths with
 *   classic scrollbars, which take room from the panel where overlay ones do
 *   not; only below the width the box needs does it become rows, and there a
 *   focused side's reset sits in its row instead of over the next label.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { clickBlock, openEditorWith, selection } from "./canvas/editor-driver";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

test.describe.configure({ lock: [LOCK.homepage] });

const BOX = "spacing-box-box";
const TEXT = "spacing-box-text";
const NODES = [
  {
    id: BOX,
    type: "core/box",
    version: 1,
    props: { as: "div" },
    slots: {
      children: [
        {
          id: TEXT,
          type: "core/heading",
          version: 1,
          props: { text: "Inside the box", level: "h2" },
        },
      ],
    },
  },
];

/** The sides in the order Tab must visit them. */
const SIDES = [
  "Margin top",
  "Margin right",
  "Margin bottom",
  "Margin left",
  "Padding top",
  "Padding right",
  "Padding bottom",
  "Padding left",
];

/**
 * Make every scrollbar a classic one, as Windows and a Mac set to "Always"
 * draw them: a scrollbar the page styles is laid out in the box it scrolls,
 * taking its width from the content.
 */
async function forceClassicScrollbars(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      "::-webkit-scrollbar { width: 15px; height: 15px; } ::-webkit-scrollbar-thumb { background: #888; }",
  });
}

/** Open the builder on the Box and show its Style tab's Spacing section. */
async function openBoxSpacing(page: Page): Promise<Locator> {
  await openEditorWith(page, NODES, TEXT);
  await clickBlock(page, TEXT);
  await expect.poll(() => selection(page)).toEqual([TEXT]);
  // From the canvas, Escape goes up to the Box holding the heading.
  await page.keyboard.press("Escape");
  await expect.poll(() => selection(page)).toEqual([BOX]);
  const inspector = page.getByTestId("inspector");
  await inspector.getByRole("tab", { name: "Style" }).click();
  const spacing = inspector.getByRole("button", { name: /^Spacing/ });
  if ((await spacing.getAttribute("aria-expanded")) !== "true") {
    await spacing.click();
  }
  await expect(spacing).toHaveAttribute("aria-expanded", "true");
  const box = page.locator(".nx-spacing-box");
  await expect(box).toBeVisible();
  return box;
}

/** Whether the box is drawn as a box (a grid), rather than as rows. */
function drawnAsBox(page: Page): Promise<boolean> {
  return page
    .locator(".nx-spacing-box .nx-style-inspector__side-box")
    .first()
    .evaluate(element => getComputedStyle(element).display === "grid");
}

/** The inspector's own width, and whether it is scrolling. */
function inspectorState(
  page: Page
): Promise<{ width: number; scrolls: boolean }> {
  return page.locator(".nx-inspector").evaluate(element => ({
    width: Math.round(element.getBoundingClientRect().width),
    scrolls: element.scrollHeight > element.clientHeight,
  }));
}

/** A side's field, by the start of its label. */
function sideField(box: Locator, side: string): Locator {
  return box.getByRole("textbox", { name: new RegExp(`^${side}\\b`) });
}

/** The accessible name of whatever holds focus, as a test reads it. */
function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active === null) return "";
    const labelled = active.getAttribute("aria-label");
    if (labelled !== null) return labelled;
    const labels = (active as HTMLInputElement).labels;
    return labels?.[0]?.textContent?.trim() ?? "";
  });
}

test("keeps the box at the inspector's default and minimum widths, with classic scrollbars", async ({
  page,
}) => {
  // Short, so the Style tab is longer than the panel and its scrollbar shows.
  await page.setViewportSize({ width: 1440, height: 560 });
  await openBoxSpacing(page);
  await forceClassicScrollbars(page);

  const atDefault = await inspectorState(page);
  expect(atDefault.width).toBe(320);
  // The control: the panel really is scrolling, so a classic scrollbar is
  // there taking its room.
  expect(atDefault.scrolls).toBe(true);
  expect(await drawnAsBox(page)).toBe(true);

  // To the minimum width, from the keyboard, as the divider allows.
  const divider = page.getByRole("separator", { name: "Canvas and inspector" });
  await divider.focus();
  await page.keyboard.press("End");
  await expect.poll(async () => (await inspectorState(page)).width).toBe(280);
  expect(await drawnAsBox(page)).toBe(true);
});

test("tabs round the box, margin then padding, each Top, Right, Bottom, Left, never onto a reset", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const box = await openBoxSpacing(page);

  await box.getByLabel("Margin top", { exact: true }).click();
  for (const [index, side] of SIDES.entries()) {
    expect(await focusedName(page)).toBe(side);
    await page.keyboard.type(`${(index + 1) * 10}px`);
    if (index === SIDES.length - 1) break;
    // On to the next side. A variables button for THIS side may come first
    // (it stays a Tab stop until each field offers variables in its own
    // menu); a reset never does.
    const next = SIDES[index + 1] ?? "";
    for (let hop = 0; hop < 3; hop += 1) {
      await page.keyboard.press("Tab");
      const name = await focusedName(page);
      if (name === next) break;
      expect(name, `a stop between ${side} and ${next}`).toBe(
        `Variables for ${side}`
      );
    }
    expect(await focusedName(page)).toBe(next);
  }
  await page.keyboard.press("Tab");

  // Each value landed in the side it was typed for. By the label's start:
  // once a side holds a value its label also says where the value is from.
  for (const [index, side] of SIDES.entries()) {
    await expect(sideField(box, side)).toHaveValue(`${(index + 1) * 10}px`);
  }

  // And Alt+Backspace in a side resets it.
  const right = sideField(box, "Margin right");
  await right.focus();
  await page.keyboard.press("Alt+Backspace");
  await expect(right).toHaveValue("");
});

test("in rows, below the width the box needs, a focused side's reset never covers the next label", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const box = await openBoxSpacing(page);
  // A value on every side, so each has a reset to show when focused.
  for (const [index, side] of SIDES.entries()) {
    const field = sideField(box, side);
    await field.fill(`${index + 1}px`);
    await field.press("Enter");
  }
  // Narrower than the shell's own minimum allows, which is the only way to
  // reach the rows from the shell today; the box reads the width it is given.
  await page
    .locator(".nx-inspector")
    .evaluate(element => element.style.setProperty("width", "220px"));
  await expect.poll(() => drawnAsBox(page)).toBe(false);

  const rows = box.locator("[data-side]");
  const count = await rows.count();
  expect(count).toBe(SIDES.length);
  for (let index = 0; index < count - 1; index += 1) {
    const row = rows.nth(index);
    await row.locator("input").focus();
    const reset = row.locator('[data-action="reset"]');
    await expect(reset).toBeVisible();
    const resetBox = await reset.boundingBox();
    const nextLabel = await rows
      .nth(index + 1)
      .locator(".nx-style-inspector__field-label-text")
      .boundingBox();
    if (resetBox === null || nextLabel === null) {
      throw new Error("the reset or the next label has no box");
    }
    const overlaps =
      resetBox.x < nextLabel.x + nextLabel.width &&
      nextLabel.x < resetBox.x + resetBox.width &&
      resetBox.y < nextLabel.y + nextLabel.height &&
      nextLabel.y < resetBox.y + resetBox.height;
    expect(overlaps, `the reset of row ${index + 1} over the next label`).toBe(
      false
    );
  }
});
