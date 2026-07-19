/**
 * A plugin's admin UI is actually styled — in a real browser, both themes.
 *
 * The style-fixture plugin (apps/playground/src/plugins/style-fixture) injects a
 * component exercising all three styling layers after the Posts list. Its
 * classes are NOT in the admin's `@source` scan, so if the safelist or its
 * `admin.styles` regressed, the elements would render unstyled (a transparent,
 * un-painted background). Each layer is asserted to resolve a real token
 * background in light and dark:
 *  - Layer 1 (kit primitives): the Card paints a surface.
 *  - Layer 2 (safelist): a `bg-card` utility paints.
 *  - Layer 3 (admin.styles): the plugin's own `.sf-panel` paints.
 */
import { expect, test } from "@playwright/test";

import { gotoAdmin, type Theme } from "./support/admin";

const TRANSPARENT = new Set(["rgba(0, 0, 0, 0)", "transparent"]);

async function backgroundOf(
  page: import("@playwright/test").Page,
  testId: string
): Promise<string> {
  const el = page.getByTestId(testId);
  await expect(el).toBeVisible({ timeout: 30_000 });
  return el.evaluate(node => window.getComputedStyle(node).backgroundColor);
}

for (const theme of ["light", "dark"] as Theme[]) {
  test(`plugin admin UI is styled across all three layers in ${theme} mode`, async ({
    page,
  }) => {
    await gotoAdmin(page, "/collections/posts", theme);

    // Layer 1: the kit Card rendered (component registration + kit styling).
    await expect(page.getByTestId("sf-card")).toBeVisible({ timeout: 30_000 });

    // Layer 2: a safelisted utility (bg-card) actually paints.
    const safelistBg = await backgroundOf(page, "sf-safelist");
    expect(
      TRANSPARENT.has(safelistBg),
      `${theme}: safelisted bg-card did not paint (got ${safelistBg})`
    ).toBe(false);

    // Layer 3: the plugin's own admin.styles class (.sf-panel) paints.
    const adminStylesBg = await backgroundOf(page, "sf-adminstyles");
    expect(
      TRANSPARENT.has(adminStylesBg),
      `${theme}: admin.styles .sf-panel did not paint (got ${adminStylesBg})`
    ).toBe(false);
  });
}
