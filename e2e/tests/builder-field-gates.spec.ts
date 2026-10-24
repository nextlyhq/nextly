/**
 * A builder address reaches only a field the form would let the author edit.
 *
 * The field's card on the form offers no way into the builder for a read-only
 * field, but the builder has an address of its own, and an address can be
 * typed or shared. Opened directly, it must refuse the field rather than draw
 * an editor that saves into it — and still open the document's other field,
 * which is what tells a refusal from a builder that opens nothing.
 *
 * @module tests/builder-field-gates
 */
import { expect } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import {
  createEntry,
  createRuntimeCollection,
  pageWithHeading,
  removeMigrationsOf,
} from "./support/runtime-collection";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.schema] });

test("refuses a read-only blocks field at its builder address, and opens an editable one", async ({
  page,
}) => {
  const slug = `gated_pages_${Date.now()}`;
  const api = page.request;
  try {
    await makeAndVisit();
  } finally {
    await removeMigrationsOf(slug);
  }

  async function makeAndVisit(): Promise<void> {
    await createRuntimeCollection(api, slug, [
      {
        name: "locked",
        type: "blocks",
        label: "Locked layout",
        admin: { readOnly: true },
      },
      { name: "body", type: "blocks", label: "Body" },
    ]);
    const id = await createEntry(api, slug, {
      title: "Gated",
      locked: pageWithHeading("locked-heading", "Not to be edited"),
      body: pageWithHeading("body-heading", "Free to edit"),
    });
    const form = `/admin/collections/${slug}/${id}`;
    await gotoAdmin(page, `/collections/${slug}/${id}`);

    // Typed straight into the address bar, past the card.
    await page.goto(`${form}/builder?field=locked`);
    await expect(
      page.getByRole("heading", { name: "This field can't be edited" })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/read-only/)).toBeVisible();
    await expect(page.locator(".nx-canvas")).toHaveCount(0);

    // The way back is the document's own form.
    await page.getByRole("button", { name: "Back to the document" }).click();
    await expect(page).toHaveURL(new RegExp(`${form}$`));

    // The control: the same document's editable field opens its editor.
    await page.goto(`${form}/builder?field=body`);
    await expect(
      page.locator('.nx-canvas [data-nx-node="body-heading"]').first()
    ).toBeVisible({ timeout: 30_000 });
  }
});
