/**
 * Relabelling a saved field in a real Builder renames nothing.
 *
 * A saved field's name is its column and API key; its label is only what
 * editors read. Changing "Summary" to "Excerpt" once asked, at save, whether
 * to rename the column or drop it, because the name followed the label. Now
 * the name stays, so the save has no schema change to review: it saves the
 * new label, the column keeps its name, and the stored value is still read
 * under it.
 *
 * A collection made at runtime, because the playground's own collections are
 * code-first and open read-only.
 */
import { expect } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import {
  createRuntimeCollection,
  expectOk,
  removeRuntimeCollection,
} from "./support/runtime-collection";

// Creating a collection changes the schema and the dashboard's cards, as for the
// other specs that create one.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.schema] });

const API = "/admin/api";

test("relabelling a saved field keeps its name, with no schema change to review", async ({
  page,
}) => {
  const slug = `relabel_${Date.now()}`;
  try {
    // Stored as a field the Builder made is stored, with its flags written
    // out. Keep them: a field stored without `required`/`unique` reads as
    // changed on any Builder save, relabel or not, because the save's preview
    // compares them exactly (`hasFieldChanged` in nextly's
    // domains/schema/services/field-diff.ts), and the save then asks to
    // confirm a change that is not this test's.
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
    await expectOk(
      await page.request.post(`${API}/collections/${slug}/entries`, {
        data: { summary: "Kept under its name" },
      }),
      "adding an entry"
    );

    await gotoAdmin(page, `/builder/collections/${slug}`);
    // Selecting the field's row in the outline opens its settings.
    await page.getByTestId("field-row-summary").click();
    const label = page.getByRole("textbox", { name: "Label", exact: true });
    await label.fill("Excerpt");
    await expect(
      page.getByRole("textbox", { name: "Name", exact: true })
    ).toHaveValue("summary");

    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Saved with no review: the label is a setting, and nothing asks whether to
    // rename or drop the column.
    await expect
      .poll(async () => {
        const schema = await page.request.get(
          `${API}/collections/schema/${slug}`
        );
        const body = (await schema.json()) as {
          fields?: { name: string; label?: string }[];
        };
        return body.fields?.find(f => f.label === "Excerpt")?.name ?? null;
      })
      .toBe("summary");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    const entries = await page.request.get(
      `${API}/collections/${slug}/entries`
    );
    await expectOk(entries, "reading the entries");
    const { items } = (await entries.json()) as {
      items: { summary?: string }[];
    };
    expect(items.map(item => item.summary)).toEqual(["Kept under its name"]);
  } finally {
    // The collection only. Its migration files stay: the server's ledger
    // records them as applied, and deleting them while it runs makes it
    // refuse every later schema change, in the specs after this one too.
    await removeRuntimeCollection(page.request, slug);
  }
});
