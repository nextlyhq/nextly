/**
 * The Schema Builder's dialog for a field that stops being translated, against a real server.
 *
 * Making a translated field shared archives every other language's value and keeps the default
 * language's as the shared one. Before Apply, the dialog says how many values in which languages
 * move and how to bring them back; a field that cannot leave translation in one change is refused
 * there, with the steps that work and no Save to press. Unit tests cover the dialog's parts; this
 * covers the whole road from a stored translation to what the author reads.
 *
 * Each test seeds its own translated collection through the admin API, as the Builder would have
 * saved it. Safe to write against: the suite owns its database and empties it before every run.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";

const API = "/admin/api";

/** A translated collection with one entry, its `headline` in English and Spanish. */
async function seedTranslated(
  page: Page,
  slug: string,
  headline: Record<string, unknown>
): Promise<void> {
  const created = await page.request.post(`${API}/collections`, {
    data: {
      name: slug,
      labels: { singular: "Story", plural: "Stories" },
      localized: true,
      fields: [
        { name: "headline", type: "text", label: "Headline", ...headline },
      ],
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const entry = await page.request.post(`${API}/collections/${slug}/entries`, {
    data: { headline: "Hello" },
  });
  expect(entry.ok(), await entry.text()).toBe(true);
  const { item } = (await entry.json()) as { item: { id: string } };
  const spanish = await page.request.patch(
    `${API}/collections/${slug}/entries/${item.id}?locale=es`,
    { data: { headline: "Hola" } }
  );
  expect(spanish.ok(), await spanish.text()).toBe(true);
}

/** Make `headline` shared in the Builder and press Save, which opens the schema dialog. */
async function makeHeadlineShared(page: Page, slug: string): Promise<void> {
  await gotoAdmin(page, `/builder/collections/${slug}`);
  // Exact: the field row's own button names its actions too ("… Edit headline …").
  await page
    .getByRole("button", { name: "Edit headline", exact: true })
    .click();
  await page.getByRole("tab", { name: "Advanced" }).click();
  await page.getByRole("switch", { name: "Localized" }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
}

test("says what moves to the archive and how to bring it back", async ({
  page,
}) => {
  await seedTranslated(page, "e2e_stories", {});

  await makeHeadlineShared(page, "e2e_stories");

  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByText(
      "1 Spanish value moves to the archive. English becomes the shared value."
    )
  ).toBeVisible();
  await expect(
    dialog.getByText(
      "nextly i18n:restore --collection e2e_stories --field headline"
    )
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Copy the restore command" })
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /save changes|apply changes/i })
  ).toBeEnabled();
});

test("refuses a required field with the steps that work, and offers no Save", async ({
  page,
}) => {
  await seedTranslated(page, "e2e_required_stories", { required: true });

  await makeHeadlineShared(page, "e2e_required_stories");

  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("heading", { name: "Schema Change Needs Another Step" })
  ).toBeVisible();
  await expect(dialog.getByText("no longer localized")).toBeVisible();
  await expect(dialog.getByText("Needs three steps")).toBeVisible();
  await expect(
    dialog.getByText(
      "A required field can't stop being translated in the same change."
    )
  ).toBeVisible();
  await expect(dialog.getByRole("listitem")).toHaveText([
    "Turn off Required and save.",
    "Turn off Localized and save.",
    "Turn Required back on and save.",
  ]);
  // Nothing in the change can be saved, so no Save can be pressed: either it is absent, or,
  // where another change rides along, disabled.
  const save = dialog.getByRole("button", {
    name: /save changes|apply changes/i,
  });
  if ((await save.count()) > 0) await expect(save).toBeDisabled();
});
