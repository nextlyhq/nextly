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

/** One target chip in the bar, by its name. */
const chip = (page: Page, name: string) =>
  bar(page).getByRole("button", { name, exact: true });

/** Select a block and open the inspector's Style tab with Typography open. */
async function styleOf(page: Page, id: string): Promise<void> {
  await clickBlock(page, id);
  await page.getByRole("tab", { name: "Style" }).click();
  const section = page.getByRole("button", { name: "Typography", exact: true });
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
 * The Typography section's Colour field. Its name carries where its value
 * comes from ("Colour From Card"), so it is matched by its start.
 */
const colourField = (page: Page) =>
  page
    .getByRole("region", { name: /^Typography/ })
    .getByRole("textbox", { name: /^Colour( |$)/ });

test.describe("shared styles on a block", () => {
  test.describe.configure({ timeout: 180_000 });

  let before: Record<string, unknown>[] | null = null;
  test.beforeEach(async ({ page }) => {
    before = await storedClasses(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  test.afterEach(async ({ page }) => {
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
    await expect(chip(page, "Card")).toHaveAttribute("aria-pressed", "false");

    // The bar's box stands apart from the inspector it sits on, in both
    // schemes, read from the computed colours rather than by eye.
    for (const dark of [false, true]) {
      const [box, panel] = await groundsOf(page, dark);
      expect(box, `the bar against the panel, dark=${dark}`).not.toBe(panel);
    }
    await groundsOf(page, false);

    // Another block wears it.
    await styleOf(page, B);
    await bar(page).getByRole("button", { name: "Apply shared style" }).click();
    const search = page.getByRole("combobox", { name: "Search shared styles" });
    await search.fill("card");
    await search.press("Enter");
    await expect(await block(page, B)).toHaveCSS("color", NAVY.rgb);

    // The style becomes the target by keyboard, and says how far it reaches.
    await chip(page, "This block").focus();
    await page.keyboard.press("ArrowRight");
    await expect(chip(page, "Card")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(chip(page, "Card")).toHaveAttribute("aria-pressed", "true");
    await expect(bar(page).getByRole("status")).toHaveText(
      "Now editing shared style Card"
    );
    await expect(bar(page)).toContainText(
      "Editing shared style Card · .nx-c-card"
    );
    await expect(bar(page).locator("[data-shared-reach]")).toContainText(
      "2 blocks on this page"
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
    await chip(page, "Card").focus();
    await page.keyboard.press("Escape");
    await expect(chip(page, "This block")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
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
    const field = page.getByRole("region", { name: /^Typography/ });
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
    await chip(page, "Card").click();
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

    const chips = bar(page).locator("[data-target-chip]");
    await expect(chips).toHaveText(["This block", "one", "two", "three"]);
    // One shared style per block in this release: no second one is offered.
    await expect(
      bar(page).getByRole("button", { name: "Apply shared style" })
    ).toHaveCount(0);
    // Any of them can be the target.
    await chip(page, "two").click();
    await expect(chip(page, "two")).toHaveAttribute("aria-pressed", "true");

    // Opening and saving the block drops none.
    await pressSave(page);
    await expect
      .poll(async () => (await storedNodes(page))[0]?.classes)
      .toEqual(["e2e-three", "e2e-one", "e2e-two"]);

    // Taken off: the others stay.
    await bar(page)
      .getByRole("button", { name: "Actions for shared style one" })
      .click();
    await page
      .getByRole("menuitem", { name: "Remove one from this block" })
      .click();
    await expect(chips).toHaveText(["This block", "two", "three"]);
    // Back to this block, to read what the block itself holds.
    await chip(page, "This block").click();

    // Detached: the look stays on the block, the style goes.
    await bar(page)
      .getByRole("button", { name: "Actions for shared style three" })
      .click();
    await page
      .getByRole("menuitem", {
        name: /^Detach: keep the look on this block only/,
      })
      .click();
    await expect(chips).toHaveText(["This block", "two"]);
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
