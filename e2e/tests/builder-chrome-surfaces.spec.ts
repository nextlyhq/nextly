/**
 * The editor's panels and the page look apart, and everything in the
 * chrome that can be pressed looks it.
 *
 * - The rail, the side panels and the top bar are one panel surface (white in
 *   light), and the canvas region around the page is a plain grey well a
 *   visible step darker, in both themes. The menus and popovers the editor
 *   opens sit on the panel surface too.
 * - The 1px dividers between them are the border colour, the foreground when
 *   the system asks for more contrast, and the system's text colour in forced
 *   colours.
 * - The open panel's rail item is filled, at 3:1 against the rail.
 * - Every enabled control in the chrome shows the hand; a disabled one does
 *   not; a block on the canvas keeps its grab cursor.
 *
 * Colours are read as the browser paints them, so the theme's own tokens and
 * the editor's mixes are judged together, which no unit test can do.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

import { block } from "./canvas/editor-driver";
import { contrastRatio, gotoAdmin, toRgb, type Theme } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// The editor opens on the homepage Single, which other files edit.
test.describe.configure({ lock: [LOCK.homepage] });

const HOMEPAGE = "/admin/api/singles/homepage";
const OPEN_BUILDER_ACTION = /^Open in builder$/;
const BLOCK_ID = "surfaces-text";

async function openBuilder(
  page: Page,
  theme: Theme,
  width = 1440
): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  const stored = await page.request.patch(HOMEPAGE, {
    data: {
      layout: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: BLOCK_ID,
            type: "core/text",
            version: 1,
            props: { text: "A page on the well" },
          },
        ],
      },
      _overwrite: true,
    },
  });
  expect(stored.ok(), `seeding the homepage: ${stored.status()}`).toBe(true);
  await gotoAdmin(page, "/singles/homepage", theme);
  await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
  await expect(await block(page, BLOCK_ID)).toBeVisible({ timeout: 60_000 });
}

/** The colour behind an element: its own fill, or the nearest ancestor's. */
async function groundBehind(target: Locator): Promise<string> {
  return target.evaluate(element => {
    for (let at: Element | null = element; at !== null; at = at.parentElement) {
      const fill = getComputedStyle(at).backgroundColor;
      if (fill !== "rgba(0, 0, 0, 0)" && fill !== "transparent") return fill;
    }
    return "rgb(255, 255, 255)";
  });
}

/** OKLCH lightness of an sRGB colour, per the OKLab definition. */
function oklchLightness([r, g, b]: [number, number, number]): number {
  const linear = (value: number) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb
  );
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

const chrome = (page: Page) => page.locator(".nx-builder-chrome").first();
const rail = (page: Page) =>
  page.getByRole("navigation", { name: "Editor panels" });
const topBar = (page: Page) =>
  page.locator('header[aria-label="Editor actions"]');
const inspector = (page: Page) =>
  page.getByRole("complementary", { name: "Inspector" });
const well = (page: Page) => page.locator(".nx-canvas-scroller").first();

