/**
 * The Design panel by kind: four tabs, Colours, Type, Spacing and Styles,
 * whose groups fold and stay folded for the author.
 *
 * - Each tab holds its own kind of thing, and the panel names them in order.
 * - A folded group is still folded after a reload; a fresh profile finds
 *   every group open.
 * - Switching through all four tabs leaves the rows' columns where they were,
 *   at the panel's default width and at its narrowest.
 * - No word for the code underneath ("class", "Classes", "DTCG") is shown.
 * - F2 on a row opens its editor with the name ready to type over; Escape
 *   closes it back to the row, and neither press moves the canvas selection.
 * - At the panel's narrowest, the last row's editor opens whole in the window.
 */
import { expect, type Page } from "@playwright/test";

import { clickBlock, openEditorWith, selection } from "./canvas/editor-driver";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const NODES = [
  {
    id: "tabs-text",
    type: "core/text",
    version: 1,
    props: { text: "A page beside the Design panel" },
  },
];

const TABS = ["Colours", "Type", "Spacing", "Styles"] as const;

async function openDesign(page: Page): Promise<void> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  if (!(await panel.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await expect(panel).toBeVisible();
}

function tab(page: Page, name: string) {
  return page
    .getByRole("region", { name: "Design panel" })
    .getByRole("tab", { name: new RegExp(`^${name}`) });
}

async function switchTo(page: Page, name: string): Promise<void> {
  await tab(page, name).click();
  await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
}

/** The first variable row's name and value columns, in the window. */
async function firstRowColumns(page: Page) {
  const row = page.locator(".nx-vars__row").first();
  await expect(row).toBeVisible();
  const body = await page
    .locator(".nx-vars__body")
    .first()
    .evaluate(element => element.clientWidth);
  const columns = await row.evaluate(element => {
    const at = (box: Element | null) => {
      const rect = box?.getBoundingClientRect();
      return rect === undefined
        ? null
        : { left: Math.round(rect.left), right: Math.round(rect.right) };
    };
    return {
      row: at(element),
      name: at(element.querySelector(".nx-vars__name")),
      swatch: at(element.querySelector(".nx-vars__swatch")),
      // The ⋯ beside the row, on the same line.
      more: at(element.parentElement?.querySelector(".nx-vars__more") ?? null),
    };
  });
  return { ...columns, body };
}

/** The room inside every panel body the open tab draws. */
function bodyWidths(page: Page): Promise<number[]> {
  return page
    .locator(".nx-vars__body")
    .evaluateAll(bodies => bodies.map(body => body.clientWidth));
}

test("names its four tabs in order, each holding its own kind", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openEditorWith(page, NODES, "tabs-text");
  await openDesign(page);
  const panel = page.getByRole("region", { name: "Design panel" });
  await expect(panel.getByRole("heading", { name: "Design" })).toBeVisible();
  await expect(panel.getByRole("tab")).toHaveText([...TABS]);
  // Colours: the colour variables.
  await expect(
    panel.getByRole("button", { name: /^Colours, \d+$/ })
  ).toBeVisible();
  // Type: the site's fonts, then the type sizes.
  await switchTo(page, "Type");
  await expect(
    panel.getByRole("button", { name: /^Fonts, \d+$/ })
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /^Type scale, \d+$/ })
  ).toBeVisible();
  // Spacing: spacing, radius and shadows.
  await switchTo(page, "Spacing");
  await expect(
    panel.getByRole("button", { name: /^Spacing, radius & shadows, \d+$/ })
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /^Colours, \d+$/ })
  ).toHaveCount(0);
});

test("keeps a folded group folded across a reload, and opens every group on a fresh profile", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await openEditorWith(page, NODES, "tabs-text");
  await openDesign(page);
  const panel = page.getByRole("region", { name: "Design panel" });
  const colours = panel.getByRole("button", { name: /^Colours, \d+$/ });
  await expect(colours).toHaveAttribute("aria-expanded", "true");
  await colours.click();
  await expect(colours).toHaveAttribute("aria-expanded", "false");
  await expect(panel.locator(".nx-vars__row")).toHaveCount(0);

  await page.reload();
  await openDesign(page);
  await expect(
    panel.getByRole("button", { name: /^Colours, \d+$/ })
  ).toHaveAttribute("aria-expanded", "false");

  // A fresh profile: nothing remembered, every group open.
  const fresh = await browser.newContext({
    storageState: await page.context().storageState({ indexedDB: false }),
  });
  try {
    const other = await fresh.newPage();
    await other.addInitScript(() => {
      try {
        for (const key of Object.keys(window.localStorage)) {
          if (key.includes("nx-pb-design-folds"))
            window.localStorage.removeItem(key);
        }
      } catch {
        // Storage refused: nothing to clear.
      }
    });
    await openEditorWith(other, NODES, "tabs-text");
    await openDesign(other);
    await expect(
      other
        .getByRole("region", { name: "Design panel" })
        .getByRole("button", { name: /^Colours, \d+$/ })
    ).toHaveAttribute("aria-expanded", "true");
  } finally {
    await fresh.close();
  }
  // Put it back for the specs after this one.
  await panel.getByRole("button", { name: /^Colours, \d+$/ }).click();
});

