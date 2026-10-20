/**
 * A dashboard chart's values reached in a real browser: by pointer, by keyboard and by a screen
 * reader's live region, with axe over the charts themselves.
 *
 * Drawn with the generated "Posts by status" and "Posts over time" cards, over posts this file
 * creates. The pointer cases are here rather than in the component tests because jsdom's pointer
 * events carry no related target, so React reads every move as leaving: whether a tooltip STAYS
 * while the pointer moves onto it (WCAG 2.2 1.4.13) can only be seen in a browser.
 */
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";

import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { createEntry, expectOk } from "./support/runtime-collection";

const BREAKDOWN = "collection/posts-breakdown";
const TIMELINE = "collection/posts-timeline";
const ENTRIES = "/admin/api/collections/posts/entries";
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// This run's own slugs, so a rerun on the same database writes posts of its own.
const RUN = Date.now().toString(36);
const created: string[] = [];

interface Layout {
  version: number;
  scope: string;
  available: string[];
  placements: Array<{
    id: string;
    widgetId: string;
    width: string;
    removed?: boolean;
  }>;
}

async function signedIn(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string | undefined
): Promise<APIRequestContext> {
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  return playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
}

test.beforeAll(async ({ playwright }, testInfo) => {
  const api = await signedIn(playwright, testInfo.project.use.baseURL);
  try {
    // Two drafts and a published post, so the breakdown draws at least two bars.
    for (const [index, status] of ["draft", "draft", "published"].entries()) {
      created.push(
        await createEntry(api, "posts", {
          title: `Chart reach ${RUN} ${index}`,
          slug: `chart-reach-${RUN}-${index}`,
          status,
        })
      );
    }
  } finally {
    await api.dispose();
  }
});

test.afterAll(async ({ playwright }, testInfo) => {
  const api = await signedIn(playwright, testInfo.project.use.baseURL);
  try {
    for (const id of created) {
      await expectOk(await api.delete(`${ENTRIES}/${id}`), "deleting a post");
    }
  } finally {
    await api.dispose();
  }
});

/** Place both chart cards, full width, at the top of the saved layout. */
async function placeCharts(page: Page): Promise<void> {
  const read = await page.request.get("/admin/api/dashboard/layout");
  const layout = (await read.json()) as Layout;
  for (const id of [BREAKDOWN, TIMELINE]) {
    const placed = layout.placements.some(p => p.widgetId === id);
    if (!placed && !layout.available.includes(id))
      throw new Error(`the generated ${id} card cannot be added`);
  }
  const others = layout.placements.filter(
    p => p.widgetId !== BREAKDOWN && p.widgetId !== TIMELINE
  );
  const placements = [
    { id: "e2e-breakdown", widgetId: BREAKDOWN, width: "full", removed: false },
    { id: "e2e-timeline", widgetId: TIMELINE, width: "full", removed: false },
    ...others,
  ];
  const write = await page.request.put("/admin/api/dashboard/layout", {
    data: { placements, version: layout.version, scope: layout.scope },
  });
  expect(write.ok()).toBe(true);
}

test.afterEach(async ({ page }) => {
  const read = await page.request.get("/admin/api/dashboard/layout");
  const body = (await read.json()) as Layout;
  if (body.version === 0) return;
  await page.request.delete(
    `/admin/api/dashboard/layout?version=${body.version}&scope=${encodeURIComponent(body.scope)}`
  );
});

const cell = (page: Page, id: string) => page.getByTestId(`widget-cell-${id}`);
const chartIn = (page: Page, id: string) =>
  cell(page, id).getByRole("group", { name: /Use the arrow keys/ });
const tooltipIn = (page: Page, id: string) =>
  cell(page, id).getByTestId("chart-tooltip");

async function openDashboard(page: Page, theme: "light" | "dark" = "light") {
  await placeCharts(page);
  await gotoAdmin(page, "/", theme);
  await expect(
    cell(page, BREAKDOWN).getByTestId("chart-group").first()
  ).toBeVisible();
}

test("a hovered bar's tooltip stays while the pointer moves onto it, and goes when it leaves", async ({
  page,
}) => {
  await openDashboard(page);
  const bar = cell(page, BREAKDOWN).getByTestId("chart-group").first();
  await bar.hover();
  const tip = tooltipIn(page, BREAKDOWN);
  await expect(tip).toBeVisible();

  // Onto the tooltip itself: it is still shown, so it can be read and reached.
  const box = await tip.boundingBox();
  if (!box) throw new Error("the tooltip has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(tip).toBeVisible();

  // Escape dismisses it without moving the pointer or focus.
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);

  // Hovering again shows it; leaving the chart hides it.
  await bar.hover();
  await expect(tip).toBeVisible();
  await page.getByRole("heading", { level: 1 }).hover();
  await expect(tip).toHaveCount(0);
});

test("the keyboard reaches each bar from one tab stop, and the live region reads it", async ({
  page,
}) => {
  await openDashboard(page);
  const chart = chartIn(page, BREAKDOWN);
  await chart.focus();
  await expect(chart).toBeFocused();
  const live = cell(page, BREAKDOWN).getByTestId("chart-live");
  const first = await live.textContent();
  expect(first).toMatch(/^.+: \d[\d,]*\.$/);
  await expect(tooltipIn(page, BREAKDOWN)).toBeVisible();

  await page.keyboard.press("ArrowDown");
  await expect(live).not.toHaveText(first ?? "");
  await page.keyboard.press("Home");
  await expect(live).toHaveText(first ?? "");

  // One tab stop: the next Tab leaves the chart rather than stepping through its bars.
  await page.keyboard.press("Tab");
  await expect(chart).not.toBeFocused();
  await expect(chart.locator(":focus")).toHaveCount(0);
});

test("the keyboard starts a chart over time at its latest point", async ({
  page,
}) => {
  await openDashboard(page);
  const chart = chartIn(page, TIMELINE);
  await chart.focus();
  const live = cell(page, TIMELINE).getByTestId("chart-live");
  await expect(live).toHaveText(/^.+: (\d[\d,]*|no value)\.$/);
  await expect(tooltipIn(page, TIMELINE)).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`the charts pass axe's AA rules with a tooltip open, ${theme}`, async ({
    page,
  }) => {
    await openDashboard(page, theme);
    await chartIn(page, BREAKDOWN).focus();
    await expect(tooltipIn(page, BREAKDOWN)).toBeVisible();
    const results = await new AxeBuilder({ page })
      .include(`[data-testid="widget-cell-${BREAKDOWN}"]`)
      .include(`[data-testid="widget-cell-${TIMELINE}"]`)
      .withTags(AA_TAGS)
      .analyze();
    // A scan of nothing reports no violations too; passing rules show it looked at the charts.
    expect(results.passes.length, "axe scanned nothing").toBeGreaterThan(5);
    expect(
      results.violations.map(v => ({
        id: v.id,
        targets: v.nodes.map(node => node.target.join(" ")),
      }))
    ).toEqual([]);
  });
}
