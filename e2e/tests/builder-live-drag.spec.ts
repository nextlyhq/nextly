/**
 * Dragging a value shows it on the canvas while the pointer moves, in the
 * real editor, and the drag is one step of undo:
 *
 * 1. A number field's label (a Heading's Font size): the heading's size on
 *    the canvas changes part-way through the drag, before the release; one
 *    Undo puts the size from before the drag back.
 * 2. The colour picker's surface: the Heading's colour follows the pointer
 *    while it is held down; once the picker is closed, one Undo puts the old
 *    colour back.
 * 3. A slider (a Section's opacity): the canvas follows while the thumb
 *    moves; one Undo puts it back.
 * 4. Speed: the label drag on a processor slowed 4×. Each pointer move is
 *    timed from the move to the first canvas frame that shows its value. On a
 *    production server the 75th percentile is held to 100 ms, the budget the
 *    builder's speed check gives a keystroke reaching the canvas; on `dev`
 *    the timings are attached to the report and only following is checked.
 *
 * A field that wrote on release would leave the canvas unchanged until the
 * pointer is lifted; one that wrote a step per move would need an Undo per
 * move.
 *
 * Each test makes its own page, named uniquely, so no page lock is needed.
 *
 * @module tests/builder-live-drag.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasBlock } from "./support/canvas-frame";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// Reads the site's devices, which a spec storing breakpoints changes.
test.describe.configure({ lock: [LOCK.siteStyle] });

const ENTRIES = "/admin/api/collections/pages/entries";
const HEADING = "00000000-0000-4000-8000-00000000d201";
const SECTION = "00000000-0000-4000-8000-00000000d202";

/** The budget for a pointer move to reach the canvas, at the 75th percentile. */
const MOVE_BUDGET_MS = 100;
const PRODUCTION = process.env.E2E_SERVER === "production";

const NODES = [
  {
    id: HEADING,
    type: "core/heading",
    version: 1,
    props: { text: "A heading to drag", level: "h2" },
    styles: {
      base: { base: { fontSize: "16px", color: "rgb(0, 0, 255)" } },
    },
  },
  {
    id: SECTION,
    type: "core/section",
    version: 1,
    props: { as: "section", contained: true },
    styles: { base: { base: { padding: { blockStart: "24px" } } } },
    slots: {
      children: [
        {
          id: `${SECTION}-text`,
          type: "core/text",
          version: 1,
          props: { text: "A band to fade" },
        },
      ],
    },
  },
];