test("keeps the rows' columns where they were across all four tabs, at the default width and the narrowest", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openEditorWith(page, NODES, "tabs-text");
  await openDesign(page);
  for (const width of ["default", "narrowest"] as const) {
    if (width === "narrowest") {
      const divider = page.getByRole("separator", { name: "Panel and canvas" });
      await divider.focus();
      await page.keyboard.press("Home");
      await expect
        .poll(async () =>
          Math.round(
            (
              await page
                .getByRole("region", { name: "Design panel" })
                .boundingBox()
            )?.width ?? 0
          )
        )
        .toBeLessThanOrEqual(240);
    }
    await switchTo(page, "Colours");
    const before = await firstRowColumns(page);
    // Measured while each tab is open: every variable row spans the same
    // room, and every tab's body is as wide as Colours'.
    for (const name of ["Type", "Spacing", "Styles"]) {
      await switchTo(page, name);
      const widths = await bodyWidths(page);
      expect(widths, `${name} at the ${width} width`).toEqual(
        widths.map(() => before.body)
      );
      if (name !== "Styles") {
        const here = await firstRowColumns(page);
        expect(here.row, `${name}'s rows at the ${width} width`).toEqual(
          before.row
        );
      }
    }
    // And back on Colours, the same columns as before.
    await switchTo(page, "Colours");
    expect(await firstRowColumns(page), `at the ${width} width`).toEqual(
      before
    );
    // Every tab name shows in full.
    for (const name of TABS) {
      const full = await tab(page, name).evaluate(
        element => element.scrollWidth <= element.clientWidth
      );
      expect(full, `${name} at the ${width} width`).toBe(true);
    }
  }
});

test("shows no word for the code underneath in any tab", async ({ page }) => {
  test.setTimeout(120_000);
  await openEditorWith(page, NODES, "tabs-text");
  await openDesign(page);
  const panel = page.getByRole("region", { name: "Design panel" });
  for (const name of TABS) {
    await switchTo(page, name);
    const text = await panel.innerText();
    expect(text, `${name}: no "class"`).not.toMatch(/\bclass(es)?\b/i);
    expect(text, `${name}: "DTCG" only as a hint`).not.toMatch(/DTCG/);
  }
});

test("F2 renames a row in place, and Escape closes the field back to the row without moving the selection", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openEditorWith(page, NODES, "tabs-text");
  await clickBlock(page, "tabs-text");
  await expect.poll(() => selection(page)).toEqual(["tabs-text"]);
  await openDesign(page);
  // The first variable's line: its row gives way to the name field while
  // it is renamed, so the row is found inside it.
  const line = page.locator(".nx-vars__item").first();
  const row = line.locator(".nx-vars__row");
  await row.focus();
  await page.keyboard.press("F2");
  const name = line.getByRole("textbox", { name: /^Name of / });
  await expect(name).toBeFocused();
  await expect(page.locator(".nx-vars-editor")).toHaveCount(0);
  // The whole name is selected, so typing replaces it.
  expect(
    await name.evaluate(
      (input: HTMLInputElement) =>
        input.selectionStart === 0 && input.selectionEnd === input.value.length
    )
  ).toBe(true);

  await page.keyboard.press("Escape");
  await expect(name).toHaveCount(0);
  await expect(row).toBeFocused();
  expect(await selection(page)).toEqual(["tabs-text"]);
  // Back on the row, its tooltip may show again once the counts are read,
  // and an Escape closes that first. The next leaves the panel for the
  // canvas, and the block is still selected after every press.
  const tooltip = page.getByRole("tooltip");
  if (await tooltip.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
    await expect(row).toBeFocused();
    expect(await selection(page)).toEqual(["tabs-text"]);
  }
  await page.keyboard.press("Escape");
  await expect(row).not.toBeFocused();
  expect(await selection(page)).toEqual(["tabs-text"]);
});

test("at the panel's narrowest, the last row's editor opens whole inside the window", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openEditorWith(page, NODES, "tabs-text");
  await openDesign(page);
  const divider = page.getByRole("separator", { name: "Panel and canvas" });
  await divider.focus();
  await page.keyboard.press("Home");
  const panel = page.getByRole("region", { name: "Design panel" });
  await expect
    .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
    .toBeLessThanOrEqual(240);
  const last = panel.locator(".nx-vars__row").last();
  await last.scrollIntoViewIfNeeded();
  await last.click();
  const editor = page.locator(".nx-vars-editor");
  await expect(editor).toBeVisible();
  const box = await editor.boundingBox();
  expect(box, "the editor is drawn").not.toBeNull();
  if (box === null) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1280);
  expect(box.y + box.height).toBeLessThanOrEqual(720);
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
});
