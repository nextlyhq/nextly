/**
 * "Publish all" says what it does to each language before it does it, and the
 * result says what it did.
 *
 * On a localized author whose English holds a pending change, whose Spanish is
 * live, and whose Arabic has no content of its own: the confirmation lists all
 * three with the server's outcome for each, and once confirmed the result
 * message reports each language's outcome and the pending change is live.
 * The plausible broken implementations say pending changes go live for every
 * language whatever it holds, or report only that every language was
 * published.
 *
 * @module tests/publish-all-dialog
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const AUTHORS = "/admin/api/collections/authors/entries";

/** An author live in English and Spanish, with a change held in English. */
async function authorWithAHeldChange(page: Page): Promise<string> {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const created = await page.request.post(`${AUTHORS}?locale=en`, {
    data: {
      title: `Published author ${stamp}`,
      jobTitle: "Mathematician",
      status: "published",
    },
  });
  expect(created.ok(), `creating an author: ${created.status()}`).toBe(true);
  const id = ((await created.json()) as { item?: { id?: string } }).item?.id;
  if (typeof id !== "string") throw new Error("the new author has no id");
  const spanish = await page.request.patch(`${AUTHORS}/${id}?locale=es`, {
    data: { jobTitle: "Matemática", status: "published", _overwrite: true },
  });
  expect(spanish.ok(), `publishing Spanish: ${spanish.status()}`).toBe(true);
  const held = await page.request.patch(`${AUTHORS}/${id}?locale=en`, {
    data: { jobTitle: "Mathematician and writer", _overwrite: true },
  });
  expect(held.ok(), `holding an English change: ${held.status()}`).toBe(true);
  return id;
}

test.describe("publishing every language", () => {
  test("lists what happens to each language, then reports what did", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await authorWithAHeldChange(page);
    await gotoAdmin(page, `/collections/authors/${id}`);

    await page
      .getByRole("complementary")
      .getByRole("button", { name: "Publish all" })
      .click();
    const dialog = page.getByRole("alertdialog");
    const list = dialog.getByRole("list", {
      name: "What happens to each language",
    });
    await expect(list.getByRole("listitem")).toHaveText([
      "EnglishIts unpublished changes go live.",
      "SpanishStays as published.",
      "ArabicGoes live with no content of its own, showing English.",
    ]);

    await dialog
      .getByRole("button", { name: "Publish all", exact: true })
      .click();

    await expect(
      page.getByText(
        "All languages published. English: its unpublished changes went live. Spanish: stayed as published. Arabic: went live with no content of its own, showing English."
      )
    ).toBeVisible();
    // The pending change is what went live, read back as the site reads it.
    const read = await page.request.get(`${AUTHORS}/${id}?locale=en`);
    const body = (await read.json()) as {
      jobTitle?: unknown;
      item?: { jobTitle?: unknown };
    };
    expect(body.item?.jobTitle ?? body.jobTitle).toBe(
      "Mathematician and writer"
    );
  });
});
