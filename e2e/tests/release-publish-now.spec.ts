/**
 * Publish now from a release's page, in a real browser: it asks first, naming
 * the release, and once confirmed the release has run and its document is
 * live. The confirmation is checked with axe and gives focus back on Escape.
 */
import { expect } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import { post, readRelease, release } from "./support/releases-api";
import { test } from "./support/test";

// Publish now runs the release runner, which runs every overdue release it finds.
test.describe.configure({ lock: [LOCK.releases] });

/** Where a document stands: `draft` or `published`. */
async function statusOf(
  request: import("@playwright/test").APIRequestContext,
  postId: string
): Promise<string | undefined> {
  const response = await request.get(
    `/admin/api/collections/posts/entries/${postId}?status=all`
  );
  expect(response.ok(), await response.text()).toBe(true);
  const body = (await response.json()) as {
    status?: string;
    item?: { status?: string };
  };
  return (body.item ?? body).status;
}

test("publishes a draft release at once, after asking, and its document goes live", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now().toString(36);
  const title = `Published now e2e ${stamp}`;
  const postId = await post(page, stamp);
  const releaseId = await release(page, title, postId);
  expect(await statusOf(page.request, postId)).toBe("draft");

  await gotoAdmin(page, `/releases/${releaseId}`);
  const opener = page.getByRole("button", { name: "Publish now…" });
  await opener.click();

  const ask = page.getByRole("alertdialog", {
    name: `Publish “${title}” now?`,
  });
  await expect(ask).toBeVisible();
  await expectNoAxeViolations(page, { include: '[role="alertdialog"]' });
  await page.keyboard.press("Escape");
  await expect(ask).toHaveCount(0);
  await expect(opener).toBeFocused();
  // Asked and declined: nothing ran.
  expect((await readRelease(page, releaseId)).state).toBe("draft");

  await opener.click();
  await ask.getByRole("button", { name: "Publish now" }).click();
  await expect(ask).toHaveCount(0);

  await expect
    .poll(async () => (await readRelease(page, releaseId)).state)
    .toBe("published");
  expect(await statusOf(page.request, postId)).toBe("published");
  await expect(
    page.locator("main").getByText("Published").first()
  ).toBeVisible();
});
