/**
 * A dashboard card lays itself out by its OWN width: small below 340 px, medium to 699 px,
 * large from 700 px, whatever the window is.
 *
 * Drawn with the generated "Recent posts" list card at every width on a 1,200 px and a 900 px
 * dashboard and in a 358 px phone column, and at the transitions the bands create: a half card
 * on 680 and 720 px dashboards, and the single column at 330 and 350 px. The dashboard's width
 * is the container's, not the window's, so the window is sized until the container measures
 * what each case names.
 */
import { expect, test, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

const RECENT_POSTS = "collection/posts-recent";
type Width = "quarter" | "third" | "half" | "twoThirds" | "full";

interface Layout {
  version: number;
  scope: string;
  /** Widget ids this reader may add: a generated collection card is offered, not placed. */
  available: string[];
  placements: Array<{
    id: string;
    widgetId: string;
    width: string;
    removed?: boolean;
  }>;
}

/** Put the Recent posts card at `width` in the saved layout. */
async function placeRecentPosts(page: Page, width: Width): Promise<void> {
  const read = await page.request.get("/admin/api/dashboard/layout");
  const layout = (await read.json()) as Layout;
  const placed = layout.placements.some(
    placement => placement.widgetId === RECENT_POSTS
  );
  // A generated collection card is not on the default dashboard, only offered to add, so a
  // fresh install places it here; one already placed is moved to the width.
  if (!placed && !layout.available.includes(RECENT_POSTS))
    throw new Error("the generated Recent posts card cannot be added");
  const placements = placed
    ? layout.placements.map(placement =>
        placement.widgetId === RECENT_POSTS
          ? { ...placement, width, removed: false }
          : placement
      )
    : [
        ...layout.placements,
        {
          id: "e2e-recent-posts",
          widgetId: RECENT_POSTS,
          width,
          removed: false,
        },
      ];
  const write = await page.request.put("/admin/api/dashboard/layout", {
    data: { placements, version: layout.version, scope: layout.scope },
  });
  expect(write.ok()).toBe(true);
}

/** The Recent posts card's cell, which the grid names by the widget it draws. */
function recentPostsCell(page: Page) {
  return page.getByTestId(`widget-cell-${RECENT_POSTS}`);
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

async function tierAt(page: Page, dashboardWidth: number) {
  await sizeDashboard(page, dashboardWidth);
  const card = recentPostsCell(page).locator("[data-tier]").first();
  await expect(card).toHaveAttribute("data-tier", /small|medium|large/);
  // Nothing in the card is wider than the card: it wraps rather than overflowing its cell.
  const overflow = await card.evaluate(
    element => element.scrollWidth - element.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
  return card.getAttribute("data-tier");
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
    await placeRecentPosts(page, width);
    await page.reload();
    expect(await tierAt(page, dashboardWidth)).toBe(tier);
  });
}

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
  expect(await tierAt(page, 680)).toBe("small");
  expect(await tierAt(page, 720)).toBe("medium");

  await placeRecentPosts(page, "full");
  await page.reload();
  expect(await tierAt(page, 330)).toBe("small");
  expect(await tierAt(page, 350)).toBe("medium");
});
