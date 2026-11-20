/**
 * The builder's chrome works for every author: by keyboard, by screen
 * reader, in light and dark, with reduced motion and in forced colours.
 *
 * What each asserts, and the broken version it rules out:
 *
 * - **axe:** the whole page meets WCAG 2.2 AA with the start area showing,
 *   with the picker open, and with each of the top bar's menus open (the
 *   page switcher, Preview's, Publish's, ⋯ and the zoom), in light and dark.
 *   Whole-page scans: a modal menu hides the focusable editor around it
 *   (`aria-hidden-focus`), a defect outside the menu itself.
 * - **Focus rings:** each top-bar control and the start area's buttons, when
 *   reached by Tab, draw a ring at 3:1 or more against the bar or canvas
 *   behind them. A control that only shows the browser's hover look, or a
 *   ring in a tint of the ground, fails.
 * - **F6:** moves from the top bar to the rail, the open panel, the canvas
 *   and the inspector, then back to the top bar; Shift+F6 walks it back.
 * - **Reduced motion:** with `prefers-reduced-motion: reduce`, the insertion
 *   line, the picker, the "+" between blocks and in an empty Section, the
 *   start area, the width handles and ruler, and the top bar's buttons all
 *   have computed transition and animation durations of 0. A rule written
 *   only for motion's presence leaves the picker's opening fade.
 * - **Forced colours, and a dark Section:** on a near-black Section the
 *   insertion line and the "+" stand out at 3:1 or more by their colour or
 *   their halo; with `forced-colors: active` they, and an empty Section's
 *   hover outline, are drawn in the system's Highlight.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 *
 * @module tests/builder-chrome-access.spec
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

import { contrastRatio, toRgb, type Theme } from "./support/admin";
import { settleTransitions } from "./support/axe-scan.mjs";
import {
  createPage,
  longTitle,
  openBuilder,
  revealGapAdd,
  topBar,
} from "./support/builder-chrome";
import { canvasBlock } from "./support/canvas-frame";
import { ownSeat, test } from "./support/test";

const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const HEADING = "00000000-0000-4000-8000-0000001980b1";
const TEXT = "00000000-0000-4000-8000-0000001980b2";
const DARK = "00000000-0000-4000-8000-0000001980b3";
const DARK_HEADING = "00000000-0000-4000-8000-0000001980b4";
const DARK_EMPTY = "00000000-0000-4000-8000-0000001980b5";

/** The near-black a dark Section is drawn in. */
const NEAR_BLACK = "#111827";

/** A heading, some text, and a near-black Section holding a heading and an empty Section. */
function content(): object[] {
  return [
    {
      id: HEADING,
      type: "core/heading",
      version: 1,
      props: { text: "A heading on the page", level: "h2" },
    },
    {
      id: TEXT,
      type: "core/text",
      version: 1,
      props: { text: "Some text under it." },
    },
    {
      id: DARK,
      type: "core/section",
      version: 1,
      name: "Dark band",
      props: { as: "section", contained: true },
      styles: {
        base: {
          base: {
            backgroundColor: NEAR_BLACK,
            color: "#f9fafb",
            padding: {
              blockStart: "32px",
              blockEnd: "32px",
              inlineStart: "32px",
              inlineEnd: "32px",
            },
          },
        },
      },
      slots: {
        children: [
          {
            id: DARK_HEADING,
            type: "core/heading",
            version: 1,
            props: { text: "On a dark band", level: "h3" },
          },
          {
            id: DARK_EMPTY,
            type: "core/section",
            version: 1,
            name: "Dark empty",
            props: { as: "section", contained: true },
            styles: {
              base: {
                base: { backgroundColor: NEAR_BLACK, minHeight: "120px" },
              },
            },
            slots: { children: [] },
          },
        ],
      },
    },
  ];
}

/** axe's AA findings over the whole page, each with where it was found. */
async function axeFindings(page: Page, where: string) {
  await settleTransitions(page);
  const results = await new AxeBuilder({ page }).withTags(AA_TAGS).analyze();
  expect(
    results.passes.length,
    `${where}: axe checked nothing`
  ).toBeGreaterThan(10);
  return results.violations.map(violation => ({
    where,
    id: violation.id,
    count: violation.nodes.length,
    targets: violation.nodes
      .flatMap(node => node.target.map(String))
      .slice(0, 4),
  }));
}

