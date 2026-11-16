/**
 * The first Schema Builder save of a table an earlier Nextly version made also brings that table
 * up to date, and the server writes each such conversion only once the save confirms it by its
 * key. In a real Builder, the review lists what the save brings up to date, in plain words; its
 * Save sends the key of every conversion listed, and Cancel sends nothing.
 *
 * The preview is answered here with one conversion. A table as an earlier version made it has no
 * migration history, and the suite's server shares one history among every spec, so such a table
 * cannot be made in it without hand-editing that shared history. The server's own road (a real
 * older table, its preview, the refusal of an unconfirmed apply, and the confirmed save) is
 * covered by nextly's integration tests on each dialect; this covers the browser's part.
 *
 * A collection made at runtime, because the playground's own collections are code-first and open
 * read-only.
 */
import { expect, type Page, type Request } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import {
  createRuntimeCollection,
  removeMigrationsOf,
  removeRuntimeCollection,
} from "./support/runtime-collection";

// Creating a collection changes the schema and the dashboard's cards, as for the other specs
// that create one.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.schema] });

/** The conversion the preview names: an index the earlier version's create left out. */
const conversionOf = (table: string) => ({
  table,
  column: table,
  from: "as an earlier version made it",
  to: "as Nextly declares it (add index)",
  change: "adds an index on created_at",
});

/**
 * Answers the collection's preview as the server does for a table an earlier version made: its
 * own answer, with the change to save and one conversion.
 */
async function answerWithConversion(page: Page, slug: string): Promise<void> {
  await page.route(
    `**/admin/api/collections/schema/${slug}/preview`,
    async route => {
      const response = await route.fetch();
      const read = (await response.json()) as Record<string, unknown> & {
        data?: Record<string, unknown>;
      };
      const conversions = [conversionOf(`dc_${slug}`)];
      const answered =
        read.data === undefined
          ? { ...read, hasChanges: true, conversions }
          : { ...read, data: { ...read.data, hasChanges: true, conversions } };
      await route.fulfill({ response, json: answered });
    }
  );
}

/** Each apply request the page sends for the collection, as it is sent. */
function appliesOf(page: Page, slug: string): Request[] {
  const sent: Request[] = [];
  page.on("request", request => {
    if (
      request.method() === "POST" &&
      request.url().endsWith(`/collections/schema/${slug}/apply`)
    ) {
      sent.push(request);
    }
  });
  return sent;
}

/** Relabel the saved field and press Save, which opens the review. */
async function saveARelabel(page: Page, slug: string): Promise<void> {
  await gotoAdmin(page, `/builder/collections/${slug}`);
  await page.getByTestId("field-row-summary").click();
  await page
    .getByRole("textbox", { name: "Label", exact: true })
    .fill("Excerpt");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
}

async function withCollection(
  page: Page,
  slug: string,
  body: () => Promise<void>
): Promise<void> {
  try {
    // Stored as the Builder stores a field, with its flags written out, so the save has no
    // change of its own to review beyond the label.
    await createRuntimeCollection(page.request, slug, [
      {
        name: "summary",
        type: "text",
        label: "Summary",
        required: false,
        unique: false,
        index: false,
      },
    ]);
    await body();
  } finally {
    await removeRuntimeCollection(page.request, slug);
    await removeMigrationsOf(slug);
  }
}

test("lists what the save brings up to date, and its Save confirms it by its key", async ({
  page,
}) => {
  const slug = `uptodate_${Date.now()}`;
  await withCollection(page, slug, async () => {
    await answerWithConversion(page, slug);
    const applies = appliesOf(page, slug);

    await saveARelabel(page, slug);

    const section = page
      .getByRole("alertdialog")
      .getByRole("region", { name: "Brought up to date" });
    await expect(
      section.getByText(
        `dc_${slug} was made by an earlier Nextly version. Saving brings it up to date: adds an index on created_at.`,
        { exact: true }
      )
    ).toBeVisible();
    // Nothing to tick: Save confirms every conversion listed.
    await expect(section.getByRole("checkbox")).toHaveCount(0);

    // Awaited to its answer, and the review to its close, so the save has finished before the
    // collection is removed: the server refuses a change while a save's migration runs.
    const applied = page.waitForResponse(response =>
      response.url().endsWith(`/collections/schema/${slug}/apply`)
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /save changes/i })
      .click();
    const response = await applied;
    const body = response.request().postDataJSON() as {
      acknowledgedConversions?: string[];
    };

    expect(body.acknowledgedConversions).toEqual([`dc_${slug}`]);
    expect(applies).toHaveLength(1);
    await expect(page.getByRole("alertdialog")).toBeHidden();
  });
});

test("sends no apply when the review is cancelled", async ({ page }) => {
  const slug = `uptodate_cancel_${Date.now()}`;
  await withCollection(page, slug, async () => {
    await answerWithConversion(page, slug);
    const applies = appliesOf(page, slug);

    await saveARelabel(page, slug);
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Cancel" })
      .click();

    await expect(page.getByRole("alertdialog")).toBeHidden();
    expect(applies).toHaveLength(0);
  });
});
