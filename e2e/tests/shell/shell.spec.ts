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

import {
  assertShellReady,
  createShellDriver,
  isUnpainted,
  measureShellRender,
} from "./driver";

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
    // class names, and lays out as a stack of full-width blocks.
    //
    // Derived from the SAME measurement `goto()` takes, rather than reading the
    // element again. Two readers of one element drift, and this one would drift
    // silently because `goto()` runs first — its verdict decides whether this
    // test evaluates at all.
    const shell = createShellDriver(page);
    await shell.goto();

    const measurement = await measureShellRender(page);

    expect(measurement.present).toBe(true);
    // A painted colour, never the custom property: asking for
    // `--nx-builder-surface` returns the declared token stream — the literal
    // text `var(--nx-muted)` — which is non-empty whether or not anything
    // defines it. That assertion passed while the harness loaded no
    // design-system stylesheet at all.
    expect(isUnpainted(measurement)).toBe(false);
    // Emitted only by this package's stylesheet, so the two halves of the
    // contract are checked separately rather than inferred from one another.
    expect(measurement.display).toBe("flex");
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
    // The SAME readiness implementation the first navigation uses. A second,
    // raw `waitFor` here would mean a page that fails to render only AFTER a
    // reload still reports the generic timeout this change exists to replace.
    await assertShellReady(page);

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
    // The SAME readiness implementation the first navigation uses. A second,
    // raw `waitFor` here would mean a page that fails to render only AFTER a
    // reload still reports the generic timeout this change exists to replace.
    await assertShellReady(page);

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
    await expect(page.getByRole("region", { name: "Canvas" })).toHaveCount(0);
    // The way out has to survive every degraded state.
    await expect(
      page.getByRole("button", { name: "Exit editor" })
    ).toBeVisible();
    void shell;
  });
});

test.describe("the readiness diagnostic itself", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("names an unrendered page instead of reporting a missing box", async ({
    page,
  }) => {
    // THE POSITIVE CONTROL for the diagnostic added alongside it.
    //
    // On a healthy run the shell always appears, so the diagnostic branch never
    // executes — which would leave an ordering mistake, an unreachable probe or
    // a diagnostic that throws for the wrong reason invisible until a real
    // outage, the one moment nobody can afford to debug the instrument. This
    // drives that branch against a page under the test's control.
    await page.setContent("<html><body></body></html>");

    await expect(assertShellReady(page)).rejects.toThrow(
      /shell is not in the DOM/
    );
  });

  test("does not claim a boot failure it cannot observe", async ({ page }) => {
    // The message must describe what was seen and stop there. An empty body is
    // produced by a route-level exception, a hydration failure and a server that
    // never booted alike, and Playwright's own `webServer.url` gate has already
    // proven the server answers — so naming boot as the cause would send the
    // reader past the actual fault.
    await page.setContent("<html><body></body></html>");

    const error = await assertShellReady(page).catch(
      (thrown: unknown) => thrown
    );

    expect(String(error)).toContain("does NOT by itself mean");
    expect(String(error)).not.toMatch(/the server failed to boot\b(?!:)/);
  });

  test("preserves a failure that is not an absence", async ({ page }) => {
    // A rail that IS present but never visible is a real shell defect with a
    // real Playwright error. Replacing it with "the application did not come up"
    // would discard the cause in favour of a guess.
    await page.setContent(
      `<html><body><nav aria-label="Editor panels" style="display:none"></nav>
       <div class="nx-builder-chrome"></div></body></html>`
    );

    // Asserted as a REJECTION first. Checking only that the message lacks a
    // string passes when the promise RESOLVES — `error` is then `undefined`
    // and `String(undefined)` contains nothing — so the weaker form would
    // certify a readiness check that had silently stopped failing at all.
    const error = await assertShellReady(page).then(
      () => null,
      (thrown: unknown) => thrown
    );

    expect(error).not.toBeNull();
    // Playwright's OWN timeout, not ours: the rail is present, so the absence
    // path must not have run and the original failure must survive intact.
    expect(String(error)).toMatch(/Timeout|exceeded/i);
    expect(String(error)).not.toContain("not in the DOM");
  });
});