/** Open a menu by its button, scan, and close it with Escape. */
async function scanMenu(
  page: Page,
  opener: Locator,
  where: string
): Promise<Awaited<ReturnType<typeof axeFindings>>> {
  await expect(opener, `${where}: its button`).toBeVisible();
  await opener.click();
  const menu = page.getByRole("menu");
  await expect(menu, `${where}: the menu`).toBeVisible();
  const found = await axeFindings(page, where);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  return found;
}

/** The region focus is in: its name, or the open panel's. */
async function focusedRegion(page: Page): Promise<string> {
  return page.evaluate(() => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement)) return "nothing";
    const named = focused.getAttribute("aria-label") ?? "";
    if (focused.matches('header[aria-label="Editor actions"]'))
      return "top bar";
    if (named === "Editor panels") return "rail";
    // The canvas region, or the page's frame inside it, which takes the
    // focus the region is given.
    if (focused.closest('[aria-label="Canvas"]') !== null) return "canvas";
    if (focused.matches('aside[aria-label="Inspector"]')) return "inspector";
    if (focused.matches("section[tabindex='-1'][aria-label]"))
      return `panel ${named}`;
    return `${focused.tagName.toLowerCase()} ${named}`.trim();
  });
}

/**
 * The colours a focused element's ring may be drawn in: its outline's, when
 * it has one, and each colour in its box shadow.
 */
async function ringColours(target: Locator): Promise<string[]> {
  return target.evaluate(element => {
    const style = getComputedStyle(element);
    const colours: string[] = [];
    if (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 1) {
      colours.push(style.outlineColor);
    }
    const shadow = style.boxShadow;
    if (shadow !== "none") {
      colours.push(
        ...(shadow.match(
          /(?:rgba?|oklch|oklab|lab|lch|hsla?|color)\([^)]*\)/g
        ) ?? [])
      );
    }
    return colours;
  });
}

/** The colour behind an element: its own fill, or the nearest ancestor's. */
async function groundBehind(target: Locator): Promise<string> {
  return target.evaluate(element => {
    for (let at = element.parentElement; at !== null; at = at.parentElement) {
      const fill = getComputedStyle(at).backgroundColor;
      if (fill !== "rgba(0, 0, 0, 0)" && fill !== "transparent") return fill;
    }
    return "rgb(255, 255, 255)";
  });
}

/** The best contrast any of `colours` makes against `ground`. */
async function bestContrast(
  page: Page,
  colours: readonly string[],
  ground: string
): Promise<number> {
  const behind = await toRgb(page, ground);
  let best = 0;
  for (const colour of colours) {
    // A fully transparent colour paints nothing: an `rgba(…, 0)`, a
    // `… / 0)`, or `transparent`.
    if (
      colour === "transparent" ||
      /^rgba\([^)]*,\s*0\)$/.test(colour) ||
      /\/\s*0\)$/.test(colour)
    ) {
      continue;
    }
    best = Math.max(best, contrastRatio(await toRgb(page, colour), behind));
  }
  return best;
}

/**
 * Each element of `targets`, and all inside it, whose computed transition or
 * animation lasts longer than nothing.
 */
async function moving(targets: Locator): Promise<string[]> {
  return targets.evaluateAll(elements => {
    const seconds = (value: string) =>
      value
        .split(",")
        .map(part => part.trim())
        .map(part =>
          part.endsWith("ms") ? parseFloat(part) / 1000 : parseFloat(part)
        );
    const found: string[] = [];
    for (const root of elements) {
      for (const element of [root, ...root.querySelectorAll("*")]) {
        const style = getComputedStyle(element);
        const transition = seconds(style.transitionDuration).some(
          time => time > 0
        );
        const animation =
          style.animationName !== "none" &&
          seconds(style.animationDuration).some(time => time > 0);
        if (transition || animation) {
          found.push(
            `${element.tagName.toLowerCase()}.${String(element.getAttribute("class") ?? "").split(" ")[0]} ${transition ? `transition ${style.transitionDuration}` : ""}${animation ? ` animation ${style.animationName} ${style.animationDuration}` : ""}`.trim()
          );
        }
      }
    }
    return [...new Set(found)];
  });
}

