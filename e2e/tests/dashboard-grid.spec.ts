/**
 * The dashboard's grid in a browser: twelve columns, each card spanning its
 * `w` columns and as tall as its content (the cards of a row as tall as the
 * tallest of them), reflowed by the dashboard's own width and never the
 * window's, and never resized past its widget's bounds.
 *
 * jsdom has no layout, so the component tests can say which classes and styles
 * a card is drawn with but not the box it ends up in. These measure the drawn
 * page: every card's width and height in each band against its content's own
 * height, recorded on the test as an attachment, the two gaps, the order in the one-column band, and a card asked
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
import { expect, type Locator, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin, type Theme } from "./support/admin";
import { sizeBoundsOf } from "./support/dashboard-sizes";
import { LOCK } from "./support/locks";
import { resetToDefault } from "./support/dashboard-layout";

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
  /** Its content's height, unstretched by its row (`contentHeights`). */
  natural: number;
  /** The empty room under its body's content while unstretched: none for a card fitted to it. */
  slack: number;
  /** How far its content runs past its foot; nothing is clipped, so it should be none. */
  overflowDown: number;
  overflow: number;
}

async function readLayout(page: Page): Promise<Layout> {
  const read = await page.request.get("/admin/api/dashboard/layout");
  expect(read.ok()).toBe(true);
  return (await read.json()) as Layout;
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
 * on what earlier specs left behind (the setup card retires once its steps are done).
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
        overflowDown: cell.scrollHeight - cell.clientHeight,
      };
    })
  );
  const natural = await contentHeights(page);
  return boxes
    .filter(box => box.width > 0 && box.height > 0)
    .map(box => {
      const stored = sizes.get(box.placementId);
      if (stored === undefined) {
        throw new Error(`no stored placement ${box.placementId}`);
      }
      return {
        ...box,
        natural: natural.get(box.placementId)?.height ?? 0,
        slack: natural.get(box.placementId)?.slack ?? 0,
        widgetId: stored.widgetId,
        w: stored.w,
        h: stored.h,
      };
    });
}

/**
 * Each drawn cell's content height, by placement: the height it takes when it is not stretched
 * to its row (`align-self: start`), and the empty room left under its body's content then, which
 * a card drawn at a stored height rather than its content's would show. Measured with every cell
 * so and then put back in one go, so no frame is painted between.
 */
async function contentHeights(
  page: Page
): Promise<Map<string, { height: number; slack: number }>> {
  const pairs = await page.locator(CELLS).evaluateAll(cells => {
    const elements = cells as HTMLElement[];
    const before = elements.map(cell => cell.style.alignSelf);
    for (const cell of elements) cell.style.alignSelf = "start";
    const measured = elements.map(cell => {
      const body = cell.querySelector<HTMLElement>(
        '[data-testid="widget-card-body"]'
      );
      // A wrapper laid out as if absent (`display: contents`) has no box of its own: its children
      // are read in its place.
      const boxed = (element: Element): Element[] =>
        getComputedStyle(element).display === "contents"
          ? [...element.children].flatMap(boxed)
          : [element];
      const bottoms = [...(body?.children ?? [])]
        .flatMap(boxed)
        .map(child => child.getBoundingClientRect().bottom);
      const slack =
        body === null || bottoms.length === 0
          ? 0
          : body.getBoundingClientRect().bottom - Math.max(...bottoms);
      return [
        cell.getAttribute("data-placement-id") ?? "",
        { height: cell.getBoundingClientRect().height, slack },
      ] as const;
    });
    elements.forEach((cell, index) => {
      cell.style.alignSelf = before[index] ?? "";
    });
    return measured;
  });
  return new Map(pairs);
}

/** The columns a card of `w` spans on a dashboard `area` wide, as the bands state them. */
function expectedSpan(w: number, area: number): number {
  if (area < 640) return w <= 3 ? 6 : 12;
  if (area < 1024) return w <= 6 ? 6 : 12;
  return w;
}

/** The gap across the grid on a dashboard `area` wide. */
function expectedColumnGap(area: number): number {
  return area >= 1280 ? 24 : 16;
}

