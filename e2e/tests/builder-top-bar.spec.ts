/**
 * The page builder's top bar, at its far end, in a browser: the panel
 * buttons, search, Preview, and Save and Publish, which say the page's state
 * themselves, Publish with its other ways to publish on its arrow.
 *
 * Driven through a page's whole life on a collection with drafts (edit, save,
 * publish, edit, save, publish again, unpublish, with and without a saved
 * working draft), through a save the network refuses, and on the homepage
 * Single, which has no lifecycle and so offers Save alone, through a Design
 * write the network refuses.
 *
 * @module tests/builder-top-bar.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { openEditorWith } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { canvasFrame } from "./support/canvas-frame";

const ENTRIES = "/admin/api/collections/pages/entries";

const NODES = [
  { id: "bar-first", type: "core/text", version: 1, props: { text: "Kept" } },
  {
    id: "bar-second",
    type: "core/text",
    version: 1,
    props: { text: "Removed by the test" },
  },
];

/** A draft page of its own, and its id. */
async function createPage(request: APIRequestContext): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Top bar ${stamp}`,
      slug: `top-bar-${stamp}`,
      status: "draft",
      content: { formatVersion: 1, kind: "page", nodes: NODES },
    },
  });
  expect(created.ok(), `creating a page: ${created.status()}`).toBe(true);
  const body = (await created.json()) as { item: { id: string } };
  return body.item.id;
}

/** The bar's end column. */
const end = (page: Page) => page.locator('[data-topbar="end"]');

/** The bar's Save, in whichever state it reads. */
const saveButton = (page: Page) => end(page).locator('[data-action="save"]');

/** The bar's Publish, in whichever state it reads. */
const publishButton = (page: Page) =>
  end(page).locator('[data-action="publish"]');

/** A block on the canvas, by its node id. */
const block = (page: Page, id: string) =>
  canvasFrame(page).locator(`.nx-canvas [data-nx-node="${id}"]`).first();

/** Removes a block, as an edit. */
async function removeBlock(page: Page, id: string): Promise<void> {
  await block(page, id).click();
  await page.keyboard.press("Delete");
  await expect(block(page, id)).toHaveCount(0);
}

/** A page of its own, made through the API, and its id. */
async function openDraftPage(page: Page): Promise<string> {
  const id = await createPage(page.request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  return id;
}

/** Unpublishes from Publish's arrow, confirming as the entry's page asks. */
async function unpublish(page: Page, id: string): Promise<void> {
  await end(page).getByRole("button", { name: "More ways to publish" }).click();
  await page.getByRole("menuitem", { name: "Unpublish" }).click();
  const unpublished = pageWrite(page, id);
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Unpublish" })
    .click();
  await unpublished;
}

/** The page's status pill beside the title, its spoken prefix included. */
const status = (page: Page) =>
  page
    .locator('[data-topbar="start"]')
    .getByText(/^Page status:/)
    .locator("..");

/** The names of the end column's buttons, in order. */
async function endButtons(page: Page): Promise<string[]> {
  return end(page)
    .getByRole("button")
    .evaluateAll(buttons =>
      buttons.map(
        button =>
          button.getAttribute("aria-label") ?? (button.textContent ?? "").trim()
      )
    );
}

/** The rows on the leading action's arrow, then closes it. */
async function arrowRows(page: Page, arrow: string): Promise<string[]> {
  await end(page).getByRole("button", { name: arrow }).click();
  const rows = await page
    .getByRole("menu")
    .getByRole("menuitem")
    .allTextContents();
  await page.keyboard.press("Escape");
  return rows;
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

test.describe("the top bar's far end", () => {
  test.describe.configure({ timeout: 240_000 });

  test("takes a draft page through edit, save, publish, publish again and unpublish", async ({
    page,
  }) => {
    const id = await openDraftPage(page);

    // The panel buttons first, then search, Preview, and Save and Publish,
    // the bar ending on the page's own verbs.
    await expect
      .poll(async () => (await endButtons(page)).slice(0, 6))
      .toEqual([
        "Left panel",
        "Inspector",
        "Search and commands",
        "Preview",
        "Saved",
        "Publish",
      ]);
    await expect(status(page)).toHaveText("Page status: Draft");

    // An edit: Save says so, and Publish still offers to publish.
    await removeBlock(page, "bar-second");
    await expect(saveButton(page)).toHaveText("Save");
    await expect(publishButton(page)).toHaveText("Publish");

    const saved = pageWrite(page, id);
    await saveButton(page).click();
    await saved;
    await expect(saveButton(page)).toHaveText("Saved");
    await expect(status(page)).toHaveText("Page status: Draft");

    const published = pageWrite(page, id);
    await publishButton(page).click();
    await published;
    await expect(publishButton(page)).toHaveText("Published");
    await expect(status(page)).toHaveText("Page status: Published");

    // Unpublished with nothing saved beside it: Publish, and Draft.
    await unpublish(page, id);
    await expect(publishButton(page)).toHaveText("Publish");
    await expect(status(page)).toHaveText("Page status: Draft");

    // Published again, then an edit saved beside the live page.
    const again = pageWrite(page, id);
    await publishButton(page).click();
    await again;
    await expect(publishButton(page)).toHaveText("Published");
    await removeBlock(page, "bar-first");
    await expect(publishButton(page)).toHaveText("Publish changes");
    const kept = pageWrite(page, id);
    await saveButton(page).click();
    await kept;
    await expect(saveButton(page)).toHaveText("Saved");
    await expect(publishButton(page)).toHaveText("Publish changes");

    // Unpublished with a saved working draft: still Publish, and Draft.
    await unpublish(page, id);
    await expect(publishButton(page)).toHaveText("Publish");
    await expect(status(page)).toHaveText("Page status: Draft");
  });

  test("a save the network refuses reads Retry save with the reason, and Retry save saves", async ({
    page,
  }) => {
    const id = await openDraftPage(page);
    await removeBlock(page, "bar-second");

    // The page's own write is refused, as when the network is off.
    const write = new RegExp(`/collections/pages/entries/${id}(\\?|$)`);
    await page.route(write, async route => {
      try {
        if (["PATCH", "PUT"].includes(route.request().method())) {
          await route.abort("internetdisconnected");
        } else {
          await route.continue();
        }
      } catch {
        // The page moved on; nothing is left to answer.
      }
    });
    await saveButton(page).click();
    await expect(saveButton(page)).toHaveText("Retry save");
    const notice = page.getByTestId("document-save-publish-notice");
    await expect(notice.getByText("Not saved", { exact: true })).toBeVisible();
    await expect(page.getByTestId("document-save-publish-failure")).toHaveText(
      /^Not saved\. .+/
    );

    await page.unroute(write);
    const saved = pageWrite(page, id);
    await saveButton(page).click();
    await saved;
    await expect(saveButton(page)).toHaveText("Saved");
    await expect(page.getByTestId("document-save-publish-failure")).toHaveText(
      ""
    );
  });
});

test.describe("a document with no lifecycle", () => {
  // The homepage Single is reseeded here, as the other builder files do, and
  // the site's style is written and refused.
  test.describe.configure({
    lock: [LOCK.homepage, LOCK.siteStyle],
    timeout: 180_000,
  });

  test("offers Save alone, with the same states", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, "bar-first");
    const buttons = await endButtons(page);
    expect(buttons).toContain("Saved");
    expect(buttons).not.toContain("Publish");
    expect(buttons).not.toContain("More ways to publish");
    await expect(publishButton(page)).toHaveCount(0);
    await expect(saveButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(
      page.locator('[data-topbar] [data-testid="save-state-indicator"]')
    ).toHaveCount(0);
  });

  test("a Design write the network refuses reads Retry save, naming it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, "bar-first");
    await page.route("**/admin/api/singles/site-style", async route => {
      try {
        if (["PATCH", "PUT"].includes(route.request().method())) {
          await route.abort("internetdisconnected");
        } else {
          await route.continue();
        }
      } catch {
        // The page moved on; nothing is left to answer.
      }
    });
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
    await page.getByRole("button", { name: /^Primary, light / }).click();
    const value = page
      .getByRole("dialog", { name: "Edit Primary" })
      .getByLabel("Light", { exact: true });
    await value.fill("#123456");
    await value.press("Enter");
    await page.keyboard.press("Escape");

    await expect(saveButton(page)).toHaveText("Retry save");
    await expect(page.getByTestId("document-save-publish-failure")).toHaveText(
      /^Not saved\. .*wasn't saved/
    );
  });
});
