/**
 * The Style tab's "Block style" section, in the real editor.
 *
 * - "Edit block styles", under a Section's tiles, opens the Design panel on
 *   its Styles tab with Block styles' Section group opened, even folded, and
 *   brought into view with focus on its heading.
 * - A value changed on a Section wearing Hero lands on that Section alone:
 *   another Section wearing Hero keeps Hero's look. The tiles and the
 *   editing bar keep their size through the choice and the change.
 *
 * Safe to write against: the suite owns its database, and the homepage is
 * emptied after each test.
 *
 * @module builder-block-style-tiles.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import {
  block,
  clearSelection,
  clickBlock,
  emptyHomepage,
  openEditorWith,
  selection,
} from "./canvas/editor-driver";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const HERO_ID = "look:core/section:hero";
const FIRST = "block-style-first";
const SECOND = "block-style-second";
const SECTION_GROUP = "block-styles:core/section";

/** A Section holding a heading, wearing the block styles given. */
function section(id: string, words: string, classes?: readonly string[]) {
  return {
    id,
    type: "core/section",
    version: 1,
    props: { as: "section", contained: true },
    ...(classes === undefined ? {} : { classes: [...classes] }),
    slots: {
      children: [
        {
          id: `${id}-heading`,
          type: "core/heading",
          version: 1,
          props: { text: words, level: "h2" },
        },
      ],
    },
  };
}

const inspector = (page: Page) => page.getByTestId("inspector");
const tiles = (page: Page) =>
  inspector(page).getByRole("radiogroup", { name: "Block style" });
const bar = (page: Page) =>
  inspector(page).getByRole("region", { name: "What you're editing" });
const designPanel = (page: Page) =>
  page.getByRole("region", { name: "Design panel" });

/** Select a block on the canvas and open the Style tab. */
async function styleTabOf(page: Page, id: string): Promise<void> {
  await clearSelection(page);
  await clickBlock(page, id);
  await expect.poll(() => selection(page)).toEqual([id]);
  await inspector(page)
    .getByRole("tab", { name: "Style", exact: true })
    .click();
  await expect(tiles(page)).toBeVisible();
}

/**
 * A box's layout size in the panel's own pixels: the panel is not zoomed,
 * but its layout size is what the author sees grow or shrink, whatever the
 * page's scale.
 */
async function size(locator: Locator): Promise<{ w: number; h: number }> {
  return locator.evaluate(element => {
    const html = element as HTMLElement;
    return { w: html.offsetWidth, h: html.offsetHeight };
  });
}

/** A block's computed value of one property, as the canvas draws it. */
async function drawn(page: Page, id: string, property: string) {
  return (await block(page, id)).evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property
  );
}

test.describe("the Block style section", () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  test.afterEach(async ({ page }) => {
    await emptyHomepage(page);
  });

  test("Edit block styles opens Design's Block styles at Section, even folded", async ({
    page,
  }) => {
    await openEditorWith(page, [section(FIRST, "First")], FIRST);

    // Design open on another tab, with Section's group folded there.
    const panel = designPanel(page);
    const rail = page.getByRole("navigation", { name: "Editor panels" });
    await rail.waitFor();
    if (!(await panel.isVisible())) {
      await rail.getByRole("button", { name: "Design", exact: true }).click();
    }
    await expect(panel).toBeVisible();
    await panel.getByRole("tab", { name: /^Styles/ }).click();
    const group = panel.locator(`[data-group="${SECTION_GROUP}"]`);
    const toggle = group.getByRole("button", { name: /^Section, / });
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute("aria-expanded")) === "true") {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await panel.getByRole("tab", { name: /^Colours/ }).click();
    await expect(group).toHaveCount(0);

    await styleTabOf(page, FIRST);
    const line = inspector(page).locator(".nx-block-style__line");
    await expect(line).toHaveText(
      "A saved style for every Section. Edit block styles"
    );
    await line.getByRole("button", { name: "Edit block styles" }).click();

    const styles = panel.getByRole("tab", { name: /^Styles/ });
    await expect(styles).toHaveAttribute("aria-selected", "true");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      group.getByRole("list", { name: "Section styles" })
    ).toBeVisible();
    await expect(toggle).toBeFocused();
    // In view inside the panel's own scroll.
    await expect(group).toBeInViewport();
  });

  test("a value changed with Hero worn changes this Section only, and nothing grows", async ({
    page,
  }) => {
    await openEditorWith(
      page,
      [section(FIRST, "First"), section(SECOND, "Second", [HERO_ID])],
      FIRST
    );
    await styleTabOf(page, FIRST);
    await inspector(page)
      .getByRole("button", { name: "Panel options" })
      .click();
    await page.getByRole("menuitem", { name: "Expand all" }).click();
    const start = {
      tiles: await size(tiles(page)),
      bar: await size(bar(page)),
    };

    // Hero worn by this Section too.
    await tiles(page).getByRole("radio", { name: /^Hero/ }).click();
    await expect(
      tiles(page).getByRole("radio", { name: /^Hero/ })
    ).toHaveAttribute("aria-checked", "true");
    expect(await size(tiles(page)), "the tiles after Hero").toEqual(
      start.tiles
    );
    expect(await size(bar(page)), "the bar after Hero").toEqual(start.bar);
    // The bar still says the edit goes to this block, on one line.
    await expect(
      bar(page).getByRole("button", { name: /^Editing: / })
    ).toHaveAccessibleName("Editing: This block");

    const opacity = inspector(page).getByRole("textbox", { name: /^Opacity/ });
    await opacity.fill("0.5");
    await opacity.press("Enter");
    await expect.poll(() => drawn(page, FIRST, "opacity")).toBe("0.5");

    // Only this Section: the other wears Hero as before.
    expect(await drawn(page, SECOND, "opacity")).toBe("1");
    expect(await drawn(page, FIRST, "min-height")).toBe(
      await drawn(page, SECOND, "min-height")
    );
    expect(await size(tiles(page)), "the tiles after the change").toEqual(
      start.tiles
    );
    expect(await size(bar(page)), "the bar after the change").toEqual(
      start.bar
    );
    await expect(
      tiles(page).getByRole("radio", { name: /^Hero/ })
    ).toHaveAttribute("aria-checked", "true");
  });
});
