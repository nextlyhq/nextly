/**
 * A plugin's widgets drawn by their own components, in a browser: a card built
 * only from `@nextlyhq/plugin-sdk/admin`'s widget kit draws its figure and
 * chart inside the frame, in light and dark, and passes axe; a card whose
 * component throws while it draws shows its own error with Retry, and only
 * that card.
 *
 * A card whose widget hides when its data is empty leaves the dashboard at
 * rest and comes back, marked, in customise mode. Every card, plugin or core,
 * wears the same header.
 *
 * All are the playground's widget-kit fixture, placed by the test through the
 * layout, since a declared widget is never on the default dashboard.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin, type Theme } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

const API = "/admin/api";
const KIT = "widget-kit-fixture/kit";
const THROWS = "widget-kit-fixture/throws";
const HIDES = "widget-kit-fixture/hides-when-empty";
const FIXTURES = [KIT, THROWS, HIDES];

interface Layout {
  version: number;
  scope: string;
  placements: Array<{ widgetId: string }>;
}

/** Put the fixture cards first on the reader's dashboard. */
async function placeFixtures(page: Page): Promise<void> {
  const layout = await ok<Layout>(
    await page.request.get(`${API}/dashboard/layout`)
  );
  const others = layout.placements.filter(p => !FIXTURES.includes(p.widgetId));
  await ok(
    await page.request.put(`${API}/dashboard/layout`, {
      data: {
        placements: [
          { id: "e2e-kit", widgetId: KIT, width: "half", removed: false },
          { id: "e2e-throws", widgetId: THROWS, width: "half", removed: false },
          { id: "e2e-hides", widgetId: HIDES, width: "half", removed: false },
          ...others,
        ],
        version: layout.version,
        scope: layout.scope,
      },
    })
  );
}

test("a card that throws while it draws shows its own error, and only that card", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await placeFixtures(page);
  await gotoAdmin(page, "/");

  const throwing = page.getByTestId(`widget-cell-${THROWS}`);
  await expect(throwing.getByTestId("widget-card-error")).toBeVisible();
  await expect(
    throwing.getByRole("button", { name: "Retry Test fixture: throwing card" })
  ).toBeVisible();
  // The plugin boundary's generic message is not what the card shows.
  await expect(
    page.getByText("This plugin component failed to load")
  ).toHaveCount(0);
  // The card beside it draws as if nothing happened.
  await expect(page.getByTestId("kit-card")).toBeVisible();
});

for (const theme of ["light", "dark"] as Theme[]) {
  test(`a card built only from the widget kit draws in the frame and passes axe (${theme})`, async ({
    page,
  }) => {
    await gotoAdmin(page, "/", theme);
    await placeFixtures(page);
    await gotoAdmin(page, "/", theme);

    const kit = page.getByTestId(`widget-cell-${KIT}`);
    // Inside the frame: the card's title is the declaration's.
    await expect(kit.getByText("Test fixture: widget kit")).toBeVisible();
    const body = kit.getByTestId("kit-card");
    await expect(body).toBeVisible();
    // Handed its size: a half-width card at desktop width is medium.
    await expect(body).toHaveAttribute("data-size", "medium");
    await expect(body.getByTestId("chart-group")).toHaveCount(2);
    await expectNoAxeViolations(page, {
      include: `[data-testid="widget-cell-${KIT}"]`,
    });
  });
}

test("a card that hides when empty leaves the dashboard at rest, and is shown marked while customising", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await placeFixtures(page);
  await gotoAdmin(page, "/");

  // The card beside it draws, so the dashboard has answered.
  await expect(page.getByTestId("kit-card")).toBeVisible();
  const hides = page.getByTestId(`widget-cell-${HIDES}`);
  // Its answer is empty: it is on the page, marked, and takes no room. Found by
  // its role attribute, since a role query skips what is hidden.
  await expect(hides.locator('[role="region"]')).toHaveAttribute(
    "data-hidden-empty",
    ""
  );
  await expect(hides).toBeHidden();

  const begin = page.getByTestId("dashboard-edit-begin");
  await begin.focus();
  await page.keyboard.press("Enter");
  await expect(hides).toBeVisible();
  await expect(hides.getByTestId("hidden-while-empty")).toHaveText(
    "Hidden while empty"
  );
});

test("a plugin card and a core card wear the same header", async ({ page }) => {
  await gotoAdmin(page, "/");
  await placeFixtures(page);
  await gotoAdmin(page, "/");

  await expect(page.getByTestId("kit-card")).toBeVisible();
  const plugin = page
    .getByTestId(`widget-cell-${KIT}`)
    .getByTestId("widget-card-header");
  const core = page
    .locator('[data-testid^="widget-cell-core/"]')
    .getByTestId("widget-card-header")
    .first();
  await expect(core).toBeVisible();
  const [pluginBox, coreBox] = await Promise.all([
    plugin.boundingBox(),
    core.boundingBox(),
  ]);
  // One fixed height, whatever the card and whoever declared it.
  expect(pluginBox?.height).toBe(40);
  expect(coreBox?.height).toBe(40);
  // And no card says when its data arrived (a row's own time is the row's).
  await expect(
    page.locator('[data-testid^="widget-cell-"]').getByText(/^Updated /)
  ).toHaveCount(0);
});