for (const [index, theme] of (["light", "dark"] as const).entries()) {
  test.describe(`axe, ${theme}`, () => {
    test.describe.configure({ timeout: 300_000 });
    ownSeat(1 + index);

    test(`finds nothing with the start area, the picker and each menu open, ${theme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const found: Awaited<ReturnType<typeof axeFindings>> = [];

      // An empty page: its start area, then the picker it opens.
      const empty = await createPage(page.request, { title: longTitle() });
      await openBuilder(page, empty.id, { theme: theme as Theme });
      const start = page.locator(".nx-page-start");
      await expect(start).toBeVisible({ timeout: 60_000 });
      found.push(...(await axeFindings(page, "the start area")));
      await start.getByRole("button", { name: "Add a block" }).click();
      const picker = page.getByRole("dialog", { name: "Add a block" });
      await expect(picker).toBeVisible();
      found.push(...(await axeFindings(page, "the picker")));
      await page.keyboard.press("Escape");
      await expect(picker).toBeHidden();

      // Each of the top bar's menus.
      const bar = topBar(page);
      found.push(
        ...(await scanMenu(
          page,
          bar.getByRole("button", { name: /: switch page$/ }),
          "the page switcher"
        )),
        ...(await scanMenu(
          page,
          bar.getByRole("button", { name: /^Preview( options)?$/ }).last(),
          "Preview's menu"
        )),
        ...(await scanMenu(
          page,
          bar.getByRole("button", { name: "More ways to publish" }),
          "Publish's menu"
        )),
        ...(await scanMenu(
          page,
          bar.getByRole("button", { name: "More actions" }),
          "the ⋯ menu"
        )),
        ...(await scanMenu(
          page,
          bar.getByRole("button", { name: /^Canvas zoom:/ }),
          "the zoom menu"
        ))
      );
      expect(found).toEqual([]);
    });
  });
}

test.describe("focus rings", () => {
  test.describe.configure({ timeout: 240_000 });
  ownSeat(3);

  for (const theme of ["light", "dark"] as const) {
    test(`each top-bar control and start area button draws a ring at 3:1, ${theme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const { id } = await createPage(page.request);
      await openBuilder(page, id, { theme });
      const start = page.locator(".nx-page-start");
      await expect(start).toBeVisible({ timeout: 60_000 });
      const weak: string[] = [];
      let judged = 0;

      // From the bar itself, Tab walks its controls in order.
      await topBar(page).focus();
      for (let step = 0; step < 30; step++) {
        await page.keyboard.press("Tab");
        const focused = page.locator("*:focus").first();
        const inBar = await focused.evaluate(
          element =>
            element.closest('header[aria-label="Editor actions"]') !== null
        );
        if (!inBar) break;
        const name = (await focused.ariaSnapshot()).split("\n")[0] ?? "";
        const colours = await ringColours(focused);
        const ground = await groundBehind(focused);
        const ratio = await bestContrast(page, colours, ground);
        judged += 1;
        if (ratio < 3) {
          weak.push(
            `${name} ${ratio.toFixed(2)} (${colours.join(" / ")} on ${ground})`
          );
        }
      }
      expect(judged, "the bar's controls reached by Tab").toBeGreaterThan(8);

      for (const name of ["Add a block", "Insert a saved section"]) {
        const button = start.getByRole("button", { name });
        await button.focus();
        // Focused by keyboard, as a ring is drawn for.
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(button).toBeFocused();
        const colours = await ringColours(button);
        const ground = await groundBehind(button);
        const ratio = await bestContrast(page, colours, ground);
        if (ratio < 3) {
          weak.push(
            `${name} ${ratio.toFixed(2)} (${colours.join(" / ")} on ${ground})`
          );
        }
      }
      expect(weak).toEqual([]);
    });
  }
});

