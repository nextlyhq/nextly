/**
 * Undo and redo reach a change to the site's shared styles.
 *
 * A variable changed in Design is saved as it is made, so before this the
 * editor's history skipped over it. Here the top bar's Undo saves the style
 * back as it was and Redo saves the change again, read back from the stored
 * site style, while the page itself never counts as holding unsaved work.
 *
 * @module builder-style-undo.spec
 */
import { expect, type Page } from "@playwright/test";

import { openEditorWith } from "./canvas/editor-driver";
import { LOCK } from "./support/locks";
import { includingHidden, test } from "./support/test";

// The homepage Single is reseeded and edited here, as the other builder files
// do, and the site's tokens are changed and restored.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const CHANGED = "#123456";
const NODES = [
  {
    id: "style-undo-text",
    type: "core/text",
    version: 1,
    props: { text: "A page beside a style change" },
  },
];

/** The stored `tokens` section, as the site style holds it. */
async function storedTokens(page: Page): Promise<unknown> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return item.tokens ?? null;
}

/** The next stored write of the site style. */
function styleWrite(page: Page) {
  return page.waitForResponse(
    response =>
      new URL(response.url()).pathname === SITE_STYLE &&
      ["PATCH", "PUT"].includes(response.request().method()) &&
      response.ok()
  );
}

test("Undo saves a changed variable back as it was, and Redo saves it again", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const before = await storedTokens(page);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, "style-undo-text");

    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
    // The variable's row opens its editor beside the panel.
    const row = page.getByRole("button", { name: /^Primary, light / });
    await row.click();
    const editor = page.getByRole("dialog", { name: "Edit Primary" });
    const value = editor.getByLabel("Light", { exact: true });
    const saved = styleWrite(page);
    await value.fill(CHANGED);
    await value.press("Enter");
    await saved;
    expect(JSON.stringify(await storedTokens(page))).toContain(CHANGED);
    await page.keyboard.press("Escape");

    const undone = styleWrite(page);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await undone;
    expect(await storedTokens(page)).toEqual(before);
    // The studio reads the section afresh rather than keeping the change.
    await page.getByRole("button", { name: /^Primary, light / }).click();
    await expect(
      page
        .getByRole("dialog", { name: "Edit Primary" })
        .getByLabel("Light", { exact: true })
    ).not.toHaveValue(CHANGED);
    await page.keyboard.press("Escape");

    const redone = styleWrite(page);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await redone;
    expect(JSON.stringify(await storedTokens(page))).toContain(CHANGED);

    // A style is stored as it changes: the page holds no unsaved work.
    await expect(
      includingHidden(page).getByText("Unsaved changes")
    ).toHaveCount(0);
  } finally {
    const restored = await page.request.patch(SITE_STYLE, {
      data: { tokens: before },
    });
    expect(restored.ok(), `restoring the tokens: ${restored.status()}`).toBe(
      true
    );
  }
});
