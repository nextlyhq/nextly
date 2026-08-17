/**
 * Autosave, end to end: typing produces a stored recovery point, and reopening
 * the document offers it back.
 *
 * Everything else covering this path is a unit test with the transport mocked,
 * which by construction cannot see the failures most likely to exist here: a
 * route that is not registered, a policy gate that refuses, a body the server
 * rejects, a snapshot that does not survive serialisation, or a banner that
 * never appears because the read is scoped to the wrong author. Each of those
 * leaves every mocked test green.
 *
 * The properties below are therefore chosen for what only a real browser and a
 * real database can answer, not for coverage of the hook's branches.
 *
 * Requires `versions: { drafts: true }` on the collection. `status: true` alone
 * resolves to `{ drafts: false }` and the policy gate then refuses every write,
 * so a spec pointed at a collection without it fails for a configuration reason
 * that looks like a broken feature.
 */
import { test, expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

/** The autosave write, which is a PUT to a named sub-resource of the entry. */
const AUTOSAVE_WRITE =
  /\/collections\/posts\/entries\/[^/]+\/versions\/autosave$/;

/**
 * Create a post and save it, returning its editor URL.
 *
 * Autosave cannot engage before this: the endpoint addresses a document that
 * exists, and a new entry has no id until it has been saved once. A spec that
 * typed into an unsaved form and waited for a write would hang for the right
 * reason and read as a broken feature.
 */
async function createSavedPost(page: Page, title: string): Promise<string> {
  // `/create`, from `routes.ts`, NOT `/new`. The page FILE tree says otherwise
  // and the router remaps it, so a path derived by reading the directory
  // resolves to nothing and the editor renders empty -- which reads as a broken
  // feature rather than a wrong URL.
  await gotoAdmin(page, "/collections/posts/create");

  // Only the title. The slug is derived from it by the editor, so filling one
  // that does not exist as its own control times out on a field the form never
  // renders.
  await // `exact`, because Playwright matches an accessible name as a SUBSTRING by
  // default and this form also has a "Meta Title".
  page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await page.getByRole("button", { name: /save draft/i }).click();

  // The editor moves to the saved entry's own URL, which is also the signal
  // that an id now exists. Waiting on the URL rather than on a toast keeps this
  // independent of notification copy.
  // Saving a NEW entry returns to the LIST rather than staying in the editor,
  // so the entry has to be reopened from there. Measured, not assumed: waiting
  // for an entry-shaped url here times out on a page that is showing the list.
  await page.waitForURL(/\/collections\/posts$/, { timeout: 30_000 });
  await page.getByRole("link", { name: title }).click();

  // Now an entry url, and the negative lookahead keeps `create` from matching.
  await page.waitForURL(/\/collections\/posts\/(?!create$)[^/]+$/, {
    timeout: 30_000,
  });
  await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
  return page.url();
}

test.describe("autosave recovery", () => {
  test("records what was typed and offers it back after a reload", async ({
    page,
  }) => {
    const url = await createSavedPost(page, `Autosave ${Date.now()}`);
    const recovered = "text that was never saved";

    // Arm the wait BEFORE typing. Registering it afterwards races the debounce,
    // and a request that already completed is one this would wait for forever.
    const written = page.waitForResponse(
      r => AUTOSAVE_WRITE.test(r.url()) && r.request().method() === "PUT",
      { timeout: 30_000 }
    );

    await page
      .getByRole("textbox", { name: "Excerpt", exact: true })
      .fill(recovered);

    // POPULATION BEFORE VERDICT. The banner assertion below is about something
    // being PRESENT, but the failure it must not be confused with is "nothing
    // was ever recorded" -- and that produces no banner just as convincingly as
    // a broken recovery read. Requiring a successful write first separates
    // them, and names which half broke when it does.
    const response = await written;
    expect(
      response.status(),
      "the autosave write must be accepted"
    ).toBeLessThan(400);

    // Reload rather than navigate away and back: this is the case the feature
    // exists for, and it discards all client state, so anything offered
    // afterwards came from the server.
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });

    await expect(
      page.getByText(/unsaved changes from/i),
      "the recovery offer must survive a reload"
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /^restore$/i }).click();

    await expect(
      page.getByRole("textbox", { name: "Excerpt", exact: true }),
      "restoring must put the recorded values back in the form"
    ).toHaveValue(recovered);
  });

  /**
   * Dismissing is "not now", never "delete". Someone who dismisses and then
   * reloads must still be offered the work, rather than discovering it is gone
   * because they closed a banner.
   *
   * This is the property most likely to be broken by a well-meaning change --
   * clearing the row on dismiss looks like tidying up -- and it is invisible to
   * any test that does not reload.
   */
  test("dismissing the offer does not discard the recorded work", async ({
    page,
  }) => {
    await createSavedPost(page, `Dismiss ${Date.now()}`);

    const written = page.waitForResponse(
      r => AUTOSAVE_WRITE.test(r.url()) && r.request().method() === "PUT",
      { timeout: 30_000 }
    );
    await page
      .getByRole("textbox", { name: "Excerpt", exact: true })
      .fill("work that must survive a dismissal");
    expect((await written).status()).toBeLessThan(400);

    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });

    const offer = page.getByText(/unsaved changes from/i);
    await expect(offer).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /dismiss recovery offer/i }).click();
    await expect(offer).toBeHidden();

    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });

    await expect(
      page.getByText(/unsaved changes from/i),
      "a dismissal must not delete the stored recovery point"
    ).toBeVisible({ timeout: 15_000 });
  });
});