test.describe("F6", () => {
  test.describe.configure({ timeout: 180_000 });
  ownSeat(4);

  test("moves between the top bar, rail, panel, canvas and inspector, and back", async ({
    page,
  }) => {
    const { id } = await createPage(page.request, { nodes: content() });
    await openBuilder(page, id);
    const add = page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Add", exact: true });
    if ((await add.getAttribute("aria-pressed")) !== "true") await add.click();
    await expect(add).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("complementary", { name: "Inspector" })
    ).toBeVisible();

    await topBar(page)
      .getByRole("button", { name: /: switch page$/ })
      .focus();
    const forward = [await focusedRegion(page)];
    for (let step = 0; step < 5; step++) {
      await page.keyboard.press("F6");
      forward.push(await focusedRegion(page));
    }
    expect(forward).toEqual(
      ["button", "rail", "panel Add", "canvas", "inspector", "top bar"].map(
        (region, at) => (at === 0 ? (forward[0] ?? region) : region)
      )
    );
    const back = [];
    for (let step = 0; step < 4; step++) {
      await page.keyboard.press("Shift+F6");
      back.push(await focusedRegion(page));
    }
    expect(back).toEqual(["inspector", "canvas", "panel Add", "rail"]);
  });
});

test.describe("reduced motion", () => {
  test.describe.configure({ timeout: 240_000 });
  ownSeat(5);

  test("the line, picker, “+”, start area, handles, ruler and bar buttons never move", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const found: string[] = [];

    // The start area and the picker it opens.
    const empty = await createPage(page.request);
    await openBuilder(page, empty.id);
    const start = page.locator(".nx-page-start");
    await expect(start).toBeVisible({ timeout: 60_000 });
    await start.getByRole("button", { name: "Add a block" }).hover();
    found.push(...(await moving(start)));
    await start.getByRole("button", { name: "Add a block" }).click();
    const picker = page.locator(".nx-insert-picker");
    await expect(picker).toBeVisible();
    found.push(...(await moving(picker)));
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();

    // A page with blocks: the "+" controls, the line, the width's handles and
    // ruler, and the bar's buttons through a save.
    const { id } = await createPage(page.request, { nodes: content() });
    await openBuilder(page, id);
    await expect(canvasBlock(page, HEADING)).toBeVisible({ timeout: 60_000 });
    await canvasBlock(page, DARK).click({ position: { x: 4, y: 4 } });
    const plus = page.locator(".nx-page-inserters__add");
    await expect(plus.first()).toBeAttached();
    found.push(...(await moving(page.locator(".nx-page-inserters"))));
    const emptyPlus = page.getByRole("button", {
      name: "Add a block, or drop one here, in Dark empty",
    });
    await emptyPlus.hover();
    found.push(
      ...(await moving(page.locator(".nx-empty-container-appenders")))
    );

    const add = page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Add", exact: true });
    if ((await add.getAttribute("aria-pressed")) !== "true") await add.click();
    await page.getByRole("option", { name: "Heading", exact: true }).hover();
    const line = page.locator(".nx-insertion-line");
    await expect(line.first()).toBeVisible();
    found.push(...(await moving(line)));

    // A width typed in previews it: the handles and the ruler show.
    await topBar(page).locator("[data-nx-active-width]").click();
    const width = page.getByRole("spinbutton", { name: "Preview width" });
    await width.fill("900");
    await width.press("Enter");
    const handles = page.getByRole("slider", { name: "Preview width" });
    await expect(handles.first()).toBeVisible();
    await expect(page.locator(".nx-preview-width__ruler")).toBeAttached();
    found.push(...(await moving(page.locator(".nx-preview-width"))));

    // The bar's buttons, while Save changes its words.
    await canvasBlock(page, HEADING).dblclick();
    await page.keyboard.type(" more");
    await page.keyboard.press("Escape");
    found.push(...(await moving(topBar(page))));
    await topBar(page).locator('[data-action="save"]').click();
    // "✓ Saved", drawn as a tick and "Saved".
    await expect(topBar(page).locator('[data-action="save"]')).toHaveText(
      "Saved"
    );
    found.push(...(await moving(topBar(page))));
    expect([...new Set(found)]).toEqual([]);
  });
});

