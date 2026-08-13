/**
 * Reading the editor shell's geometry from a real browser.
 *
 * SEPARATE from `tests/canvas/driver.ts` on purpose. That one models a canvas —
 * drag mechanics, frame origin, zoom — and exists so a canvas implementation can
 * be swapped without editing its specs. Teaching it about rails and inspectors
 * would give it two reasons to change and break that swap. This models the
 * shell around the canvas, and the two share nothing but the page.
 *
 * Every reader here returns a MEASURED number rather than a class name or a
 * style attribute. A shell whose CSS never loaded still carries its classes, and
 * a test asserting on them passes over an unstyled page — which is the exact
 * failure the unit tests already cannot see and this file exists to catch.
 *
 * @module tests/shell/driver
 */
import type { Locator, Page } from "@playwright/test";

/** Where the harness mounts the shell. */
export const SHELL_PATH = "/builder-shell";

/** The regions the shell lays out, by their accessible names. */
export const REGION_NAMES = {
  rail: "Editor panels",
  panel: null,
  canvas: "Canvas",
  inspector: "Inspector",
} as const;

export interface ShellDriver {
  goto: () => Promise<void>;
  /** A rail button by its label. */
  railItem: (label: string) => Locator;
  /** The measured width of a region, in CSS pixels. */
  widthOf: (
    region: "rail" | "panel" | "canvas" | "inspector"
  ) => Promise<number>;
  /** Whether the left panel is rendered at all. */
  panelIsOpen: () => Promise<boolean>;
  /** The accessible name of the region currently holding focus, if any. */
  focusedRegion: () => Promise<string | null>;
  /** Drag a separator by a pixel delta along the horizontal axis. */
  dragSeparator: (index: number, deltaX: number) => Promise<void>;
}

/**
 * Locates a region by role and name.
 *
 * The left panel is found by its OPEN panel's name rather than a fixed one,
 * because the shell names that region after whatever the rail selected — which
 * is the behaviour a screen-reader user depends on and therefore worth reading
 * the same way.
 */
function regionLocator(page: Page, region: keyof typeof REGION_NAMES): Locator {
  switch (region) {
    case "rail":
      return page.getByRole("navigation", { name: REGION_NAMES.rail });
    case "canvas":
      return page.getByRole("main", { name: REGION_NAMES.canvas });
    case "inspector":
      return page.getByRole("complementary", { name: REGION_NAMES.inspector });
    case "panel":
      return page.getByTestId("panel-slot");
  }
}

/** How long the shell is given to appear before the page is diagnosed instead. */
const SHELL_READY_TIMEOUT_MS = 15_000;

/** The chrome root, named once so every reader of it agrees on the selector. */
const CHROME_SELECTOR = ".nx-builder-chrome";

/**
 * Everything one look at the chrome can tell us.
 *
 * ONE measurement, because two readers of the same element drift: the readiness
 * check and the stylesheet test both need the box, the painted background and
 * the layout mode, and a second implementation of "what does the chrome look
 * like" agrees on the day it is written and not afterwards. Both derive their
 * verdicts from this rather than each asking the DOM again.
 */
export interface ShellRenderMeasurement {
  /** Whether the chrome is in the DOM at all, however it looks. */
  present: boolean;
  /** Null when absent, or when it is present with no layout box. */
  box: { width: number; height: number } | null;
  /** The RESOLVED background, never the custom property behind it. */
  background: string | null;
  /** The resolved `display`, which only this package's stylesheet sets. */
  display: string | null;
  /**
   * The alpha of the browser's own computed background, or null when there is
   * no colour to read. Read from the alpha SEPARATOR, so it does not depend on
   * which colour function the browser chose to serialize into.
   */
  backgroundAlpha: number | null;
}

