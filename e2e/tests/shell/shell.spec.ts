/**
 * The shell's layout, measured in a real browser.
 *
 * These are the guarantees the unit suite CANNOT make. jsdom reports every
 * element as zero-sized and applies no stylesheet, so `packages/builder`'s
 * component tests can decide which panel is open and what the rail announces,
 * and can say nothing about whether anything is where it belongs. Every
 * assertion here reads a measured box.
 *
 * That split is deliberate rather than incidental: a component test asserting
 * "the panel is 300px" in jsdom passes whatever the CSS does, including when
 * the stylesheet failed to ship at all — which was a real defect in this
 * package's first build.
 */
import { expect, test } from "@playwright/test";

import { createShellDriver } from "./driver";

const MIN_SHELL_WIDTH = 1280;
const MIN_CANVAS_WIDTH = 480;
const RAIL_WIDTH = 48;
const LEFT_BOUNDS = { min: 240, max: 480 };
const INSPECTOR_BOUNDS = { min: 280, max: 520 };

test.describe("the shell's regions", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("lays out rail, canvas and inspector at their declared sizes", async ({
    page,
  }) => {
    const shell = createShellDriver(page);
    await shell.goto();

    // The rail is fixed. Measured rather than read from a style attribute: an
    // unstyled page still carries the attribute.
    expect(await shell.widthOf("rail")).toBeCloseTo(RAIL_WIDTH, 0);

    const inspector = await shell.widthOf("inspector");
    expect(inspector).toBeGreaterThanOrEqual(INSPECTOR_BOUNDS.min);
    expect(inspector).toBeLessThanOrEqual(INSPECTOR_BOUNDS.max);

    // The canvas holds its floor with no panel open.
    expect(await shell.widthOf("canvas")).toBeGreaterThanOrEqual(
      MIN_CANVAS_WIDTH
    );
  });

  test("keeps the canvas above its floor once a panel is open", async ({
    page,
  }) => {
    // The joint constraint, which is the whole reason per-panel bounds were the
    // wrong model: both panels at their individual maximums would leave the
    // canvas narrower than either of them.
    const shell = createShellDriver(page);
    await shell.goto();

    await shell.railItem("Layers").click();
    expect(await shell.panelIsOpen()).toBe(true);

    const panel = await shell.widthOf("panel");
    expect(panel).toBeGreaterThanOrEqual(LEFT_BOUNDS.min);
    expect(panel).toBeLessThanOrEqual(LEFT_BOUNDS.max);
    expect(await shell.widthOf("canvas")).toBeGreaterThanOrEqual(
      MIN_CANVAS_WIDTH
    );
  });

  test("the stylesheet actually loaded", async ({ page }) => {
    // The control for every measurement above, and not redundant with them: a
    // shell whose CSS never shipped still renders its markup, still carries its
    // class names, and lays out as a stack of full-width blocks. Regions would
    // have boxes; they would simply be the wrong ones. This asserts the chrome
    // token resolved, which only happens if the stylesheet arrived.
    const shell = createShellDriver(page);
    await shell.goto();

    const surface = await page.evaluate(() => {
      const chrome = document.querySelector(".nx-builder-chrome");
      if (chrome === null) return null;
      return getComputedStyle(chrome)
        .getPropertyValue("--nx-builder-surface")
        .trim();
    });
    expect(surface).not.toBeNull();
    expect(surface).not.toBe("");
  });
});

test.describe("panel widths survive a reload", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("restores a dragged width", async ({ page }) => {
    // The property the preference port exists for. Persisted PROPORTIONALLY, so
    // the restored width is compared with a tolerance rather than by equality:
    // the layout is stored as percentages and re-resolved against the viewport.
    const shell = createShellDriver(page);
    await shell.goto();
    await shell.railItem("Layers").click();

    const before = await shell.widthOf("panel");
    await shell.dragSeparator(0, 80);
    const dragged = await shell.widthOf("panel");
    // The drag has to have moved something, or the reload assertion below is
    // comparing a width to itself and passes without persisting anything.
    expect(Math.abs(dragged - before)).toBeGreaterThan(20);

    // A reload, NOT a second navigation, and deliberately in the SAME test.
    // Each test gets a fresh context seeded from the sign-in snapshot captured
    // once by `global-setup`, so `localStorage` does not carry between tests —
    // split across two tests, the second would start clean and pass or fail for
    // a reason that has nothing to do with persistence.
    await page.reload();
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .waitFor({ state: "visible" });

    expect(await shell.panelIsOpen()).toBe(true);
    expect(await shell.widthOf("panel")).toBeCloseTo(dragged, -1);
  });
});

test.describe("keyboard region cycling", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("F6 moves between the regions that exist", async ({ page }) => {
    const shell = createShellDriver(page);
    await shell.goto();

    await shell.railItem("Layers").click();
    await page.getByRole("navigation", { name: "Editor panels" }).focus();

    await page.keyboard.press("F6");
    expect(await shell.focusedRegion()).toBe("Layers");

    await page.keyboard.press("F6");
    expect(await shell.focusedRegion()).toBe("Canvas");

    await page.keyboard.press("F6");
    expect(await shell.focusedRegion()).toBe("Inspector");
  });

  test("F6 skips the panel when nothing is open", async ({ page }) => {
    // The absent-region case. Cycling a static list would stop here, focusing
    // nothing, and the key would look broken from the second press on.
    const shell = createShellDriver(page);
    await shell.goto();
    expect(await shell.panelIsOpen()).toBe(false);

    await page.getByRole("navigation", { name: "Editor panels" }).focus();
    await page.keyboard.press("F6");

    expect(await shell.focusedRegion()).toBe("Canvas");
  });
});

test.describe("a viewport below the supported width", () => {
  // Explicitly 100px inside the degraded range, never the default. The
  // `Desktop Chrome` device viewport is exactly 1280x720 — precisely the
  // breakpoint — which is the one width where a `min-width: 1280px` rule and
  // its complement disagree about which applies, so the default would assert
  // against the boundary itself rather than against the behaviour.
  test.use({ viewport: { width: MIN_SHELL_WIDTH - 100, height: 900 } });

  test("says where to edit instead of compressing", async ({ page }) => {
    const shell = createShellDriver(page);
    await page.goto("/builder-shell");

    await expect(page.getByText(/needs a wider screen/i)).toBeVisible();
    await expect(page.getByRole("main", { name: "Canvas" })).toHaveCount(0);
    // The way out has to survive every degraded state.
    await expect(
      page.getByRole("button", { name: "Exit editor" })
    ).toBeVisible();
    void shell;
  });
});