/** A colour as the chrome resolves it, from a probe placed inside it. */
async function resolvedInChrome(page: Page, colour: string): Promise<string> {
  return chrome(page).evaluate((root, value) => {
    const probe = document.createElement("span");
    probe.style.color = value;
    root.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, colour);
}

async function railItem(page: Page, name: string): Promise<Locator> {
  return rail(page).getByRole("button", { name, exact: true });
}

async function openLayers(page: Page): Promise<Locator> {
  const layers = await railItem(page, "Layers");
  if ((await layers.getAttribute("aria-pressed")) !== "true") {
    await layers.click();
  }
  await expect(layers).toHaveAttribute("aria-pressed", "true");
  return layers;
}

/** axe's colour-contrast rule over one surface, with its population checked. */
async function contrastFindings(page: Page, selector: string) {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withRules(["color-contrast"])
    .analyze();
  expect(
    results.passes.length + results.incomplete.length,
    `axe found nothing to check in ${selector}`
  ).toBeGreaterThan(0);
  return results.violations.flatMap(violation =>
    violation.nodes.map(node => `${violation.id}: ${node.target.join(" ")}`)
  );
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`the editor's surfaces, ${theme}`, () => {
    // The widest common laptop, and the narrowest the editor draws itself
    // at (below it, the editor says it needs more room).
    for (const width of [1440, 1280]) {
      test(`draws white panels around a grey well at ${width}px`, async ({
        page,
      }, testInfo) => {
        await openBuilder(page, theme, width);
        await openLayers(page);

        const panel = await toRgb(page, await groundBehind(rail(page)));
        for (const [name, region] of [
          ["the top bar", topBar(page)],
          ["the left panel", page.getByRole("region", { name: "Layers" })],
          ["the inspector", inspector(page)],
        ] as const) {
          expect(
            await toRgb(page, await groundBehind(region)),
            `${name} sits on the rail's panel surface`
          ).toEqual(panel);
        }

        const ground = await toRgb(page, await groundBehind(well(page)));
        const gap = oklchLightness(panel) - oklchLightness(ground);
        expect(
          gap,
          `panel ${panel.join(",")} vs well ${ground.join(",")}`
        ).toBeGreaterThanOrEqual(0.03);
        if (theme === "light") {
          expect(oklchLightness(panel)).toBeGreaterThan(0.98);
        }

        await testInfo.attach(`surfaces-${theme}-${width}.png`, {
          body: await page.screenshot(),
          contentType: "image/png",
        });
      });
    }

    test("opens its page menu and page data popover on the panel surface, legibly", async ({
      page,
    }) => {
      await openBuilder(page, theme);
      const panel = await toRgb(page, await groundBehind(rail(page)));

      await page.getByRole("button", { name: /: switch page$/ }).click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      expect(await toRgb(page, await groundBehind(menu))).toEqual(panel);
      expect(await contrastFindings(page, '[role="menu"]')).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();

      // Page settings' line, there at every level, as the top bar's meter
      // is only near the limit.
      await page.locator('.nx-read-meter[data-place="settings"]').click();
      const reads = page.locator(".nx-read-panel");
      await expect(reads).toBeVisible();
      expect(await toRgb(page, await groundBehind(reads))).toEqual(panel);
      expect(await contrastFindings(page, ".nx-read-panel")).toEqual([]);
    });

    test("fills the open panel's rail item at 3:1 against the rail", async ({
      page,
    }) => {
      await openBuilder(page, theme);
      const layers = await openLayers(page);
      const fill = await toRgb(
        page,
        await layers.evaluate(item => getComputedStyle(item).backgroundColor)
      );
      const ground = await toRgb(page, await groundBehind(rail(page)));
      // Measured here rather than by axe: the rail's items are icons, and
      // axe's contrast rule judges text only, so it finds nothing to check.
      expect(contrastRatio(fill, ground)).toBeGreaterThanOrEqual(3);
    });
  });
}

