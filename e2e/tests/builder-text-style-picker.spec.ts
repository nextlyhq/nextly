/**
 * The Style tab's "Text style" picker in the browser, with the site's text
 * styles stored as they are kept: named classes with the text role.
 *
 * - An H2 given "Display" and a Text block given "Eyebrow" take each whole
 *   look, read from their computed styles, and Display's own mobile size
 *   follows the canvas to Mobile; the stored blocks each wear the one entry.
 * - A block's own value over its text style says "Changed from Eyebrow",
 *   and Reset shows the text style's value again.
 * - Undo and Redo take a pick back and forward.
 * - The picker is reached and used with the keyboard alone, and Escape
 *   closes its list and hands focus back to it.
 * - Its list stays inside the window and passes the accessibility scan, in
 *   light and dark.
 *
 * @module builder-text-style-picker.spec
 */
import { expect, type Page } from "@playwright/test";

import {
  block,
  clickBlock,
  emptyHomepage,
  openEditorWith,
  pressSave,
} from "./canvas/editor-driver";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// The homepage Single is reseeded and edited here, and the site's classes
// are changed and restored.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const HOMEPAGE = "/admin/api/singles/homepage";
const H2 = "ts-heading";
const TEXT = "ts-text";

/** The site's two text styles, as the site style stores them. */
const DISPLAY = {
  id: "ts-display",
  slug: "display",
  label: "Display",
  orderIndex: 0,
  role: "text",
  styles: {
    base: {
      base: { fontSize: "56px", lineHeight: 1.05, fontWeight: 700 },
      mobile: { fontSize: "32px" },
    },
  },
};
const EYEBROW = {
  id: "ts-eyebrow",
  slug: "eyebrow",
  label: "Eyebrow",
  orderIndex: 1,
  role: "text",
  styles: {
    base: {
      base: {
        fontSize: "12px",
        lineHeight: 1.4,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      },
    },
  },
};

const NODES = [
  {
    id: H2,
    type: "core/heading",
    version: 1,
    props: { text: "A heading that looks like Display", level: "h2" },
  },
  {
    id: TEXT,
    type: "core/text",
    version: 1,
    props: { text: "A paragraph that looks like Eyebrow" },
  },
];

/** The stored `classes` section, as the site style holds it. */
async function storedClasses(page: Page): Promise<unknown[] | null> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return (item.classes as unknown[] | undefined) ?? null;
}

