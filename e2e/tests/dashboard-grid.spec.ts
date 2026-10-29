/**
 * The dashboard's grid in a browser: twelve columns of rows 72 px high, each
 * card spanning its `w` columns and `h` rows, reflowed by the dashboard's own
 * width and never the window's, and never resized past its widget's bounds.
 *
 * jsdom has no layout, so the component tests can say which classes and styles
 * a card is drawn with but not the box it ends up in. These measure the drawn
 * page: every card's width and height in each band, recorded on the test as an
 * attachment, the two gaps, the order in the one-column band, and a card asked
 * for a size past its maximum.
 *
 * The dashboard's own route draws the icon rail alone; the secondary panel
 * opens only on the routes that have one. "Sidebar open" is stood in for by
 * narrowing the dashboard's container by the panel's 256 px, which is all an
 * open panel does to it.
 *
 * Each test returns the reader to the default dashboard when it ends.
 *
 * @module tests/dashboard-grid.spec
 */
import { expect, type Locator, type Page, type Route } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin, type Theme } from "./support/admin";
import { cardHeightPx, sizeBoundsOf } from "./support/dashboard-sizes";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

const CELLS = '[data-testid^="widget-cell-"]';

/** The width of the secondary sidebar panel, which an open one takes from the dashboard. */
const PANEL_PX = 256;

interface Placement {
  id: string;
  widgetId: string;
  w: number;
  h: number;
  removed?: boolean;
  config?: Record<string, unknown>;
}

interface Layout {
  version: number;
  scope: string;
  widgets: Record<string, unknown>;
  placements: Placement[];
}

/** One drawn card: its placement, its stored size and its box. */
interface DrawnCard {
  placementId: string;
  widgetId: string;
  w: number;
  h: number;
  left: number;
  top: number;
  width: number;
  height: number;
  overflow: number;
}

async function readLayout(page: Page): Promise<Layout> {
  const read = await page.request.get("/admin/api/dashboard/layout");
  expect(read.ok()).toBe(true);
  return (await read.json()) as Layout;
}

/** Back to the default dashboard, through the guarded reset a reader uses. */
async function resetToDefault(page: Page): Promise<void> {
  const body = await readLayout(page);
  if (body.version === 0) return;
  const reset = await page.request.delete(
    `/admin/api/dashboard/layout?version=${body.version}&scope=${encodeURIComponent(body.scope)}`
  );
  expect(reset.status()).toBe(200);
}

/** Save `placements` as the reader's arrangement; the response, whatever it is. */
async function saveLayout(page: Page, placements: Placement[]) {
  const layout = await readLayout(page);
  return page.request.put("/admin/api/dashboard/layout", {
    data: { placements, version: layout.version, scope: layout.scope },
  });
}

/**
 * The fixture widget whose minimum is the full twelve columns, placed first on the default
 * dashboard: the card the one-column band must still draw without overflowing. A fixture of its
 * own rather than one found among core's widgets, since which of those a reader is shown depends
 * on what earlier specs left behind (the Get started card retires once its steps are done).
 */
const FULL_WIDTH = "widget-kit-fixture/full-width";

async function placeFullMinimumCard(page: Page): Promise<string> {
  const layout = await readLayout(page);
  const chosen = FULL_WIDTH;
  const bounds = await sizeBoundsOf(page, chosen);
  const others = layout.placements.filter(p => p.widgetId !== chosen);
  const write = await saveLayout(page, [
    {
      id: "e2e-full-minimum",
      widgetId: chosen,
      ...bounds.default,
      removed: false,
    },
    ...others,
  ]);
  expect(write.ok()).toBe(true);
  return chosen;
}

/** Narrow the dashboard by an open panel's width, or put it back. */
async function setPanel(page: Page, open: boolean): Promise<void> {
  await page.evaluate(
    ([px, isOpen]) => {
      const container = document.querySelector<HTMLElement>(
        '[data-testid="dashboard-container"]'
      );
      if (container)
        container.style.marginInlineStart = isOpen ? `${px}px` : "";
    },
    [PANEL_PX, open] as const
  );
}

