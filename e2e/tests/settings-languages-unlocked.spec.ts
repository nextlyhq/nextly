/**
 * Settings › Languages on a site whose configuration declares no languages,
 * so Settings keeps them: it starts with English alone, and each change is
 * made through the screen and read back through the languages API, so what
 * the screen says was saved is what the server stored.
 *
 * - a one-language site reads correctly: English, the default, and the way to
 *   add a second; at 390 px nothing falls off the side; axe's AA scan;
 * - add Spanish and Arabic, the dialog saying that no content changes and
 *   nothing is migrated;
 * - rename Arabic, then move it above Spanish;
 * - remove Arabic, confirmed after reading that its content is kept, then add
 *   it back;
 * - make Spanish the default, after reading the server's summary of what that
 *   changes;
 * - the keyboard reaches every control, in order, with its focus drawn.
 *
 * Runs only on a playground started with no languages declared and its
 * content untranslated (`E2E_LANGUAGES_UNLOCKED_ONLY=1`, see
 * e2e/playwright.config.ts and apps/playground/nextly.config.ts). The
 * playground as it ships, which locks the list, is
 * `settings-languages.spec.ts`.
 *
 * @module tests/settings-languages-unlocked.spec
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { emptyScanReason, scanAxe } from "./support/axe-scan.mjs";
import { test } from "./support/test";

// Each test builds on the list the one before it left. A retry runs the
// file again from its first test, on the server the failed attempt left, so
// the first test starts by putting the site back to English alone.
test.describe.configure({ mode: "serial" });

const LANGUAGES = "/admin/api/languages";

interface StoredLanguage {
  code: string;
  label: string;
  direction: "ltr" | "rtl";
  fallback: string[];
  position: number;
  isDefault: boolean;
  active: boolean;
}

/** The languages as the API answers them now, in order, the removed ones included. */
async function languagesOf(
  api: APIRequestContext
): Promise<{ lockedByConfig: boolean; languages: StoredLanguage[] }> {
  const read = await api.get(LANGUAGES);
  expect(read.ok(), await read.text()).toBe(true);
  const body = (await read.json()) as {
    items: StoredLanguage[];
    meta: { lockedByConfig: boolean };
  };
  return { lockedByConfig: body.meta.lockedByConfig, languages: body.items };
}

/** The active languages' codes, in the site's order. */
async function activeCodes(api: APIRequestContext): Promise<string[]> {
  return (await languagesOf(api)).languages
    .filter(language => language.active)
    .sort((a, b) => a.position - b.position)
    .map(language => language.code);
}

/** Makes one change through the API, which must be saved. */
async function change(
  api: APIRequestContext,
  data: Record<string, unknown>
): Promise<void> {
  const saved = await api.post(LANGUAGES, { data });
  expect(saved.ok(), await saved.text()).toBe(true);
}

/**
 * Puts the site back to English alone, its default, from wherever an earlier
 * attempt of this file stopped: English added back if it was removed, made
 * the default again, every other language removed. Changes nothing on a site
 * that already has English alone, as a first attempt's has.
 */
async function startWithEnglishAlone(api: APIRequestContext): Promise<void> {
  let { languages } = await languagesOf(api);
  const english = languages.find(each => each.code === "en");
  if (english && !english.active) {
    await change(api, { kind: "add", code: "en", label: "English" });
    ({ languages } = await languagesOf(api));
  }
  const current = languages.find(each => each.isDefault && each.active);
  if (current && current.code !== "en") {
    await change(api, { kind: "setDefault", code: "en", confirmed: true });
  }
  for (const other of languages.filter(
    each => each.active && each.code !== "en"
  )) {
    await change(api, { kind: "remove", code: other.code });
  }
  expect(await activeCodes(api)).toEqual(["en"]);
}

async function openLanguages(page: Page): Promise<Locator> {
  await gotoAdmin(page, "/settings/languages");
  const list = page.getByRole("list", { name: "Languages in use" });
  await expect(list).toBeVisible({ timeout: 30_000 });
  return list;
}

/** The names on the list's rows, in order. */
function rowNames(list: Locator): Promise<string[]> {
  return list
    .getByRole("listitem")
    .evaluateAll(rows =>
      rows.map(row => row.querySelector("span")?.textContent ?? "")
    );
}

