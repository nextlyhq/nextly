/**
 * Reading a document's history must not write to the document.
 *
 * A past version is rendered by the editor's own field components, against a
 * form of its own. That separation is the whole safety property, and it is
 * invisible to every unit test covering it: those mock the transport, so a
 * historical value reaching a real save or a real autosave produces no failure
 * they can observe. The retarget that would cause it is quiet too — React form
 * context binds to the nearest provider, so a component that resolved to the
 * wrong form is still perfectly valid code doing the wrong thing.
 *
 * So the properties below are the ones only a real browser and a real database
 * can answer: that no write is issued while reading, and that the live document
 * is still the thing that gets saved afterwards.
 *
 * Requires `versions: { drafts: true }` on the collection. `status: true` alone
 * resolves to `{ drafts: false }`, the policy gate then refuses every write,
 * and a spec pointed at a collection without it fails for a configuration
 * reason that looks like a broken feature.
 */
import { test, expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

/**
 * The two Excerpt fields are told apart by WHERE they are, not by their order
 * in the document. The history panel is portalled, so its position in the DOM
 * is an implementation detail of the portal rather than anything this spec
 * should depend on — and `.first()` silently picks the wrong one the day that
 * changes.
 */
const liveExcerpt = (page: Page) =>
  page.locator("main").getByRole("textbox", { name: "Excerpt", exact: true });

const historyExcerpt = (page: Page) =>
  page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Excerpt", exact: true });

/** The autosave write: a PUT to a named sub-resource of the entry. */
const AUTOSAVE_WRITE =
  /\/collections\/posts\/entries\/[^/]+\/versions\/autosave$/;

/**
 * A saved post whose title has been changed once, so its history holds an
 * earlier version that differs from what is live.
 *
 * Both titles are returned rather than recomputed by the caller: the assertions
 * turn on telling them apart, and a test that rebuilt the string would still
 * pass if the editor showed neither.
 */
async function postWithHistory(
  page: Page
): Promise<{ first: string; current: string }> {
  const stamp = Date.now();
  const title = `History ${stamp}`;
  const first = `excerpt as first written ${stamp}`;
  const current = `excerpt as it stands now ${stamp}`;

  // `/create`, from `routes.ts`, NOT `/new` — the page file tree says otherwise
  // and the router remaps it.
  await gotoAdmin(page, "/collections/posts/create");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  // The excerpt is set HERE, on the first save, so the earliest version already
  // holds it. Filling it only after creation would leave the oldest version
  // blank, and the assertions below would then be comparing against an empty
  // field — which passes for the wrong reason if the panel renders nothing.
  await liveExcerpt(page).fill(first);
  await page.getByRole("button", { name: /save draft/i }).click();

  // Saving a NEW entry returns to the LIST rather than staying in the editor.
  await page.waitForURL(/\/collections\/posts$/, { timeout: 30_000 });
  await page.getByRole("link", { name: title }).click();
  await page.waitForURL(/\/collections\/posts\/(?!create$)[^/]+$/, {
    timeout: 30_000,
  });
  await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });

  // Excerpt rather than Title, and not for convenience: on the EDIT page the
  // title is an inline control in the document header, not a field in the form,
  // so a spec that fills it there waits on something the form never renders.
  // Excerpt is a plain field of the entry and is what the sibling autosave spec
  // exercises for the same reason.
  await expect(liveExcerpt(page)).toHaveValue(first, { timeout: 30_000 });

  // A second save, so there is a version that is NOT what is live.
  await liveExcerpt(page).fill(current);
  await page.getByRole("button", { name: /save draft/i }).click();
  await expect(liveExcerpt(page)).toHaveValue(current, { timeout: 30_000 });

  return { first, current };
}

/** Open the history panel and select the oldest version it lists. */
async function openOldestVersion(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Version history" }).click();
  const rows = page.getByRole("button", { name: /^Version \d+/ });
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });

  // The list is newest first, so the last row is the earliest version — the one
  // that differs from what is live, which is what makes the assertions bite.
  await rows.last().click();
  await expect(page.getByText(/Viewing version/)).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("reading history does not write", () => {
  test("issues no autosave while a past version is on screen", async ({
    page,
  }) => {
    const { first } = await postWithHistory(page);

    // Armed BEFORE the panel opens: a request that already completed is one
    // this would wait for forever, and the point is to catch a write the act
    // of opening provokes.
    const write = page
      .waitForResponse(
        r => AUTOSAVE_WRITE.test(r.url()) && r.request().method() === "PUT",
        { timeout: 8_000 }
      )
      .then(r => r.url())
      .catch(() => null);

    await openOldestVersion(page);

    // POPULATION BEFORE VERDICT. "No write happened" is satisfied just as well
    // by a panel that rendered nothing at all, so the historical value has to
    // be on screen before the absence means anything.
    await expect(
      historyExcerpt(page),
      "the past version's own value must be rendered before absence proves anything"
    ).toHaveValue(first, { timeout: 15_000 });

    expect(
      await write,
      "loading a past version must not record it as unsaved work"
    ).toBeNull();
  });

  test("leaves the live document untouched, and saves the live values", async ({
    page,
  }) => {
    const { first, current } = await postWithHistory(page);

    await openOldestVersion(page);

    // The panel is non-modal, so the live editor is still on screen behind it.
    // Its own field must still hold what is live — if the snapshot had been
    // loaded into the live form, this would read the historical title.
    await expect(
      liveExcerpt(page),
      "opening history must not load the snapshot into the live form"
    ).toHaveValue(current, { timeout: 15_000 });

    // And the live save must still submit live values. A component that
    // resolved to the history form would write the past here, silently.
    await page.getByRole("button", { name: /save draft/i }).click();
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });

    await expect(
      liveExcerpt(page),
      "saving with history open must persist the live values, not the historical ones"
    ).toHaveValue(current, { timeout: 30_000 });
    await expect(liveExcerpt(page)).not.toHaveValue(first);
  });
});