test.describe("the unpainted predicate", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // Driven through a REAL browser, because the thing under test is how a
  // browser serializes a computed colour — which is precisely what a
  // hand-written string case cannot speak for. The previous version asserted
  // against literals invented in Node, and would have gone on passing while the
  // predicate was blind to every modern colour function.
  const chromeWith = (background: string) =>
    `<html><body><div class="nx-builder-chrome"
       style="background-color:${background};width:100px;height:100px"></div></body></html>`;

  test("sees a zero-alpha MODERN colour as unpainted", async ({ page }) => {
    // `oklch` is not incidental: this repository authors its tokens in it —
    // `packages/ui/src/styles/theme.css` carries 121 `oklch` declarations — so
    // a chrome whose token chain resolves to a transparent `oklch` is the
    // realistic shape of the failure, not a synthetic one.
    await page.setContent(chromeWith("oklch(0.7 0.1 200 / 0)"));

    const measurement = await measureShellRender(page);

    expect(measurement.present).toBe(true);
    expect(isUnpainted(measurement)).toBe(true);
  });

  test("sees a zero-alpha colour from a SECOND modern function", async ({
    page,
  }) => {
    // `oklch` alone would leave the predicate looking like it recognises one
    // function rather than one alpha SEPARATOR. `color()` serializes the same
    // way and shares no function name with it, so passing both is what
    // separates "handles the slash form" from "handles oklch".
    await page.setContent(chromeWith("color(srgb 1 0 0 / 0)"));

    const measurement = await measureShellRender(page);

    // The fixture has to REACH the mechanism. A browser that rejected this
    // declaration would leave the initial background — `rgba(0, 0, 0, 0)` —
    // which is also unpainted, so the verdict below would be identical while
    // no `color()` value was ever parsed. Asserting the serialization survived
    // is what separates the two.
    expect(measurement.background).toContain("color(");
    expect(isUnpainted(measurement)).toBe(true);
  });

  test("reads a MISSING alpha as transparent, not as absent", async ({
    page,
  }) => {
    // `none` is a valid alpha and it draws nothing: outside interpolation a
    // missing component behaves as zero, and this composites over white to
    // `rgb(255, 255, 255)` exactly as `/ 0` does. It is the case a
    // numbers-only pattern silently reclassifies, because an unmatched alpha
    // is indistinguishable from a colour that carries no alpha at all.
    await page.setContent(chromeWith("oklch(0.7 0.1 200 / none)"));

    const measurement = await measureShellRender(page);

    // Same reasoning as above: without this the test passes on a browser that
    // dropped the declaration entirely.
    expect(measurement.background).toContain("none");
    expect(measurement.backgroundAlpha).toBe(0);
    expect(isUnpainted(measurement)).toBe(true);
  });

  test("sees a zero-alpha non-black legacy colour as unpainted", async ({
    page,
  }) => {
    // The case the two-spelling comparison got wrong.
    await page.setContent(chromeWith("rgba(255, 0, 0, 0)"));

    expect(isUnpainted(await measureShellRender(page))).toBe(true);
  });

  test("counts a barely-visible colour as painted", async ({ page }) => {
    // Something IS drawn. A readiness check that rejected this would fail on a
    // legitimately near-transparent chrome, which is a false diagnosis in the
    // opposite direction.
    await page.setContent(chromeWith("rgba(255, 0, 0, 0.01)"));

    expect(isUnpainted(await measureShellRender(page))).toBe(false);
  });

  test("counts an opaque modern colour as painted", async ({ page }) => {
    await page.setContent(chromeWith("oklch(0.7 0.1 200)"));

    const measurement = await measureShellRender(page);

    // The positive control for the two above: if the browser could not parse
    // the colour at all, `backgroundAlpha` would be null and every case here
    // would report "painted" for the wrong reason.
    expect(measurement.backgroundAlpha).toBe(1);
    expect(isUnpainted(measurement)).toBe(false);
  });
});
