/**
 * One person, one entry, two tabs.
 *
 * A claim is held per person, so opening the entry in a second tab moves the
 * claim there, and the first tab is told it was opened in another tab -- not
 * that its own user took it over. Its unsaved edit stays on screen, and
 * "Continue editing here" makes it the editing tab again, edit and all.
 *
 * @module tests/entry-lock-two-tabs
 */
import { expect } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { EVERY_DIALECT } from "./support/every-dialect";
import { LOCKED_POST as POST } from "./support/locked-post";
import { claimedBy, expectHeldBy } from "./support/two-editors";

/** What a tab says once the person has opened the document elsewhere. */
const OPENED_ELSEWHERE = /^You opened this document in another tab\./;

// Run on every dialect: the claim the two tabs share lives in the database.
test.describe("one person in two tabs", { tag: EVERY_DIALECT }, () => {
  // A tab learns its claim moved only at its next beat, allowed 45 seconds.
  test.describe.configure({ timeout: 120_000 });

  test("the first tab is told about the other tab, keeps its edit, and can continue", async ({
    page,
  }) => {
    const { document, address, stored } = await POST.prepare(page.request);
    await gotoAdmin(page, address);
    await expect(POST.field(page)).toHaveValue(stored, { timeout: 30_000 });
    const me = await claimedBy(page.request, document);
    const unsaved = `${stored}, edited in the first tab`;
    await POST.field(page).fill(unsaved);

    const second = await page.context().newPage();
    await gotoAdmin(second, address);
    // The second tab edits: the claim is this person's, wherever they are.
    await expect(POST.field(second)).toBeEditable({ timeout: 30_000 });
    await expect(POST.field(second)).toHaveValue(stored);

    // The first tab is told at its next beat, as the person who opened it
    // elsewhere and not as a colleague taking it over.
    await expect(page.getByText(OPENED_ELSEWHERE)).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByText(/took over this document/)).toHaveCount(0);
    await expect(POST.field(page)).toHaveValue(unsaved);
    await expect(POST.field(page)).not.toBeEditable();

    await page.getByRole("button", { name: "Continue editing here" }).click();
    await expect(POST.field(page)).toBeEditable({ timeout: 30_000 });
    await expect(POST.field(page)).toHaveValue(unsaved);
    await expectHeldBy(page.request, document, me);

    // And the tab it moved from is told the same way.
    await expect(second.getByText(OPENED_ELSEWHERE)).toBeVisible({
      timeout: 45_000,
    });
  });
});
