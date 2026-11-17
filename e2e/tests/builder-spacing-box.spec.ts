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

/**
 * Whether the drawn box is whole: no side of the padding ring reaching past
 * its ring or over a margin side. A grid alone is not enough, since a box
 * kept as a grid too narrow for it draws its inner sides over the outer ones.
 */
function boxIsWhole(page: Page): Promise<boolean> {
  return page.locator(".nx-spacing-box").evaluate(box => {
    const rect = (element: Element) => element.getBoundingClientRect();
    const meets = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 0.5 &&
      b.left < a.right - 0.5 &&
      a.top < b.bottom - 0.5 &&
      b.top < a.bottom - 0.5;
    const margin = box.querySelector('[data-ring="margin"]');
    const padding = box.querySelector('[data-ring="padding"]');
    if (margin === null || padding === null) return false;
    const ring = rect(padding);
    const outer = [...margin.querySelectorAll(":scope > [data-side]")].map(
      rect
    );
    return [...padding.querySelectorAll(":scope > [data-side]")].every(side => {
      const own = rect(side);
      return (
        own.left >= ring.left - 0.5 &&
        own.right <= ring.right + 0.5 &&
        outer.every(other => !meets(own, other))
      );
    });
  });
}

/**
 * The inspector's own width, whether it is scrolling, and how much room its
 * scrollbar takes from its content (0 for an overlay scrollbar).
 */
function inspectorState(
  page: Page
): Promise<{ width: number; scrolls: boolean; gutter: number }> {
  return page.locator(".nx-inspector").evaluate(element => {
    const html = element as HTMLElement;
    const style = getComputedStyle(html);
    const borders =
      parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    return {
      width: Math.round(html.getBoundingClientRect().width),
      scrolls: html.scrollHeight > html.clientHeight,
      gutter: html.offsetWidth - borders - html.clientWidth,
    };
  });
}

/** A side's button, by the start of its name: "Margin top 10px". */
function sideField(box: Locator, side: string): Locator {
  return box.getByRole("button", { name: new RegExp(`^${side} `) });
}

/** A side's value as it shows. */
function sideText(box: Locator, side: string): Locator {
  return sideField(box, side).locator(".nx-spacing-side__text");
}

/** A side's value set through its popover: typed, then Enter. */
async function setSide(page: Page, box: Locator, side: string, value: string) {
  await sideField(box, side).click();
  const number = page.getByLabel(`Value for ${side}`);
  await number.fill(value);
  await number.press("Enter");
  await expect(page.getByRole("dialog", { name: side })).toHaveCount(0);
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
  // And the scrollbar is a classic one, taking its width from the panel.
  expect(atDefault.gutter).toBeGreaterThanOrEqual(15);
  expect(await drawnAsBox(page)).toBe(true);
  expect(await boxIsWhole(page)).toBe(true);

  // To the minimum width, from the keyboard, as the divider allows.
  const divider = page.getByRole("separator", { name: "Canvas and inspector" });
  await divider.focus();
  await page.keyboard.press("End");
  await expect.poll(async () => (await inspectorState(page)).width).toBe(308);
  expect(await drawnAsBox(page)).toBe(true);
  expect(await boxIsWhole(page)).toBe(true);
});

test("tabs round the box, margin then padding, each Top, Right, Bottom, Left, never onto a reset", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const box = await openBoxSpacing(page);

  // Quick entry: a digit on a side opens its popover typing it, and Tab
  // commits and goes on to the next side, never onto a reset.
  await sideField(box, "Margin top").focus();
  for (const [index, side] of SIDES.entries()) {
    expect(await focusedName(page)).toBe(side);
    await page.keyboard.type(`${(index + 1) * 10}`);
    await expect(page.getByLabel(`Value for ${side}`)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  // Each value landed in the side it was typed for, in the unit shown.
  for (const [index, side] of SIDES.entries()) {
    await expect(sideText(box, side)).toHaveText(`${(index + 1) * 10}px`);
  }

  // And Alt+Backspace on a side resets it.
  const right = sideField(box, "Margin right");
  await right.focus();
  await page.keyboard.press("Alt+Backspace");
  await expect(sideText(box, "Margin right")).toHaveText("–");
});

test("in rows, below the width the box needs, a focused side's reset never covers the next label", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const box = await openBoxSpacing(page);
  // A value on every side, so each has a reset to show when focused.
  for (const [index, side] of SIDES.entries()) {
    await setSide(page, box, side, `${index + 1}px`);
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
    await row.locator(".nx-spacing-side").focus();
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

test("at the narrowest panel a long value or variable ends in an ellipsis, whole in its tooltip and name", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const box = await openBoxSpacing(page);
  await setSide(page, box, "Margin top", "1000px");
  // The longest of the site's own spacing variables, from the popover.
  await sideField(box, "Padding top").click();
  await page
    .getByRole("radio", { name: /^Section padding \(top and bottom\)/ })
    .click();
  await page.keyboard.press("Escape");
  await page
    .locator(".nx-inspector")
    .evaluate(element => element.style.setProperty("width", "280px"));

  for (const [side, whole] of [
    ["Margin top", "1000px"],
    ["Padding top", "Section padding (top and bottom)"],
  ] as const) {
    const text = sideText(box, side);
    // Never cut mid-character: either it fits, or it ends in an ellipsis.
    const cut = await text.evaluate(element => ({
      overflows: element.scrollWidth > element.clientWidth,
      ellipsis: getComputedStyle(element).textOverflow === "ellipsis",
    }));
    expect(cut.ellipsis).toBe(true);
    await expect(sideField(box, side)).toHaveAccessibleName(`${side} ${whole}`);
    if (cut.overflows) {
      await sideField(box, side).hover();
      await expect(page.getByRole("tooltip")).toHaveText(whole);
      await page.mouse.move(0, 0);
    }
  }
  // The long name does not fit at this width: the case the tooltip is for.
  expect(
    await sideText(box, "Padding top").evaluate(
      element => element.scrollWidth > element.clientWidth
    )
  ).toBe(true);
});
