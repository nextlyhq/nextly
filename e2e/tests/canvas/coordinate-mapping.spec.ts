/**
 * Checklist point 5: ONE host-point-to-canvas-point mapping, zoom, scroll and
 * iframe-offset aware.
 *
 * This point cannot be validated through the driver, because this canvas draws
 * its indicators INSIDE the iframe with CSS rather than in parent chrome. The
 * v2 canvas must draw them in the host, so the arithmetic is probed directly
 * here, before anything depends on it.
 *
 * Ground truth is Playwright's own cross-frame `boundingBox()`, which reports
 * an element inside an iframe in main-frame coordinates. Agreeing with it means
 * agreeing with the browser.
 *
 * Hard scope cap: coordinates only. No drag, no drop, no tree mutation.
 */
import { expect, test } from "@playwright/test";

import { FLAT_LIST_FIXTURE, seedPage } from "./fixtures";
import {
  frameContentOrigin,
  mapFramePointToHost,
  mapFrameRectToHost,
  mapHostPointToFrame,
  type FrameInset,
} from "./coordinate-mapping";
import { createPocDriver } from "./poc-driver";

test.describe.configure({ timeout: 180_000 });
test.use({ viewport: { width: 2560, height: 1400 } });

/** The node measured throughout: far enough down that a scale error shows up. */
const PROBE_ID = "nx-flat-4";

/** Read the probe's rect as the browser reports it across the frame boundary. */
async function groundTruth(page: import("@playwright/test").Page) {
  const box = await page
    .frameLocator("iframe")
    .locator(`[data-nx-id="${PROBE_ID}"]`)
    .boundingBox();
  expect(box, "probe node must be measurable across the frame").not.toBeNull();
  return box!;
}

/**
 * How the frame's content origin is derived from its measured border box.
 *
 * `"raw"` adds `clientLeft` to a post-transform corner without scaling it —
 * the arithmetic a naive implementation writes. It exists so the bordered test
 * below can show its own tolerance is load-bearing, the same way the scale test
 * shows the scale term is.
 */
type InsetMode = "scaled" | "raw";

