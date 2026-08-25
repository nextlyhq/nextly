/**
 * The API Playground's metrics row keeps its size when the first reply lands.
 *
 * This property cannot be tested where the rest of the response pane is tested.
 * jsdom computes no layout: every box there is zero by zero, so an assertion
 * about widths passes against any implementation, including one that reflows on
 * every response. Measuring it needs a real engine, which is what puts this
 * file here rather than beside the component.
 *
 * What it guards: the row is `flex-wrap`, and an em dash is narrower than
 * `200`, `123ms` and `5.8 KB`. Reserve nothing and the row's intrinsic width
 * grows the moment a response arrives -- so at any pane width between the empty
 * and populated widths it gains a line, pushing the tab bar and the body down
 * while somebody is reading them.
 */
import { expect, test, type Locator } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

/**
 * Where the row's content begins.
 *
 * The row is `justify-end`, so its children pack against the right edge and the
 * first child's left edge IS the content width, read off the layout the browser
 * actually performed. Asserting on that rather than on a wrap at one chosen
 * viewport makes the check width-independent: identical content widths cannot
 * wrap differently at ANY width, so one measurement settles every pane size
 * instead of the one this test happened to open.
 */
async function contentLeftEdge(locator: Locator): Promise<number> {
  return locator.evaluate(row => {
    const first = row.firstElementChild;
    if (!first) throw new Error("the metrics row rendered no children");
    return first.getBoundingClientRect().x;
  });
}

test("the metrics row does not resize when the first response arrives", async ({
  page,
}) => {
  // Triples the budget. The playground route compiles on its first visit in
  // dev, and measured here that alone spent more than the default 30s on a
  // cold cache -- which fails at the first locator, where a timeout says
  // nothing about the property under test.
  test.slow();

  await gotoAdmin(page, "/collections/posts/api");

  const meta = page.getByTestId("response-meta");
  const toolbar = page.getByTestId("response-toolbar");
  await expect(meta).toBeVisible();

  // Serve the reply from here, registered after the page has loaded so only
  // Send is answered by it.
  //
  // The row reserves 6ch for latency, which holds `9999ms`, and the component
  // says plainly that a slower reply outgrows the reservation and may reflow
  // again. Measured against a LIVE request this test would therefore fail on
  // correct code whenever a cold route compile or a loaded worker pushes the
  // first call past ten seconds. An immediate reply of a fixed size puts every
  // value inside the width reserved for it, so what is left varying between
  // the two measurements is the thing under test.
  await page.route("**/admin/api/collections/posts/entries*", route =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [],
        meta: { total: 0, page: 1, limit: 10 },
      }),
    })
  );

  // The empty row, before anything has been sent. Read after the row is
  // visible so the measurement is of a laid-out box rather than of a node the
  // engine has not reached yet.
  await expect(meta).toContainText("—");
  const edgeBefore = await contentLeftEdge(meta);
  const toolbarBefore = (await toolbar.boundingBox())?.y;
  expect(toolbarBefore, "the toolbar has a box to measure").toBeDefined();

  await page.getByRole("button", { name: /^send/i }).click();

  // The populated row MUST actually arrive, or the comparison below is between
  // two empty rows and passes against every implementation. The row's text runs
  // together as `Status200Latency52ms`, so each value is anchored to the label
  // in front of it rather than matched on a word boundary that is not there.
  await expect(meta).toContainText(/Status\s*\d{3}/, { timeout: 30_000 });
  await expect(meta).toContainText(/Latency\s*\d+ms/);

  // The reservation only claims to cover latencies it has room for, so the
  // comparison below is only meaningful inside that range. Asserting it here
  // means a reply that somehow outran the reservation reports THAT, rather
  // than presenting itself as a layout regression.
  const latencyMs = Number(
    /Latency\s*(\d+)ms/.exec((await meta.textContent()) ?? "")?.[1]
  );
  expect(
    latencyMs,
    "latency outgrew the 6ch reservation, so the width comparison cannot bind"
  ).toBeLessThan(10_000);

  const edgeAfter = await contentLeftEdge(meta);
  const toolbarAfter = (await toolbar.boundingBox())?.y;

  // Under a pixel, not equal to it. Layout here is fractional, and a width
  // reserved in `ch` and the glyph advances that fill it round independently --
  // measured, the edge settles 1/64th of a pixel apart. Nothing at that scale
  // can wrap a row or move a control, while the defect this guards against
  // moves the edge by the width of three values at once.
  expect(
    Math.abs(edgeAfter - edgeBefore),
    "the metrics row's content width changed when the response arrived"
  ).toBeLessThan(1);
  expect(
    Math.abs((toolbarAfter ?? 0) - (toolbarBefore ?? 0)),
    "the toolbar moved when the response arrived"
  ).toBeLessThan(1);
});
