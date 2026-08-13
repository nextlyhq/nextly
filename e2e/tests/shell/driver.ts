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

/**
 * Fail with the CAUSE when the application did not come up, before any
 * assertion gets the chance to report a symptom instead.
 *
 * Every geometric check in this file reads a measured box, which is what makes
 * them honest — but it also means a page that never styled produces "the
 * inspector region has no layout box", which reads exactly like a layout
 * regression in the shell. That has now cost two other lanes an afternoon each:
 * their diffs could not reach `packages/builder`, the web server had logged
 * `TypeError: The database connection is not open`, and three assertions
 * observing ONE broken page were read as three independent regressions.
 *
 * Three unrelated regressions in a single run is implausible; one page that
 * failed to render, seen three times, is not. This check encodes that reading
 * so the next person does not have to arrive at it.
 *
 * Deliberately placed in `goto`, not in `widthOf`: by the time a width is being
 * measured the test is already asking a question that presupposes a working
 * page, and the answer to a presupposition failure belongs before the question.
 */
async function assertAppRendered(page: Page): Promise<void> {
  const chrome = page.locator(".nx-builder-chrome").first();
  const box = await chrome.boundingBox();
  if (box === null || box.width === 0 || box.height === 0) {
    throw new Error(
      `The editor shell mounted but has no layout box, so the APPLICATION did ` +
        `not render — this is not a layout regression in the shell.\n` +
        `Check the web-server log first. Known causes, all outside any PR's ` +
        `diff: the playground's database failing to open ` +
        `("TypeError: The database connection is not open"), and ` +
        `\`next/font/google\` fetching at BUILD time from fonts.googleapis.com, ` +
        `which fails a blocked or slow network while naming an internal ` +
        `turbopack module.`
    );
  }

  // Painted, not merely boxed. A `var()` chain that cannot resolve computes to
  // transparent, which is what a missing design-system stylesheet produces —
  // and that renders a full-size, correctly-structured, entirely unstyled page
  // whose region widths are all wrong for a reason no shell change caused.
  const background = await chrome.evaluate(
    element => getComputedStyle(element).backgroundColor
  );
  if (background === "rgba(0, 0, 0, 0)" || background === "transparent") {
    throw new Error(
      `The editor shell rendered but its chrome resolved to no colour, so a ` +
        `STYLESHEET is missing rather than a layout being wrong. The shell's ` +
        `own sheet supplements the design system's: the harness must import ` +
        `"@nextlyhq/ui/styles.css" alongside "@nextlyhq/builder/styles.css".`
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
      await page
        .getByRole("navigation", { name: REGION_NAMES.rail })
        .waitFor({ state: "visible" });
      await assertAppRendered(page);
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
