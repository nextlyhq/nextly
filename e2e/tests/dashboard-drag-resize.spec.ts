/**
 * Moving and sizing cards while customising, in a browser: the handle left of each title, the
 * other cards moving aside while one is dragged, a card's right edge snapping to its widths, and
 * the menu's moves for the keyboard.
 *
 * jsdom lays nothing out, so where a card goes and how wide it is drawn can only be seen here.
 * A card's place is read from layout (`offsetTop`, `offsetLeft`), which a slide's transform does
 * not move, so a card caught mid-slide reads where it is going.
 *
 * Nothing here saves. Each test returns the reader to the default dashboard when it ends, as
 * `dashboard-arrangement.spec.ts` does.
 *
 * @module tests/dashboard-drag-resize.spec
 */
import { expect, type Locator, type Page, type Route } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { resetToDefault } from "./support/dashboard-layout";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

const CELLS = '[data-testid^="widget-cell-"]';

/** A card on the default dashboard whose widths run from 33% to 100%, drawn at 50%. */
const CONTINUE = "core/continue";

function cell(page: Page, widgetId: string): Locator {
  return page.getByTestId(`widget-cell-${widgetId}`);
}

/** Where a drawn element is; one not drawn fails the test here, rather than measuring as zero. */
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`not drawn: ${String(locator)}`);
  return box;
}

/** Opens customise mode and waits for the handles, which are drawn once the grid is measured. */
async function customize(page: Page): Promise<void> {
  await expect(
    page.locator(CELLS).filter({ visible: true }).nth(2)
  ).toBeVisible();
  await page.getByTestId("dashboard-edit-begin").click();
  await expect(page.getByTestId("widget-drag-handle").first()).toBeVisible();
  await settled(page);
}

/**
 * Waits until the cards have stopped moving, read twice in a row half a second apart: a card that
 * grows as its data arrives moves the ones after it, and a pointer aimed at a card measured before
 * then would land somewhere else.
 */
async function settled(page: Page): Promise<void> {
  let last = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(
          await page.locator(CELLS).evaluateAll(cells =>
            cells.map(cell => {
              const r = cell.getBoundingClientRect();
              return [r.x, r.y, r.width, r.height];
            })
          )
        );
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [500] }
    )
    .toBe(true);
}

/** The cards in the order the page draws them: by row, then left to right. */
async function drawnOrder(page: Page): Promise<string[]> {
  return page.locator(CELLS).evaluateAll(cells =>
    cells
      .map(cell => ({
        id: cell.getAttribute("data-placement-id") ?? "",
        top: (cell as HTMLElement).offsetTop,
        left: (cell as HTMLElement).offsetLeft,
      }))
      .sort((a, b) => a.top - b.top || a.left - b.left)
      .map(card => card.id)
  );
}

/** The cards in the order the page holds them, which a drag changes only on release. */
async function heldOrder(page: Page): Promise<string[]> {
  return page
    .locator(CELLS)
    .evaluateAll(cells =>
      cells.map(cell => cell.getAttribute("data-placement-id") ?? "")
    );
}

/** A card's layout box within the grid, unmoved by a slide. */
async function laidOut(locator: Locator) {
  return locator.evaluate(cell => {
    const element = cell as HTMLElement;
    return {
      top: element.offsetTop,
      left: element.offsetLeft,
      width: element.offsetWidth,
    };
  });
}

/** The pointer at a point inside a card, as a share of its drawn box. */
async function pointAt(locator: Locator, x: number, y: number) {
  const box = await boxOf(locator);
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}

/**
 * Where the pointer goes for a card to reach `w` columns: the middle of the gap after the
 * card's last column, measured from the card's own left edge as the grid lays it out.
 */
async function edgeFor(page: Page, card: Locator, w: number) {
  const grid = page.getByRole("region", { name: "Dashboard widgets" });
  const geometry = await grid.evaluate(element => ({
    width: element.getBoundingClientRect().width,
    gap: Number.parseFloat(getComputedStyle(element).columnGap),
  }));
  const column = (geometry.width - 11 * geometry.gap) / 12;
  const box = await boxOf(card);
  return box.x + w * column + (w - 1) * geometry.gap + geometry.gap / 2;
}

