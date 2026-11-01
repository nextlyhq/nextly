/**
 * The add gallery in a browser (dashboard-experience R-19, R-20, R-23): Over time added for a
 * collection from its add step, three cards added in one visit, each tile drawn by its widget's
 * own view from its declared preview, and an axe scan of the open gallery in both themes.
 *
 * jsdom draws no layout and runs no real query, so the component tests can say what each control
 * does but not that a card lands on the dashboard, ringed and in view, with the settings chosen.
 *
 * Each test returns the reader to the default dashboard when it ends, so a test that fails half
 * way leaves the next spec the dashboard a new site has.
 *
 * @module tests/dashboard-gallery.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin, type Theme } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { resetToDefault } from "./support/dashboard-layout";

// Shares the dashboard with other specs; see support/locks.ts.
test.describe.configure({ lock: [LOCK.dashboard] });

const CELLS = '[data-testid^="widget-cell-"]';

/** The playground's collection of pages, which Over time is added for. */
const PAGES = { slug: "block-pages", label: "Block Pages" } as const;

interface LayoutRead {
  version: number;
  scope: string;
  placements: Array<{
    widgetId: string;
    w: number;
    removed?: boolean;
    config?: Record<string, unknown>;
  }>;
}

test.afterEach(async ({ page }) => {
  await resetToDefault(page);
});

const bar = (page: Page) =>
  page.getByRole("group", { name: "Customize your dashboard" });

/** The dashboard in customise mode, its gallery open, focus in its search. */
async function openGallery(page: Page, theme: Theme = "light") {
  await gotoAdmin(page, "/", theme);
  await expect(
    page.locator(CELLS).filter({ visible: true }).first()
  ).toBeVisible();
  await page.getByTestId("dashboard-edit-begin").click();
  await bar(page).getByRole("button", { name: "Add widget" }).click();
  const panel = page.getByRole("dialog", { name: "Add widget" });
  await expect(
    panel.getByRole("searchbox", { name: "Search widgets or collections" })
  ).toBeFocused();
  await expect(panel.getByTestId("add-panel-tiles")).toBeVisible();
  return panel;
}

/** Focus is still inside the panel. */
async function expectFocusIn(panel: Locator): Promise<void> {
  expect(
    await panel.evaluate(node => node.contains(document.activeElement))
  ).toBe(true);
}

test("adds Over time for a collection from its add step, with the period and width chosen", async ({
  page,
}) => {
  const panel = await openGallery(page);
  const before = await page.locator(CELLS).count();

  await panel.getByRole("button", { name: "Add Over time" }).click();
  const step = panel.getByTestId("add-panel-step");
  await expect(
    step.getByRole("heading", { name: "Add “Over time”" })
  ).toBeFocused();
  await step
    .getByRole("combobox", { name: "Collection" })
    .selectOption({ label: PAGES.label });
  // Each chip as a reader presses it, then its radio is the one checked.
  await step.getByTestId("add-panel-period").getByText("Last 90 days").click();
  await expect(step.getByRole("radio", { name: "Last 90 days" })).toBeChecked();
  await step.getByTestId("add-panel-width").getByText("Full").click();
  await expect(
    step.getByRole("radio", { name: "Full width, 12 columns" })
  ).toBeChecked();
  // The card previewed as it will be added, with the collection's own data.
  await expect(step.getByTestId("settings-preview")).toBeVisible();
  await step.getByRole("button", { name: "Add to dashboard" }).click();

  // Back in the gallery, still open, focus on the tile it came from.
  await expect(step).toBeHidden();
  await expect(panel.getByRole("button", { name: /Over time$/ })).toBeFocused();
  await expect(page.locator(CELLS)).toHaveCount(before + 1);
  await expect(panel.getByTestId("add-panel-live")).toHaveText(
    new RegExp(`^Added ${PAGES.label}.*\\.$`)
  );
  // Last in the order, ringed, and brought into view.
  const added = page.locator(CELLS).last();
  await expect(added).toHaveAttribute(
    "data-testid",
    "widget-cell-core/over-time"
  );
  await expect(added).toHaveAttribute("data-highlighted", /.*/);
  await expect(added).toBeInViewport();

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await page.getByTestId("dashboard-edit-save").click();
  await expect(bar(page)).toBeHidden();
  const saved = (await (
    await page.request.get("/admin/api/dashboard/layout")
  ).json()) as LayoutRead;
  const card = saved.placements.at(-1);
  expect(card).toMatchObject({
    widgetId: "core/over-time",
    w: 12,
    config: { collection: PAGES.slug, dateRange: "90d" },
  });
});

