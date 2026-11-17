/**
 * Shared styles on a block, from the inspector: this block by default, a
 * shared style on request.
 *
 * - Saving a block's look as a shared style keeps the block as it looked,
 *   another block can wear it, and a change to the style (made with the style
 *   as the target, whose reach the bar states) reaches both blocks; Undo and
 *   Redo write the style back and forward.
 * - A value from a shared style says so, an override on the block says what
 *   it overrides and resets, and Move to puts the block's value in the style.
 * - A block stored with three shared styles keeps and lists all three, and
 *   any one can be taken off it, or detached.
 *
 * @module builder-shared-styles.spec
 */
import { expect, type Page } from "@playwright/test";

import {
  block,
  clickBlock,
  emptyHomepage,
  openEditorWith,
  pressSave,
} from "./canvas/editor-driver";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// The homepage Single is reseeded and edited here, as the other builder files
// do, and the site's shared styles are changed and restored.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const HOMEPAGE = "/admin/api/singles/homepage";
const A = "shared-style-a";
const B = "shared-style-b";
const NAVY = { hex: "#112233", rgb: "rgb(17, 34, 51)" };
const BROWN = { hex: "#654321", rgb: "rgb(101, 67, 33)" };
const BLACK = { hex: "#000001", rgb: "rgb(0, 0, 1)" };

/** A text block, with styles of its own or shared styles when given. */
function text(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: "core/text",
    version: 1,
    props: { text: `Text of ${id}` },
    ...extra,
  };
}

/** A colour set on the base state at the base breakpoint. */
const colour = (hex: string) => ({ base: { base: { color: hex } } });

/** The stored `classes` section, as the site style holds it. */
async function storedClasses(
  page: Page
): Promise<Record<string, unknown>[] | null> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return (item.classes as Record<string, unknown>[] | undefined) ?? null;
}

/** Store the site's shared styles, as a test's starting point or its cleanup. */
async function storeClasses(page: Page, classes: unknown): Promise<void> {
  const stored = await page.request.patch(SITE_STYLE, {
    data: { classes, _overwrite: true },
  });
  expect(
    stored.ok(),
    `storing the shared styles: ${stored.status()} ${await stored.text()}`
  ).toBe(true);
}

/** The homepage's stored nodes, draft included. */
async function storedNodes(page: Page): Promise<Record<string, unknown>[]> {
  const response = await page.request.get(`${HOMEPAGE}?draft=true`);
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as {
    layout?: { nodes?: Record<string, unknown>[] };
  };
  return item.layout?.nodes ?? [];
}

/** The next stored write of the site style. */
function styleWrite(page: Page) {
  return page.waitForResponse(
    response =>
      new URL(response.url()).pathname === SITE_STYLE &&
      ["PATCH", "PUT"].includes(response.request().method()) &&
      response.ok()
  );
}

/** The inspector's "what you're editing" bar. */
const bar = (page: Page) =>
  page.getByRole("region", { name: "What you're editing" });

/** The bar's target chip: the menu button that says what an edit changes. */
const targetChip = (page: Page) =>
  bar(page).getByRole("button", { name: /^Editing: / });

