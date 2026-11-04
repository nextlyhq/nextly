/**
 * The page builder's top bar, at its far end, in a browser: the panel
 * buttons, whether the work is saved, Preview, and the entry's leading action
 * with its other ways to publish on its arrow.
 *
 * Driven through a page's whole life on a collection with drafts (edit, save,
 * publish, unpublish), and on the homepage Single, which has no lifecycle and
 * so offers Save alone.
 *
 * @module tests/builder-top-bar.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { openEditorWith, pressSave } from "./canvas/editor-driver";
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

/** The save state's chip, inside the end column. */
const chip = (page: Page) =>
  end(page).locator('[data-testid="save-state-indicator"]');

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
  test.describe.configure({ timeout: 180_000 });

  test("takes a draft page through edit, save, publish and unpublish", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 60_000,
    });

    // The panel buttons first, then search, the save state, Preview, and
    // Publish with its arrow, the bar ending on the action that leads.
    await expect
      .poll(() => endButtons(page))
      .toEqual([
        "Left panel",
        "Inspector",
        "Search and commands",
        "Preview",
        "Publish",
        "More ways to publish",
      ]);
    await expect(status(page)).toHaveText("Page status: Draft");

    // The arrow holds the private save and the other ways to publish; the
    // entry's own page keeps duplicating, discarding and deleting.
    const draftRows = await arrowRows(page, "More ways to publish");
    expect(draftRows[0]).toBe("Save draft");
    for (const kept of [
      "Duplicate",
      "Delete",
      "Discard changes",
      "Unpublish",
    ]) {
      expect(draftRows).not.toContain(kept);
    }

    // An edit is unsaved work, in the chip beside the verbs that store it.
    await canvasFrame(page)
      .locator('.nx-canvas [data-nx-node="bar-second"]')
      .first()
      .click();
    await page.keyboard.press("Delete");
    await expect(chip(page)).toHaveText("Unsaved changes");

    const saved = pageWrite(page, id);
    await pressSave(page);
    await saved;
    await expect(chip(page)).toHaveText("Saved");
    await expect(status(page)).toHaveText("Page status: Draft");

    const published = pageWrite(page, id);
    await end(page)
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await published;
    await expect(status(page)).toHaveText("Page status: Published");

    // Published with nothing pending: saving leads, and is disabled for real
    // with its reason, rather than looking pressable and doing nothing.
    const save = end(page).getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeDisabled();
    // Its title is the reason it is held, not its own name again.
    await expect(save).toHaveAttribute("title", /^(?!Save$).+/);
    expect(await arrowRows(page, "More document actions")).toContain(
      "Unpublish"
    );

    // Unpublish asks first, as on the entry's page, and then takes it down.
    await end(page)
      .getByRole("button", { name: "More document actions" })
      .click();
    await page.getByRole("menuitem", { name: "Unpublish" }).click();
    const unpublished = pageWrite(page, id);
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Unpublish" })
      .click();
    await unpublished;
    await expect(status(page)).toHaveText("Page status: Draft");
  });
});

test.describe("a document with no lifecycle", () => {
  // The homepage Single is reseeded here, as the other builder files do.
  test.describe.configure({ lock: [LOCK.homepage], timeout: 180_000 });

  test("offers Save alone, with no arrow", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, "bar-first");
    const buttons = await endButtons(page);
    expect(buttons).toContain("Save");
    expect(buttons).not.toContain("Publish");
    expect(buttons).not.toContain("More ways to publish");
    expect(buttons).not.toContain("More document actions");
    await expect(chip(page)).toHaveCount(1);
  });
});
