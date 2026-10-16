/**
 * The Page Builder edits a translated page's DEFAULT language: it opens, draws
 * and saves that language, and leaves another language's layout as it was.
 * Translating happens on the translation page, not in the builder.
 *
 * Runs against the `translated-pages` e2e fixture, the one localized
 * collection with a translated blocks field. The fixture is registered only
 * for the e2e run; if it is missing, the first request below fails and says so
 * rather than the suite passing on nothing.
 *
 * @module tests/builder-language
 */
import { expect, test, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;
const ENTRIES = "/admin/api/collections/translated-pages/entries";

function page_(id: string, text: string) {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id, type: "core/heading", version: 1, props: { text, level: "h2" } },
    ],
  };
}

const ENGLISH = page_("en-heading", "The page in English");
const SPANISH = page_("es-heading", "La página en español");

async function translatedPage(page: Page): Promise<string> {
  const created = await page.request.post(ENTRIES, {
    data: { title: `Translated ${Date.now()}`, layout: ENGLISH },
  });
  expect(
    created.ok(),
    `creating a translated page (is the translated-pages fixture registered for this run?): ${created.status()}`
  ).toBe(true);
  const id = String(
    ((await created.json()) as { item: { id: string } }).item.id
  );
  const spanish = await page.request.patch(`${ENTRIES}/${id}?locale=es`, {
    data: { layout: SPANISH },
  });
  expect(spanish.ok(), `writing the Spanish layout: ${spanish.status()}`).toBe(
    true
  );
  return id;
}

async function layoutIn(page: Page, id: string, locale: string) {
  // `fallback-locale`, as the server spells it: off, a language reads only
  // its own value, never the default language's in its place.
  const read = await page.request.get(
    `${ENTRIES}/${id}?locale=${locale}&fallback-locale=none`
  );
  expect(read.ok()).toBe(true);
  return ((await read.json()) as { layout?: unknown }).layout;
}

function heading(page: Page, id: string) {
  return page.locator(`.nx-canvas [data-nx-node="${id}"]`).first();
}

test("opens, reloads and saves the default language only", async ({ page }) => {
  const id = await translatedPage(page);

  // Arriving from the Spanish edit screen still opens the default language:
  // the builder's address names no language.
  await gotoAdmin(page, `/collections/translated-pages/${id}?locale=es`);
  // Said beside the way in, since the preview above it shows the Spanish page.
  await expect(
    page.getByText(
      "Opens the default language, the one the Page Builder edits."
    )
  ).toBeVisible();
  await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/admin/collections/translated-pages/${id}/builder\\?field=layout$`
    )
  );
  await expect(heading(page, "en-heading")).toBeVisible({ timeout: 30_000 });
  await expect(heading(page, "es-heading")).toHaveCount(0);

  await page.reload();
  await expect(heading(page, "en-heading")).toBeVisible({ timeout: 30_000 });

  // One edit, saved with the form's own shortcut.
  await heading(page, "en-heading").click();
  await page.keyboard.press("Delete");
  await expect(heading(page, "en-heading")).toHaveCount(0);
  const saved = page.waitForResponse(
    response =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname === `${ENTRIES}/${id}`
  );
  await page.keyboard.press("Control+s");
  expect((await saved).ok()).toBe(true);

  // The default language holds the edit; Spanish is as it was.
  expect(await layoutIn(page, id, "en")).toMatchObject({ nodes: [] });
  expect(await layoutIn(page, id, "es")).toMatchObject({
    nodes: [{ id: "es-heading" }],
  });
});
