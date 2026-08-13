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
