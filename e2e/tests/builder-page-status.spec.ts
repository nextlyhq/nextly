/**
 * The page builder's one page status, in a browser.
 *
 * Save and Publish say the page's state themselves: Save reads "Save" over
 * unsaved work and a quiet "✓ Saved" otherwise, and Publish reads "Publish
 * changes" while the live page is behind and a quiet "Published" when it
 * matches. The pill beside the title says only where the page is in its life
 * (Draft, Published or Scheduled), never "Changed" or "Modified", and no chip
 * repeats the save state. Changes left from a last visit, stored but never
 * saved, open with Save enabled, and Save says "Changes from your last visit
 * aren't saved yet." with Save and Discard.
 *
 * @module tests/builder-page-status.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";

const NODES = [
  { id: "status-kept", type: "core/text", version: 1, props: { text: "Kept" } },
  {
    id: "status-removed",
    type: "core/text",
    version: 1,
    props: { text: "Removed by the test" },
  },
];

const LAST_VISIT = "Changes from your last visit aren't saved yet.";

/** A published page of its own, and its id. */
async function createPublishedPage(
  request: APIRequestContext
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Page status ${stamp}`,
      slug: `page-status-${stamp}`,
      status: "published",
      content: { formatVersion: 1, kind: "page", nodes: NODES },
    },
  });
  expect(created.ok(), `creating a page: ${created.status()}`).toBe(true);
  const body = (await created.json()) as { item: { id: string } };
  return body.item.id;
}

/** The bar's start and end columns. */
const start = (page: Page) => page.locator('[data-topbar="start"]');
const end = (page: Page) => page.locator('[data-topbar="end"]');

/** The bar's Save, in whichever state it reads. */
const saveButton = (page: Page) => end(page).locator('[data-action="save"]');

/** The bar's Publish, in whichever state it reads. */
const publishButton = (page: Page) =>
  end(page).locator('[data-action="publish"]');

/** The page's status pill beside the title, its spoken prefix included. */
const status = (page: Page) =>
  start(page)
    .getByText(/^Page status:/)
    .locator("..");

/** A block on the canvas, by its node id. */
const block = (page: Page, id: string) =>
  canvasFrame(page).locator(`.nx-canvas [data-nx-node="${id}"]`).first();

/** Opens the page in the builder and waits for its canvas. */
async function openBuilder(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** The write of this page, and not the other requests under its path. */
function pageWrite(page: Page, id: string) {
  return page.waitForResponse(
    response =>
      new URL(response.url()).pathname.endsWith(`/entries/${id}`) &&
      ["PATCH", "PUT"].includes(response.request().method()) &&
      response.ok()
  );
}

/** The editor storing this page's recovery point. */
function recoveryPointStored(page: Page, id: string) {
  return page.waitForResponse(
    response =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname.endsWith(
        `/entries/${id}/versions/autosave`
      ) &&
      response.ok(),
    { timeout: 60_000 }
  );
}

/**
 * Leaves a change the editor stored as a recovery point but never saved, by
 * removing the second block, then goes away without saving.
 */
async function leaveUnsavedChange(page: Page, id: string): Promise<void> {
  await openBuilder(page, id);
  const stored = recoveryPointStored(page, id);
  await block(page, "status-removed").click();
  await page.keyboard.press("Delete");
  await expect(block(page, "status-removed")).toHaveCount(0);
  await stored;
}

test.describe("the builder's page status", () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("an edit to a published page shows one unsaved signal, the Save button, and Publish changes", async ({
    page,
  }) => {
    const id = await createPublishedPage(page.request);
    await openBuilder(page, id);
    await expect(status(page)).toHaveText("Page status: Published");
    await expect(saveButton(page)).toHaveText("Saved");
    await expect(saveButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(publishButton(page)).toHaveText("Published");
    // No chip beside them says it again.
    await expect(
      page.locator('[data-topbar] [data-testid="save-state-indicator"]')
    ).toHaveCount(0);

    await block(page, "status-removed").click();
    await page.keyboard.press("Delete");

    // Save alone says the work is unsaved; Publish says the live page is
    // behind; the pill still says where the page is in its life.
    await expect(saveButton(page)).toHaveText("Save");
    await expect(publishButton(page)).toHaveText("Publish changes");
    await expect(status(page)).toHaveText("Page status: Published");
    const bar = page.locator("[data-topbar]");
    await expect(bar.getByText("Unsaved changes")).toHaveCount(0);
    await expect(bar.getByText("Modified")).toHaveCount(0);
    await expect(bar.getByText("Changed")).toHaveCount(0);

    // Saved as a draft of the live page: saved, and the live page behind.
    const saved = pageWrite(page, id);
    await saveButton(page).click();
    await saved;
    await expect(saveButton(page)).toHaveText("Saved");
    await expect(publishButton(page)).toHaveText("Publish changes");
    await expect(status(page)).toHaveText("Page status: Published");

    const published = pageWrite(page, id);
    await publishButton(page).click();
    await published;
    await expect(publishButton(page)).toHaveText("Published");
  });

  test("changes from a last visit open with Save enabled, and Save keeps them", async ({
    page,
  }) => {
    const id = await createPublishedPage(page.request);
    await leaveUnsavedChange(page, id);

    await openBuilder(page, id);
    await expect(saveButton(page)).toHaveText("Save");
    await expect(saveButton(page)).not.toHaveAttribute("aria-disabled", "true");

    // Save says what they are, and offers both answers.
    await saveButton(page).click();
    const popover = page.getByRole("dialog");
    await expect(popover.getByText(LAST_VISIT)).toBeVisible();
    await expect(
      popover.getByRole("button", { name: "Discard" })
    ).toBeVisible();

    const saved = pageWrite(page, id);
    await popover.getByRole("button", { name: "Save" }).click();
    await saved;
    await expect(saveButton(page)).toHaveText("Saved");
    await expect(block(page, "status-removed")).toHaveCount(0);
    await expect(publishButton(page)).toHaveText("Publish changes");
    await expect(status(page)).toHaveText("Page status: Published");

    // Saved for real: opened again, nothing is offered and the change holds.
    await openBuilder(page, id);
    await expect(saveButton(page)).toHaveText("Saved");
    await expect(block(page, "status-kept")).toHaveCount(1);
    await expect(block(page, "status-removed")).toHaveCount(0);
  });

  test("changes from a last visit are dropped by Discard, and Save goes back to saved", async ({
    page,
  }) => {
    const id = await createPublishedPage(page.request);
    await leaveUnsavedChange(page, id);

    await openBuilder(page, id);
    await expect(saveButton(page)).toHaveText("Save");

    await saveButton(page).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Discard" })
      .click();

    await expect(saveButton(page)).toHaveText("Saved");
    await expect(saveButton(page)).toHaveAttribute("aria-disabled", "true");
    // The page as saved: the change was never put back.
    await expect(block(page, "status-removed")).toHaveCount(1);
    await expect(publishButton(page)).toHaveText("Published");
    await expect(status(page)).toHaveText("Page status: Published");
  });
});
