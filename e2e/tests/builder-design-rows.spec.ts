/**
 * The Design panel's compact rows in the browser: a variable is renamed in
 * place in its row, by its ⋯ menu's Rename or by F2.
 *
 * - Enter keeps the new name, read back from the stored site style.
 * - Leaving the field keeps it too.
 * - Escape cancels and hands focus back to the row.
 * - The code name stays through every rename, so CSS that uses it keeps
 *   working.
 * - "+ Add colour" at the end of the list, on a site with 30 colours and a
 *   search on, keeps the search and the list where it is, and opens the new
 *   colour beside its row, marked "New", with its name focused.
 */
import { expect, type Page } from "@playwright/test";

import { openEditorWith } from "./canvas/editor-driver";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage } from "./support/usage-count";

test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const NODES = [
  {
    id: "rows-text",
    type: "core/text",
    version: 1,
    props: { text: "A page beside the Design panel's rows" },
  },
];
const TOKENS = [
  {
    name: "color.brand",
    kind: "color",
    values: { light: "#1d2b6b", dark: "#8fa7ff" },
  },
  { name: "color.text", kind: "color", values: { light: "#3b3f46" } },
];

interface StoredToken {
  name: string;
  label?: string;
  values: { light: string; dark?: string };
}

async function storedTokens(page: Page): Promise<unknown> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return item.tokens ?? null;
}

/** The stored variables' code names and labels, in order. */
async function storedNames(page: Page): Promise<string[]> {
  const tokens = (await storedTokens(page)) as {
    tokens?: StoredToken[];
  } | null;
  return (tokens?.tokens ?? []).map(
    token => `${token.name}=${token.label ?? ""}`
  );
}

async function seed(page: Page, tokens: unknown): Promise<void> {
  await countEveryPage(page.request);
  const written = await page.request.patch(SITE_STYLE, {
    data: { tokens, _overwrite: true },
  });
  expect(written.ok(), `writing the variables: ${written.status()}`).toBe(true);
}

async function openDesign(page: Page, tab: string): Promise<void> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  if (!(await panel.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await panel.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
}

test("a colour is renamed in place: Enter and leaving the field keep the name, Escape cancels, and the code name stays", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const before = await storedTokens(page);
  try {
    await seed(page, { tokens: TOKENS });
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "rows-text");
    await openDesign(page, "Colours");
    const panel = page.getByRole("region", { name: "Design panel" });

    // From the ⋯ menu's Rename: the field is in the row, and Enter keeps it.
    // Names no colour the site's code supplies has, which would be refused.
    await panel.getByRole("button", { name: "More actions for Brand" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const brand = panel.getByRole("textbox", { name: "Name of Brand" });
    await expect(brand).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await brand.fill("Harbour");
    await brand.press("Enter");
    await expect(
      panel.getByRole("button", { name: /^Harbour,/ })
    ).toBeFocused();
    await expect
      .poll(() => storedNames(page))
      .toEqual(["color.brand=Harbour", "color.text="]);

    // F2, then leaving the field: kept.
    await panel.getByRole("button", { name: /^Text,/ }).focus();
    await page.keyboard.press("F2");
    const text = panel.getByRole("textbox", { name: "Name of Text" });
    await expect(text).toBeFocused();
    await text.fill("Paper ink");
    await page.getByRole("tab", { name: /^Colours/ }).click();
    await expect(
      panel.getByRole("button", { name: /^Paper ink,/ })
    ).toBeVisible();
    await expect
      .poll(() => storedNames(page))
      .toEqual(["color.brand=Harbour", "color.text=Paper ink"]);

    // F2, then Escape: cancelled, focus back on the row, nothing stored.
    const harbour = panel.getByRole("button", { name: /^Harbour,/ });
    await harbour.focus();
    await page.keyboard.press("F2");
    const field = panel.getByRole("textbox", { name: "Name of Harbour" });
    await field.fill("Gone");
    await field.press("Escape");
    await expect(field).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: /^Harbour,/ })
    ).toBeFocused();
    // The Design panel stays open: Escape closed only the field.
    await expect(panel).toBeVisible();
    expect(await storedNames(page)).toEqual([
      "color.brand=Harbour",
      "color.text=Paper ink",
    ]);
  } finally {
    await seed(page, before);
  }
});

/** `count` colours, named so they sort in order. */
function colours(count: number) {
  return {
    tokens: Array.from({ length: count }, (_, at) => ({
      name: `color.many-${String(at).padStart(2, "0")}`,
      kind: "color",
      values: { light: `#${(0x203040 + at * 0x050505).toString(16)}` },
    })),
  };
}

test("+ Add colour keeps the search and the list's place, and opens the new colour beside its row with its name focused", async ({
  page,
}) => {
  // Thirty colours seeded and read back, then restored: slow on a busy
  // machine, so more room than the other tests here.
  test.setTimeout(300_000);
  const before = await storedTokens(page);
  try {
    await seed(page, colours(30));
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "rows-text");
    await openDesign(page, "Colours");
    const panel = page.getByRole("region", { name: "Design panel" });
    const search = panel.getByRole("searchbox", { name: "Search Design" });
    // Matches every colour, enough rows to scroll, and not the new one.
    await search.fill("many");
    await expect(panel.locator(".nx-vars__row")).toHaveCount(30);
    const body = panel.locator(".nx-vars__body").first();
    // Part way down, where the add row is in view.
    const add = panel.getByRole("button", { name: "Add colour" });
    await add.scrollIntoViewIfNeeded();
    const scrolled = await body.evaluate(element => element.scrollTop);
    await add.click();

    const editor = page.getByRole("dialog", { name: "Edit New colour" });
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel("Name", { exact: true })).toBeFocused();
    // The search is kept, and the list did not jump back to its top. Read
    // by its field: the open editor hides the rest from the tree.
    await expect(page.locator('input[aria-label="Search Design"]')).toHaveValue(
      "many"
    );
    expect(
      Math.abs((await body.evaluate(element => element.scrollTop)) - scrolled)
    ).toBeLessThan(80);
    // The new row is the group's last, marked New, in view, and the editor
    // opens beside it.
    const added = panel.locator(".nx-vars__item").last();
    await expect(added.locator(".nx-vars__name")).toContainText("New colour");
    await expect(added.locator(".nx-vars__new")).toHaveText("New");
    await expect(added).toBeInViewport();
    const rowBox = await added.boundingBox();
    const box = await editor.boundingBox();
    const view = page.viewportSize();
    if (rowBox === null || box === null || view === null) {
      throw new Error("[e2e] no box");
    }
    expect(box.x).toBeGreaterThanOrEqual(rowBox.x + rowBox.width - 1);
    expect(box.y).toBeLessThanOrEqual(rowBox.y + rowBox.height);
    expect(box.y + box.height).toBeGreaterThanOrEqual(rowBox.y);
    expect(box.y + box.height).toBeLessThanOrEqual(view.height);
    // Closed, so the new colour is saved and the panel is at rest before
    // the variables are put back.
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
  } finally {
    await seed(page, before);
  }
});
