/**
 * A collection list on a site with three languages (English, Spanish, Arabic) shows each
 * document's languages as labelled chips with a key, filters by "Missing in" and "Out of date
 * in" a language, and shows titles in a chosen language, each with its language's `lang` and
 * `dir`.
 *
 * Runs against the `translated-pages` e2e fixture: a localized collection whose title is
 * translated. Two pages are made for this run, found by a stamp in their titles:
 * - "Lantern": Spanish written, then the English title changed (Spanish out of date), no Arabic;
 * - "Harbour": Arabic written, no Spanish.
 *
 * @module tests/entry-list-languages
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { STORAGE_STATE } from "../global-setup";

import { expectNoAxeViolations } from "./support/axe";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/translated-pages/entries";
const STAMP = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const LANTERN = `Lantern ${STAMP}`;
const LANTERN_REVISED = `Lantern, revised ${STAMP}`;
const LINTERNA = `Linterna ${STAMP}`;
const HARBOUR = `Harbour ${STAMP}`;
const MINAA = `ميناء ${STAMP}`;

// One set of pages for the whole file.
test.describe.configure({ mode: "serial" });

async function write(
  api: APIRequestContext,
  method: "post" | "patch",
  url: string,
  data: Record<string, unknown>
): Promise<string> {
  const res = await api[method](url, { data });
  expect(
    res.ok(),
    `${method} ${url} (is the translated-pages fixture registered for this run?): ${res.status()}`
  ).toBe(true);
  return String(((await res.json()) as { item: { id: string } }).item.id);
}

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  // Signed in as the suite's admin, as every page of the suite is.
  const api = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
  try {
    const lantern = await write(api, "post", ENTRIES, { title: LANTERN });
    await write(api, "patch", `${ENTRIES}/${lantern}?locale=es`, {
      title: LINTERNA,
      _overwrite: true,
    });
    const harbour = await write(api, "post", ENTRIES, { title: HARBOUR });
    await write(api, "patch", `${ENTRIES}/${harbour}?locale=ar`, {
      title: MINAA,
      _overwrite: true,
    });
    // A second later, so the English change is written after the Spanish on a database whose
    // timestamps keep whole seconds: the Spanish is then out of date.
    await new Promise(resolve => setTimeout(resolve, 1100));
    await write(api, "patch", `${ENTRIES}/${lantern}?locale=en`, {
      title: LANTERN_REVISED,
      _overwrite: true,
    });
  } finally {
    await api.dispose();
  }
});

/** The list of translated pages, narrowed by search to this run's two. */
async function openList(page: Page): Promise<void> {
  await gotoAdmin(page, "/collections/translated-pages");
  await page.locator("[data-entry-search-input]").fill(STAMP);
  await expect(visibleRow(page, LANTERN_REVISED)).toBeVisible();
  await expect(visibleRow(page, HARBOUR)).toBeVisible();
}

/** A row drawn at this width (rows are drawn twice: table and narrow cards), by text in it. */
function visibleRow(page: Page, text: string) {
  return page
    .locator("[data-row-id]")
    .filter({ hasText: text })
    .filter({ visible: true });
}

/** A title drawn at this width, marked with the language it is written in. */
function shownTitle(page: Page, text: string) {
  return page
    .locator("[data-title-language]")
    .filter({ hasText: text })
    .filter({ visible: true });
}

async function chooseFilter(page: Page, option: string): Promise<void> {
  await page.getByRole("button", { name: /Filter/ }).click();
  await page
    .getByRole("menu")
    .getByRole("menuitemcheckbox", { name: option })
    .click();
  await page.keyboard.press("Escape");
}

async function chooseTitleLanguage(page: Page, language: string) {
  await page.getByRole("combobox", { name: /Titles in/ }).click();
  await page.getByRole("option", { name: language }).click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("shows each page's languages as chips, with the key", async ({ page }) => {
  await openList(page);

  const lantern = visibleRow(page, LANTERN_REVISED);
  await expect(
    lantern.getByRole("button", { name: "Open in English, EN, live" })
  ).toBeVisible();
  await expect(
    lantern.getByRole("button", {
      name: "Open in Spanish, ES, out of date, live",
    })
  ).toBeVisible();
  await expect(
    lantern.getByRole("button", { name: "Open in Arabic, AR, missing" })
  ).toBeVisible();

  const harbour = visibleRow(page, HARBOUR);
  await expect(
    harbour.getByRole("button", { name: "Open in Spanish, ES, missing" })
  ).toBeVisible();
  await expect(
    harbour.getByRole("button", { name: "Open in Arabic, AR, live" })
  ).toBeVisible();

  const key = page.getByRole("list", { name: "Language key" });
  await expect(key.getByRole("listitem")).toHaveText([
    /^Live/,
    /^Changes/,
    /^Out of date/,
    /^Draft/,
    /^Missing/,
  ]);

  // Scanned with the search cleared: its clear button is the shared search
  // field's, not this list's.
  await page.locator("[data-entry-search-input]").fill("");
  await expectNoAxeViolations(page, { include: "main" });
});

test("filters by out of date in, and by missing in, a language, kept in the address", async ({
  page,
}) => {
  await openList(page);

  await chooseFilter(page, "Out of date in Spanish");
  await expect(page).toHaveURL(/pf=nextly\.language(%3A|:)out-of-date\.es/);
  await expect(visibleRow(page, LANTERN_REVISED)).toBeVisible();
  await expect(visibleRow(page, HARBOUR)).toHaveCount(0);

  await chooseFilter(page, "Missing in Spanish");
  await expect(page).toHaveURL(/pf=nextly\.language(%3A|:)missing\.es/);
  await expect(visibleRow(page, HARBOUR)).toBeVisible();
  await expect(visibleRow(page, LANTERN_REVISED)).toHaveCount(0);

  // The address alone opens the same list.
  await page.reload();
  await page.locator("[data-entry-search-input]").fill(STAMP);
  await expect(visibleRow(page, HARBOUR)).toBeVisible();
  await expect(visibleRow(page, LANTERN_REVISED)).toHaveCount(0);
});

test("shows titles in a chosen language, each marked with its language and direction", async ({
  page,
}) => {
  await openList(page);

  await chooseTitleLanguage(page, "Spanish");
  await expect(shownTitle(page, LINTERNA)).toHaveAttribute("lang", "es");
  await expect(shownTitle(page, LINTERNA)).toHaveAttribute("dir", "ltr");
  // Harbour has no Spanish title: its English one stays, marked as English, never as Spanish.
  await expect(shownTitle(page, HARBOUR)).toHaveAttribute("lang", "en");
  await expect(visibleRow(page, HARBOUR)).toContainText("(English)");

  await chooseTitleLanguage(page, "Arabic");
  await expect(shownTitle(page, MINAA)).toHaveAttribute("lang", "ar");
  await expect(shownTitle(page, MINAA)).toHaveAttribute("dir", "rtl");
  await expect(shownTitle(page, LANTERN_REVISED)).toHaveAttribute("lang", "en");

  await chooseTitleLanguage(page, "English");
  await expect(page.locator("[data-title-language]")).toHaveCount(0);
});

test("keeps every language control on screen at 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openList(page);

  for (const control of [
    page.getByRole("combobox", { name: /Titles in/ }),
    page.getByRole("button", { name: /Filter/ }),
    page.getByRole("list", { name: "Language key" }),
  ]) {
    const box = await control.boundingBox();
    expect(box, "drawn").not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  // The page itself does not scroll sideways.
  const scrolls = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(scrolls).toBe(false);
});