/** The target chip's menu, opened. */
async function openTargets(page: Page) {
  await targetChip(page).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** A target in the open menu, by the name it starts with. */
const targetItem = (page: Page, name: string) =>
  page.getByRole("menuitemradio", { name: new RegExp(`^${name}\\b`) });

/** Make a worn style, or "This block", the target from the menu. */
async function chooseTarget(page: Page, name: string): Promise<void> {
  await openTargets(page);
  await targetItem(page, name).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}

/** The targets the menu lists, by their label line. */
async function targetLabels(page: Page): Promise<string[]> {
  const menu = await openTargets(page);
  const labels = await menu
    .getByRole("menuitemradio")
    .evaluateAll(items =>
      items.map(
        item =>
          item.querySelector(".nx-editing-bar__item-words > span")
            ?.textContent ?? ""
      )
    );
  await page.keyboard.press("Escape");
  return labels;
}

/** Select a block and open the inspector's Style tab with Text open. */
async function styleOf(page: Page, id: string): Promise<void> {
  await clickBlock(page, id);
  await page.getByRole("tab", { name: "Style" }).click();
  const section = page
    .getByTestId("inspector")
    .getByRole("button", { name: /^Text(\s?has changes)?$/ });
  if ((await section.getAttribute("aria-expanded")) !== "true") {
    await section.click();
  }
}

/**
 * The bar's own background and the nearest painted background behind it (the
 * inspector's surface), with the admin in light or dark.
 */
async function groundsOf(page: Page, dark: boolean): Promise<[string, string]> {
  return bar(page).evaluate((element, wantDark) => {
    element.ownerDocument.documentElement.classList.toggle("dark", wantDark);
    const paint = (node: Element | null): string => {
      for (let at = node; at !== null; at = at.parentElement) {
        const colour = getComputedStyle(at).backgroundColor;
        if (colour !== "rgba(0, 0, 0, 0)" && colour !== "transparent") {
          return colour;
        }
      }
      return "none";
    };
    return [paint(element), paint(element.parentElement)];
  }, dark);
}

/**
 * The Text section's Colour field. Its name carries where its value
 * comes from ("Colour From Card"), so it is matched by its start.
 */
const colourField = (page: Page) =>
  page
    .getByRole("region", { name: /^Text(\s?has changes)?$/ })
    .getByRole("textbox", { name: /^Colour( |$)/ });

test.describe("shared styles on a block", () => {
  test.describe.configure({ timeout: 180_000 });

  let before: Record<string, unknown>[] | null = null;
  test.beforeEach(async ({ page }) => {
    before = await storedClasses(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  test.afterEach(async ({ page }) => {
    // Off the homepage first: a shared style still in use cannot be removed.
    await emptyHomepage(page);
    await storeClasses(page, before ?? []);
  });

  test("saves a block's look as a shared style, and a change to it reaches both blocks", async ({
    page,
  }) => {
    await storeClasses(page, []);
    await openEditorWith(
      page,
      [text(A, { styles: colour(NAVY.hex) }), text(B)],
      A
    );
    await expect(await block(page, A)).toHaveCSS("color", NAVY.rgb);

    // Save as shared style, from the block card's menu.
    await clickBlock(page, A);
    await page
      .locator("[data-block-card]")
      .getByRole("button", { name: /^Actions for / })
      .click();
    await page
      .getByRole("menuitem", { name: /^Save as shared style…/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Save as shared style" });
    await expect(dialog).toContainText("Moves this block's 1 value");
    await dialog.getByRole("textbox", { name: "Name" }).fill("Card");
    await expect(dialog.getByText(".nx-c-card", { exact: true })).toBeVisible();
    const saved = styleWrite(page);
    await dialog.getByRole("button", { name: "Save shared style" }).click();
    await saved;
    await expect(page.getByText("Saved as shared style Card")).toBeVisible();

    // The block looks as it did, and wears the style.
    await expect(await block(page, A)).toHaveCSS("color", NAVY.rgb);
    const stored = await storedClasses(page);
    expect(stored).toEqual([
      expect.objectContaining({
        slug: "card",
        label: "Card",
        styles: colour(NAVY.hex),
      }),
    ]);
    await page.getByRole("tab", { name: "Style" }).click();
    await expect(targetChip(page)).toHaveAccessibleName("Editing: This block");
    expect(await targetLabels(page)).toEqual(["● This block", "◆ Card"]);

    // The bar's box stands apart from the inspector it sits on, in both
    // schemes, read from the computed colours rather than by eye.
    for (const dark of [false, true]) {
      const [box, panel] = await groundsOf(page, dark);
      expect(box, `the bar against the panel, dark=${dark}`).not.toBe(panel);
    }
    await groundsOf(page, false);

    // Another block wears it.
    await styleOf(page, B);
    await openTargets(page);
    await page
      .getByRole("menuitem", { name: /^Apply a shared style…/ })
      .click();
    const search = page.getByRole("combobox", { name: "Search shared styles" });
    await search.fill("card");
    await search.press("Enter");
    await expect(await block(page, B)).toHaveCSS("color", NAVY.rgb);

    // The style becomes the target by keyboard, and says how far it reaches.
    await targetChip(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(targetItem(page, "Card")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(targetChip(page)).toHaveAccessibleName(
      "Editing: shared style Card"
    );
    await expect(bar(page).getByRole("status")).toHaveText(
      "Now editing shared style Card"
    );
    await expect(bar(page).locator("[data-shared-reach]")).toContainText(
      "Shared style · 2 blocks on this page"
    );
    await expect(bar(page).locator("[data-shared-reach]")).toContainText(
      "Changes here change all of them."
    );

    // A change to the style reaches both blocks.
    await expect(colourField(page)).toHaveValue(NAVY.hex);
    const changed = styleWrite(page);
    await colourField(page).fill(BROWN.hex);
    await colourField(page).press("Enter");
    await changed;
    await expect(await block(page, A)).toHaveCSS("color", BROWN.rgb);
    await expect(await block(page, B)).toHaveCSS("color", BROWN.rgb);

    // Undo writes the style back, and both blocks follow; Redo again.
    const undone = styleWrite(page);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await undone;
    await expect(await block(page, B)).toHaveCSS("color", NAVY.rgb);
    await expect(await block(page, A)).toHaveCSS("color", NAVY.rgb);
    expect((await storedClasses(page))?.[0]?.styles).toEqual(colour(NAVY.hex));
    const redone = styleWrite(page);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await redone;
    await expect(await block(page, B)).toHaveCSS("color", BROWN.rgb);
    expect((await storedClasses(page))?.[0]?.styles).toEqual(colour(BROWN.hex));

    // Escape on the shared target goes back to this block.
    await targetChip(page).focus();
    await page.keyboard.press("Escape");
    await expect(targetChip(page)).toHaveAccessibleName("Editing: This block");
  });

  test("says a value comes from the shared style, overrides it on the block, resets, and moves a value into it", async ({
    page,
  }) => {
    await storeClasses(page, [
      {
        id: "e2e-card",
        slug: "card",
        label: "Card",
        orderIndex: 0,
        styles: colour(NAVY.hex),
      },
    ]);
    await openEditorWith(page, [text(A, { classes: ["e2e-card"] })], A);
    await styleOf(page, A);

    // Only Colour holds a value in this test, so the section is its scope.
    const field = page.getByRole("region", { name: /^Text(\s?has changes)?$/ });
    await expect(field.getByRole("img", { name: "From Card" })).toBeVisible();

    // Overridden on this block.
    await colourField(page).fill(BLACK.hex);
    await colourField(page).press("Enter");
    await expect(await block(page, A)).toHaveCSS("color", BLACK.rgb);
    await expect(field).toContainText("Set on this block · overrides Card");

    // Reset shows the style's value again.
    await field
      .getByRole("button", { name: /^Reset Colour on this block/ })
      .click();
    await expect(await block(page, A)).toHaveCSS("color", NAVY.rgb);
    await expect(field).not.toContainText("Set on this block");

    // Move to: the block's value goes into the style.
    await colourField(page).fill(BLACK.hex);
    await colourField(page).press("Enter");
    await chooseTarget(page, "Card");
    // The words, then the action on its own line.
    await expect(
      field.locator('[data-shared-line="move"] [data-shared-line-text]')
    ).toHaveText("Set on this block");
    const moved = styleWrite(page);
    await field.getByRole("button", { name: "Move Colour to Card" }).click();
    await moved;
    expect((await storedClasses(page))?.[0]?.styles).toEqual(colour(BLACK.hex));
    await expect(field).not.toContainText("Set on this block");
    await expect(await block(page, A)).toHaveCSS("color", BLACK.rgb);
  });

  test("keeps and lists a block's three shared styles, and takes one off or detaches one", async ({
    page,
  }) => {
    const three = ["one", "two", "three"].map((slug, orderIndex) => ({
      id: `e2e-${slug}`,
      slug,
      orderIndex,
      styles: orderIndex === 2 ? colour(NAVY.hex) : {},
    }));
    await storeClasses(page, three);
    await openEditorWith(
      page,
      [text(A, { classes: ["e2e-three", "e2e-one", "e2e-two"] })],
      A
    );
    await styleOf(page, A);

    expect(await targetLabels(page)).toEqual([
      "● This block",
      "◆ one",
      "◆ two",
      "◆ three",
    ]);
    // One shared style per block in this release: no second one is offered.
    await openTargets(page);
    await expect(
      page.getByRole("menuitem", { name: /^Apply a shared style…/ })
    ).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    // Any of them can be the target.
    await chooseTarget(page, "two");
    await expect(targetChip(page)).toHaveAccessibleName(
      "Editing: shared style two"
    );

    // Opening and saving the block drops none.
    await pressSave(page);
    await expect
      .poll(async () => (await storedNodes(page))[0]?.classes)
      .toEqual(["e2e-three", "e2e-one", "e2e-two"]);

    // Taken off: the others stay.
    await openTargets(page);
    await page.getByRole("menuitem", { name: /^Remove one/ }).click();
    expect(await targetLabels(page)).toEqual([
      "● This block",
      "◆ two",
      "◆ three",
    ]);
    // Back to this block, to read what the block itself holds.
    await chooseTarget(page, "This block");

    // Detached: the look stays on the block, the style goes.
    await openTargets(page);
    await page.getByRole("menuitem", { name: /^Detach three/ }).click();
    expect(await targetLabels(page)).toEqual(["● This block", "◆ two"]);
    await expect(await block(page, A)).toHaveCSS("color", NAVY.rgb);
    await expect(colourField(page)).toHaveValue(NAVY.hex);

    await pressSave(page);
    await expect
      .poll(async () => {
        const [node] = await storedNodes(page);
        return { classes: node?.classes, styles: node?.styles };
      })
      .toEqual({ classes: ["e2e-two"], styles: colour(NAVY.hex) });
  });
});
