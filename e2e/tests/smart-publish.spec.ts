/**
 * Publish from the editor: one click when only the language on screen changes, and the choice of
 * what goes live when another language holds changes.
 *
 * On the three-language playground's authors.
 * The plausible broken versions: a dialog on every publish, and one click past a waiting Spanish
 * change.
 *
 * @module tests/smart-publish
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const AUTHORS = "/admin/api/collections/authors/entries";

/** An author live in English and Spanish, with `spanishHeld` waiting in Spanish. */
async function liveAuthor(page: Page, spanishHeld?: string): Promise<string> {
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
  if (spanishHeld !== undefined) {
    const held = await page.request.patch(`${AUTHORS}/${id}?locale=es`, {
      data: { jobTitle: spanishHeld, _overwrite: true },
    });
    expect(held.ok(), `holding a Spanish change: ${held.status()}`).toBe(true);
  }
  // A change held in English, so the header's main button is "Publish changes".
  const english = await page.request.patch(`${AUTHORS}/${id}?locale=en`, {
    data: { jobTitle: "Mathematician and writer", _overwrite: true },
  });
  expect(english.ok(), `holding an English change: ${english.status()}`).toBe(
    true
  );
  return id;
}

/** What a visitor reads of the author in `locale`. */
async function liveJobTitle(page: Page, id: string, locale: string) {
  const read = await page.request.get(`${AUTHORS}/${id}?locale=${locale}`);
  const body = (await read.json()) as {
    jobTitle?: unknown;
    item?: { jobTitle?: unknown };
  };
  return body.item?.jobTitle ?? body.jobTitle;
}

test.describe("Publish from the editor", () => {
  test("publishes in one click when only the language on screen changes", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await liveAuthor(page);
    await gotoAdmin(page, `/collections/authors/${id}`);

    await page.getByRole("button", { name: "Publish changes" }).click();

    await expect
      .poll(() => liveJobTitle(page, id, "en"))
      .toBe("Mathematician and writer");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("opens the choice when another language holds changes, and publishes only what is chosen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const id = await liveAuthor(page, "Matemática y escritora");
    await gotoAdmin(page, `/collections/authors/${id}`);

    await page.getByRole("button", { name: "Publish changes" }).click();
    const dialog = page.getByRole("dialog", { name: "Publish changes" });
    await expect(
      dialog.getByRole("checkbox", { name: /English/ })
    ).toBeChecked();
    const spanish = dialog.getByRole("checkbox", { name: "Spanish" });
    await expect(spanish).not.toBeChecked();
    await expect(spanish).toHaveAccessibleDescription(
      /go live for readers of Spanish/
    );

    await dialog.getByRole("button", { name: "Publish selected" }).click();
    await expect(dialog).toBeHidden();

    expect(await liveJobTitle(page, id, "en")).toBe("Mathematician and writer");
    expect(await liveJobTitle(page, id, "es")).toBe("Matemática");
  });
});
