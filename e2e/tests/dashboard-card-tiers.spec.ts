/**
 * A dashboard card lays itself out by its OWN width: small below 340 px, medium to 699 px,
 * large from 700 px, whatever the window is.
 *
 * Drawn with a Recent entries card set to posts at every width on a 1,200 px and a 900 px
 * dashboard and in a 358 px phone column, and at the transitions the bands create: a half card
 * on 680 and 720 px dashboards, and the single column at 330 and 350 px. The dashboard's width
 * is the container's, not the window's, so the window is sized until the container measures
 * what each case names.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

const RECENT_ENTRIES = "core/recent-entries";
/**
 * The generated card core once drew for posts' recent entries. The layout write refuses a new
 * Recent entries card at a width the widget does not allow, so a quarter card can only be one
 * saved before it: this card, which a read converts to Recent entries set to posts, keeping its
 * width.
 */
const GENERATED_RECENT_POSTS = "collection/posts-recent";
type Width = "quarter" | "third" | "half" | "twoThirds" | "full";

interface Layout {
  version: number;
  scope: string;
  /** Every widget this reader may see, by id. */
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
 * Put one Recent entries card, set to posts, at `width` in the saved layout: at a quarter, as the
 * generated card it converts from. Recent entries is never on the default dashboard, and any
 * other card of it is left off, so its cell is this one.
 */
async function placeRecentPosts(page: Page, width: Width): Promise<void> {
  const read = await page.request.get("/admin/api/dashboard/layout");
  const layout = (await read.json()) as Layout;
  const card =
    width === "quarter"
      ? { widgetId: GENERATED_RECENT_POSTS }
      : { widgetId: RECENT_ENTRIES, config: { collection: "posts" } };
  if (!(card.widgetId in layout.widgets))
    throw new Error(
      `the ${card.widgetId} widget is not visible to this reader`
    );
  const placements = [
    ...layout.placements.filter(
      placement =>
        placement.widgetId !== RECENT_ENTRIES &&
        placement.widgetId !== GENERATED_RECENT_POSTS
    ),
    { id: "e2e-recent-posts", width, removed: false, ...card },
  ];
  const write = await page.request.put("/admin/api/dashboard/layout", {
    data: { placements, version: layout.version, scope: layout.scope },
  });
  expect(write.ok()).toBe(true);
}

/** The Recent entries card's cell, which the grid names by the widget it draws. */
function recentPostsCell(page: Page) {
  return page.getByTestId(`widget-cell-${RECENT_ENTRIES}`);
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
async function expectTierAt(page: Page, dashboardWidth: number, tier: string) {
  await sizeDashboard(page, dashboardWidth);
  const card = recentPostsCell(page).locator("[data-tier]").first();
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
    await placeRecentPosts(page, width);
    await page.reload();
    await expectTierAt(page, dashboardWidth, tier);
  });
}

// Recent entries allows a third to the full row (RECENT_ENTRIES_WIDTHS), so a card saved at a
// quarter is drawn at the nearest width it allows. On a 1,200 px dashboard that is a third, which
// is medium, not the small a quarter there would be; the small tier is the 680 px crossing below.
test("a quarter card on a 1200px dashboard is drawn at a third, and is medium", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await placeRecentPosts(page, "quarter");
  await page.reload();
  await expectTierAt(page, 1200, "medium");
  // A third is four of the grid's twelve tracks at this width, and a quarter three.
  const span = await recentPostsCell(page).evaluate(
    element => getComputedStyle(element).gridColumnEnd
  );
  expect(span).toBe("span 4");
});

test("a full card on a 900px dashboard draws its rows as a table", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await placeRecentPosts(page, "full");
  await page.reload();
  await sizeDashboard(page, 900);
  await expect(recentPostsCell(page).getByTestId("widget-table")).toBeVisible();
});

test("crosses from small to medium where the bands put the edge", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await placeRecentPosts(page, "half");
  await page.reload();
  await expectTierAt(page, 680, "small");
  await expectTierAt(page, 720, "medium");

  await placeRecentPosts(page, "full");
  await page.reload();
  await expectTierAt(page, 330, "small");
  await expectTierAt(page, 350, "medium");
});