/**
 * Every card is as wide as its band draws its `w`, and as tall as its content or, beside a taller
 * card in its row, as that card: never a stored row count, never cut. Recorded on the test for the
 * band it was measured in.
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
      contentHeight: Math.round(card.natural * 10) / 10,
      slack: Math.round(card.slack * 10) / 10,
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
  }
  // 🔴 Each row is as tall as its tallest card's content, and every card in it as tall as the
  // row: their bottoms meet, and the row holds the tallest whole.
  const rows = new Map<number, DrawnCard[]>();
  for (const card of cards) {
    const top = Math.round(card.top);
    rows.set(top, [...(rows.get(top) ?? []), card]);
  }
  for (const row of rows.values()) {
    const tallest = Math.max(...row.map(card => card.natural));
    for (const card of row) {
      expect(card.height, `${card.widgetId} height at ${label}`).toBeCloseTo(
        tallest,
        0
      );
      expect(
        card.natural,
        `${card.widgetId} is no taller than its row at ${label}`
      ).toBeLessThanOrEqual(card.height + 1);
    }
  }
  // Nothing inside a card is clipped or scrolls, and unstretched, no card stands taller than its
  // content: no empty room under its body's last element.
  for (const card of cards) {
    expect(
      card.slack,
      `${card.widgetId} room under its content at ${label}`
    ).toBeLessThanOrEqual(1);
    expect(
      card.overflowDown,
      `${card.widgetId} cut at the foot at ${label}`
    ).toBeLessThanOrEqual(1);
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
 * The sizes a Width submenu offers, read from each choice's test id (`card-width-6`)
 * rather than its text: a width is named by its share of the row ("50%") with its columns beneath,
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
    await expect(
      page.locator(CELLS).filter({ visible: true }).first()
    ).toBeVisible();
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
    await expect(
      page.locator(CELLS).filter({ visible: true }).first()
    ).toBeVisible();
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

test("pairs two quarter-width cards on one row on a 390 px phone, each half the row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await gotoAdmin(page, "/");
  // Two Count cards, a quarter of the row each where the dashboard is wide, placed first.
  const layout = await readLayout(page);
  const write = await saveLayout(page, [
    { id: "e2e-quarter-a", widgetId: "core/count", w: 3, h: 2, removed: false },
    { id: "e2e-quarter-b", widgetId: "core/count", w: 3, h: 2, removed: false },
    ...layout.placements,
  ]);
  expect(write.ok()).toBe(true);
  await page.reload();
  const a = page.locator(`${CELLS}[data-placement-id="e2e-quarter-a"]`);
  const b = page.locator(`${CELLS}[data-placement-id="e2e-quarter-b"]`);
  await expect(a).toBeVisible();
  await expect(b).toBeVisible();
  const area = await areaWidth(page);
  expect(area).toBeLessThan(640);
  const [boxA, boxB] = await Promise.all([a.boundingBox(), b.boundingBox()]);
  if (boxA === null || boxB === null)
    throw new Error("[e2e] a quarter card has no box");
  // 🔴 One row, side by side, each half the row less half the gap; every other card is full width.
  expect(Math.abs(boxA.y - boxB.y)).toBeLessThan(1);
  expect(boxB.x).toBeGreaterThan(boxA.x);
  const half = (area - expectedColumnGap(area)) / 2;
  expect(boxA.width).toBeCloseTo(half, 0);
  expect(boxB.width).toBeCloseTo(half, 0);
  await expectCardsInBand(page, "390px with two quarter cards");
});

test("changes band at the dashboard's own 639/640 and 1,023/1,024 px, and its gap at 1,280 px", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await placeFullMinimumCard(page);
  await page.reload();
  await expect(
    page.locator(CELLS).filter({ visible: true }).first()
  ).toBeVisible();
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
  await expect(
    page.locator(CELLS).filter({ visible: true }).first()
  ).toBeVisible();
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

  // No Height is offered: a card is as tall as its content.
  await menuButton.click();
  await expect(page.getByTestId("card-height-menu")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  const area = await areaWidth(page);
  const gap = expectedColumnGap(area);
  const box = await cell.boundingBox();
  expect(box?.width).toBeCloseTo(((area + gap) * bounds.max.w) / 12 - gap, 0);
  // Cancel asks before discarding a width that changed; the answer is to discard.
  await page.getByTestId("dashboard-edit-cancel").click();
  const ask = page.getByTestId("dashboard-leave-ask");
  await expect(ask.or(page.getByTestId("dashboard-edit-begin"))).toBeVisible();
  if ((await ask.count()) > 0) {
    await ask.getByRole("button", { name: "Discard changes" }).click();
  }
  await expect(page.getByTestId("dashboard-edit-begin")).toBeVisible();

  // 🔴 A size past the maximum written straight to the layout is refused, or drawn at the
  // maximum; either way the card is never drawn wider than it. A stored `h` past the maximum
  // sets no height, as no stored `h` does: the card stays as tall as its content.
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
  expect(after?.width ?? 0).toBeLessThanOrEqual(
    ((area + gap) * bounds.max.w) / 12 - gap + 1
  );
});
