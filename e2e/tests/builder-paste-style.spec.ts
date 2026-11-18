/**
 * "Copy style" and "Paste style" from a block's More actions menu, in the
 * real editor, with the site's text styles and a shared style stored as the
 * site keeps them.
 *
 * What each asserts, and the broken version it rules out:
 *
 * - A Heading's look (a colour, a size on Desktop and another on Mobile, a
 *   hover colour, the text style "Eyebrow" and a shared style) pasted onto
 *   two selected Headings, one wearing "Display": both are drawn with it on
 *   Desktop and Mobile, both store the source's class list, their words are
 *   unchanged, and one Undo takes both back. A paste merged into the targets
 *   would keep "Display"; one applied block by block needs two undos. One
 *   Redo brings the look back on both.
 * - From a Heading with no text style onto one wearing "Display", "Display"
 *   is removed. A paste that kept a target's styles would leave it.
 * - Onto an Image, the builder says how many settings don't apply to Image:
 *   a Heading's background colour at rest and on hover, which an Image has
 *   no place for.
 * - The menu, with the two items, passes the accessibility scan in light and
 *   dark, and is used with the keyboard alone.
 *
 * @module builder-paste-style.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import {
  block,
  clickBlock,
  emptyHomepage,
  openEditorWith,
  pressSave,
} from "./canvas/editor-driver";
import { emptyScanReason, scanAxe } from "./support/axe-scan.mjs";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// The homepage Single is reseeded and edited here, and the site's classes
// are changed and restored.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const HOMEPAGE = "/admin/api/singles/homepage";

const DISPLAY = {
  id: "ps-display",
  slug: "ps-display",
  label: "Display",
  orderIndex: 0,
  role: "text",
  styles: { base: { base: { fontSize: "56px", fontWeight: 700 } } },
};
const EYEBROW = {
  id: "ps-eyebrow",
  slug: "ps-eyebrow",
  label: "Eyebrow",
  orderIndex: 1,
  role: "text",
  styles: {
    base: { base: { textTransform: "uppercase", letterSpacing: "0.08em" } },
  },
};
const FRAMED = {
  id: "ps-framed",
  slug: "ps-framed",
  label: "Framed",
  orderIndex: 2,
  // The catalog's one border property: a width per logical side and a style.
  styles: {
    base: {
      base: {
        border: {
          style: "solid",
          width: {
            blockStart: "3px",
            blockEnd: "3px",
            inlineStart: "3px",
            inlineEnd: "3px",
          },
        },
      },
    },
  },
};

const SOURCE = "ps-source";
const FIRST = "ps-first";
const SECOND = "ps-second";
const PLAIN = "ps-plain";
const PICTURE = "ps-picture";

const SOURCE_STYLES = {
  base: {
    base: {
      color: "rgb(200, 0, 0)",
      fontSize: "40px",
      backgroundColor: "rgb(255, 240, 200)",
    },
    mobile: { fontSize: "24px" },
  },
  hover: {
    base: {
      color: "rgb(0, 0, 200)",
      backgroundColor: "rgb(255, 220, 150)",
    },
  },
};

function heading(id: string, text: string, extra: object = {}): object {
  return {
    id,
    type: "core/heading",
    version: 1,
    props: { text, level: "h2" },
    ...extra,
  };
}

const NODES = [
  heading(SOURCE, "The look to copy", {
    styles: SOURCE_STYLES,
    classes: [EYEBROW.id, FRAMED.id],
  }),
  heading(FIRST, "First heading", { classes: [DISPLAY.id] }),
  heading(SECOND, "Second heading"),
  heading(PLAIN, "A plain heading"),
  {
    id: PICTURE,
    type: "core/image",
    version: 1,
    props: { src: "/nextly-logo.svg", alt: "The Nextly logo" },
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

/** The selected block's toolbar "More actions" button. */
function blockMenu(page: Page): Locator {
  return page
    .getByTestId("canvas")
    .getByRole("button", { name: "More actions" });
}

/** Pick one of the More actions menu's items. */
async function fromMenu(page: Page, name: string): Promise<void> {
  await blockMenu(page).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}

/** Copy one block's style from its menu. */
async function copyStyleOf(page: Page, id: string): Promise<void> {
  await clickBlock(page, id);
  await fromMenu(page, "Copy style");
}

/** Show the canvas at one device. */
async function device(page: Page, name: RegExp): Promise<void> {
  await page
    .getByRole("radiogroup", { name: "Device" })
    .getByRole("radio", { name })
    .click();
}

/**
 * The open menu's accessibility scan, saying why when axe could measure no
 * contrast inside it: the reasons axe gives for each item it left
 * unmeasured, so a scan of nothing names its cause rather than only its
 * silence.
 */
async function expectMenuScanned(page: Page): Promise<void> {
  // Drawn at full strength first: the menu and everything around it at an
  // opacity of 1, which is what an opening fade ends on.
  await expect
    .poll(() =>
      page.getByRole("menu").evaluate(menu => {
        let opacity = 1;
        for (
          let at: Element | null = menu;
          at !== null;
          at = at.parentElement
        ) {
          opacity *= Number(getComputedStyle(at).opacity);
        }
        return opacity;
      })
    )
    .toBe(1);
  const scope = { include: '[role="menu"]' };
  const { results, findings } = await scanAxe(page, scope);
  const unmeasured = results.incomplete
    .filter(rule => rule.id === "color-contrast")
    .flatMap(rule =>
      rule.nodes.map(
        node =>
          `${node.target.map(String).join(" ")}: ${node.any
            .map(check => check.message)
            .join("; ")}`
      )
    );
  expect(
    emptyScanReason(results, scope),
    `axe left unmeasured:\n${unmeasured.join("\n")}`
  ).toBeNull();
  expect(findings).toEqual([]);
}

