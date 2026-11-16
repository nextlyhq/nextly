/**
 * The page builder's one page status, in a browser.
 *
 * The pill beside the title says where the SAVED page stands (Draft,
 * Published or Changed) and nothing about unsaved edits, which only the save
 * chip reports. And changes left from a last visit, stored but never saved,
 * open with Save enabled, the chip saying "Unsaved changes" and its popover
 * "Changes from your last visit aren't saved yet." with Save and Discard:
 * never "Unsaved changes" beside a Save that does nothing.
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

/** The chip's control while changes from a last visit wait. */
const offerChip = (page: Page) =>
  end(page).getByRole("button", { name: "Unsaved changes: Save or Discard" });

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

/** The save state's chip, inside the end column. */
const chip = (page: Page) =>
  end(page).locator('[data-testid="save-state-indicator"]');

/** The page's status pill beside the title, its spoken prefix included. */
const status = (page: Page) =>
  start(page)
    .getByText(/^Page status:/)
    .locator("..");

/** The bar's own Save, not a row on an arrow. */
const barSave = (page: Page) =>
  end(page).getByRole("button", { name: "Save", exact: true });

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

  test("an edit to a published page shows one unsaved signal, and a draft save reads Changed", async ({
    page,
  }) => {
    const id = await createPublishedPage(page.request);
    await openBuilder(page, id);
    await expect(status(page)).toHaveText("Page status: Published");
    await expect(chip(page)).toHaveText("Saved");

    await block(page, "status-removed").click();
    await page.keyboard.press("Delete");

    // The chip alone says so; the pill still reports the saved page.
    await expect(chip(page)).toHaveText("Unsaved changes");
    await expect(status(page)).toHaveText("Page status: Published");
    const bar = page.locator("[data-topbar]");
    await expect(bar.getByText("Unsaved changes", { exact: true })).toHaveCount(
      1
    );
    await expect(bar.getByText("Modified")).toHaveCount(0);

    // Saved as a draft of the live page: changes waiting to be published.
    const saved = pageWrite(page, id);
    await barSave(page).click();
    await saved;
    await expect(chip(page)).toHaveText("Saved");
    await expect(status(page)).toHaveText("Page status: Changed");
  });

  test("changes from a last visit open with Save enabled, and Save keeps them", async ({
    page,
  }) => {
    const id = await createPublishedPage(page.request);
    await leaveUnsavedChange(page, id);

    await openBuilder(page, id);
    await expect(chip(page)).toHaveText("Unsaved changes");
    await expect(barSave(page)).toBeEnabled();

    // The chip's popover says what they are, and offers both answers.
    await offerChip(page).click();
    const popover = page.getByRole("dialog");
    await expect(popover.getByText(LAST_VISIT)).toBeVisible();
    await expect(
      popover.getByRole("button", { name: "Discard" })
    ).toBeVisible();
    await expect(popover.getByRole("button", { name: "Save" })).toBeVisible();
    await page.keyboard.press("Escape");

    const saved = pageWrite(page, id);
    await barSave(page).click();
    await saved;
    await expect(chip(page)).toHaveText("Saved");
    await expect(block(page, "status-removed")).toHaveCount(0);
    await expect(status(page)).toHaveText("Page status: Changed");

    // Saved for real: opened again, nothing is offered and the change holds.
    await openBuilder(page, id);
    await expect(chip(page)).toHaveText("Saved");
    await expect(block(page, "status-kept")).toHaveCount(1);
    await expect(block(page, "status-removed")).toHaveCount(0);
  });

  test("changes from a last visit are dropped by Discard, and the chip goes back to saved", async ({
    page,
  }) => {
    const id = await createPublishedPage(page.request);
    await leaveUnsavedChange(page, id);

    await openBuilder(page, id);
    await expect(offerChip(page)).toBeVisible();

    await offerChip(page).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Discard" })
      .click();

    await expect(chip(page)).toHaveText("Saved");
    await expect(barSave(page)).toBeDisabled();
    // The page as saved: the change was never put back.
    await expect(block(page, "status-removed")).toHaveCount(1);
    await expect(status(page)).toHaveText("Page status: Published");
  });
});