test.describe("the side-panel toggles", () => {
  test("are filled while their panel shows, and clear once it is hidden", async ({
    page,
  }) => {
    await openBuilder(page, "light");
    const toggle = topBar(page).getByRole("button", {
      name: "Inspector",
      exact: true,
    });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const fill = () =>
      toggle.evaluate(button => getComputedStyle(button).backgroundColor);
    const panel = await toRgb(page, await groundBehind(rail(page)));
    expect(await toRgb(page, await fill())).not.toEqual(panel);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    // Moved off, so the hover wash is not what is read.
    await page.mouse.move(0, 0);
    await expect.poll(fill).toBe("rgba(0, 0, 0, 0)");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("the editor's dividers", () => {
  /** The colours of the top bar's, the rail's and a resize handle's lines. */
  async function dividers(page: Page): Promise<string[]> {
    const handle = page.getByRole("separator", {
      name: "Canvas and inspector",
    });
    return [
      await topBar(page).evaluate(
        bar => getComputedStyle(bar).borderBottomColor
      ),
      await rail(page).evaluate(nav => getComputedStyle(nav).borderRightColor),
      await handle.evaluate(line => getComputedStyle(line).backgroundColor),
    ];
  }

  test("are 1px lines in the border colour", async ({ page }) => {
    await openBuilder(page, "light");
    const width = await topBar(page).evaluate(
      bar => getComputedStyle(bar).borderBottomWidth
    );
    expect(width).toBe("1px");
    const border = await resolvedInChrome(page, "var(--nx-border)");
    expect(await dividers(page)).toEqual([border, border, border]);
  });

  test("turn to the foreground when the system asks for more contrast", async ({
    page,
  }) => {
    await page.emulateMedia({ contrast: "more" });
    await openBuilder(page, "light");
    const foreground = await resolvedInChrome(page, "var(--nx-foreground)");
    const border = await resolvedInChrome(page, "var(--nx-border)");
    expect(foreground).not.toBe(border);
    expect(await dividers(page)).toEqual([foreground, foreground, foreground]);
  });

  test("take the system's text colour in forced colours", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await openBuilder(page, "light");
    const text = await resolvedInChrome(page, "CanvasText");
    const canvas = await resolvedInChrome(page, "Canvas");
    expect(text).not.toBe(canvas);
    expect(await dividers(page)).toEqual([text, text, text]);
  });
});

test.describe("the editor's cursors", () => {
  async function cursorOf(target: Locator): Promise<string> {
    return target.evaluate(element => getComputedStyle(element).cursor);
  }

  /** The enabled controls in one region, with each one's name and cursor. */
  async function controlCursors(region: Locator): Promise<string[]> {
    return region.evaluate(root =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button, [role="button"], [role="tab"], [role="radio"], [role="menuitem"], [role="menuitemradio"]'
        )
      )
        .filter(
          control =>
            !control.matches(
              ':disabled, [aria-disabled="true"], [data-disabled]:not([data-disabled="false"])'
            ) && control.getClientRects().length > 0
        )
        .map(control => {
          const name =
            control.getAttribute("aria-label") ??
            control.textContent?.trim() ??
            control.tagName;
          return `${name}: ${getComputedStyle(control).cursor}`;
        })
    );
  }

  const notPointer = (entries: string[]) =>
    entries.filter(entry => !entry.endsWith(": pointer"));

  test("shows the hand on every enabled control in the bar, the rail and the panels", async ({
    page,
  }) => {
    await openBuilder(page, "light");
    await openLayers(page);
    await (await block(page, BLOCK_ID)).click();
    await expect(inspector(page).getByRole("tab").first()).toBeVisible();

    for (const region of [
      topBar(page),
      rail(page),
      page.getByRole("region", { name: "Layers" }),
      inspector(page),
    ]) {
      const cursors = await controlCursors(region);
      expect(cursors.length).toBeGreaterThan(0);
      expect(notPointer(cursors)).toEqual([]);
    }
  });

  test("shows the hand on the zoom menu's items", async ({ page }) => {
    await openBuilder(page, "light");
    await topBar(page).locator(".nx-zoom-control").click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const cursors = await controlCursors(menu);
    expect(cursors.length).toBeGreaterThan(0);
    expect(notPointer(cursors)).toEqual([]);
  });

  test("keeps the arrow on a disabled control, and grab on a canvas block", async ({
    page,
  }) => {
    await openBuilder(page, "light");
    const redo = page.getByRole("button", { name: "Redo", exact: true });
    await expect(redo).toBeDisabled();
    expect(await cursorOf(redo)).not.toBe("pointer");
    expect(await cursorOf(await block(page, BLOCK_ID))).toBe("grab");
  });
});