/** Holds a card's right edge and moves the pointer across to `x`, leaving it held. */
async function holdEdgeAndMove(page: Page, card: Locator, x: number) {
  const edge = card.getByTestId("widget-resize-edge");
  const from = await boxOf(edge);
  const y = from.y + from.height / 2;
  await page.mouse.move(from.x + from.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 10 });
}

/**
 * Passes the reader's widgets through with `widgetId`'s width bounds changed, for a widget
 * bounded as no widget on the default dashboard is.
 */
async function boundWidget(
  page: Page,
  widgetId: string,
  bounds: { min: number; default: number; max: number }
): Promise<void> {
  await page.route(/\/admin-meta\/workspace/, async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    // Aborted rather than thrown when the read is given up: a throw out of the handler prints
    // the request, session cookie included.
    let response: Awaited<ReturnType<Route["fetch"]>>;
    try {
      response = await route.fetch();
    } catch {
      await route.abort().catch(() => {});
      return;
    }
    const body = (await response.json()) as Record<string, unknown>;
    const meta = (Array.isArray(body.widgets) ? body : body.data) as {
      widgets?: Array<{
        id: string;
        size: Record<"default" | "min" | "max", { w: number; h: number }>;
      }>;
    };
    const widget = meta.widgets?.find(w => w.id === widgetId);
    if (widget !== undefined) {
      widget.size = {
        default: { ...widget.size.default, w: bounds.default },
        min: { ...widget.size.min, w: bounds.min },
        max: { ...widget.size.max, w: bounds.max },
      };
    }
    await route.fulfill({ response, json: body }).catch(() => {});
  });
}

test.beforeEach(async ({ page }) => {
  // Tall enough that every card is on screen: a pointer held near the bottom edge scrolls the
  // page, as it should, and the card would land wherever the scroll stopped.
  await page.setViewportSize({ width: 1440, height: 2400 });
});

test.afterEach(async ({ page }) => {
  await page.mouse.up();
  await resetToDefault(page);
});

test("the handle stands left of each title, on the title's own row", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const first = page.locator(CELLS).filter({ visible: true }).first();
  await expect(first).toBeVisible();
  const title = first.getByTestId("widget-card-header").getByRole("heading");
  const atRest = await boxOf(title);

  await customize(page);
  const handle = first.getByTestId("widget-drag-handle");
  const grip = await boxOf(handle);
  const moved = await boxOf(title);
  // Left of the title, and no row added: the title moved right, not down.
  expect(grip.x + grip.width).toBeLessThanOrEqual(moved.x);
  expect(moved.x).toBeGreaterThan(atRest.x);
  expect(Math.abs(moved.y - atRest.y)).toBeLessThanOrEqual(1);
  const gripMiddle = grip.y + grip.height / 2;
  expect(gripMiddle).toBeGreaterThan(moved.y);
  expect(gripMiddle).toBeLessThan(moved.y + moved.height);
});

