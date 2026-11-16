/**
 * When a recovery point stops being offered for good, in a browser against a
 * real database: edits typed and deleted again, and Discard on the builder's
 * last-visit chip.
 *
 * Both are about a LATER session, so each case opens the document again from
 * the server (a reload, or a new tab, which is a new session in this tab's
 * storage): what is or is not offered there came from the stored point.
 *
 * @module tests/recovery-offer-lasting.spec
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { test } from "./support/test";

const POSTS = "/admin/api/collections/posts/entries";
const PAGES = "/admin/api/collections/pages/entries";

/** The editor storing a recovery point of this document. */
function pointStored(page: Page, slug: string, id: string) {
  return page.waitForResponse(
    response =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname.endsWith(
        `/collections/${slug}/entries/${id}/versions/autosave`
      ) &&
      response.ok(),
    { timeout: 60_000 }
  );
}

/** The editor reading this document's recovery point. */
function pointRead(page: Page, slug: string, id: string) {
  return page.waitForResponse(
    response =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname.endsWith(
        `/collections/${slug}/entries/${id}/versions/autosave`
      ) &&
      response.ok(),
    { timeout: 60_000 }
  );
}

test.describe("a recovery point that is no longer offered", () => {
  test.describe.configure({ timeout: 180_000 });

  test("typing in the title and deleting it again leaves no restore offer next time", async ({
    page,
  }) => {
    const title = `Undone ${Date.now()}`;
    const created = await page.request.post(POSTS, { data: { title } });
    expect(created.ok(), `creating a post: ${created.status()}`).toBe(true);
    const { item } = (await created.json()) as { item: { id: string } };

    await gotoAdmin(page, `/collections/posts/${item.id}`);
    const field = page.getByRole("textbox", { name: "Title", exact: true });
    await expect(field).toHaveValue(title);

    // Typed, and kept as a recovery point while the form held it.
    const recorded = pointStored(page, "posts", item.id);
    await field.click();
    await field.press("End");
    await field.pressSequentially(" abc");
    await recorded;

    // Deleted back to the saved title: the point is emptied.
    const emptied = pointStored(page, "posts", item.id);
    for (let i = 0; i < 4; i += 1) await field.press("Backspace");
    await expect(field).toHaveValue(title);
    await emptied;

    // Left and opened again: nothing to restore.
    const read = pointRead(page, "posts", item.id);
    await page.reload();
    await read;
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    await expect(field).toHaveValue(title);
    await expect(page.getByText(/unsaved changes from/i)).toBeHidden();
    await expect(page.getByRole("button", { name: /^restore$/i })).toHaveCount(
      0
    );
  });

  test("Discard on changes from a last visit is never offered again, in a new tab either", async ({
    page,
    context,
  }) => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const created = await page.request.post(PAGES, {
      data: {
        title: `Discard ${stamp}`,
        slug: `discard-${stamp}`,
        status: "published",
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            { id: "kept", type: "core/text", version: 1, props: { text: "A" } },
            {
              id: "removed",
              type: "core/text",
              version: 1,
              props: { text: "B" },
            },
          ],
        },
      },
    });
    expect(created.ok(), `creating a page: ${created.status()}`).toBe(true);
    const { item } = (await created.json()) as { item: { id: string } };
    const builder = `/collections/pages/${item.id}/builder?field=content`;
    const canvas = (on: Page) =>
      expect(on.getByRole("region", { name: "Canvas" })).toBeVisible({
        timeout: 60_000,
      });
    // The bar's Save, which makes the offer while changes wait.
    const saveButton = (on: Page) =>
      on.locator('[data-topbar="end"]').locator('[data-action="save"]');

    // A change stored as a recovery point and never saved.
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(page, builder);
    await canvas(page);
    const recorded = pointStored(page, "pages", item.id);
    await canvasFrame(page)
      .locator('.nx-canvas [data-nx-node="removed"]')
      .first()
      .click();
    await page.keyboard.press("Delete");
    await recorded;

    // Next visit: offered, and discarded.
    await gotoAdmin(page, builder);
    await canvas(page);
    await expect(saveButton(page)).toHaveText("Save");
    await saveButton(page).click();
    const emptied = pointStored(page, "pages", item.id);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Discard" })
      .click();
    await emptied;
    await expect(saveButton(page)).toHaveText("Saved");

    // A new tab is a new session: still nothing offered.
    const other = await context.newPage();
    await other.setViewportSize({ width: 1440, height: 900 });
    const read = pointRead(other, "pages", item.id);
    await gotoAdmin(other, builder);
    await read;
    await canvas(other);
    // Saved, and so offering nothing.
    await expect(saveButton(other)).toHaveText("Saved");
  });
});
