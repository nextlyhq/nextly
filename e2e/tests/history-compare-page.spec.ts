/**
 * The comparison page, opened from a shared address.
 *
 * A note is published three times. A shared address opens its second version
 * against the one before it; the reader compares it with what is published
 * instead, switches to side by side, and each choice is written to the
 * address. "Restore…" hands the second version to the editor, which holds the
 * third: its restore list puts the second version's summary back as an
 * unsaved edit, the save records where it came from, and readers still see
 * the third version.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/history-notes/entries";

/** Versions 1, 2 and 3, each published; 3 is what readers see. */
async function notePublishedThrice(
  page: Page
): Promise<{ id: string; second: number }> {
  const stamp = Date.now();
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Compare note ${stamp}`,
      summary: "first",
      status: "published",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { item } = (await created.json()) as { item: { id: string } };
  for (const data of [
    { summary: "published again", status: "published" },
    { summary: "published a third time", status: "published" },
  ]) {
    const saved = await page.request.patch(`${ENTRIES}/${item.id}`, {
      data: { ...data, _overwrite: true },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
  }
  return { id: item.id, second: 2 };
}

test.describe("the comparison page", () => {
  test("opens a shared address, compares with the current draft, switches the view and restores", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { id, second } = await notePublishedThrice(page);

    // A shared address: the second version against the one before it.
    await gotoAdmin(
      page,
      `/collections/history-notes/${id}/versions?from=previous&to=${second}`
    );
    const comparison = page.getByRole("region", { name: "Comparison" });
    await expect(comparison).toBeVisible({ timeout: 30_000 });

    // Compared with what is published instead: the address says so.
    await page
      .getByRole("combobox", { name: "Compare with" })
      .selectOption("published");
    await expect(page).toHaveURL(/from=published/);
    await expect(
      comparison.getByText(/Compared with what is published \(version 3\)/)
    ).toBeVisible({ timeout: 30_000 });

    // Side by side, written to the address so a link opens it that way.
    await comparison.getByRole("button", { name: "Side by side" }).click();
    await expect(page).toHaveURL(/view=side/);

    await expectNoAxeViolations(page);

    // Restored in the editor, from its restore list, then saved.
    await page.getByRole("button", { name: "Restore…" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(
      dialog.getByText(`Restore from version ${second}`)
    ).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("button", { name: /^Restore \d+ fields?$/ }).click();
    await expect(
      page.getByRole("textbox", { name: "Summary", exact: true })
    ).toHaveValue("published again");
    const saved = page.waitForResponse(
      response =>
        response.url().includes(`/entries/${id}`) &&
        response.request().method() === "PATCH"
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect((await saved).ok()).toBe(true);

    // The save records where the summary came from.
    const history = await page.request.get(`${ENTRIES}/${id}/versions`);
    const { items } = (await history.json()) as {
      items: { fieldSources?: Record<string, number> }[];
    };
    expect(items[0]?.fieldSources).toMatchObject({ summary: second });
    // Nothing was published: readers still see the third version.
    const live = await page.request.get(`${ENTRIES}/${id}`);
    // A read answers with the document itself.
    expect(await live.json()).toMatchObject({
      status: "published",
      summary: "published a third time",
    });
  });
});