/** A draft page holding the blocks above, opened in the builder. */
async function openNewPage(page: Page): Promise<void> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Live drag ${stamp}`,
      slug: `live-drag-${stamp}`,
      status: "draft",
      content: { formatVersion: 1, kind: "page", nodes: NODES },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const body = (await created.json()) as { item?: { id?: string } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(canvasBlock(page, HEADING).first()).toBeVisible({
    timeout: 60_000,
  });
}

/** A computed style of a block as the canvas draws it. */
function drawn(page: Page, id: string, property: string): Promise<string> {
  return canvasBlock(page, id)
    .first()
    .evaluate(
      (element, name) => getComputedStyle(element).getPropertyValue(name),
      property
    );
}

/** The editor's Undo button. */
function undoButton(page: Page): Locator {
  return page.getByRole("button", { name: "Undo", exact: true });
}

/** Select a block and open one of its Style tab's sections by name. */
async function openStyleSection(
  page: Page,
  block: () => Promise<void>,
  name: RegExp
): Promise<Locator> {
  await block();
  const inspector = page.getByTestId("inspector");
  await inspector.getByRole("tab", { name: "Style", exact: true }).click();
  const header = inspector.getByRole("button", { name }).first();
  if ((await header.getAttribute("aria-expanded")) !== "true") {
    await header.click();
  }
  await expect(header).toHaveAttribute("aria-expanded", "true");
  return inspector;
}

/** The heading selected, with its Text section open. */
function headingText(page: Page): Promise<Locator> {
  return openStyleSection(
    page,
    () => canvasBlock(page, HEADING).first().click(),
    /^Text(\s?has changes)?$/
  );
}

/** The Font size field's label, the handle a drag takes. */
async function fontSizeLabel(page: Page): Promise<Locator> {
  // Named by its label and the provenance after it ("Font size Set here").
  const field = page
    .getByTestId("inspector")
    .getByRole("textbox", { name: /^Font size\b/ });
  await expect(field).toHaveValue("16");
  const id = await field.getAttribute("id");
  if (id === null) throw new Error("the Font size field has no id");
  return page.locator(`label[for="${id}"]`);
}

/** The centre of an element, where a drag starts. */
async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("the drag handle has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("a number label's drag moves the canvas before release, as one undo step", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openNewPage(page);
  await headingText(page);
  const label = await fontSizeLabel(page);
  await expect(undoButton(page)).toBeDisabled();

  const start = await centreOf(label);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y, { steps: 5 });
  // Still held down: the canvas already draws the dragged size.
  await expect.poll(() => drawn(page, HEADING, "font-size")).toBe("26px");
  await page.mouse.move(start.x + 20, start.y, { steps: 5 });
  await expect.poll(() => drawn(page, HEADING, "font-size")).toBe("36px");
  await page.mouse.up();
  await expect.poll(() => drawn(page, HEADING, "font-size")).toBe("36px");

  // One Undo takes the whole drag back, and there is nothing before it.
  await undoButton(page).click();
  await expect.poll(() => drawn(page, HEADING, "font-size")).toBe("16px");
  await expect(undoButton(page)).toBeDisabled();
});

test("the colour picker's colour follows the pointer on the canvas, as one undo step", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openNewPage(page);
  const inspector = await headingText(page);
  await expect(undoButton(page)).toBeDisabled();
  await inspector.getByRole("button", { name: /^Colour for Colou?r/ }).click();
  const custom = page.getByRole("button", { name: "Custom colour" });
  if ((await custom.getAttribute("aria-expanded")) === "false") {
    await custom.click();
  }
  const surface = page.getByRole("application", {
    name: /Saturation and brightness/,
  });
  const box = await surface.boundingBox();
  if (box === null) throw new Error("the colour surface has no box");

  // Held down across the surface: each stop is drawn on the canvas before
  // the pointer is lifted.
  const seen = new Set<string>();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  for (const [x, y] of [
    [0.8, 0.2],
    [0.8, 0.6],
    [0.4, 0.8],
  ] as const) {
    const before = await drawn(page, HEADING, "color");
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, {
      steps: 4,
    });
    await expect.poll(() => drawn(page, HEADING, "color")).not.toBe(before);
    seen.add(await drawn(page, HEADING, "color"));
  }
  await page.mouse.up();
  expect(seen.size).toBe(3);
  expect(seen.has("rgb(0, 0, 255)")).toBe(false);
  const picked = await drawn(page, HEADING, "color");

  // Closed, the gesture is one step: one Undo puts the old colour back.
  await page.keyboard.press("Escape");
  await expect(surface).toBeHidden();
  await expect.poll(() => drawn(page, HEADING, "color")).toBe(picked);
  await undoButton(page).click();
  await expect.poll(() => drawn(page, HEADING, "color")).toBe("rgb(0, 0, 255)");
  await expect(undoButton(page)).toBeDisabled();
});

test("the opacity slider moves the canvas while it moves, as one undo step", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openNewPage(page);
  const inspector = await openStyleSection(
    page,
    () =>
      canvasBlock(page, SECTION)
        .first()
        .click({ position: { x: 4, y: 4 } }),
    /^Effects(has changes)?$/
  );
  await expect(undoButton(page)).toBeDisabled();
  expect(await drawn(page, SECTION, "opacity")).toBe("1");
  const thumb = inspector.getByRole("slider", { name: "Opacity slider" });
  const start = await centreOf(thumb);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 40, start.y, { steps: 5 });
  // Still held down: the canvas already draws the section fainter.
  await expect
    .poll(async () => Number(await drawn(page, SECTION, "opacity")))
    .toBeLessThan(1);
  const first = await drawn(page, SECTION, "opacity");
  await page.mouse.move(start.x - 80, start.y, { steps: 5 });
  await expect
    .poll(async () => Number(await drawn(page, SECTION, "opacity")))
    .toBeLessThan(Number(first));
  await page.mouse.up();

  await undoButton(page).click();
  await expect.poll(() => drawn(page, SECTION, "opacity")).toBe("1");
  await expect(undoButton(page)).toBeDisabled();
});

test("a label drag on a 4× slowed processor reaches the canvas within its budget", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await openNewPage(page);
  await headingText(page);
  const label = await fontSizeLabel(page);

  // Each frame's font size, as the canvas draws it, timed on the clock both
  // documents share.
  await canvasBlock(page, HEADING)
    .first()
    .evaluate((_element, id) => {
      const record = window as unknown as {
        __liveDrag?: { at: number; size: string }[];
      };
      const draws: { at: number; size: string }[] = [];
      record.__liveDrag = draws;
      let last = "";
      const watch = (): void => {
        const node = document.querySelector(
          `.nx-canvas [data-nx-node="${id}"]`
        );
        const size = node === null ? "" : getComputedStyle(node).fontSize;
        if (size !== last) {
          last = size;
          draws.push({ at: performance.timeOrigin + performance.now(), size });
        }
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    }, HEADING);
  // Each pointer move while the button is down, as the editor receives it.
  await page.evaluate(() => {
    const record = window as unknown as { __liveDragMoves?: number[] };
    const moves: number[] = [];
    record.__liveDragMoves = moves;
    document.addEventListener(
      "pointermove",
      event => {
        if (event.buttons === 1) {
          moves.push(performance.timeOrigin + event.timeStamp);
        }
      },
      { capture: true }
    );
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  try {
    const start = await centreOf(label);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(start.x + step * 3, start.y);
      // Room for the move to be drawn before the next, as a hand moves.
      await page.waitForTimeout(150);
    }
    await page.mouse.up();
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await cdp.detach();
  }

  const moves = await page.evaluate(
    () =>
      (window as unknown as { __liveDragMoves?: number[] }).__liveDragMoves ??
      []
  );
  const draws = await canvasBlock(page, HEADING)
    .first()
    .evaluate(
      () =>
        (
          window as unknown as {
            __liveDrag?: { at: number; size: string }[];
          }
        ).__liveDrag ?? []
    );
  // Each move: from the move to the first frame drawing a size other than
  // the one on the canvas when it arrived.
  const latencies = moves.flatMap(at => {
    const before = draws.filter(draw => draw.at <= at).at(-1)?.size;
    const shown = draws.find(draw => draw.at > at && draw.size !== before);
    return shown === undefined ? [] : [shown.at - at];
  });
  const sorted = [...latencies].sort((a, b) => a - b);
  const p75 = sorted[Math.ceil(sorted.length * 0.75) - 1] ?? Infinity;
  await testInfo.attach("live-drag-timings.json", {
    contentType: "application/json",
    body: JSON.stringify(
      { server: PRODUCTION ? "production" : "dev", p75, latencies, draws },
      null,
      2
    ),
  });

  // The canvas followed the drag: a size per move, not one at the end.
  expect(moves.length).toBeGreaterThanOrEqual(12);
  expect(latencies.length).toBeGreaterThanOrEqual(10);
  expect(new Set(draws.map(draw => draw.size)).size).toBeGreaterThanOrEqual(10);
  if (PRODUCTION) expect(p75).toBeLessThanOrEqual(MOVE_BUDGET_MS);
});
