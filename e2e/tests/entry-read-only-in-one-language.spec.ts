/**
 * A user who may change a note in English and only read it in Spanish, by the
 * fixture's rule, edits the English and opens the Spanish read-only, on its
 * translation page. While the Spanish answer is on its way the admin waits,
 * showing neither the editor nor that page: the English answer kept meanwhile
 * grants nothing in Spanish, not even its read.
 */
import { expect, type Page } from "@playwright/test";

import { includingHidden, test } from "./support/test";
import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { createEntry, expectOk } from "./support/runtime-collection";

// One signed-in user for the whole file: signing in spends the auth budget.
test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);
const SPANISH_NOTE = "Revisado en español.";
const READ_ONLY =
  "Your access lets you view this, but not change it. If you need to change it, ask an admin.";

let translator: LimitedUser;
let page: Page;
let noteId: string;

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const admin = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
  try {
    noteId = await createEntry(admin, "translator-notes", {
      title: `A note to translate ${RUN}`,
      note: "Checked in English.",
    });
    // The Spanish the user may read: the rule that refuses them a change in
    // Spanish does not hold the suite's admin.
    await expectOk(
      await admin.patch(
        `/admin/api/collections/translator-notes/entries/${noteId}?locale=es`,
        { data: { note: SPANISH_NOTE, _overwrite: true } }
      ),
      "writing the Spanish note"
    );
    translator = await signInAsLimitedUser(browser, admin, baseURL, [
      "read-translator-notes",
      "update-translator-notes",
    ]);
  } finally {
    await admin.dispose();
  }
  page = await translator.context.newPage();
});

test.afterAll(async () => {
  await translator?.context.close();
});

/** The editor's own save. */
const save = () => page.locator('[data-primary="true"]');
/** The translation page's save, which names the language it saves. */
const translationSave = () => page.locator('[data-slot="translation-save"]');
// What a reader who may not change the document is told, anywhere in it, a
// hidden copy of the page included: what proving it is not there has to see.
const readOnlyAnywhere = () => includingHidden(page).getByText(READ_ONLY);
const bannerAnywhere = () =>
  includingHidden(page).getByTestId("document-lock-banner");
const note = () =>
  page.locator("main").getByRole("textbox", { name: "Note", exact: true });

/** The note's editor and its Spanish translation page, within the admin. */
const editor = () => `/collections/translator-notes/${noteId}`;
const spanishPage = () =>
  `/translations/collections/translator-notes/${noteId}?locale=es`;

/** Whether `url` asks the capabilities answer for `locale`. */
function asksCapabilitiesIn(locale: string) {
  return (url: URL) =>
    url.pathname.endsWith("/me/capabilities") &&
    url.searchParams.get("locale") === locale;
}

test("edits the English and opens the Spanish read-only, showing nothing that saves while it loads", async () => {
  await gotoAdmin(page, editor());
  await expect(save()).toBeVisible();
  await expect(readOnlyAnywhere()).toHaveCount(0);
  await expect(bannerAnywhere()).toHaveCount(0);
  await expect(note()).toBeEditable();

  // The Spanish answer is held until the page has been read without it.
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  let asked = false;
  await page.route(asksCapabilitiesIn("es"), async route => {
    asked = true;
    await held;
    await route.continue();
  });

  await page.getByRole("button", { name: "Open Spanish" }).click();
  await expect.poll(() => asked).toBe(true);

  // The admin waits for the Spanish answer: neither the editor nor the
  // translation page, so nothing that saves, is shown on the English answer's
  // word.
  // Its outline, by CSS: it may not be drawn yet, and the suite's test-id
  // locators see visible elements only.
  await expect(page.locator('[data-testid="screen-outline"]')).toBeAttached();
  await expect(note()).toHaveCount(0);
  await expect(save()).toHaveCount(0);
  await expect(translationSave()).toHaveCount(0);

  release();
  await expect(page).toHaveURL(`/admin${spanishPage()}`);
  await expect(page.getByText(READ_ONLY)).toBeVisible();
  // The Spanish as it is stored, to be read and not changed.
  await expect(note()).toHaveValue(SPANISH_NOTE);
  await expect(note()).not.toBeEditable();
  await expect(translationSave()).toHaveCount(0);
  await expect(save()).toHaveCount(0);
  await page.unroute(asksCapabilitiesIn("es"));
});

test("is offered the save again on returning to English", async () => {
  await gotoAdmin(page, spanishPage());
  await expect(page.getByText(READ_ONLY)).toBeVisible();
  await page.getByRole("link", { name: "Open in editor" }).click();
  await expect(page).toHaveURL(`/admin${editor()}`);
  await expect(save()).toBeVisible();
  await expect(readOnlyAnywhere()).toHaveCount(0);
  await expect(bannerAnywhere()).toHaveCount(0);
  await expect(note()).toHaveValue("Checked in English.");
  await expect(note()).toBeEditable();
});
