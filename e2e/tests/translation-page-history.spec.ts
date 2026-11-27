/**
 * A past version of a language is read and restored on that language's own
 * page: its text is put into the page as unsaved work, nothing is written, and
 * the person's own save is what stores it.
 *
 * Runs on the playground's authors, whose Biography and Role / Title are kept
 * per language and whose other fields are shared.
 *
 * @module tests/translation-page-history
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { uniqueTag } from "./support/accounts";
import { gotoAdmin, type Theme } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { createEntry, expectOk } from "./support/runtime-collection";
import { ownSeat, test } from "./support/test";

const AUTHORS = "/admin/api/collections/authors/entries";
const ENGLISH = "Wrote the first published program.";
const FIRST = "Escribió el primer programa.";
const SECOND = "Escribió el primer programa publicado.";

/** Saves an author's Spanish, published. */
async function writeSpanish(
  page: Page,
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  await expectOk(
    await page.request.patch(`${AUTHORS}/${id}?locale=es`, {
      data: { ...data, status: "published", _overwrite: true },
    }),
    "writing the Spanish"
  );
}

/**
 * An author written in English, then twice in Spanish: versions 1, 2 and 3.
 * The second Spanish save changes a shared field too, so a version of the
 * first holds an older shared value that a restore must leave alone.
 */
async function authorSavedTwiceInSpanish(page: Page): Promise<string> {
  const id = await createEntry(page.request, "authors", {
    title: `Restored author ${uniqueTag()}`,
    status: "published",
    bio: ENGLISH,
    articleCount: 3,
  });
  await writeSpanish(page, id, { bio: FIRST });
  await writeSpanish(page, id, { bio: SECOND, articleCount: 9 });
  return id;
}

/** One language of an author as stored, the work waiting in it included. */
async function storedIn(
  page: Page,
  id: string,
  language: string
): Promise<Record<string, unknown>> {
  const read = await page.request.get(
    `${AUTHORS}/${id}?locale=${language}&fallback-locale=none&status=all&draft=true`
  );
  await expectOk(read, `reading the author in ${language}`);
  return (await read.json()) as Record<string, unknown>;
}

const pagePath = (id: string, query = "") =>
  `/translations/collections/authors/${id}?locale=es${query}`;

const actions = (page: Page): Locator =>
  page.getByRole("group", { name: "Spanish actions" });
const biography = (page: Page): Locator =>
  page
    .getByRole("group", { name: "Biography", exact: true })
    .locator('[data-slot="translation-target"]')
    .getByRole("textbox", { name: "Biography", exact: true });
const saveButton = (page: Page): Locator =>
  page.locator('[data-slot="translation-save"]');

/** Opens History and shows the first Spanish version. */
async function showFirstSpanish(page: Page): Promise<void> {
  await actions(page)
    .getByRole("button", { name: "History", exact: true })
    .click();
  const version = page.getByRole("button", { name: /Version 2\b/ });
  await expect(version).toBeVisible({ timeout: 30_000 });
  await version.click();
  await expect(
    actions(page).getByRole("button", { name: "Restore…" })
  ).toBeEnabled({ timeout: 30_000 });
}

test("restoring Spanish writes nothing until it is saved", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const id = await authorSavedTwiceInSpanish(page);
  const before = await storedIn(page, id, "es");
  const english = await storedIn(page, id, "en");

  /** Every write of the document the page sends, from here on. */
  const writes: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET" && path.startsWith(`${AUTHORS}/${id}`)) {
      // Not a write of the document: a version read is noted as seen.
      if (!path.endsWith("/seen")) writes.push(`${request.method()} ${path}`);
    }
  });

  await gotoAdmin(page, pagePath(id));
  await expect(biography(page)).toHaveValue(SECOND);
  await showFirstSpanish(page);
  // The page's own actions act on the live text, which is not on screen.
  await expect(saveButton(page)).toHaveCount(0);
  await expect(
    page.getByText("Shared fields are changed in the editor.")
  ).toBeVisible();

  await actions(page).getByRole("button", { name: "Restore…" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("checkbox", { name: "Biography" })
  ).toBeChecked();
  // Shared, so it is named and can't be put back here.
  await expect(
    dialog.getByRole("checkbox", { name: "Article Count" })
  ).toBeDisabled();
  await expectNoAxeViolations(page, { include: '[role="alertdialog"]' });
  await dialog.getByRole("button", { name: "Restore 1 field" }).click();

  // In the page as unsaved work, with nothing sent and nothing stored.
  await expect(biography(page)).toHaveValue(FIRST);
  await expect(saveButton(page)).toBeEnabled();
  expect(writes).toEqual([]);
  expect(await storedIn(page, id, "es")).toEqual(before);

  // The person's own save is the one write, and says where the text is from.
  const answered = page.waitForResponse(
    response =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname === `${AUTHORS}/${id}`
  );
  await saveButton(page).click();
  const response = await answered;
  expect(response.ok(), await response.text()).toBe(true);
  expect(response.request().postDataJSON()).toMatchObject({
    bio: FIRST,
    _restoredFrom: { bio: 2 },
  });
  expect(writes).toHaveLength(1);

  expect((await storedIn(page, id, "es")).bio).toBe(FIRST);
  const after = await storedIn(page, id, "en");
  expect(after.bio).toBe(english.bio);
  expect(after.articleCount).toBe(9);
  const history = await page.request.get(`${AUTHORS}/${id}/versions`);
  await expectOk(history, "reading the history");
  const { items } = (await history.json()) as {
    items: { fieldSources?: Record<string, number> }[];
  };
  expect(items[0]?.fieldSources).toEqual({ bio: 2 });
});

test.describe("reading history on the page", () => {
  ownSeat(1);

  test("an editor's history address in Spanish opens on Spanish's page", async ({
    page,
  }) => {
    const id = await authorSavedTwiceInSpanish(page);
    await gotoAdmin(page, `/collections/authors/${id}?locale=es&history=1`);
    await expect(page).toHaveURL(`/admin${pagePath(id, "&history=1")}`);
    await expect(
      page.getByRole("heading", { name: "History", exact: true })
    ).toBeVisible({ timeout: 30_000 });
  });

  test("unsaved words are there after a version is read", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await authorSavedTwiceInSpanish(page);
    await gotoAdmin(page, pagePath(id));
    await biography(page).fill("Palabras sin guardar.");
    await showFirstSpanish(page);
    await actions(page)
      .getByRole("button", { name: "Back to current" })
      .click();
    await expect(biography(page)).toHaveValue("Palabras sin guardar.");
  });

  for (const theme of ["light", "dark"] satisfies Theme[]) {
    test(`meets the accessibility rules in the ${theme} theme`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const id = await authorSavedTwiceInSpanish(page);
      await gotoAdmin(page, pagePath(id), theme);
      await showFirstSpanish(page);
      await expectNoAxeViolations(page);
    });
  }

  test("on a phone History is on screen and takes the whole width", async ({
    page,
  }) => {
    const width = 390;
    await page.setViewportSize({ width, height: 844 });
    const id = await authorSavedTwiceInSpanish(page);
    await gotoAdmin(page, pagePath(id));
    const history = actions(page).getByRole("button", {
      name: "History",
      exact: true,
    });
    const box = await history.boundingBox();
    if (box === null) throw new Error("History is not drawn");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);

    await history.click();
    const panel = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "History", exact: true }),
    });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    expect((await panel.boundingBox())?.width).toBe(width);
  });
});