/** The dashboard's own width: the container every span answers to. */
async function areaWidth(page: Page): Promise<number> {
  return page
    .getByTestId("dashboard-container")
    .evaluate(element => element.getBoundingClientRect().width);
}

/**
 * Every drawn card, in DOM order, with the size its placement stores: from `layout` when the
 * caller already holds it, which a test measuring many widths passes so that it reads the layout
 * once rather than once a width, against the server's rate limit.
 */
async function drawnCards(page: Page, held?: Layout): Promise<DrawnCard[]> {
  const layout = held ?? (await readLayout(page));
  const sizes = new Map(layout.placements.map(p => [p.id, p]));
  const boxes = await page.locator(CELLS).evaluateAll(cells =>
    cells.map(cell => {
      const box = cell.getBoundingClientRect();
      return {
        placementId: cell.getAttribute("data-placement-id") ?? "",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        overflow: cell.scrollWidth - cell.clientWidth,
      };
    })
  );
  return boxes
    .filter(box => box.width > 0 && box.height > 0)
    .map(box => {
      const stored = sizes.get(box.placementId);
      if (stored === undefined) {
        throw new Error(`no stored placement ${box.placementId}`);
      }
      return { ...box, widgetId: stored.widgetId, w: stored.w, h: stored.h };
    });
}

/** The columns a card of `w` spans on a dashboard `area` wide, as the bands state them. */
function expectedSpan(w: number, area: number): number {
  if (area < 640) return 12;
  if (area < 1024) return w <= 6 ? 6 : 12;
  return w;
}

/** The gap across the grid on a dashboard `area` wide. */
function expectedColumnGap(area: number): number {
  return area >= 1280 ? 24 : 16;
}

/**
 * Every card is as wide as its band draws its `w` and as tall as its `h`, whatever the band.
 * Recorded on the test for the band it was measured in.
 */
async function expectCardsInBand(
  page: Page,
  label: string,
  layout?: Layout
): Promise<number> {
  const area = await areaWidth(page);
  const cards = await drawnCards(page, layout);
  // More than one card, or "every card" proves nothing.
  expect(cards.length).toBeGreaterThan(1);
  const gap = expectedColumnGap(area);
  const recorded = cards.map(card => {
    const span = expectedSpan(card.w, area);
    return {
      widgetId: card.widgetId,
      w: card.w,
      h: card.h,
      span,
      width: Math.round(card.width * 10) / 10,
      height: Math.round(card.height * 10) / 10,
      expectedWidth: Math.round((((area + gap) * span) / 12 - gap) * 10) / 10,
      expectedHeight: cardHeightPx(card.h),
    };
  });
  await test.info().attach(`cards at ${label} (${Math.round(area)}px)`, {
    body: JSON.stringify({ area, gap, cards: recorded }, null, 2),
    contentType: "application/json",
  });
  for (const card of recorded) {
    expect(card.width, `${card.widgetId} width at ${label}`).toBeCloseTo(
      card.expectedWidth,
      0
    );
    // 🔴 `h` never changes with the band: the same rows at every width.
    expect(card.height, `${card.widgetId} height at ${label}`).toBeCloseTo(
      card.expectedHeight,
      0
    );
  }
  for (const card of cards) {
    expect(
      card.overflow,
      `${card.widgetId} overflow at ${label}`
    ).toBeLessThanOrEqual(1);
  }
  return area;
}

/** Size the window until the dashboard's own container is `target` pixels wide. */
async function sizeDashboard(page: Page, target: number): Promise<void> {
  let viewport = target + 200;
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.setViewportSize({ width: viewport, height: 900 });
    const width = await areaWidth(page);
    if (Math.abs(width - target) < 1) return;
    viewport += Math.round(target - width);
  }
  throw new Error(`the dashboard did not reach ${target}px`);
}

/**
 * The sizes a Width or Height submenu offers, read from each choice's test id (`card-width-6`)
 * rather than its text: a width is named by its share of the row ("½") with its columns beneath,
 * so the text is no number to read.
 */
async function valuesOf(choices: Locator): Promise<number[]> {
  return choices.evaluateAll(items =>
    items.map(item =>
      Number((item.getAttribute("data-testid") ?? "").split("-").pop())
    )
  );
}

