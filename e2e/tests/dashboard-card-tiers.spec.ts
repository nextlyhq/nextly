/**
 * A dashboard card lays itself out by its OWN width: small below 340 px, medium to 699 px,
 * large from 700 px, whatever the window is.
 *
 * Drawn with a Recent entries card set to Posts at every width it allows (a third to the full
 * width), and a Count card set to Posts at the quarter width Recent entries does not, on a
 * 1,200 px and a 900 px dashboard and in a 358 px phone column, and at the transitions the
 * bands create: a half card on 680 and 720 px dashboards, and the single column at 330 and
 * 350 px. The dashboard's width is the container's, not the window's, so the window is sized
 * until the container measures what each case names.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

/** A list card, the one the table case draws: Recent entries, set to Posts. */
const RECENT_ENTRIES = "core/recent-entries";
/** A card that allows a quarter, which Recent entries does not: Count, set to Posts. */
const COUNT = "core/count";
type Width = "quarter" | "third" | "half" | "twoThirds" | "full";

/** The card each width is drawn with: Count at a quarter, Recent entries otherwise. */
function cardFor(width: Width): string {
  return width === "quarter" ? COUNT : RECENT_ENTRIES;
}

interface Layout {
  version: number;
  scope: string;
  /** Every widget this reader may see, by id: the layout write accepts any of them. */
  widgets: Record<string, unknown>;
  placements: Array<{
    id: string;
    widgetId: string;
    width: string;
    removed?: boolean;
    config?: Record<string, unknown>;
  }>;
}

/**
 * Put `widgetId`'s card, set to Posts, at `width` in the saved layout: neither is on the default
 * dashboard, so a fresh install places it here, and one already placed is moved to the width.
 */
async function placeCard(
  page: Page,
  widgetId: string,
  width: Width
): Promise<void> {
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
          ? { ...placement, width, removed: false }
          : placement
      )
    : [
        ...layout.placements,
        {
          id: `e2e-${widgetId.replace("/", "-")}`,
          widgetId,
          width,
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

const CASES: Array<[number, Width, string]> = [
  [1200, "quarter", "small"],
  [1200, "third", "medium"],
  [1200, "half", "medium"],
  [1200, "twoThirds", "large"],
  [1200, "full", "large"],
  [900, "quarter", "medium"],
  [900, "third", "medium"],
  [900, "half", "medium"],
  [900, "twoThirds", "large"],
  [900, "full", "large"],
  [358, "quarter", "medium"],
  [358, "half", "medium"],
  [358, "full", "medium"],
];

for (const [dashboardWidth, width, tier] of CASES) {
  test(`a ${width} card on a ${dashboardWidth}px dashboard is ${tier}`, async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    await placeCard(page, cardFor(width), width);
    await page.reload();
    await expectTierAt(page, cardFor(width), dashboardWidth, tier);
  });
}

test("a full card on a 900px dashboard draws its rows as a table", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await placeCard(page, RECENT_ENTRIES, "full");
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
  await placeCard(page, RECENT_ENTRIES, "half");
  await page.reload();
  await expectTierAt(page, RECENT_ENTRIES, 680, "small");
  await expectTierAt(page, RECENT_ENTRIES, 720, "medium");

  await placeCard(page, RECENT_ENTRIES, "full");
  await page.reload();
  await expectTierAt(page, RECENT_ENTRIES, 330, "small");
  await expectTierAt(page, RECENT_ENTRIES, 350, "medium");
});

/**
 * The generated card core once drew for posts' recent entries. A layout saved before Recent
 * entries replaced it can still hold it, at a quarter, and a read converts it to Recent entries
 * set to posts, keeping the width. The layout write refuses a NEW Recent entries card at a
 * quarter, so a converted card is the only quarter one there is.
 */
const GENERATED_RECENT_POSTS = "collection/posts-recent";

// Recent entries allows a third to the full row (RECENT_ENTRIES_WIDTHS), so a converted card
// saved at a quarter is drawn at the nearest width it allows: a third, which on a 1,200 px
// dashboard is medium. The quarter cases above use Count, which allows a quarter.
test("a converted quarter card on a 1200px dashboard is drawn at a third, and is medium", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const read = await page.request.get("/admin/api/dashboard/layout");
  const layout = (await read.json()) as Layout;
  if (!(GENERATED_RECENT_POSTS in layout.widgets))
    throw new Error(`${GENERATED_RECENT_POSTS} is not visible to this reader`);
  const placements = [
    ...layout.placements.filter(
      placement =>
        placement.widgetId !== RECENT_ENTRIES &&
        placement.widgetId !== GENERATED_RECENT_POSTS
    ),
    {
      id: "e2e-generated-recent-posts",
      widgetId: GENERATED_RECENT_POSTS,
      width: "quarter",
      removed: false,
    },
  ];
  const write = await page.request.put("/admin/api/dashboard/layout", {
    data: { placements, version: layout.version, scope: layout.scope },
  });
  expect(write.ok()).toBe(true);
  await page.reload();

  await expectTierAt(page, RECENT_ENTRIES, 1200, "medium");
  // A third is four of the grid's twelve tracks at this width, and a quarter three.
  const span = await cellOf(page, RECENT_ENTRIES).evaluate(
    element => getComputedStyle(element).gridColumnEnd
  );
  expect(span).toBe("span 4");
});