/** Chooses `action` from a language's menu. */
async function choose(page: Page, name: string, action: string) {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

/** Adds a language through the Add dialog. */
async function addLanguage(
  page: Page,
  language: { code: string; name: string; rtl?: boolean; fallback: string }
) {
  await page.getByRole("button", { name: "Add language" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a language" });
  await expect(dialog).toContainText(
    "Adding a language changes no content and nothing is migrated."
  );
  await dialog.getByLabel("Code").fill(language.code);
  await dialog.getByLabel("Name").fill(language.name);
  if (language.rtl) {
    await dialog.getByRole("radio", { name: "Right to left" }).click();
  }
  await dialog.getByRole("combobox", { name: "Falls back to" }).click();
  await page.getByRole("option", { name: language.fallback }).click();
  await dialog.getByRole("button", { name: "Add language" }).click();
  await expect(dialog).toBeHidden();
}

/** The shared destructive (red) button inside the open confirm dialog. */
const RED_CONFIRM = '[role="alertdialog"] [data-slot="button.destructive"]';

/**
 * axe's AA scan of the open confirm dialog, every rule on every element, with
 * one result set aside by rule AND element: `color-contrast` on the red
 * confirm itself. Every other rule still runs on that button, and contrast
 * still fails anywhere else in the dialog.
 */
async function expectDialogPassesAxeButItsRedConfirm(page: Page) {
  const scope = { include: '[role="alertdialog"]' };
  // Its opening animation finished first, as `expectNoAxeViolations` waits.
  await page.locator(scope.include).evaluate(async element => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map(animation => animation.finished.catch(() => undefined))
    );
  });
  const { results, findings } = await scanAxe(page, scope);
  const empty = emptyScanReason(results, scope);
  expect(empty, empty ?? undefined).toBeNull();
  const left = [];
  for (const finding of findings) {
    const targets = [];
    for (const target of finding.targets) {
      const isRedConfirm =
        finding.id === "color-contrast" &&
        (await page.evaluate(
          ([selector, red]) =>
            document.querySelector(selector)?.matches(red) === true,
          [target, RED_CONFIRM]
        ));
      if (!isRedConfirm) targets.push(target);
    }
    if (targets.length > 0) left.push({ ...finding, targets });
  }
  // The shared destructive red is below AA against its text; tracked apart.
  expect(left, JSON.stringify(left, null, 2)).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("a site of one language: English, the default, and where a second is added", async ({
  page,
}) => {
  // The positive control for this file: the server answers an unlocked list.
  expect((await languagesOf(page.request)).lockedByConfig).toBe(false);
  await startWithEnglishAlone(page.request);

  const list = await openLanguages(page);
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("listitem")).toContainText("English");
  await expect(list.getByRole("listitem")).toContainText("Default");
  await expect(
    page.getByText(
      "This site has one language. Add another to translate content into it."
    )
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add language" })
  ).toBeVisible();
  await expect(page.getByText(/set in this site's configuration/)).toHaveCount(
    0
  );
  await expectNoAxeViolations(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Add language" })
  ).toBeVisible();
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
});

test("adds Spanish and Arabic, saying that no content changes", async ({
  page,
}) => {
  const list = await openLanguages(page);
  await addLanguage(page, { code: "es", name: "Spanish", fallback: "English" });
  await addLanguage(page, {
    code: "ar",
    name: "Arabic",
    rtl: true,
    fallback: "English",
  });

  await expect(list.getByRole("listitem")).toHaveCount(3);
  expect(await rowNames(list)).toEqual(["English", "Spanish", "Arabic"]);
  const stored = (await languagesOf(page.request)).languages;
  expect(stored.find(each => each.code === "es")).toMatchObject({
    label: "Spanish",
    direction: "ltr",
    fallback: ["en"],
    active: true,
    isDefault: false,
  });
  expect(stored.find(each => each.code === "ar")).toMatchObject({
    label: "Arabic",
    direction: "rtl",
    fallback: ["en"],
    active: true,
  });
});

test("renames Arabic, then moves it above Spanish", async ({ page }) => {
  const list = await openLanguages(page);
  await choose(page, "Arabic", "Edit…");
  const dialog = page.getByRole("dialog", { name: "Edit Arabic" });
  await dialog.getByLabel("Name").fill("Arabic (Modern Standard)");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  expect(
    (await languagesOf(page.request)).languages.find(each => each.code === "ar")
      ?.label
  ).toBe("Arabic (Modern Standard)");

  await choose(page, "Arabic (Modern Standard)", "Move up");
  await expect
    .poll(() => rowNames(list))
    .toEqual(["English", "Arabic (Modern Standard)", "Spanish"]);
  expect(await activeCodes(page.request)).toEqual(["en", "ar", "es"]);
});

test("removes Arabic once confirmed, keeping its content, and adds it back", async ({
  page,
}) => {
  const list = await openLanguages(page);
  const arabic = "Arabic (Modern Standard)";
  await choose(page, arabic, "Remove…");
  const dialog = page.getByRole("alertdialog", { name: `Remove ${arabic}?` });
  await expect(dialog).toContainText(
    `Editors can no longer write or translate content in ${arabic}.`
  );
  await expect(dialog).toContainText("The content is kept.");
  await expectDialogPassesAxeButItsRedConfirm(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(await activeCodes(page.request)).toEqual(["en", "ar", "es"]);

  await choose(page, arabic, "Remove…");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: `Remove ${arabic}` })
    .click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  const removed = page.getByRole("list", { name: "Removed languages" });
  await expect(removed).toContainText(arabic);
  expect(await rowNames(list)).toEqual(["English", "Spanish"]);
  expect(
    (await languagesOf(page.request)).languages.find(each => each.code === "ar")
      ?.active
  ).toBe(false);

  await removed.getByRole("button", { name: `Add ${arabic} back` }).click();
  await expect(removed).toBeHidden();
  await expect(list.getByRole("listitem")).toHaveCount(3);
  expect(await activeCodes(page.request)).toContain("ar");
});

test("makes Spanish the default after showing what that changes", async ({
  page,
}) => {
  const list = await openLanguages(page);
  // How much content each language holds, from the server's count: the
  // count's presence, not its value, since this site's content is untranslated
  // and every count reads 0 (the values are the component tests').
  await expect(list.getByRole("listitem").first()).toContainText(
    /Content\d+ items?/
  );

  await choose(page, "Spanish", "Make default…");
  const dialog = page.getByRole("alertdialog", {
    name: "Make Spanish the default?",
  });
  await expect(dialog).toContainText("Content in each language");
  await expect(dialog).toContainText(
    "Spanish becomes the language content is edited in, and the one readers get when they ask for no language. English stays a language of the site."
  );
  await expect(dialog).toContainText("Translations keep their records.");
  await expect(dialog).toContainText(/English: \d+ items?/);
  await expect(dialog).toContainText(/Spanish: \d+ items?/);
  await expectNoAxeViolations(page, { include: '[role="alertdialog"]' });
  // Nothing changes until it is confirmed.
  expect(
    (await languagesOf(page.request)).languages.find(each => each.isDefault)
      ?.code
  ).toBe("en");

  await dialog
    .getByRole("button", { name: "Make Spanish the default" })
    .click();
  await expect(dialog).toBeHidden();
  // Each row by the name it starts with: English is also Spanish's fallback.
  await expect(
    list.getByRole("listitem").filter({ hasText: /^Spanish/ })
  ).toContainText("Default");
  await expect(
    list.getByRole("listitem").filter({ hasText: /^English/ })
  ).not.toContainText("Default");
  expect(
    (await languagesOf(page.request)).languages.find(each => each.isDefault)
      ?.code
  ).toBe("es");
});

test("the keyboard reaches every control in order, with its focus drawn", async ({
  page,
}) => {
  const list = await openLanguages(page);
  const add = page.getByRole("button", { name: "Add language" });
  await add.focus();

  // The tab order from Add language through the rows' menus.
  const order: string[] = [];
  for (let step = 0; step < 4; step += 1) {
    order.push(
      await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        return element?.getAttribute("aria-label") ?? element?.innerText ?? "";
      })
    );
    const outline = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      return getComputedStyle(element).outlineStyle;
    });
    expect(outline, `focus drawn on ${order.at(-1)}`).not.toBe("none");
    await page.keyboard.press("Tab");
  }
  test.info().annotations.push({
    type: "tab order",
    description: order.join(" → "),
  });
  // The rows' order is the site's: Arabic, added back, comes last.
  expect(await rowNames(list)).toEqual([
    "English",
    "Spanish",
    "Arabic (Modern Standard)",
  ]);
  expect(order).toEqual([
    "Add language",
    "Actions for English",
    "Actions for Spanish",
    "Actions for Arabic (Modern Standard)",
  ]);

  // A menu opened and closed from the keyboard gives focus back to its button.
  const spanish = page.getByRole("button", { name: "Actions for Spanish" });
  await spanish.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Edit…" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(spanish).toBeFocused();

  // A dialog opened from the keyboard holds focus and gives it back on Escape.
  await add.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Add a language" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Code")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();
});