async function gridGaps(page: Page): Promise<{ across: string; down: string }> {
  return page
    .getByRole("region", { name: "Dashboard widgets" })
    .evaluate(grid => {
      const style = getComputedStyle(grid);
      return { across: style.columnGap, down: style.rowGap };
    });
}

test.afterEach(async ({ page }) => {
  await resetToDefault(page);
});

const WIDE_CASES = [1024, 1440].flatMap(viewport =>
  [false, true].map(open => ({ viewport, open }))
);

for (const theme of ["light", "dark"] as const satisfies readonly Theme[]) {
  // Every window and panel case on one load: the dashboard reflows by its own width, so a
  // resize needs no reload, and a load a case would spend the session's REST budget of a
  // minute within the spec (each load is some forty requests).
  test(`draws every card at the size its band gives it, at 1024, 1440 and 768px, sidebar closed and open (${theme})`, async ({
    page,
  }) => {
    await gotoAdmin(page, "/", theme);
    await placeFullMinimumCard(page);
    await page.reload();
    await expect(page.locator(CELLS).first()).toBeVisible();
    const layout = await readLayout(page);
    for (const { viewport, open } of [
      ...WIDE_CASES,
      { viewport: 768, open: false },
      { viewport: 768, open: true },
    ]) {
      const label = `${viewport}px, sidebar ${open ? "open" : "closed"}, ${theme}`;
      await test.step(label, async () => {
        await page.setViewportSize({ width: viewport, height: 900 });
        await setPanel(page, open);
        const area = await expectCardsInBand(page, label, layout);
        // The band is the dashboard's, never the window's: an open panel moves the area alone.
        const gaps = await gridGaps(page);
        expect(gaps.across).toBe(`${expectedColumnGap(area)}px`);
        expect(gaps.down).toBe("16px");
      });
    }
  });

  test(`draws one column at 360px in the saved order, a 12-column minimum without overflow (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await gotoAdmin(page, "/", theme);
    const full = await placeFullMinimumCard(page);
    await page.reload();
    await expect(page.locator(CELLS).first()).toBeVisible();
    const area = await expectCardsInBand(page, `360px, ${theme}`);
    expect(area).toBeLessThan(640);

    const cards = await drawnCards(page);
    // One column: every card starts at the same left edge, each below the last, in the order
    // the arrangement saved them.
    const saved = (await readLayout(page)).placements
      .filter(p => !p.removed)
      .map(p => p.id);
    const drawn = cards.map(card => card.placementId);
    expect(drawn).toEqual(saved.filter(id => drawn.includes(id)));
    for (let i = 1; i < cards.length; i++) {
      expect(cards[i].left).toBeCloseTo(cards[0].left, 0);
      expect(cards[i].top).toBeGreaterThan(cards[i - 1].top);
    }
    const wide = cards.find(card => card.widgetId === full);
    expect(wide, "the 12-column minimum card is drawn").toBeDefined();
    expect(wide?.width).toBeCloseTo(area, 0);
    expect(wide?.overflow).toBeLessThanOrEqual(1);
  });
}

test("changes band at the dashboard's own 639/640 and 1,023/1,024 px, and its gap at 1,280 px", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await placeFullMinimumCard(page);
  await page.reload();
  await expect(page.locator(CELLS).first()).toBeVisible();
  // Resizing the window changes no placement, so one read serves every width.
  const layout = await readLayout(page);
  for (const target of [639, 640, 1023, 1024, 1279, 1280]) {
    await sizeDashboard(page, target);
    await expectCardsInBand(page, `a ${target}px dashboard`, layout);
    expect((await gridGaps(page)).across).toBe(
      `${expectedColumnGap(target)}px`
    );
  }
});

test("never resizes a card past its widget's maximum, from the menu or the layout write", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await gotoAdmin(page, "/");
  await expect(page.locator(CELLS).first()).toBeVisible();
  const [first] = await drawnCards(page);
  const bounds = await sizeBoundsOf(page, first.widgetId);
  const cell = page.locator(
    `${CELLS}[data-placement-id="${first.placementId}"]`
  );

  await page.getByTestId("dashboard-edit-begin").click();
  const menuButton = cell.getByRole("button", { name: /^Card actions for / });

  // The widths offered stop at the maximum; choosing the last draws the card at it.
  const widthMenu = page.getByTestId("card-width-menu");
  await menuButton.click();
  if ((await widthMenu.count()) > 0) {
    await widthMenu.focus();
    await page.keyboard.press("ArrowRight");
    const widths = page.getByRole("menuitemradio");
    const offered = await valuesOf(widths);
    expect(Math.max(...offered)).toBe(bounds.max.w);
    expect(Math.min(...offered)).toBe(bounds.min.w);
    await widths.last().focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toHaveCount(0);
  } else {
    // A widget of one width offers no Width at all.
    expect(bounds.min.w).toBe(bounds.max.w);
    await page.keyboard.press("Escape");
  }

  // The heights offered stop at the maximum too.
  await menuButton.click();
  const heightMenu = page.getByTestId("card-height-menu");
  if ((await heightMenu.count()) > 0) {
    await heightMenu.focus();
    await page.keyboard.press("ArrowRight");
    const heights = page.getByRole("menuitemradio");
    const offered = await valuesOf(heights);
    expect(Math.max(...offered)).toBe(bounds.max.h);
    await heights.last().focus();
    await page.keyboard.press("Enter");
  } else {
    expect(bounds.min.h).toBe(bounds.max.h);
    await page.keyboard.press("Escape");
  }
  await expect(page.getByRole("menu")).toHaveCount(0);

  const area = await areaWidth(page);
  const gap = expectedColumnGap(area);
  const box = await cell.boundingBox();
  expect(box?.width).toBeCloseTo(((area + gap) * bounds.max.w) / 12 - gap, 0);
  expect(box?.height).toBeCloseTo(cardHeightPx(bounds.max.h), 0);
  await page.getByRole("button", { name: "Cancel" }).click();

  // 🔴 A size past the maximum written straight to the layout is refused, or drawn at the
  // maximum; either way the card is never drawn past it.
  const layout = await readLayout(page);
  const past = layout.placements.map(p =>
    p.id === first.placementId
      ? { ...p, w: bounds.max.w, h: bounds.max.h + 1 }
      : p
  );
  await saveLayout(page, past);
  await page.reload();
  await expect(cell).toBeVisible();
  const after = await cell.boundingBox();
  expect(after?.height ?? 0).toBeLessThanOrEqual(
    cardHeightPx(bounds.max.h) + 1
  );
  expect(after?.width ?? 0).toBeLessThanOrEqual(
    ((area + gap) * bounds.max.w) / 12 - gap + 1
  );
});

const GET_STARTED = "core/get-started";

/**
 * The layout read passed through with the Get started card first, at `rows()` rows (its widget's
 * default when that gives nothing), holding a collection, an entry, six Singles and an invite:
 * more steps than a compact card holds. Mocked, so the card is drawn whatever earlier specs left
 * behind (it retires once a site's steps are done). `rows` is read on every request, so a test
 * changes the card's height by reloading.
 */
async function placeFullGetStarted(
  page: Page,
  rows: () => number | undefined = () => undefined
): Promise<void> {
  const size = (await sizeBoundsOf(page, GET_STARTED)).default;
  await page.route("**/dashboard/layout", async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    // Aborted rather than thrown when the page has gone: a throw out of the handler fails a test
    // that had passed, and its message prints the request, session cookie included.
    let response: Awaited<ReturnType<Route["fetch"]>>;
    try {
      response = await route.fetch();
    } catch {
      await route.abort().catch(() => {});
      return;
    }
    const body = (await response.json()) as Record<string, unknown>;
    const layout = (Array.isArray(body.placements) ? body : body.data) as {
      placements: Array<Record<string, unknown>>;
      getStarted?: unknown;
    };
    layout.placements = [
      {
        id: "e2e-get-started",
        widgetId: GET_STARTED,
        w: size.w,
        h: rows() ?? size.h,
        removed: false,
      },
      ...layout.placements.filter(p => p.widgetId !== GET_STARTED),
    ];
    const singles = ["a", "b", "c", "d", "e", "f"].map(slug => ({
      key: `single:${slug}`,
      kind: "single",
      single: slug,
      status: "open",
    }));
    const steps = [
      { key: "collection", kind: "collection", status: "done" },
      { key: "entry", kind: "entry", status: "open" },
      ...singles,
      { key: "invite", kind: "invite", status: "open" },
    ];
    layout.getStarted = {
      drawn: true,
      answer: { unknown: false, steps, done: 1, total: steps.length },
    };
    await route.fulfill({ response, json: body });
  });
}

/** The Get started card's cell, once its steps are drawn. */
async function getStartedCell(page: Page): Promise<Locator> {
  const cell = page.getByTestId(`widget-cell-${GET_STARTED}`);
  await expect(cell.getByTestId("get-started-progress")).toBeVisible({
    timeout: 60_000,
  });
  return cell;
}

/** Nothing in the card's body is cut by its edge: no overflow, and every drawn step inside. */
async function expectWholeSteps(cell: Locator, label: string): Promise<void> {
  const fit = await cell.getByTestId("widget-card-body").evaluate(element => ({
    scroll: element.scrollHeight,
    client: element.clientHeight,
  }));
  expect(fit.scroll, `${label}: the body overflows`).toBeLessThanOrEqual(
    fit.client + 1
  );
  const card = await cell.boundingBox();
  const last = await cell.getByRole("listitem").last().boundingBox();
  expect((last?.y ?? 0) + (last?.height ?? 0), label).toBeLessThanOrEqual(
    (card?.y ?? 0) + (card?.height ?? 0)
  );
}

for (const width of [1440, 390]) {
  test(`draws only whole Get started steps at every height (${width}px)`, async ({
    page,
  }) => {
    // 🔴 A card never scrolls, so a step past the card's rows is cut off: at three rows high
    // the invite step was drawn below the card's bottom edge. Each height on one page, read
    // again from the mocked layout, rather than a page a height.
    let rows = 3;
    await page.setViewportSize({ width, height: 2600 });
    await placeFullGetStarted(page, () => rows);
    await gotoAdmin(page, "/");
    for (const h of [3, 4, 8, 12]) {
      rows = h;
      if (h !== 3) await page.reload();
      const cell = await getStartedCell(page);
      await expectWholeSteps(cell, `${h} rows`);
    }
  });
}

test("Show N more grows the Get started card in place, Show less folds it back, focus held, nothing saved", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 2600 });
  const writes: string[] = [];
  page.on("request", request => {
    if (
      request.url().includes("/dashboard/layout") &&
      request.method() !== "GET"
    ) {
      writes.push(request.method());
    }
  });
  await placeFullGetStarted(page);
  await gotoAdmin(page, "/");
  const cell = await getStartedCell(page);
  const folded = (await cell.boundingBox())?.height ?? 0;
  const drawn = await cell.getByRole("listitem").count();
  expect(drawn).toBeLessThan(9);

  // Found by what it is, the card's one toggle, not by its words: its name changes as it is
  // pressed, and a locator by the first name would stop matching the very control it pressed.
  const control = cell.locator("button[aria-expanded]");
  await expect(control).toHaveCount(1);
  await expect(control).toHaveAccessibleName(`Show ${9 - drawn} more`);
  await expect(control).toHaveAttribute("aria-expanded", "false");
  await control.focus();
  await page.keyboard.press("Enter");
  await expect(cell.getByRole("listitem")).toHaveCount(9);
  await expect(control).toHaveAccessibleName("Show less");
  await expect(control).toHaveAttribute("aria-expanded", "true");
  await expect(control).toBeFocused();
  // Grown in place, to hold every step, which the body then does without cutting one.
  await expect
    .poll(async () => (await cell.boundingBox())?.height ?? 0)
    .toBeGreaterThan(folded);
  await expectWholeSteps(cell, "shown in full");

  await page.keyboard.press("Enter");
  await expect(cell.getByRole("listitem")).toHaveCount(drawn);
  await expect(control).toHaveAccessibleName(`Show ${9 - drawn} more`);
  await expect(control).toBeFocused();
  await expect
    .poll(async () => Math.round((await cell.boundingBox())?.height ?? 0))
    .toBe(Math.round(folded));
  // A reader's look at the rest is not an arrangement: nothing was written.
  expect(writes).toEqual([]);
});