test.describe("on a dark Section, and in forced colours", () => {
  test.describe.configure({ timeout: 240_000 });
  ownSeat(6);

  /** Point at an Add panel tile, so the line is drawn after the dark heading. */
  async function lineAfterDarkHeading(page: Page): Promise<Locator> {
    await canvasBlock(page, DARK_HEADING).click();
    const add = page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Add", exact: true });
    if ((await add.getAttribute("aria-pressed")) !== "true") await add.click();
    await page.getByRole("option", { name: "Text", exact: true }).hover();
    // The line itself; its label says the words.
    const line = page.locator(".nx-insertion-line .nx-drop-indicator").first();
    await expect(line).toBeVisible();
    await expect(page.locator(".nx-insertion-line__label")).toHaveText(
      /goes after On a dark band|goes after Heading/
    );
    return line;
  }

  /** The empty dark Section's words, which a pointer lights its outline from. */
  function emptyWords(page: Page): Locator {
    return page.getByRole("button", {
      name: "Add a block, or drop one here, in Dark empty",
    });
  }

  /** The outline an empty Section's words light while pointed at. */
  async function hoverOutline(words: Locator): Promise<string> {
    return words.evaluate(element => {
      const area = element.previousElementSibling;
      if (area === null) throw new Error("the words have no area before them");
      return getComputedStyle(area).outlineColor;
    });
  }

  /** The "+" between the dark band's two children, brought out. */
  async function gapAdd(page: Page): Promise<Locator> {
    await canvasBlock(page, DARK).click({ position: { x: 4, y: 4 } });
    const add = page.getByRole("button", {
      name: /^Add a block between .+ and Dark empty$/,
    });
    await expect(add).toBeAttached();
    await revealGapAdd(page, add);
    return add;
  }

  /**
   * The colours a mark stands out from the page by: its fill, and the halo
   * drawn around it. Its text colour, border and outline are left out: the
   * line draws none of them, so counting them would let an unpainted colour
   * pass for the mark's own.
   */
  async function markColours(mark: Locator): Promise<string[]> {
    return mark.evaluate(element => {
      const style = getComputedStyle(element);
      return [
        style.backgroundColor,
        ...(style.boxShadow.match(
          /(?:rgba?|oklch|oklab|lab|lch|hsla?|color)\([^)]*\)/g
        ) ?? []),
      ];
    });
  }

  test("the line, the empty Section's hover and the “+” stand out on a near-black Section", async ({
    page,
  }) => {
    const { id } = await createPage(page.request, { nodes: content() });
    await openBuilder(page, id);
    await expect(canvasBlock(page, DARK_HEADING)).toBeVisible({
      timeout: 60_000,
    });
    const weak: string[] = [];
    const judge = async (what: string, colours: string[]) => {
      const ratio = await bestContrast(page, colours, NEAR_BLACK);
      if (ratio < 3)
        weak.push(`${what} ${ratio.toFixed(2)} (${colours.join(" / ")})`);
    };

    await judge(
      "the line",
      await markColours(await lineAfterDarkHeading(page))
    );
    await page.mouse.move(0, 0);

    await emptyWords(page).hover();
    await judge("the empty Section's hover", [
      await hoverOutline(emptyWords(page)),
    ]);

    await judge("the “+”", await markColours(await gapAdd(page)));
    expect(weak).toEqual([]);
  });

  test("the line, the “+” and an empty Section's hover take the system's Highlight", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" });
    const { id } = await createPage(page.request, { nodes: content() });
    await openBuilder(page, id);
    await expect(canvasBlock(page, DARK_HEADING)).toBeVisible({
      timeout: 60_000,
    });
    // The system's Highlight as this browser resolves it, from a probe that
    // keeps its own colours.
    const highlight = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.setProperty("forced-color-adjust", "none");
      probe.style.backgroundColor = "Highlight";
      document.body.append(probe);
      const resolved = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return resolved;
    });

    const line = await lineAfterDarkHeading(page);
    await expect(line).toHaveCSS("background-color", highlight);
    await page.mouse.move(0, 0);

    await emptyWords(page).hover();
    await expect.poll(() => hoverOutline(emptyWords(page))).toBe(highlight);

    const add = await gapAdd(page);
    await expect(add).toHaveCSS("background-color", highlight);
  });
});