test("adds three cards in one visit, each said and ringed, the panel open throughout", async ({
  page,
}) => {
  const panel = await openGallery(page);
  const before = await page.locator(CELLS).count();
  const live = panel.getByTestId("add-panel-live");
  const ringed = page.locator(`${CELLS}[data-highlighted]`);

  // A widget that reads no collection is added on choosing it, and again.
  await panel.getByRole("button", { name: "Add Note" }).click();
  await expect(page.locator(CELLS)).toHaveCount(before + 1);
  await expect(live).toHaveText(/^Added Note\.$/);
  await expect(ringed).toHaveCount(1);
  await expectFocusIn(panel);

  await panel.getByRole("button", { name: "Add another Note" }).click();
  await expect(page.locator(CELLS)).toHaveCount(before + 2);
  await expect(ringed).toHaveCount(1);
  await expectFocusIn(panel);

  // A collection's label lists its pairs, each added with that collection chosen.
  const search = panel.getByRole("searchbox", {
    name: "Search widgets or collections",
  });
  await search.fill("posts");
  await expect(panel.getByTestId("add-panel-count")).toHaveText(
    /results? for “posts”/
  );
  await panel.getByRole("button", { name: "Add Count · Posts" }).click();
  await expect(page.locator(CELLS)).toHaveCount(before + 3);
  await expect(live).toHaveText(/^Added Posts.*\.$/);
  await expect(panel).toBeVisible();
  await expectFocusIn(panel);
  await expect(page.locator(CELLS).last()).toHaveAttribute(
    "data-testid",
    "widget-cell-core/count"
  );

  // Closing lands on the last card added, in view.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(ringed).toBeInViewport();
});

test("draws each tile with its widget's own view from the preview it declares", async ({
  page,
}) => {
  const panel = await openGallery(page);
  const tile = (id: string) =>
    panel.getByTestId(`add-panel-tile-${id}`).getByTestId("tile-preview");
  // Core's add-only widgets, each from its sample case.
  await expect(tile("core/count")).toContainText("128");
  await expect(tile("core/breakdown")).toContainText("Published");
  await expect(tile("core/note")).toContainText("This week:");
  await expect(tile("core/over-time").locator("svg").first()).toBeVisible();
  // A widget that declares no case is drawn as its sketch.
  await expect(
    tile("core/recent-entries").getByTestId("tile-sketch")
  ).toBeVisible();
});

test("says when nothing matches, and Clear brings the gallery back", async ({
  page,
}) => {
  const panel = await openGallery(page);
  const search = panel.getByRole("searchbox", {
    name: "Search widgets or collections",
  });
  await search.fill("zzzz");
  await expect(panel.getByTestId("add-panel-none")).toContainText(
    "No widgets match “zzzz”"
  );
  await panel.getByRole("button", { name: "Clear" }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(panel.getByTestId("add-panel-tiles")).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`the open gallery and its add step have no AA violations (${theme})`, async ({
    page,
  }) => {
    const panel = await openGallery(page, theme);
    await expectNoAxeViolations(page, {
      include: '[data-testid="add-widget-panel"]',
    });
    await panel.getByRole("button", { name: "Add Over time" }).click();
    await expect(panel.getByTestId("add-panel-step")).toBeVisible();
    await expectNoAxeViolations(page, {
      include: '[data-testid="add-widget-panel"]',
    });
  });
}
