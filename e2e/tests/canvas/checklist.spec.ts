/**
 * Canvas acceptance checks beyond the five drag scenarios.
 *
 * Every test is tagged. `[acceptance]` states a requirement any canvas must
 * meet, and runs unchanged against any `CanvasDriver`. `[informational]`
 * records what the current canvas does in an area a replacement is expected to
 * change, so a later difference reads as a decision rather than a regression.
 */
import { expect, test } from "@playwright/test";

import {
  FLAT_LIST_FIXTURE,
  readStoredBlockIds,
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
  // Correlate each sample with WHERE the pointer was. Owner strings alone
  // cannot distinguish "the inner container owned the target throughout the
  // nested region" from "it owned one sample and the root owned the rest",
  // and only the first satisfies depth priority.
  // One drop-zone height, which is the size of the ambiguous band at an edge.
  const EDGE_MARGIN_PX = 8;
  const inner = (await driver.readBlockBoxes()).find(
    box => box.id === "nx-inner"
  );
  expect(inner, "the nested container must render").toBeDefined();
  const origin = await driver.frameOrigin();

  const samples: Array<{
    inside: boolean;
    owner: string | null;
    offsetFromTop: number;
    offsetFromBottom: number;
  }> = [];
  for (let step = 0; step < 60; step++) {
    await driver.moveBy(0, 8);
    const owner = await driver.readActiveZoneOwner();
    const frameY = driver.pointer().y - origin.y;
    samples.push({
      // A margin at each edge, because a pointer sitting exactly on the
      // boundary is a position both containers can legitimately claim: the
      // gap zone immediately before the nested container belongs to the outer
      // one. Depth priority is a statement about being INSIDE, and without the
      // margin this assertion flips run to run depending on where the fixed
      // step size happens to land relative to the edge.
      inside:
        frameY >= inner!.top + EDGE_MARGIN_PX &&
        frameY <= inner!.top + inner!.height - EDGE_MARGIN_PX,
      owner,
      offsetFromTop: Math.round(frameY - inner!.top),
      offsetFromBottom: Math.round(inner!.top + inner!.height - frameY),
    });
  }
  await driver.cancel();

  const owners = samples
    .map(sample => sample.owner)
    .filter((owner): owner is string => owner !== null);

  test
    .info()
    .annotations.push({ type: "owners", description: JSON.stringify(owners) });

  expect(owners.length, "the drag must find some target").toBeGreaterThan(0);
  expect(
    owners,
    "the nested container must win while the pointer is inside it"
  ).toContain("nx-inner");

  // Ownership must be CONTIGUOUS per container. Depth priority that only wins
  // on some samples produces root, inner, root, inner interleaving, which a
  // "contains" check accepts and a user experiences as a flickering indicator.
  const runs = owners.filter((owner, i) => owner !== owners[i - 1]);
  expect(
    runs.filter(owner => owner === "nx-inner").length,
    `ownership must not interleave; runs were ${JSON.stringify(runs)}`
  ).toBe(1);

  // The decisive check: while the pointer is inside the nested container, the
  // OUTER container must never own the target. That is what depth priority
  // means, and no assertion over owner strings alone can see it.
  const rootOwnedInside = samples.filter(
    sample => sample.inside && sample.owner === "nx-spike-root"
  );
  test.info().annotations.push({
    type: "root-owned-inside",
    description: JSON.stringify(
      rootOwnedInside.map(r => ({
        fromTop: r.offsetFromTop,
        fromBottom: r.offsetFromBottom,
      }))
    ),
  });
  expect(
    rootOwnedInside.length,
    `the outer container owned the target ${rootOwnedInside.length} time(s) while the pointer was inside the nested one`
  ).toBe(0);
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
test("[acceptance] point 4: siblings do not move during a drag", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);

  // Whole boxes, not just tops: a canvas that shifts siblings sideways or
  // resizes a block without moving its top would produce identical arrays and
  // pass a top-only comparison, while point 4 says siblings must not move.
  const read = async () =>
    (await driver.readBlockBoxes()).map(
      box => `${box.id}:${box.top}:${box.left}:${box.width}:${box.height}`
    );

  const before = await read();
  await startLibraryDrag(driver);
  for (let step = 0; step < 20; step++) await driver.moveBy(0, 8);
  const during = await read();
  await driver.cancel();

  const shifted = before.filter((box, i) => box !== during[i]);

  test.info().annotations.push({
    type: "layout-shift",
    description: `before=${JSON.stringify(before)} during=${JSON.stringify(during)}`,
  });

  // The marker sits here, immediately before the assertion it excuses and after
  // every read. Declared any earlier, a broken block-box query, a missing
  // library item or a drag-activation failure would all be classified as the
  // known layout-shift gap, and the test would "pass" without ever reaching the
  // zero-shift assertion.
  test.info().annotations.push({
    type: "shifted-count",
    description: `${shifted.length} of ${before.length} nodes changed geometry`,
  });

  // Outside the expected failure: a drag that INSERTS or DELETES nodes is a
  // different defect from the known geometry shift, and marking it expected
  // would let real content loss ride in under the layout gap.
  // Identity, not just count. A drag that reorders or replaces blocks while
  // keeping the count would otherwise be classified as the known geometry gap
  // by the marker below. Geometry is stripped from the comparison because the
  // geometry IS what the marker excuses.
  const idsOf = (boxes: string[]) => boxes.map(box => box.split(":")[0]);
  expect(
    idsOf(during),
    "a drag must not add, remove or reorder blocks"
  ).toEqual(idsOf(before));

  // Only the geometry assertion is the known gap: zones expand from 0px to 6px
  // when a drag starts and push every block below them down.
  test.fail(
    true,
    "zones expand from 0px to 6px and push every block below them down"
  );
  expect(shifted, "point 4 requires zero layout shift during a drag").toEqual(
    []
  );
});

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
  expect(
    await driver.isDragging(),
    "the benchmark must measure an ACTIVE drag, not a failed one"
  ).toBe(true);

  const samples: number[] = [];
  const targets: number[] = [];
  for (let step = 0; step < 40; step++) {
    const started = await page.evaluate(() => performance.now());
    await driver.moveBy(0, 6);
    targets.push(await driver.readActiveTarget());
    const ended = await page.evaluate(() => performance.now());
    samples.push(ended - started);
  }
  await driver.cancel();

  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const p95 =
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
  const worst = sorted[sorted.length - 1]!;

  test.info().annotations.push({
    type: "latency-500",
    description: `median=${median.toFixed(1)}ms p95=${p95.toFixed(1)}ms worst=${worst.toFixed(1)}ms n=${samples.length}`,
  });

  expect(fixture.blockIds.length).toBe(501);
  // Without this, droppable registration failing on a large tree makes every
  // sample a fast -1 and all three ceilings pass — the benchmark would be
  // cheapest exactly when the tree is broken.
  expect(
    targets.filter(value => value >= 0).length,
    "targets must be resolved during the benchmark"
  ).toBeGreaterThan(0);
  // A loose ceiling on purpose. It is a smoke alarm for an order-of-magnitude
  // regression, not the 60fps budget, which needs frame instrumentation the v2
  // canvas will have to provide.
  expect(median).toBeLessThan(500);
  // A median alone hides intermittent stalls: 19 of 40 moves could freeze for
  // seconds and the median would still pass. The tail is what a user feels.
  expect(p95, "the 95th-percentile move must not stall").toBeLessThan(500);
  expect(worst, "no single move may hang the drag").toBeLessThan(2000);
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

  // Checked while the button is still held. Releasing first would let a started
  // drag end harmlessly over the panel, leaving the tree unchanged and the
  // regression invisible.
  const draggingAtTwoPixels = await driver.isDragging();
  await page.mouse.up();

  const after = await driver.readTreeShape();
  test.info().annotations.push({
    type: "threshold",
    description: `before=${before.length} after=${after.length} dragging=${draggingAtTwoPixels}`,
  });
  expect(
    draggingAtTwoPixels,
    "a 2px movement must not pass the activation threshold"
  ).toBe(false);
  // The whole tree, not its length: a gesture that reordered blocks or swapped
  // one for another would keep the count and still have mutated the document.
  expect(
    after,
    "a sub-threshold gesture must leave the tree unchanged"
  ).toEqual(before);
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

  // A net increase of one can also mean "removed one, added two". The non-drag
  // insertion path gets the same identity guard as the drag path.
  const after = await driver.readTreeShape();
  expect(
    before.filter(id => !after.includes(id)),
    "inserting must not remove existing blocks"
  ).toEqual([]);
  expect(
    after.filter(id => !before.includes(id)),
    "inserting must add exactly one block"
  ).toHaveLength(1);
});