/** Move to a menu item with the arrows, and take it. */
async function takeWithKeys(page: Page, name: string): Promise<void> {
  await blockMenu(page).focus();
  await page.keyboard.press("Enter");
  const item = page.getByRole("menuitem", { name, exact: true });
  await expect(async () => {
    await page.keyboard.press("ArrowDown");
    await expect(item).toBeFocused({ timeout: 500 });
  }).toPass();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toHaveCount(0);
}

test.describe("Copy style and Paste style", () => {
  test.describe.configure({ timeout: 180_000 });

  let before: unknown[] | null = null;
  test.beforeEach(async ({ page }) => {
    before = await storedClasses(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await storeClasses(page, [DISPLAY, EYEBROW, FRAMED]);
  });
  test.afterEach(async ({ page }) => {
    // Off the homepage first: a style in use cannot be removed.
    await emptyHomepage(page);
    await storeClasses(page, before ?? []);
  });

  test("gives two Headings one Heading's whole look, and one Undo takes both back", async ({
    page,
  }) => {
    await openEditorWith(page, NODES, SOURCE);
    await copyStyleOf(page, SOURCE);

    await clickBlock(page, FIRST);
    await clickBlock(page, SECOND, ["Shift"]);
    await fromMenu(page, "Paste style");

    for (const id of [FIRST, SECOND]) {
      const target = await block(page, id);
      await expect(target).toHaveCSS("font-size", "40px");
      await expect(target).toHaveCSS("color", "rgb(200, 0, 0)");
      // Eyebrow's case and the shared style's frame.
      await expect(target).toHaveCSS("text-transform", "uppercase");
      await expect(target).toHaveCSS("border-top-width", "3px");
    }
    await expect(await block(page, FIRST)).toHaveText("First heading");
    await expect(await block(page, SECOND)).toHaveText("Second heading");

    await device(page, /^Mobile/);
    await expect(await block(page, FIRST)).toHaveCSS("font-size", "24px");
    await expect(await block(page, SECOND)).toHaveCSS("font-size", "24px");
    await device(page, /^Desktop/);

    await pressSave(page);
    await expect
      .poll(async () =>
        (await storedNodes(page))
          .filter(node => node.id === FIRST || node.id === SECOND)
          .map(node => [node.id, node.classes, node.props, node.styles])
      )
      .toEqual([
        [
          FIRST,
          [EYEBROW.id, FRAMED.id],
          { text: "First heading", level: "h2" },
          SOURCE_STYLES,
        ],
        [
          SECOND,
          [EYEBROW.id, FRAMED.id],
          { text: "Second heading", level: "h2" },
          SOURCE_STYLES,
        ],
      ]);

    // One Undo, both back: "Display" on the first, nothing on the second.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(await block(page, FIRST)).toHaveCSS("font-size", "56px");
    await expect(await block(page, SECOND)).not.toHaveCSS("font-size", "40px");
    await expect(await block(page, SECOND)).not.toHaveCSS(
      "text-transform",
      "uppercase"
    );

    // One Redo, both pasted again: the whole look on every target.
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    for (const id of [FIRST, SECOND]) {
      const target = await block(page, id);
      await expect(target).toHaveCSS("font-size", "40px");
      await expect(target).toHaveCSS("color", "rgb(200, 0, 0)");
      await expect(target).toHaveCSS("text-transform", "uppercase");
      await expect(target).toHaveCSS("border-top-width", "3px");
    }
  });

  test("from a Heading with no text style, removes the target's Display", async ({
    page,
  }) => {
    await openEditorWith(page, NODES, PLAIN);
    await copyStyleOf(page, PLAIN);
    await clickBlock(page, FIRST);
    await fromMenu(page, "Paste style");
    await expect(await block(page, FIRST)).not.toHaveCSS("font-size", "56px");

    await pressSave(page);
    await expect
      .poll(async () =>
        Object.hasOwn(
          (await storedNodes(page)).find(node => node.id === FIRST) ?? {},
          "classes"
        )
      )
      .toBe(false);
  });

  test("onto an Image, says how many settings don't apply to Image", async ({
    page,
  }) => {
    await openEditorWith(page, NODES, SOURCE);
    await copyStyleOf(page, SOURCE);
    await clickBlock(page, PICTURE);
    await fromMenu(page, "Paste style");
    await expect(
      page.getByText("2 settings don't apply to Image.", { exact: true })
    ).toBeVisible();
  });

  test("its menu items pass the accessibility scan in light and dark, and work from the keyboard", async ({
    page,
  }) => {
    // Menus open without their fade, so a scan reads them as drawn.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openEditorWith(page, NODES, SOURCE);
    await clickBlock(page, SOURCE);
    for (const dark of [false, true]) {
      await page.evaluate(wantDark => {
        document.documentElement.classList.toggle("dark", wantDark);
      }, dark);
      await blockMenu(page).click();
      for (const name of ["Copy style", "Paste style"]) {
        await expect(
          page.getByRole("menuitem", { name, exact: true })
        ).toBeVisible();
      }
      // The menu as an author sees it, kept with the run's results.
      await page.getByRole("menu").screenshot({
        path: test.info().outputPath(`menu-${dark ? "dark" : "light"}.png`),
      });
      await expectMenuScanned(page);
      await page.keyboard.press("Escape");
    }

    await takeWithKeys(page, "Copy style");
    await clickBlock(page, SECOND);
    await takeWithKeys(page, "Paste style");
    await expect(await block(page, SECOND)).toHaveCSS("font-size", "40px");
  });
});