/** Apply our mapping to the probe's frame-local rect. */
async function mapped(
  page: import("@playwright/test").Page,
  scale: number,
  insetMode: InsetMode = "scaled"
) {
  const frame = page.frames().find(f => f.url() === "about:blank")!;
  const frameRect = await frame.evaluate(id => {
    const el = document.querySelector(`[data-nx-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, PROBE_ID);
  expect(frameRect).not.toBeNull();

  const frameElement = page.locator("iframe");
  const origin = await frameElement.boundingBox();
  expect(origin).not.toBeNull();
  // The content origin: `boundingBox()` gives the border box, and rectangles
  // read inside the frame are relative to the content viewport. The two agree
  // only while a canvas keeps `border: none`, which is why measuring against
  // the border box passed here and drifts on any bordered canvas.
  //
  // The scale is passed through rather than measured so that `mapped(page, 1)`
  // stays a coherent "what a naive implementation computes" — it gets the wrong
  // origin AND the wrong mapping, which is what the control below asserts.
  const inset = await frameElement.evaluate<FrameInset, HTMLIFrameElement>(
    el => ({ left: el.clientLeft, top: el.clientTop })
  );

  const contentOrigin =
    insetMode === "scaled"
      ? frameContentOrigin(origin!, inset, scale)
      : { x: origin!.x + inset.left, y: origin!.y + inset.top };

  return mapFrameRectToHost(frameRect!, contentOrigin, scale);
}

/** Largest absolute difference across all four rect components. */
function worstDelta(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.width - b.width),
    Math.abs(a.height - b.height)
  );
}

test("point 5: the mapping agrees with the browser at rest", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);

  const delta = worstDelta(await mapped(page, 1), await groundTruth(page));
  test
    .info()
    .annotations.push({ type: "delta-at-rest", description: String(delta) });
  expect(delta).toBeLessThanOrEqual(1);
});

test("point 5: the mapping survives a host scroll", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);

  const originBefore = await driver.frameOrigin();
  await driver.scrollHost(300);
  const originAfter = await driver.frameOrigin();
  const moved = Math.abs(originAfter.y - originBefore.y);

  // Without this the probe silently degrades to the at-rest case whenever the
  // overflow ancestor is already at its limit or the admin's scroll container
  // moves, and a zero delta then proves nothing.
  expect(
    moved,
    "the host must actually scroll for this to test anything"
  ).toBeGreaterThan(50);

  const delta = worstDelta(await mapped(page, 1), await groundTruth(page));
  test.info().annotations.push({
    type: "delta-scrolled",
    description: `delta=${delta} originMoved=${Math.round(moved)}`,
  });

  // Scroll moves the frame's origin; re-reading the origin each time is what
  // absorbs it, which is why the mapping takes the origin as an argument
  // instead of caching it.
  expect(delta).toBeLessThanOrEqual(1);
});

test("point 5: the mapping needs its scale term under a scaled frame", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);
  await driver.setZoom(0.75);

  const withScale = worstDelta(
    await mapped(page, 0.75),
    await groundTruth(page)
  );
  const withoutScale = worstDelta(
    await mapped(page, 1),
    await groundTruth(page)
  );

  test.info().annotations.push({
    type: "delta-scaled",
    description: `withScale=${withScale} withoutScale=${withoutScale}`,
  });

  // Both halves matter. The first says the function is right; the second says
  // the scale term is load-bearing rather than decorative, so a later
  // simplification that drops it fails here instead of silently misplacing an
  // overlay further from the transform origin.
  expect(withScale).toBeLessThanOrEqual(1);
  expect(withoutScale).toBeGreaterThan(1);
});

test("point 5: the mapping survives scroll and scale together", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);
  await driver.setZoom(0.75);

  const originBefore = await driver.frameOrigin();
  await driver.scrollHost(300);
  const originAfter = await driver.frameOrigin();
  const moved = Math.abs(originAfter.y - originBefore.y);
  expect(
    moved,
    "the host must actually scroll for this to test anything"
  ).toBeGreaterThan(50);

  const delta = worstDelta(await mapped(page, 0.75), await groundTruth(page));
  test.info().annotations.push({
    type: "delta-scaled-scrolled",
    description: `delta=${delta} originMoved=${Math.round(moved)}`,
  });
  expect(delta).toBeLessThanOrEqual(1);
});

test("point 5: the mapping survives a bordered frame under scale", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);

  // Every other test in this file runs against a canvas with `border: none`,
  // where the content origin and the border-box corner are the same point. That
  // makes them all agree whether or not the inset is scaled — so none of them
  // can see this, and the fault would ship on the first bordered canvas.
  await page
    .locator("iframe")
    .evaluate(
      (el: HTMLIFrameElement) => (el.style.border = "8px solid transparent")
    );
  await driver.setZoom(0.5);

  // Precondition, not decoration. If the canvas stylesheet wins over the inline
  // border, `clientLeft` is 0, this silently becomes the at-rest case, and it
  // passes while testing nothing at all.
  const inset = await page
    .locator("iframe")
    .evaluate((el: HTMLIFrameElement) => el.clientLeft);
  expect(
    inset,
    "the border must actually apply for this to test anything"
  ).toBe(8);

  const scaled = worstDelta(await mapped(page, 0.5), await groundTruth(page));
  const raw = worstDelta(
    await mapped(page, 0.5, "raw"),
    await groundTruth(page)
  );

  test.info().annotations.push({
    type: "delta-bordered-scaled",
    description: `scaled=${scaled} raw=${raw} inset=${inset}`,
  });

  // Both halves, for the same reason as the scale test. The first says scaling
  // the inset is right; the second says it MATTERS — an 8px border at 50% puts
  // the raw sum 4px out, so a regression to it cannot pass this quietly.
  expect(scaled).toBeLessThanOrEqual(1);
  expect(raw).toBeGreaterThan(1);
});

test("point 5: the two directions are exact inverses", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);
  await driver.setZoom(0.75);

  const origin = await driver.frameOrigin();
  const scale = 0.75;

  // Hit-testing a pointer and drawing an overlay use opposite directions of the
  // same mapping. Asserting they round-trip is what stops one being corrected
  // in isolation and silently disagreeing with the other.
  for (const framePoint of [
    { x: 0, y: 0 },
    { x: 137, y: 421 },
    { x: 1024, y: 2048 },
  ]) {
    const host = mapFramePointToHost(framePoint, origin, scale);
    const back = mapHostPointToFrame(host, origin, scale);
    expect(Math.abs(back.x - framePoint.x)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(back.y - framePoint.y)).toBeLessThanOrEqual(0.001);
  }
});
