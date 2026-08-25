/**
 * The Send control stays reachable when the request bar has no room.
 *
 * The bar's children that do not shrink come to 456px -- the action picker,
 * two icon buttons and Send -- inside a container that clips to its own
 * rounded corner. Below roughly 490px of content width the clip therefore
 * takes the RIGHTMOST control, which is the primary action of the whole page.
 *
 * jsdom cannot see this: it computes no layout, so a clipped button and a
 * visible one have the same zero-sized box and the same DOM.
 */
import { expect, test } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

test("Send stays inside the request bar on a phone-width screen", async ({
  page,
}) => {
  test.slow();

  await page.setViewportSize({ width: 390, height: 844 });
  await gotoAdmin(page, "/collections/posts/api");

  const send = page.getByRole("button", { name: /^send/i });
  await expect(send).toBeVisible();

  // Visible is not enough: `overflow-hidden` leaves a clipped child in the
  // layout with a real box, so the test has to compare the button against the
  // box that clips it rather than ask whether it rendered.
  const box = await send.boundingBox();
  const bar = await send
    .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]")
    .boundingBox();

  expect(box, "Send has a box").not.toBeNull();
  expect(bar, "the bar has a box").not.toBeNull();
  if (!box || !bar) return;

  expect(
    Math.round(box.x + box.width),
    "Send's right edge is past the bar's clipped edge, so part of it is unreachable"
  ).toBeLessThanOrEqual(Math.round(bar.x + bar.width) + 1);
  expect(box.width, "Send kept a usable width").toBeGreaterThan(80);
});
