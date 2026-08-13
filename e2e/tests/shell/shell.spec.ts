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
import {
  MIN_CANVAS_WIDTH,
  MIN_SHELL_WIDTH,
  PANEL_BOUNDS,
  RAIL_WIDTH,
} from "@nextlyhq/builder/shell-state";
import { expect, test } from "@playwright/test";

import { createShellDriver } from "./driver";

/**
 * The bounds come from the package, not from a second copy of the numbers.
 *
 * Restating them here made this file agree with the shell on the day it was
 * written and never afterwards: widening a panel's maximum in `shell-state.ts`
 * would leave these assertions passing against the OLD bound, so the one test
 * that measures a real browser would go on certifying a layout the component no
 * longer produces.
 */
const LEFT_BOUNDS = PANEL_BOUNDS.left;
const INSPECTOR_BOUNDS = PANEL_BOUNDS.inspector;

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

  test("both stylesheets actually loaded", async ({ page }) => {
    // The control for every measurement above, and not redundant with them: a
    // shell whose CSS never shipped still renders its markup, still carries its
    // class names, and lays out as a stack of full-width blocks. Regions would
    // have boxes; they would simply be the wrong ones.
    //
    // Read as a PAINTED colour rather than as the custom property. Asking for
    // `--nx-builder-surface` returns the declared token stream — the literal
    // text `var(--nx-muted)` — which is a non-empty string whether or not
    // `--nx-muted` is defined anywhere. That assertion passed while the harness
    // was loading no design-system stylesheet at all, certifying the one thing
    // it existed to rule out. `background-color` is resolved by the browser, so
    // it can only be a real colour once the whole chain is present.
    const shell = createShellDriver(page);
    await shell.goto();

    const painted = await page.evaluate(() => {
      const chrome = document.querySelector(".nx-builder-chrome");
      if (chrome === null) return null;
      const styles = getComputedStyle(chrome);
      return {
        background: styles.backgroundColor,
        // Proves the editor's own sheet is present too: this class is emitted
        // only by the builder's stylesheet, so the two halves of the contract
        // are checked separately rather than inferred from one another.
        display: styles.display,
      };
    });

    expect(painted).not.toBeNull();
    // An unresolvable `var()` computes to the initial value — transparent —
    // which is exactly what a missing design system produces.
    expect(painted?.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(painted?.background).not.toBe("transparent");
    expect(painted?.display).toBe("flex");
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

  test("restores a width dragged with no panel open", async ({ page }) => {
    // The DEFAULT state, and the one the test above cannot speak for.
    //
    // Opening a panel first changes the group's topology, which re-registers
    // every panel — and registration is the only moment `react-resizable-panels`
    // reads `defaultLayout`. So that test would pass even with restoration
    // entirely broken, because the click, not the restore, is what applied the
    // stored value. Here nothing changes the panel set, so the only thing that
    // can put the width back is restoration itself.
    const shell = createShellDriver(page);
    await shell.goto();
    expect(await shell.panelIsOpen()).toBe(false);

    const before = await shell.widthOf("inspector");
    await shell.dragSeparator(0, -80);
    const dragged = await shell.widthOf("inspector");
    // Without this the reload assertion compares a width to itself and passes
    // whether or not anything was ever persisted.
    expect(Math.abs(dragged - before)).toBeGreaterThan(20);

    await page.reload();
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .waitFor({ state: "visible" });

    expect(await shell.panelIsOpen()).toBe(false);
    expect(await shell.widthOf("inspector")).toBeCloseTo(dragged, -1);
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