/**
 * The editor survives Escape mid-drag. It did not always.
 *
 * The admin shell used to treat Escape as "go back": its handler and the
 * canvas's were independent `document` listeners, `stopPropagation` does not
 * stop a sibling on the same node, so both ran and mount order decided the
 * winner. Mid-drag that navigated out of the entry editor and unmounted the
 * canvas, measured as `{"hasEditor":false}`. The admin's keydown owners now
 * register through the shared shortcut manager, which holds one listener and
 * takes precedence from the component tree, so Escape no longer leaves.
 *
 * 🔴 WHAT THIS TEST DOES NOT COVER, and what nothing else covers either.
 * Point 12 asks for a CANCELLED DRAG and an unchanged tree. This asserts the
 * editor is still mounted; 12b asserts the tree is unmutated. Both pass while
 * the drag itself is never cancelled, because `plugin-page-builder` registers
 * no Escape handler at all — the admin merely stopped stealing the key, which
 * is not the same as the canvas claiming it. The blocking layer a canvas needs
 * exists (`useShortcuts([{ keys: "Escape" }], { blocking: true })`) and nothing
 * in the page builder calls it. Do not read these two greens as point 12 being
 * met.
 */
test("[acceptance] point 12a: Escape keeps the editor mounted", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);

  await startLibraryDrag(driver);
  for (let step = 0; step < 30; step++) await driver.moveBy(0, 8);
  await driver.cancel();

  const state = { url: page.url(), hasEditor: await driver.isEditorPresent() };
  test.info().annotations.push({
    type: "after-cancel",
    description: JSON.stringify(state),
  });

  expect(
    state.hasEditor,
    `Escape left the editor: ${JSON.stringify(state)}`
  ).toBe(true);
});