/** Read the chrome once, for every reader that needs to know how it looks. */
export async function measureShellRender(
  page: Page
): Promise<ShellRenderMeasurement> {
  const chrome = page.locator(CHROME_SELECTOR).first();
  if ((await chrome.count()) === 0) {
    return {
      present: false,
      box: null,
      background: null,
      display: null,
      backgroundAlpha: null,
    };
  }
  const box = await chrome.boundingBox();
  const styles = await chrome.evaluate(element => {
    const computed = getComputedStyle(element);
    const background = computed.backgroundColor;
    // `getComputedStyle` returns a colour the browser has ALREADY serialized,
    // and CSS gives that serialization exactly two places to put an alpha:
    //
    //   legacy   rgba(r, g, b, A)       — a fourth comma-separated value
    //   modern   oklch(l c h / A)       — a value after a slash
    //            color(srgb r g b / A)
    //
    // So the alpha is read from the SEPARATOR rather than from the colour
    // function's name. Enumerating names is what fails here: this repository
    // authors its tokens in `oklch`, Chromium preserves that function in the
    // computed value, and a matcher that knows only `rgba(...)` reads a fully
    // transparent chrome as "unrecognised" and therefore, fatally, as painted.
    //
    // A colour carrying neither separator is opaque. `alpha` stays null only
    // when there is no colour to read at all, which callers treat as unknown.
    //
    // `none` is an alpha too, and a transparent one. A modern colour may carry
    // a MISSING component, which Chromium preserves through the computed value
    // as the keyword — `oklch(0.7 0.1 200 / none)`. Outside interpolation a
    // missing component behaves as zero, and it draws nothing: composited over
    // white it measures `rgb(255, 255, 255)`, identical to `/ 0`. A
    // numbers-only pattern leaves it unmatched, which this function would
    // otherwise read as "no alpha present" and therefore as fully opaque.
    const parseAlpha = (colour: string): number | null => {
      const raw =
        /\/\s*(none|[\d.]+%?)\s*\)\s*$/.exec(colour)?.[1] ??
        /^rgba\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([\d.]+%?)\s*\)$/.exec(
          colour
        )?.[1];
      if (raw === undefined) return 1;
      if (raw === "none") return 0;
      return raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
    };
    const alpha = background === "" ? null : parseAlpha(background);
    return { background, display: computed.display, alpha };
  });
  return {
    present: true,
    box: box === null ? null : { width: box.width, height: box.height },
    background: styles.background,
    display: styles.display,
    backgroundAlpha: styles.alpha,
  };
}

/**
 * A chrome that draws nothing, whatever colour it nominally is.
 *
 * Takes the MEASUREMENT rather than a colour string, so the decision is made
 * from a value the browser resolved. Two earlier versions instead asked how the
 * colour was SPELT — first comparing literal strings, then matching legacy
 * `rgba(...)` — and this repository's `oklch` tokens are exactly the case that
 * breaks both.
 *
 * An UNKNOWN alpha is treated as painted on purpose: the readiness check exists
 * to explain a broken page, and reporting "the chrome drew nothing" because a
 * colour could not be parsed would invent the very false diagnosis this file was
 * written to remove. A missing background is still absence.
 */
export function isUnpainted(measurement: ShellRenderMeasurement): boolean {
  const { background, backgroundAlpha } = measurement;
  if (background === null || background.trim() === "") return true;
  if (background.trim() === "transparent") return true;
  return backgroundAlpha === 0;
}

/**
 * Wait for the shell, and explain the page when it does not arrive.
 *
 * Exported separately from navigation so a test can drive this branch against a
 * page it controls. Without that, the diagnostic path runs only during a real
 * outage — the one moment nobody is placed to discover the diagnostic is itself
 * wrong.
 */
export async function assertShellReady(page: Page): Promise<void> {
  try {
    await page
      .getByRole("navigation", { name: REGION_NAMES.rail })
      .waitFor({ state: "visible", timeout: SHELL_READY_TIMEOUT_MS });
  } catch (error) {
    // Only an ABSENCE is evidence that the page did not render the shell. A
    // strict-mode violation (two matching rails), a rail hidden by CSS, and a
    // closed page all reject here too — each a real failure with a real cause
    // that must not be overwritten by a guess about booting.
    const measurement = await measureShellRender(page).catch(() => null);
    if (measurement === null || measurement.present) throw error;
    await diagnoseUnrenderedPage(page);
  }

  assertPainted(await measureShellRender(page));
}