/**
 * The same loop for a Single.
 *
 * Worth covering separately rather than trusting the shared hook: a Single is
 * addressed by its own document id rather than an entry id, it has no create
 * step, and `site-settings` is LOCALIZED -- so this is also the only coverage of
 * the locale travelling with the write. The collection path proved that a
 * shared transport can still be wrong at one call site, which is exactly the
 * assumption "it uses the same hook" would rest on.
 */
test.describe("autosave recovery for a Single", () => {
  const SINGLE_AUTOSAVE = /\/singles\/site-settings\/versions\/autosave/;

  test("records and offers back a Single's unsaved work", async ({ page }) => {
    await gotoAdmin(page, "/singles/site-settings");

    const written = page.waitForResponse(
      r => SINGLE_AUTOSAVE.test(r.url()) && r.request().method() === "PUT",
      { timeout: 30_000 }
    );

    const recovered = `tagline never saved ${Date.now()}`;
    await page
      .getByRole("textbox", { name: "Tagline", exact: true })
      .fill(recovered);

    // Population before verdict, as on the collection path: a banner that never
    // appears means "the read is broken" only once a write is known to have
    // landed.
    expect(
      (await written).status(),
      "the Single's autosave write must be accepted"
    ).toBeLessThan(400);

    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });

    await expect(
      page.getByText(/unsaved changes from/i),
      "a Single's recovery offer must survive a reload"
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /^restore$/i }).click();

    await expect(
      page.getByRole("textbox", { name: "Tagline", exact: true }),
      "restoring must put the Single's recorded values back"
    ).toHaveValue(recovered);
  });
});

/**
 * The property the supersede exists for: a real save clears the recovery point,
 * so reopening a SAVED document offers nothing.
 *
 * Without this, the only coverage of the delete would be that the other tests
 * still pass -- and they would pass just as well if the delete never ran, since
 * they never save after autosaving. This is the case that fails when the
 * supersede is removed.
 */
test("offers nothing after the work has actually been saved", async ({
  page,
}) => {
  await createSavedPost(page, `Superseded ${Date.now()}`);

  const written = page.waitForResponse(
    r => AUTOSAVE_WRITE.test(r.url()) && r.request().method() === "PUT",
    { timeout: 30_000 }
  );
  await page
    .getByRole("textbox", { name: "Excerpt", exact: true })
    .fill("typed, then saved for real");
  expect((await written).status()).toBeLessThan(400);

  // The real save. This is what must supersede the recovery point.
  await page.getByRole("button", { name: /save/i }).first().click();
  await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });

  // Population before verdict: the editor has to have drawn before an absence
  // means anything, or a slow page would satisfy this assertion by itself.
  await expect(
    page.getByRole("textbox", { name: "Excerpt", exact: true })
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText(/unsaved changes from/i),
    "a saved document must not offer its own saved work back"
  ).toBeHidden();
});