test("[acceptance] point 12b: Escape does not mutate the tree", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);

  // The STORED document is the subject, not the canvas. Escape currently
  // navigates out of the editor, so a canvas read would be unavailable exactly
  // on the path most likely to have persisted something — and skipping the
  // check there would leave "navigated away AND saved a deletion" untested,
  // which is the worst version of this defect.
  const before = await readStoredBlockIds(request, fixture.entryId);
  expect(before, "the seeded document must have blocks").not.toEqual([]);

  // The canvas as well, because the two can disagree. The editor feeds document
  // edits into form state and the entry is written only on an explicit save, so
  // a cancellation that deletes or reorders a node leaves the stored row intact
  // while the user is looking at a corrupted tree. Reading only the store would
  // call that clean.
  const beforeCanvas = await driver.readTreeShape();
  expect(beforeCanvas, "the canvas must render the seeded blocks").not.toEqual(
    []
  );

  await startLibraryDrag(driver);
  for (let step = 0; step < 30; step++) await driver.moveBy(0, 8);
  await driver.cancel();

  const hasEditor = await driver.isEditorPresent();
  test.info().annotations.push({
    type: "after-cancel",
    description: JSON.stringify({ url: page.url(), hasEditor }),
  });

  // No marker and no skip: cancelling must never change what is stored,
  // whether or not the editor survived. Point 12a owns the unmount itself.
  const after = await readStoredBlockIds(request, fixture.entryId);
  expect(after, "cancelling a drag must not change the stored tree").toEqual(
    before
  );

  // The live tree is only readable while the editor is mounted, which is why
  // the stored read above is unconditional rather than replaced. Escape
  // currently navigates out, so this branch does not execute today; the
  // annotation records that so a green result is not mistaken for one that
  // exercised it.
  test.info().annotations.push({
    type: "canvas-compared",
    description: String(hasEditor),
  });
  if (hasEditor) {
    expect(
      await driver.readTreeShape(),
      "cancelling a drag must not change the tree on screen"
    ).toEqual(beforeCanvas);
  }
});
