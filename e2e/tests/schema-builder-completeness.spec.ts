/**
 * A field lacking what its type needs is an error in a real Builder, and fixing it lets the save
 * through.
 *
 * A dropdown whose two options share a value is refused by the save, because the stored value
 * could not tell them apart. The Builder says so before the save is tried, in three places read
 * from one judgement: the field's row, its settings panel, and the toolbar's count of errors,
 * which brings the field into view; and Save stays unavailable while the error stands. Giving the
 * option a value of its own clears all three, and the save stores it.
 *
 * A collection made at runtime, because the playground's own collections are code-first and open
 * read-only.
 */
import { expect } from "@playwright/test";

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

const API = "/admin/api";

// Stored as the Builder stores a field, its flags written out, so the save's preview finds no
// change but the one this test makes.
const flags = { required: false, unique: false, index: false };

test("fixes the error and saves", async ({ page }) => {
  const slug = `completeness_${Date.now()}`;
  try {
    await createRuntimeCollection(page.request, slug, [
      { name: "summary", type: "text", label: "Summary", ...flags },
      {
        name: "kind",
        type: "select",
        label: "Kind",
        ...flags,
        options: [
          { label: "News", value: "news" },
          { label: "Review", value: "review" },
        ],
      },
    ]);

    await gotoAdmin(page, `/builder/collections/${slug}`);
    const kindRow = page.getByTestId("field-row-kind");
    await kindRow.click();
    const values = page.getByRole("textbox", { name: "Option value" });
    await expect(values).toHaveCount(2);
    await values.nth(1).fill("news");

    // The error, in each place it is shown.
    const message = /"kind" has two options with the value "news"/;
    await expect(kindRow).toContainText("Has an error");
    const notice = page.getByRole("alert").filter({ hasText: message });
    await expect(notice).toBeVisible();
    const showError = page.getByRole("button", {
      name: "1 error: show the next",
    });
    await expect(showError).toBeVisible();
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeDisabled();

    // The count brings the field back into view from another field's settings.
    await page.getByTestId("field-row-summary").click();
    await expect(
      page.getByRole("textbox", { name: "Name", exact: true })
    ).toHaveValue("summary");
    await showError.click();
    await expect(
      page.getByRole("textbox", { name: "Name", exact: true })
    ).toHaveValue("kind");

    // A value of its own clears the error everywhere, and the save stores it.
    await values.nth(1).fill("opinion");
    await expect(kindRow).not.toContainText("Has an error");
    await expect(notice).toHaveCount(0);
    await expect(showError).toHaveCount(0);
    await expect(save).toBeEnabled();
    await save.click();

    await expect
      .poll(async () => {
        const schema = await page.request.get(
          `${API}/collections/schema/${slug}`
        );
        const body = (await schema.json()) as {
          fields?: { name: string; options?: { value: string }[] }[];
        };
        return (
          body.fields
            ?.find(f => f.name === "kind")
            ?.options?.map(o => o.value) ?? null
        );
      })
      .toEqual(["news", "opinion"]);
  } finally {
    await removeRuntimeCollection(page.request, slug);
    await removeMigrationsOf(slug);
  }
});
