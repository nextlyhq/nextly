/**
 * Saving a pattern from the page builder does not save the page.
 *
 * The save-as-pattern dialog is a form of its own. Rendered anywhere under the
 * entry form in React's tree, its submit reaches the entry form's own submit
 * handler — React bubbles synthetic events through the component tree, portals
 * included — and the page is saved as a side effect of naming a pattern. That
 * is only observable in a real browser with the real admin around the editor:
 * the unit suites render the editor without the entry form that receives the
 * event.
 *
 * Observed by the requests the page makes, because a write to the document is
 * the effect that matters and the one an author cannot take back. The
 * pattern's own write is the positive control: an assertion of "no document
 * write" alone would also pass on a dialog that submitted nothing at all.
 *
 * @module tests/builder-pattern-dialog
 */
import { expect, type Page, type Request } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";

/*
 * The control that opens the page builder, in either of its wordings, kept as a
 * literal because this suite imports no product code. Its source is
 * `PageBuilderCard`.
 */
const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;

const HOMEPAGE_API = "/admin/api/singles/homepage";

/** A page holding one heading, which the pattern is saved from. */
const DOCUMENT = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "pattern-source",
      type: "core/heading",
      version: 1,
      props: { text: "A heading to save as a pattern", level: "h2" },
    },
  ],
};

/** Whether a request writes the homepage document itself. */
function writesTheDocument(request: Request): boolean {
  return (
    request.method() !== "GET" &&
    new URL(request.url()).pathname.startsWith(HOMEPAGE_API)
  );
}

/** Whether a request is the pattern's own write. */
function savesThePattern(request: Request): boolean {
  return (
    request.method() === "POST" &&
    new URL(request.url()).pathname.endsWith("/save-as-pattern")
  );
}

async function openBuilder(page: Page): Promise<void> {
  const seeded = await page.request.patch(HOMEPAGE_API, {
    data: { layout: DOCUMENT },
  });
  expect(seeded.ok(), `seeding the homepage layout: ${seeded.status()}`).toBe(
    true
  );
  await gotoAdmin(page, "/singles/homepage");
  await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
  await expect(
    page.locator('[data-nx-node="pattern-source"]').first()
  ).toBeVisible({ timeout: 30_000 });
}

test.describe("the save-as-pattern dialog", () => {
  test("saves the pattern without saving the page", async ({ page }) => {
    await openBuilder(page);

    const documentWrites: string[] = [];
    page.on("request", request => {
      if (writesTheDocument(request)) {
        documentWrites.push(`${request.method()} ${request.url()}`);
      }
    });

    await page.locator('[data-nx-node="pattern-source"]').first().click();
    await page.getByRole("button", { name: "Save as pattern" }).click();
    const dialog = page.getByRole("dialog", { name: "Save as pattern" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name").fill("Heading from the pattern test");
    // Required: without a granularity the browser's own validation stops the
    // submit before any handler runs, and nothing below is reached.
    await dialog.getByLabel("Element").check();

    // Enter in the name field, which the dialog turns into a form submit: the
    // path a keyboard author takes, and the one that reached the entry form.
    const patternSaved = page.waitForRequest(savesThePattern);
    await dialog.getByLabel("Name").press("Enter");
    await patternSaved;
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // A document write started by the same submit is sent within the same
    // task as the pattern's, so by the time the dialog has closed on the
    // pattern's answer it has long been on the wire. The wait below covers a
    // debounced save as well, which the form's autosave would be.
    await page.waitForTimeout(3_000);
    expect(documentWrites).toEqual([]);
  });
});
