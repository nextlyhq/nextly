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

/**
 * Explain a page that did not come up, rather than letting a later assertion
 * report a symptom of it.
 *
 * Every geometric check in this file reads a MEASURED box, which is what makes
 * it honest about an unstyled page — and it means a page that never rendered
 * reports "the inspector region has no layout box", which is indistinguishable
 * from a real layout regression in the shell.
 *
 * Called when the shell fails to appear, and again once it has. The two paths
 * are different failures and neither implies the other: a route that never
 * rendered produces no shell at all, while a rendered one can still be missing
 * its styles.
 */
async function diagnoseUnrenderedPage(page: Page): Promise<never> {
  const bodyText = (
    await page
      .locator("body")
      .innerText()
      .catch(() => "")
  ).slice(0, 300);
  const status = page.url();
  throw new Error(
    `The editor shell never appeared, so the APPLICATION did not come up — ` +
      `this is not a layout regression in the shell.\n` +
      `URL: ${status}\n` +
      `Body text (first 300 chars): ${bodyText || "<empty>"}\n` +
      `Check the web-server log before the code. A blank body points at the ` +
      `server failing to boot; an error screen usually names its own cause.`
  );
}

/**
 * Whether the chrome has a real box and a resolved colour.
 *
 * Read as a PAINTED colour rather than as a custom property: asking for
 * `--nx-builder-surface` returns the declared token stream — the literal text
 * `var(--nx-muted)` — which is non-empty whether or not anything defines it.
 * Only the resolved value distinguishes a working style chain from a broken one.
 */
async function assertChromePainted(page: Page): Promise<void> {
  const chrome = page.locator(".nx-builder-chrome").first();
  const box = await chrome.boundingBox();
  if (box === null || box.width === 0 || box.height === 0) {
    throw new Error(
      `The editor shell is in the DOM but has no layout box, so the page ` +
        `rendered without usable styles rather than the shell laying out ` +
        `wrongly. Check that the document loaded both stylesheets before ` +
        `reading this as a shell defect.`
    );
  }

  const background = await chrome.evaluate(
    element => getComputedStyle(element).backgroundColor
  );
  if (background === "rgba(0, 0, 0, 0)" || background === "transparent") {
    // Deliberately NEUTRAL about which stylesheet is at fault. An unresolvable
    // `var()` chain and a chrome rule that lost its `background-color` compute
    // to the same transparent value, so naming one of them would state a cause
    // this check cannot tell apart — and send the reader to the wrong file.
    throw new Error(
      `The editor shell rendered but its chrome resolved to no colour, so the ` +
        `style chain is broken somewhere between the design system's tokens ` +
        `and this package's rules. Either a required stylesheet is absent ` +
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
      // The wait is what DIAGNOSES a failed boot, rather than a precondition
      // for diagnosing one. Waiting first and probing afterwards meant the
      // central case — a route that never rendered — timed out here and never
      // reached the probe, so it still surfaced as a bare locator timeout.
      try {
        await page
          .getByRole("navigation", { name: REGION_NAMES.rail })
          .waitFor({ state: "visible", timeout: SHELL_READY_TIMEOUT_MS });
      } catch {
        await diagnoseUnrenderedPage(page);
      }
      await assertChromePainted(page);
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
