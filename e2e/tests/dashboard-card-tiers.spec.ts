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
  placements: Array<{
    id: string;
    widgetId: string;
    width: string;
    removed?: boolean;
  }>;
}

/** Put the Recent posts card at `width` in the saved layout, and answer its placement id. */
async function placeRecentPosts(page: Page, width: Width): Promise<string> {
  const read = await page.request.get("/admin/api/dashboard/layout");
  const layout = (await read.json()) as Layout;
  const card = layout.placements.find(
    placement => placement.widgetId === RECENT_POSTS
  );
  if (!card)
    throw new Error("the generated Recent posts card is not on the dashboard");
  const placements = layout.placements.map(placement =>
    placement.widgetId === RECENT_POSTS
      ? { ...placement, width, removed: false }
      : placement
  );
  const write = await page.request.put("/admin/api/dashboard/layout", {
    data: { placements, version: layout.version, scope: layout.scope },
  });
  expect(write.ok()).toBe(true);
  return card.id;
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

async function tierAt(page: Page, placementId: string, dashboardWidth: number) {
  await sizeDashboard(page, dashboardWidth);
  const card = page
    .getByTestId(`widget-cell-${placementId}`)
    .locator("[data-tier]")
    .first();
  await expect(card).toHaveAttribute("data-tier", /small|medium|large/);
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
    await gotoAdmin(page, "/admin");
    const placementId = await placeRecentPosts(page, width);
    await page.reload();
    expect(await tierAt(page, placementId, dashboardWidth)).toBe(tier);
  });
}

test("a full card on a 900px dashboard draws its rows as a table", async ({
  page,
}) => {
  await gotoAdmin(page, "/admin");
  const placementId = await placeRecentPosts(page, "full");
  await page.reload();
  await sizeDashboard(page, 900);
  await expect(
    page.getByTestId(`widget-cell-${placementId}`).getByTestId("widget-table")
  ).toBeVisible();
});

test("crosses from small to medium where the bands put the edge", async ({
  page,
}) => {
  await gotoAdmin(page, "/admin");
  const half = await placeRecentPosts(page, "half");
  await page.reload();
  expect(await tierAt(page, half, 680)).toBe("small");
  expect(await tierAt(page, half, 720)).toBe("medium");

  const full = await placeRecentPosts(page, "full");
  await page.reload();
  expect(await tierAt(page, full, 330)).toBe("small");
  expect(await tierAt(page, full, 350)).toBe("medium");
});