test("a dragged card moves the others aside across a row and down a row, and lands where its outline is", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await customize(page);
  const before = await drawnOrder(page);
  const [held, beside, below, diagonal] = before;
  const card = (id: string) =>
    page.locator(`${CELLS}[data-placement-id="${id}"]`);
  // Two half-width cards to a row: `beside` shares the held card's row, `diagonal` is under it.
  expect((await laidOut(card(beside))).top).toBe(
    (await laidOut(card(held))).top
  );
  expect((await laidOut(card(diagonal))).top).toBeGreaterThan(
    (await laidOut(card(held))).top
  );

  const grip = await boxOf(card(held).getByTestId("widget-drag-handle"));
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();

  // Across the row, into the right half of the card beside it.
  const across = await pointAt(card(beside), 0.75, 0.5);
  await page.mouse.move(across.x, across.y, { steps: 12 });
  await expect(page.getByTestId("widget-drag-ghost")).toBeVisible();
  await expect(page.getByTestId("widget-drop-outline")).toBeVisible();
  // Before release, the cards are already where they would go, and nothing is staged yet.
  await expect
    .poll(() => drawnOrder(page))
    .toEqual([beside, held, below, diagonal, ...before.slice(4)]);
  expect(await heldOrder(page)).toEqual(before);
  await expect(page.getByTestId("dashboard-edit-save")).toBeDisabled();

  // Down a row, into the right half of the card now there.
  const down = await pointAt(card(diagonal), 0.75, 0.5);
  await page.mouse.move(down.x, down.y, { steps: 12 });
  const after = [beside, below, diagonal, held, ...before.slice(4)];
  await expect.poll(() => drawnOrder(page)).toEqual(after);
  // The outline holds the held card's place: the card itself is under the pointer.
  // Read once the slides have finished (an endless spinner never does, so it is left out), and
  // within a pixel: both are drawn at fractional positions.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        animation =>
          animation.playState !== "running" ||
          animation.effect?.getTiming().iterations === Number.POSITIVE_INFINITY
      )
  );
  const outline = await boxOf(page.getByTestId("widget-drop-outline"));
  const place = await boxOf(card(held));
  expect(Math.abs(outline.x - place.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(outline.width - place.width)).toBeLessThanOrEqual(1);

  await page.mouse.up();
  await expect.poll(() => heldOrder(page)).toEqual(after);
  await expect.poll(() => drawnOrder(page)).toEqual(after);
  await expect(page.getByTestId("widget-grid-live")).toHaveText(
    new RegExp(`moved from 1 to 4 of ${after.length}\\.`)
  );
  await expect(page.getByTestId("widget-drag-ghost")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-edit-save")).toBeEnabled();
});

