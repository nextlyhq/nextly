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
import { expect, type Page, type TestInfo } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.schema] });

const API = "/admin/api";

/**
 * The collection slug for this attempt of a test. A retry runs against the database the first
 * attempt wrote, where a collection of the same slug already exists, so each attempt has its own.
 */
function slugFor(base: string, testInfo: TestInfo): string {
  return testInfo.retry === 0 ? base : `${base}_r${testInfo.retry}`;
}

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
}, testInfo) => {
  const slug = slugFor("e2e_stories", testInfo);
  await seedTranslated(page, slug, {});

  await makeHeadlineShared(page, slug);

  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByText(
      "1 Spanish value moves to the archive. English becomes the shared value."
    )
  ).toBeVisible();
  await expect(
    dialog.getByText(
      `nextly i18n:restore --collection ${slug} --field headline`
    )
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Copy the restore command" })
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /save changes|apply changes/i })
  ).toBeEnabled();
});

test("lets a required field whose entries have an English value stop being translated in one change", async ({
  page,
}, testInfo) => {
  const slug = slugFor("e2e_required_stories", testInfo);
  await seedTranslated(page, slug, { required: true });

  await makeHeadlineShared(page, slug);

  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByText(
      "1 Spanish value moves to the archive. English becomes the shared value."
    )
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /save changes|apply changes/i })
  ).toBeEnabled();
});

test("refuses a required field while an entry has no English value, with the step that works, and offers no Save", async ({
  page,
}, testInfo) => {
  const slug = slugFor("e2e_required_gaps", testInfo);
  await seedTranslated(page, slug, { required: true });
  // An entry written in Spanish only: its English value, the shared one, would be empty.
  const spanishOnly = await page.request.post(
    `${API}/collections/${slug}/entries?locale=es`,
    { data: { headline: "Solo" } }
  );
  expect(spanishOnly.ok(), await spanishOnly.text()).toBe(true);

  await makeHeadlineShared(page, slug);

  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("heading", { name: "Schema Change Needs Another Step" })
  ).toBeVisible();
  await expect(dialog.getByText("no longer localized")).toBeVisible();
  await expect(dialog.getByText("Needs one step")).toBeVisible();
  await expect(
    dialog.getByText(
      "1 entry has no English headline, and its English value becomes the shared one."
    )
  ).toBeVisible();
  await expect(dialog.getByRole("listitem")).toHaveText([
    "Give that entry an English headline, or turn off Required, and save again.",
  ]);
  // Nothing in the change can be saved, so no Save can be pressed: either it is absent, or,
  // where another change rides along, disabled.
  const save = dialog.getByRole("button", {
    name: /save changes|apply changes/i,
  });
  if ((await save.count()) > 0) await expect(save).toBeDisabled();
});
