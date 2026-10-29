import { expect } from "@playwright/test";

import { test } from "./support/test";

/**
 * An error boundary's `retry()` recovers from a failed server render without
 * reloading the page.
 *
 * Against the playground's `/render-retry` harness, whose render fails on an
 * id's first load and succeeds after. The templates' error boundaries call
 * `retry()` the same way; `scripts/template-error-boundaries.test.mjs` holds
 * them to it.
 */
test("Try again brings back a page whose first render failed", async ({
  page,
}) => {
  const id = `retry-${Date.now()}`;
  await page.goto(`/render-retry?id=${id}`);
  await expect(page.getByTestId("render-retry-failed")).toBeVisible();

  // A full reload would clear this, so it surviving the retry is the proof the
  // content came back in place.
  await page.evaluate(() => {
    (window as unknown as { __noReload?: boolean }).__noReload = true;
  });
  await page.getByRole("button", { name: "Try again" }).click();

  await expect(page.getByTestId("render-retry-loaded")).toHaveText(
    `Loaded ${id}`
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { __noReload?: boolean }).__noReload
    )
  ).toBe(true);
});