for (const reduced of [false, true]) {
  test(`the cards ${reduced ? "jump to their places, with no slide, for a reader who asks for reduced motion" : "slide to their places as they move aside"}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : null });
    // Every slide the page starts, counted as it starts: a slide lasts a fraction of a second,
    // so one looked for afterwards could be missed.
    await page.addInitScript(() => {
      const animate = Element.prototype.animate;
      const slides: string[] = [];
      Object.assign(window, { __slides: slides });
      Element.prototype.animate = function (
        this: Element,
        ...args: Parameters<Element["animate"]>
      ) {
        const options = args[1];
        if (typeof options === "object" && options?.id !== undefined) {
          slides.push(options.id);
        }
        return animate.apply(this, args);
      };
    });
    await gotoAdmin(page, "/");
    await customize(page);
    const before = await drawnOrder(page);
    const [held, beside] = before;
    const card = (id: string) =>
      page.locator(`${CELLS}[data-placement-id="${id}"]`);

    const grip = await boxOf(card(held).getByTestId("widget-drag-handle"));
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    const across = await pointAt(card(beside), 0.75, 0.5);
    await page.mouse.move(across.x, across.y, { steps: 12 });
    await expect
      .poll(() => drawnOrder(page))
      .toEqual([beside, held, ...before.slice(2)]);

    const slides = await page.evaluate(
      () =>
        (window as unknown as { __slides: string[] }).__slides.filter(
          id => id === "dashboard-card-slide"
        ).length
    );
    if (reduced) expect(slides).toBe(0);
    else expect(slides).toBeGreaterThan(0);
  });
}

test("a 50% card's edge snaps it to 33%, showing the width while held", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await customize(page);
  const card = cell(page, CONTINUE);
  await expect(card.getByTestId("card-size-label")).toContainText("50%");
  const before = await laidOut(card);

  // A little past where 33% ends: the nearest width is still 33%.
  await holdEdgeAndMove(page, card, (await edgeFor(page, card, 4)) + 20);
  await expect(page.getByTestId("widget-resize-width")).toHaveText("33%");
  await expect
    .poll(async () => (await laidOut(card)).width)
    .toBeLessThan(before.width * 0.75);
  await expect(page.getByTestId("dashboard-edit-save")).toBeDisabled();

  await page.mouse.up();
  await expect(page.getByTestId("widget-resize-width")).toHaveCount(0);
  await expect(card.getByTestId("card-size-label")).toContainText("33%");
  await expect(page.getByTestId("widget-grid-live")).not.toBeEmpty();
  await expect(page.getByTestId("dashboard-edit-save")).toBeEnabled();
});

test("Escape while a card's edge is held puts it back at the width it had", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await customize(page);
  const card = cell(page, CONTINUE);
  const before = await laidOut(card);

  await holdEdgeAndMove(page, card, (await edgeFor(page, card, 4)) + 20);
  await expect(page.getByTestId("widget-resize-width")).toHaveText("33%");
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("widget-resize-width")).toHaveCount(0);
  await expect.poll(async () => (await laidOut(card)).width).toBe(before.width);
  // Released after the Escape: nothing is staged.
  await page.mouse.up();
  await expect(card.getByTestId("card-size-label")).toContainText("50%");
  await expect(page.getByTestId("dashboard-edit-save")).toBeDisabled();
});

test("a 50% card's edge dragged to the end of the row makes it 100%, and the card beside it moves to fit", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await customize(page);
  const card = cell(page, CONTINUE);
  const order = await drawnOrder(page);
  const id = await card.getAttribute("data-placement-id");
  const rowMates = await Promise.all(
    order.map(async other => ({
      other,
      box: await laidOut(
        page.locator(`${CELLS}[data-placement-id="${other}"]`)
      ),
    }))
  );
  const own = await laidOut(card);
  const mate = rowMates.find(
    ({ other, box }) => other !== id && box.top === own.top
  );
  if (mate === undefined) throw new Error("no card beside the one resized");

  await holdEdgeAndMove(page, card, await edgeFor(page, card, 12));
  await expect(page.getByTestId("widget-resize-width")).toHaveText("100%");
  // The card beside it moves to the next row while the edge is still held.
  await expect
    .poll(
      async () =>
        (
          await laidOut(
            page.locator(`${CELLS}[data-placement-id="${mate.other}"]`)
          )
        ).top
    )
    .toBeGreaterThan((await laidOut(card)).top);

  await page.mouse.up();
  await expect(card.getByTestId("card-size-label")).toContainText("100%");
});

test("a card's edge stops at the widget's widest width however far it is dragged", async ({
  page,
}) => {
  await boundWidget(page, CONTINUE, { min: 4, default: 6, max: 8 });
  await gotoAdmin(page, "/");
  await customize(page);
  const card = cell(page, CONTINUE);
  await expect(card.getByTestId("card-size-label")).toContainText("50%");

  // Past the end of the row, as far as the window goes.
  await holdEdgeAndMove(page, card, 1430);
  await expect(page.getByTestId("widget-resize-width")).toHaveText("66%");
  await page.mouse.up();
  await expect(card.getByTestId("card-size-label")).toContainText("66%");
});

test("a card bounded 5 to 5 offers no edge, and a drag at its edge changes nothing", async ({
  page,
}) => {
  await boundWidget(page, CONTINUE, { min: 5, default: 5, max: 5 });
  await gotoAdmin(page, "/");
  await customize(page);
  const card = cell(page, CONTINUE);
  await expect(card.getByTestId("card-size-label")).toContainText("42%");
  // The positive control: the other cards have their edge.
  await expect(page.getByTestId("widget-resize-edge").first()).toBeAttached();
  await expect(card.getByTestId("widget-resize-edge")).toHaveCount(0);
  const before = await laidOut(card);

  const box = await boxOf(card);
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 300, y, { steps: 10 });
  await expect(page.getByTestId("widget-resize-width")).toHaveCount(0);
  await page.mouse.up();

  expect((await laidOut(card)).width).toBe(before.width);
  await expect(card.getByTestId("card-size-label")).toContainText("42%");
  await expect(page.getByTestId("dashboard-edit-save")).toBeDisabled();
});

test("from the keyboard, a card's menu moves it later and says where it went", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await customize(page);
  const before = await heldOrder(page);
  const menu = page.getByRole("button", { name: /^Card actions for / }).first();
  await menu.focus();
  await page.keyboard.press("Enter");
  const later = page.getByRole("menuitem", { name: "Move later" });
  await expect(later).toBeVisible();
  for (let step = 0; step < 10; step += 1) {
    if (await later.evaluate(item => item === document.activeElement)) break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(later).toBeFocused();
  await page.keyboard.press("Enter");

  const after = [before[1], before[0], ...before.slice(2)];
  await expect.poll(() => heldOrder(page)).toEqual(after);
  await expect(page.getByTestId("widget-grid-live")).toHaveText(
    new RegExp(`moved from 1 to 2 of ${after.length}\\.`)
  );
});
