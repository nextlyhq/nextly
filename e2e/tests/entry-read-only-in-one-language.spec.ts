/**
 * A user who may change a note in English and only read it in Spanish, by the
 * fixture's rule, edits the English and opens the Spanish read-only. While the
 * Spanish answer is on its way the editor stays on screen with nothing that
 * saves offered: the English answer it keeps meanwhile grants nothing in
 * Spanish.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { createEntry } from "./support/runtime-collection";

// One signed-in user for the whole file: signing in spends the auth budget.
test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);

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

const save = () => page.locator('[data-primary="true"]');
const banner = () => page.getByTestId("document-lock-banner");
const note = () =>
  page.locator("main").getByRole("textbox", { name: "Note", exact: true });

/** Whether `url` asks the capabilities answer for `locale`. */
function asksCapabilitiesIn(locale: string) {
  return (url: URL) =>
    url.pathname.endsWith("/me/capabilities") &&
    url.searchParams.get("locale") === locale;
}

test("edits the English and opens the Spanish read-only, offering no save while it loads", async () => {
  await gotoAdmin(page, `/collections/translator-notes/${noteId}`);
  await expect(save()).toBeVisible();
  await expect(banner()).toHaveCount(0);
  await expect(note()).toBeEditable();

  // The editor on screen, marked so a remount would show.
  await page
    .locator("main form")
    .first()
    .evaluate(form => form.setAttribute("data-kept", "english"));

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

  // The editor stays on screen, and nothing that saves is offered for Spanish
  // on the English answer's word.
  await expect(page.locator('main form[data-kept="english"]')).toHaveCount(1);
  await expect(save()).toHaveCount(0);

  release();
  await expect(banner()).toHaveText(
    "Your access lets you view this, but not change it. If you need to change it, ask an admin."
  );
  await expect(note()).not.toBeEditable();
  await expect(save()).toHaveCount(0);
  await page.unroute(asksCapabilitiesIn("es"));
});

test("is offered the save again on returning to English", async () => {
  await gotoAdmin(page, `/collections/translator-notes/${noteId}?locale=es`);
  await expect(banner()).toBeVisible();
  await page.getByRole("button", { name: "Open English" }).click();
  await expect(save()).toBeVisible();
  await expect(banner()).toHaveCount(0);
  await expect(note()).toBeEditable();
});