/** Report a page with no shell in it, without naming a cause it cannot see. */
async function diagnoseUnrenderedPage(page: Page): Promise<never> {
  const bodyText = (
    await page
      .locator("body")
      .innerText()
      .catch(() => "")
  ).slice(0, 300);
  throw new Error(
    `The editor shell is not in the DOM, so the page did not render it — ` +
      `this is not a layout regression in the shell.\n` +
      `URL: ${page.url()}\n` +
      `Body text (first 300 chars): ${bodyText || "<empty>"}\n` +
      `An empty body does NOT by itself mean the server failed to boot: a ` +
      `route-level exception, a hydration failure, and an intentionally empty ` +
      `response all look identical from here. Read the web-server log and the ` +
      `response status before choosing between them.`
  );
}

/** Turn one measurement into the readiness verdict. */
function assertPainted(measurement: ShellRenderMeasurement): void {
  const { present, box } = measurement;
  // Absence FIRST. The rail can render while the chrome root is removed or
  // renamed, and then `box` is null for a reason that has nothing to do with
  // styles — reading it as "present but unstyled" sends a markup regression
  // down the CSS investigation path, which is the failure this file exists to
  // stop rather than commit.
  if (!present) {
    throw new Error(
      `The rail rendered but no element matches "${CHROME_SELECTOR}", so the ` +
        `shell's ROOT is missing or renamed — a markup change, not a styling ` +
        `one. Every geometric check here is addressed from that element.`
    );
  }
  if (box === null || box.width === 0 || box.height === 0) {
    throw new Error(
      `The editor shell is in the DOM but has no layout box, so the page ` +
        `rendered without usable styles rather than the shell laying out ` +
        `wrongly. Check that the document loaded both stylesheets before ` +
        `reading this as a shell defect.`
    );
  }
  if (isUnpainted(measurement)) {
    // Deliberately NEUTRAL about which sheet is at fault: an unresolvable
    // `var()` chain and a chrome rule that lost its `background-color` compute
    // to the same value, so naming one states a cause this cannot separate.
    throw new Error(
      `The editor shell rendered but its chrome resolved to no colour, so the ` +
        `style chain is broken between the design system's tokens and this ` +
        `package's rules. Either a required stylesheet is absent ` +
        `("@nextlyhq/ui/styles.css" alongside "@nextlyhq/builder/styles.css") ` +
        `or the chrome's own declaration regressed. The "both stylesheets ` +
        `actually loaded" test separates those two.`
    );
  }
}

export function createShellDriver(page: Page): ShellDriver {
  return {
    async goto() {
      await page.goto(SHELL_PATH);
      // Waits for the shell rather than for the network: the shell restores
      // preferences in an effect after mount, so a test that measured on
      // `load` would read the defaults and call them the restored values.
      await assertShellReady(page);
    },

    railItem(label) {
      return page.getByRole("button", { name: label, exact: true });
    },

    async widthOf(region) {
      const box = await regionLocator(page, region).boundingBox();
      if (box === null) {
        throw new Error(
          `The ${region} region has no layout box. A region that is present in ` +
            `the DOM but has no box is the unstyled-page failure this driver ` +
            `measures rather than reads classes to avoid.`
        );
      }
      return box.width;
    },

    async panelIsOpen() {
      return (await page.getByTestId("panel-slot").count()) > 0;
    },

    async focusedRegion() {
      return page.evaluate(() => {
        const active = document.activeElement;
        if (active === null) return null;
        // The nearest ancestor carrying an accessible name that the shell set.
        const region = active.closest<HTMLElement>("[aria-label]");
        return region?.getAttribute("aria-label") ?? null;
      });
    },

    async dragSeparator(index, deltaX) {
      const separator = page.getByRole("separator").nth(index);
      const box = await separator.boundingBox();
      if (box === null)
        throw new Error(`Separator ${index} has no layout box.`);

      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      // Moved in steps rather than teleported. A splitter that tracks pointer
      // MOTION behaves differently under a single jump, and motion is what a
      // person produces.
      await page.mouse.move(startX + deltaX, startY, { steps: 10 });
      await page.mouse.up();
    },
  };
}
