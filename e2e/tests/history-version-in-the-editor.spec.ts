/**
 * A past version reads in the editor's own layout, with what it changed marked.
 *
 * Drawn against a document whose fields sit in a group and in an embedded
 * field group, because those are the layouts a version shown "in the editor's
 * own layout" has to keep. Two widths, because the actions move: on a wide
 * screen Back to current and Restore… take Save's and Publish's places in the
 * title bar, and on a phone they sit in a bar at the bottom.
 *
 * The document and its second version are written through the API, so what
 * the test watches is history, not the editor's create flow.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";

const ENTRIES = "/admin/api/collections/history-notes/entries";

/** A note saved twice: the summary and the group's subtitle change between. */
async function noteWithTwoVersions(page: Page): Promise<string> {
  const stamp = Date.now();
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `History note ${stamp}`,
      summary: "as first written",
      details: { subtitle: "first subtitle", byline: "Ana" },
      seo: { metaTitle: "unchanged meta" },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { item } = (await created.json()) as { item: { id: string } };
  const updated = await page.request.patch(`${ENTRIES}/${item.id}`, {
    data: {
      summary: "as it stands now",
      details: { subtitle: "second subtitle", byline: "Ana" },
    },
  });
  expect(updated.ok(), await updated.text()).toBe(true);
  return item.id;
}

/** Open History and choose the newest version, the one with changes. */
async function showNewestVersion(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/history-notes/${id}?history=1`);
  const rows = page.getByRole("button", { name: /Version \d+/ });
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await rows.first().click();
  await expect(page.getByRole("region", { name: "Comparison" })).toBeVisible({
    timeout: 30_000,
  });
}

/** The labels of the fields marked changed, in the order they are drawn. */
async function changedFields(page: Page): Promise<string[]> {
  const labels = await page
    .getByRole("region", { name: /, changed$/ })
    .evaluateAll(regions =>
      regions.map(region => region.getAttribute("aria-label") ?? "")
    );
  return labels.map(label => label.replace(/, changed$/, ""));
}

test.describe("a past version in the editor", () => {
  test("on a wide screen: marked in its layout, with its actions in the title bar", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await noteWithTwoVersions(page);
    await showNewestVersion(page, id);

    // The two fields the second save changed, marked in the form's order; the
    // embedded field group did not change, so it is folded away.
    await expect
      .poll(() => changedFields(page))
      .toEqual(["Summary", "Details"]);
    await expect(
      page
        .getByRole("region", { name: "Comparison" })
        .getByText(/^2 of \d+ fields changed$/)
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Show \d+ unchanged fields?$/ })
    ).toBeVisible();

    // Back to current and Restore… stand where Save and Publish do; nothing
    // that would act on the live document stays in view.
    const header = page.locator("main");
    await expect(
      header.getByRole("button", { name: "Restore…" })
    ).toBeVisible();
    await expect(
      header.getByRole("button", { name: /^save draft$/i })
    ).toHaveCount(0);

    // Back to current returns the live document.
    await header.getByRole("button", { name: "Back to current" }).click();
    await expect(page.getByRole("region", { name: "Comparison" })).toHaveCount(
      0
    );
    await expect(
      page.getByRole("textbox", { name: "Summary", exact: true })
    ).toHaveValue("as it stands now");
  });

  test("on a phone: the version's actions in a bar at the bottom", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const id = await noteWithTwoVersions(page);
    await showNewestVersion(page, id);

    const bar = page.getByRole("toolbar", { name: "Version actions" });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button", { name: "Restore…" })).toBeVisible();
    await expect(bar.getByText("1 of 2")).toBeVisible();
    // The way back to the list leads the version, where the panel stepped
    // aside for it.
    await expect(
      page
        .getByRole("region", { name: "Comparison" })
        .getByRole("button", { name: "History" })
    ).toBeVisible();

    await bar.getByRole("button", { name: "Back to current" }).click();
    await expect(bar).toHaveCount(0);
  });
});
