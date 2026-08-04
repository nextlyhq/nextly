/**
 * The zero-fluctuation checklist (master plan §2.8) beyond the five scenarios.
 *
 * Every test is tagged. `[acceptance]` states a requirement the v2 canvas must
 * meet and re-runs unchanged against driver #2. `[informational]` records what
 * this canvas does today in an area v2 deliberately replaces, so a later
 * difference reads as a decision rather than a regression.
 */
import { expect, test } from "@playwright/test";

import {
  FLAT_LIST_FIXTURE,
  LARGE_FIXTURE,
  NESTED_FIXTURE,
  seedPage,
} from "./fixtures";
import type { CanvasDriver } from "./driver";
import { createPocDriver } from "./poc-driver";

test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 2560, height: 1400 } });

/** Begin a drag from the insert panel and carry the pointer over the canvas. */
async function startLibraryDrag(driver: CanvasDriver) {
  const source = await driver.dragSourceCentre();
  const target = await driver.canvasCentre();
  await driver.startDragAt(source);
  await driver.moveBy(target.x - source.x, target.y - source.y);
}

test("[acceptance] point 1: the innermost container owns the drop target", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, NESTED_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);
  await startLibraryDrag(driver);

  // Walk down through the nested container and record which container owns the
  // active zone at each step. Depth-priority means that while the pointer is
  // inside `nx-inner`, the outer root must never own the target.
  const owners: string[] = [];
  for (let step = 0; step < 60; step++) {
    await driver.moveBy(0, 8);
    const owner = await driver.readActiveZoneOwner();
    if (owner) owners.push(owner);
  }
  await driver.cancel();

  test
    .info()
    .annotations.push({ type: "owners", description: JSON.stringify(owners) });

  expect(owners.length, "the drag must find some target").toBeGreaterThan(0);
  expect(
    owners,
    "the nested container must win at least once, or depth priority is absent"
  ).toContain("nx-inner");
});

/**
 * Marked failing because the requirement genuinely is not met today, and a
 * length-only assertion passed while every node moved.
 *
 * Measured: tops go [0,0,60,120,180,240,300] at rest and [3,12,84,156,230,302,374]
 * mid-drag. All seven nodes shift, the worst by 74px, because each drop zone
 * expands from 0px to 6px when a drag starts and pushes everything below it
 * down. Point 4 asks for zero shift, so the assertion states zero and this is
 * recorded as a known gap rather than a green check.
 */
test.fixme(
  "[acceptance] point 4: siblings do not move during a drag",
  async ({ page, request }) => {
    const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
    const driver = createPocDriver(page);
    await driver.mountTree(fixture);

    const frame = page.frames().find(f => f.url() === "about:blank")!;
    const read = () =>
      frame.evaluate(() =>
        Array.from(document.querySelectorAll("[data-nx-id]")).map(el =>
          Math.round(el.getBoundingClientRect().top)
        )
      );

    const before = await read();
    await startLibraryDrag(driver);
    for (let step = 0; step < 20; step++) await driver.moveBy(0, 8);
    const during = await read();
    await driver.cancel();

    const shifted = before
      .map((top, i) => Math.abs(top - (during[i] ?? top)))
      .filter(delta => delta > 0);

    test.info().annotations.push({
      type: "layout-shift",
      description: `before=${JSON.stringify(before)} during=${JSON.stringify(during)}`,
    });

    // Zones expand from 0px to 6px when a drag starts, so the blocks below them
    // DO move. The requirement is zero shift; this records the real number so the
    // v2 canvas has a figure to beat rather than a slogan.
    test.info().annotations.push({
      type: "shifted-count",
      description: `${shifted.length} of ${before.length} nodes moved; max ${Math.max(0, ...shifted)}px`,
    });

    expect(before.length).toBe(during.length);
    expect(shifted, "point 4 requires zero layout shift during a drag").toEqual(
      []
    );
  }
);

test("[acceptance] point 8: a 500-block tree stays responsive during a drag", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, LARGE_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);
  await startLibraryDrag(driver);

  // Wall-clock per move+read, not a frame rate: Playwright cannot observe
  // frames, and a fabricated fps number would be worse than an honest latency.
  const samples: number[] = [];
  for (let step = 0; step < 40; step++) {
    const started = await page.evaluate(() => performance.now());
    await driver.moveBy(0, 6);
    await driver.readActiveTarget();
    const ended = await page.evaluate(() => performance.now());
    samples.push(ended - started);
  }
  await driver.cancel();

  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const worst = sorted[sorted.length - 1]!;

  test.info().annotations.push({
    type: "latency-500",
    description: `median=${median.toFixed(1)}ms worst=${worst.toFixed(1)}ms n=${samples.length}`,
  });

  expect(fixture.blockIds.length).toBe(501);
  // A loose ceiling on purpose. It is a smoke alarm for an order-of-magnitude
  // regression, not the 60fps budget, which needs frame instrumentation the v2
  // canvas will have to provide.
  expect(median).toBeLessThan(500);
});

test("[informational] point 2: a click below the drag threshold does not drag", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);

  const before = await driver.readTreeShape();
  const item = await driver.dragSourceCentre();
  await page.mouse.move(item.x, item.y);
  await page.mouse.down();
  await page.mouse.move(item.x + 2, item.y);
  await page.mouse.up();

  const after = await driver.readTreeShape();
  test.info().annotations.push({
    type: "threshold",
    description: `before=${before.length} after=${after.length}`,
  });
  expect(after.length).toBe(before.length);
});

test("[informational] point 9: the library's Insert button adds a block", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);

  const before = await driver.readTreeShape();
  await driver.clickToInsert();

  await expect
    .poll(async () => (await driver.readTreeShape()).length, {
      timeout: 30_000,
    })
    .toBe(before.length + 1);
});

/**
 * Marked failing because Escape does not cancel the drag: it leaves the editor.
 *
 * Measured immediately after the keypress:
 *   {"url":"/admin/collections/pages","iframes":0,"hasEditor":false}
 *
 * The admin shell treats Escape as "go back", so mid-drag it navigates out of
 * the entry editor and unmounts the canvas entirely. Point 12 asks for a
 * cancelled drag and an unchanged tree; what happens is an abandoned editing
 * session. The v2 canvas must claim Escape while a drag is in flight.
 */
test.fixme(
  "[informational] point 12: Escape cancels a drag without changing the tree",
  async ({ page, request }) => {
    const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
    const driver = createPocDriver(page);
    await driver.mountTree(fixture);

    const before = await driver.readTreeShape();
    await startLibraryDrag(driver);
    for (let step = 0; step < 30; step++) await driver.moveBy(0, 8);
    await driver.cancel();

    const afterCancel = await page.evaluate(() => ({
      url: window.location.pathname,
      iframes: document.querySelectorAll("iframe").length,
      hasEditor: !!document.querySelector(".nx-pb-editor"),
    }));
    test.info().annotations.push({
      type: "after-cancel",
      description: JSON.stringify(afterCancel),
    });

    // Cancelling remounts the canvas iframe, so a single read can land while no
    // about:blank frame exists at all. Poll until it is back.
    let after: string[] = [];
    await expect
      .poll(
        async () => {
          try {
            after = await driver.readTreeShape();
            return after.length;
          } catch {
            return -1;
          }
        },
        { timeout: 30_000 }
      )
      .toBe(before.length);

    test.info().annotations.push({
      type: "escape",
      description: `before=${before.length} after=${after.length}`,
    });
    expect(after).toEqual(before);
  }
);
