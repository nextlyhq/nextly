/**
 * A dashboard card lays itself out by its OWN width: small below 340 px, medium to 699 px,
 * large from 700 px, whatever the window is.
 *
 * Drawn with a Recent entries card set to Posts at 4, 6, 8 and 12 columns, and a Count card set
 * to Posts at the 3 columns Recent entries does not allow, on a 1,200 px and a 900 px dashboard
 * and in a 358 px phone column, and at the transitions the bands and gaps create: a 6-column card
 * on 680 and 720 px dashboards, a 3-column card on 1,420 and 1,440 px, where the gap across is
 * 24 px, and the single column at 330 and 350 px. The dashboard's width is the container's, not
 * the window's, so the window is sized until the container measures what each case names.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { sizeBoundsOf } from "./support/dashboard-sizes";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

/** A list card, the one the table case draws: Recent entries, set to Posts. */
const RECENT_ENTRIES = "core/recent-entries";
/** A card that allows 3 columns, which Recent entries does not: Count, set to Posts. */
const COUNT = "core/count";

/** The card each width is drawn with: Count at 3 columns, Recent entries otherwise. */
function cardFor(w: number): string {
  return w === 3 ? COUNT : RECENT_ENTRIES;
}

interface Layout {
  version: number;
  scope: string;
  /** Every widget this reader may see, by id: the layout write accepts any of them. */
  widgets: Record<string, unknown>;
  placements: Array<{
    id: string;
    widgetId: string;
    w: number;
    h: number;
    removed?: boolean;
    config?: Record<string, unknown>;
  }>;
}

/**
 * Put `widgetId`'s card, set to Posts, `w` columns wide at its default height in the saved
 * layout: neither is on the default dashboard, so a fresh install places it here, and one already
 * placed is moved to the size.
 */
async function placeCard(
  page: Page,
  widgetId: string,
  w: number
): Promise<void> {
  const bounds = await sizeBoundsOf(page, widgetId);
  // The write holds a changed size to the widget's bounds; a case outside them says so here.
  expect(w).toBeGreaterThanOrEqual(bounds.min.w);
  expect(w).toBeLessThanOrEqual(bounds.max.w);
  const h = bounds.default.h;
  const read = await page.request.get("/admin/api/dashboard/layout");
  const layout = (await read.json()) as Layout;
  const placed = layout.placements.some(
    placement => placement.widgetId === widgetId
  );
  if (!placed && !(widgetId in layout.widgets))
    throw new Error(`${widgetId} is not visible to this reader`);
  const placements = placed
    ? layout.placements.map(placement =>
        placement.widgetId === widgetId
          ? { ...placement, w, h, removed: false }
          : placement
      )
    : [
        ...layout.placements,
        {
          id: `e2e-${widgetId.replace("/", "-")}`,
          widgetId,
          w,
          h,
          removed: false,
          config: { collection: "posts" },
        },
      ];
  const write = await page.request.put("/admin/api/dashboard/layout", {
    data: { placements, version: layout.version, scope: layout.scope },
  });
  expect(write.ok()).toBe(true);
}

/** A card's cell, which the grid names by the widget it draws. */
function cellOf(page: Page, widgetId: string) {
  return page.getByTestId(`widget-cell-${widgetId}`);
}

/** Size the window until the dashboard's own container is `target` pixels wide. */
async function sizeDashboard(page: Page, target: number): Promise<void> {
  let viewport = target + 300;
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.setViewportSize({ width: viewport, height: 900 });
    const width = await page
      .getByTestId("dashboard-container")
      .evaluate(element => element.getBoundingClientRect().width);
    if (Math.abs(width - target) < 1) return;
    viewport += Math.round(target - width);
  }
  throw new Error(`the dashboard did not reach ${target}px`);
}

/**
 * Size the dashboard and wait for the card to reach `tier`. Waited for rather than read: the card
 * already has its previous tier when the resize lands, and its observer may not have fired yet.
 */
async function expectTierAt(
  page: Page,
  widgetId: string,
  dashboardWidth: number,
  tier: string
) {
  await sizeDashboard(page, dashboardWidth);
  const card = cellOf(page, widgetId).locator("[data-tier]").first();
  await expect(card).toHaveAttribute("data-tier", tier);
  // Nothing in the card is wider than the card: it wraps rather than overflowing its cell.
  const overflow = await card.evaluate(
    element => element.scrollWidth - element.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.afterEach(async ({ page }) => {
  const read = await page.request.get("/admin/api/dashboard/layout");
  const body = (await read.json()) as Layout;
  if (body.version === 0) return;
  await page.request.delete(
    `/admin/api/dashboard/layout?version=${body.version}&scope=${encodeURIComponent(body.scope)}`
  );
});

const CASES: Array<[number, number, string]> = [
  [1200, 3, "small"],
  [1200, 4, "medium"],
  [1200, 6, "medium"],
  [1200, 8, "large"],
  [1200, 12, "large"],
  [900, 3, "medium"],
  [900, 4, "medium"],
  [900, 6, "medium"],
  [900, 8, "large"],
  [900, 12, "large"],
  [358, 3, "medium"],
  [358, 6, "medium"],
  [358, 12, "medium"],
];

for (const [dashboardWidth, w, tier] of CASES) {
  test(`a ${w}-column card on a ${dashboardWidth}px dashboard is ${tier}`, async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    await placeCard(page, cardFor(w), w);
    await page.reload();
    await expectTierAt(page, cardFor(w), dashboardWidth, tier);
  });
}

test("a 12-column card on a 900px dashboard draws its rows as a table", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await placeCard(page, RECENT_ENTRIES, 12);
  await page.reload();
  await sizeDashboard(page, 900);
  await expect(
    cellOf(page, RECENT_ENTRIES).getByTestId("widget-table")
  ).toBeVisible();
});

test("crosses from small to medium where the bands put the edge", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await placeCard(page, RECENT_ENTRIES, 6);
  await page.reload();
  await expectTierAt(page, RECENT_ENTRIES, 680, "small");
  await expectTierAt(page, RECENT_ENTRIES, 720, "medium");

  // From 1,280 px the gap across is 24 px: a 3-column card is 337 px on 1,420 px, where a
  // 16 px gap would make it 343 px and medium.
  await placeCard(page, COUNT, 3);
  await page.reload();
  await expectTierAt(page, COUNT, 1420, "small");
  await expectTierAt(page, COUNT, 1440, "medium");

  await placeCard(page, RECENT_ENTRIES, 12);
  await page.reload();
  await expectTierAt(page, RECENT_ENTRIES, 330, "small");
  await expectTierAt(page, RECENT_ENTRIES, 350, "medium");
});