/** Store the site's classes, as a test's starting point or its cleanup. */
async function storeClasses(page: Page, classes: unknown): Promise<void> {
  const stored = await page.request.patch(SITE_STYLE, {
    data: { classes, _overwrite: true },
  });
  expect(
    stored.ok(),
    `storing the classes: ${stored.status()} ${await stored.text()}`
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

/** Select a block and open the Style tab with its Text section open. */
async function textSectionOf(page: Page, id: string): Promise<void> {
  await clickBlock(page, id);
  await page.getByRole("tab", { name: "Style" }).click();
  const section = page
    .getByTestId("inspector")
    .getByRole("button", { name: /^Text(\s?has changes)?$/ });
  if ((await section.getAttribute("aria-expanded")) !== "true") {
    await section.click();
  }
}

/** The picker's button, named with what the block wears. */
const picker = (page: Page) =>
  page.getByRole("button", { name: /^Text style, / });

/** Pick a text style, or None, from the picker's list. */
async function pick(page: Page, name: string): Promise<void> {
  await picker(page).click();
  await page
    .getByRole("menuitemradio", { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}

test.describe("the Text style picker", () => {
  test.describe.configure({ timeout: 180_000 });

  let before: unknown[] | null = null;
  test.beforeEach(async ({ page }) => {
    before = await storedClasses(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await storeClasses(page, [DISPLAY, EYEBROW]);
  });
  test.afterEach(async ({ page }) => {
    // Off the homepage first: a text style in use cannot be removed.
    await emptyHomepage(page);
    await storeClasses(page, before ?? []);
  });

  test("gives an H2 Display and a Text block Eyebrow, each the whole look", async ({
    page,
  }) => {
    await openEditorWith(page, NODES, H2);

    await textSectionOf(page, H2);
    await expect(picker(page)).toHaveAccessibleName("Text style, None");
    await pick(page, "Display");
    const heading = await block(page, H2);
    await expect(heading).toHaveCSS("font-size", "56px");
    await expect(heading).toHaveCSS("font-weight", "700");
    await expect(picker(page)).toHaveAccessibleName("Text style, Display");

    await textSectionOf(page, TEXT);
    await pick(page, "Eyebrow");
    const text = await block(page, TEXT);
    await expect(text).toHaveCSS("font-size", "12px");
    await expect(text).toHaveCSS("font-weight", "600");
    await expect(text).toHaveCSS("text-transform", "uppercase");
    // 0.08em of 12px.
    await expect(text).toHaveCSS("letter-spacing", "0.96px");

    // The heading's own size on another device follows the text style's.
    await page
      .getByRole("radiogroup", { name: "Device" })
      .getByRole("radio", { name: /^Mobile/ })
      .click();
    await expect(await block(page, H2)).toHaveCSS("font-size", "32px");

    // Each block stores the one entry, and nothing else changed shape.
    await pressSave(page);
    await expect
      .poll(async () =>
        (await storedNodes(page)).map(node => [node.id, node.classes])
      )
      .toEqual([
        [H2, ["ts-display"]],
        [TEXT, ["ts-eyebrow"]],
      ]);
  });

  test("says \"Changed from Eyebrow\" over the block's own value, and Reset brings Eyebrow's back", async ({
    page,
  }) => {
    await openEditorWith(
      page,
      [
        {
          ...NODES[1],
          classes: ["ts-eyebrow"],
          styles: { base: { base: { fontSize: "20px" } } },
        },
      ],
      TEXT
    );
    await textSectionOf(page, TEXT);
    await expect(await block(page, TEXT)).toHaveCSS("font-size", "20px");
    const line = page.locator('[data-shared-line="override"]');
    await expect(line).toHaveText(/Changed from\sEyebrow/);
    await line.getByRole("button", { name: /^Reset / }).click();
    await expect(await block(page, TEXT)).toHaveCSS("font-size", "12px");
    await expect(line).toHaveCount(0);
  });

  test("Undo and Redo take a pick back and forward", async ({ page }) => {
    await openEditorWith(page, NODES, TEXT);
    await textSectionOf(page, TEXT);
    await pick(page, "Eyebrow");
    await expect(await block(page, TEXT)).toHaveCSS("font-size", "12px");

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(await block(page, TEXT)).not.toHaveCSS("font-size", "12px");
    await expect(picker(page)).toHaveAccessibleName("Text style, None");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(await block(page, TEXT)).toHaveCSS("font-size", "12px");
    await expect(picker(page)).toHaveAccessibleName("Text style, Eyebrow");
  });

  test("is used with the keyboard alone, and Escape hands focus back", async ({
    page,
  }) => {
    await openEditorWith(page, NODES, TEXT);
    await textSectionOf(page, TEXT);
    await picker(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(picker(page)).toBeFocused();
    // The canvas keeps its selection through the Escape.
    await expect(page.getByRole("tab", { name: "Style" })).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    // The arrows move through None, Display and Eyebrow.
    const eyebrow = page.getByRole("menuitemradio", { name: /^Eyebrow/ });
    await expect(async () => {
      await page.keyboard.press("ArrowDown");
      await expect(eyebrow).toBeFocused({ timeout: 500 });
    }).toPass();
    await page.keyboard.press("Enter");
    await expect(await block(page, TEXT)).toHaveCSS(
      "text-transform",
      "uppercase"
    );
    await expect(picker(page)).toBeFocused();
  });

  test("keeps its list inside the window, in light and dark", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, TEXT);
    await textSectionOf(page, TEXT);
    for (const dark of [false, true]) {
      await page.evaluate(wantDark => {
        document.documentElement.classList.toggle("dark", wantDark);
      }, dark);
      await picker(page).click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      if (box === null) throw new Error("the list has no box");
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1280);
      expect(box.y + box.height).toBeLessThanOrEqual(720);
      await expectNoAxeViolations(page, { include: '[role="menu"]' });
      await page.keyboard.press("Escape");
    }
  });
});
