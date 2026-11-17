/**
 * The Design panel's value controls in the browser: a size is a number with
 * the block panel's unit menu, and a line height a multiple of the text size
 * with an offer of pixels for a number too large to be one.
 *
 * - A bare number saves as pixels, read back from the stored site style.
 * - At the panel's narrowest, the last row's unit menu opens inside the
 *   window.
 * - "Use 20px" under a line height of 20 saves 20px.
 * - A font variable is chosen from the picker, never typed, and a weight by
 *   name, each saved as the value the site's stylesheet reads.
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
    id: "values-text",
    type: "core/text",
    version: 1,
    props: { text: "A page beside the Design panel's values" },
  },
];
const TOKENS = [
  { name: "font-size.body", kind: "dimension", values: { light: "16px" } },
  { name: "line-height.body", kind: "number", values: { light: "1.5" } },
  { name: "space.2", kind: "dimension", values: { light: "0.5rem" } },
  { name: "space.4", kind: "dimension", values: { light: "1rem" } },
  {
    name: "font.heading",
    kind: "fontFamily",
    values: { light: "Georgia, serif" },
  },
  { name: "weight.strong", kind: "fontWeight", values: { light: "700" } },
];

async function storedTokens(page: Page): Promise<unknown> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return item.tokens ?? null;
}

/** One variable's light value, as stored. */
async function storedValue(page: Page, name: string): Promise<unknown> {
  const tokens = (await storedTokens(page)) as {
    tokens?: { name: string; values: { light: string } }[];
  } | null;
  return tokens?.tokens?.find(token => token.name === name)?.values.light;
}

async function seed(page: Page, tokens: unknown): Promise<void> {
  // Dropping a variable is refused until every page is counted.
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

test("a size is a number with a unit menu, saves a bare number as pixels, and its menu opens inside the window at the narrowest", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const before = await storedTokens(page);
  try {
    await seed(page, { tokens: TOKENS });
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "values-text");
    await openDesign(page, "Spacing");
    const panel = page.getByRole("region", { name: "Design panel" });

    await panel.getByRole("button", { name: /^Space 4/ }).click();
    const editor = page.locator(".nx-vars-editor");
    await expect(editor.getByLabel("Light", { exact: true })).toHaveValue("1");
    await editor.getByLabel("Unit for Light").click();
    for (const unit of ["px", "rem", "em", "%", "vw", "vh"]) {
      await expect(
        page.getByRole("option", { name: unit, exact: true })
      ).toBeVisible();
    }
    await page.getByRole("option", { name: "px", exact: true }).click();
    const light = editor.getByLabel("Light", { exact: true });
    await light.fill("16");
    await light.press("Enter");
    await expect.poll(() => storedValue(page, "space.4")).toBe("16px");
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();

    // The narrowest panel, and the last row's menu.
    const divider = page.getByRole("separator", { name: "Panel and canvas" });
    await divider.focus();
    await page.keyboard.press("Home");
    await expect
      .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
      .toBeLessThanOrEqual(240);
    const last = panel.locator(".nx-vars__row").last();
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await expect(editor).toBeVisible();
    await editor.getByLabel("Unit for Light").click();
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box, "the unit menu is drawn").not.toBeNull();
    if (box !== null) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1280);
      expect(box.y + box.height).toBeLessThanOrEqual(720);
    }
    await page.keyboard.press("Escape");
  } finally {
    await seed(page, before);
  }
});

test("a line height of 20 offers 20px, and uses it when asked", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const before = await storedTokens(page);
  try {
    await seed(page, { tokens: TOKENS });
    await openEditorWith(page, NODES, "values-text");
    await openDesign(page, "Type");
    const panel = page.getByRole("region", { name: "Design panel" });
    // The type size's row; the Type tab also lists the Body font.
    await panel.getByRole("button", { name: /^Body, size/ }).click();
    const editor = page.locator(".nx-vars-editor");
    const line = editor.getByLabel("Line height, light");
    await expect(line).toHaveValue("1.5");
    await line.fill("20");
    await line.press("Enter");
    await expect(
      editor.getByText("20× the text size. Did you mean 20px?")
    ).toBeVisible();
    await editor.getByRole("button", { name: "Use 20px" }).click();
    await expect.poll(() => storedValue(page, "line-height.body")).toBe("20px");
  } finally {
    await seed(page, before);
  }
});

test("a font variable is picked from the site's and the system's fonts, and a weight by name", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const before = await storedTokens(page);
  try {
    await seed(page, { tokens: TOKENS });
    await openEditorWith(page, NODES, "values-text");
    await openDesign(page, "Type");
    const panel = page.getByRole("region", { name: "Design panel" });
    const editor = page.locator(".nx-vars-editor");

    await panel.getByRole("button", { name: /^Heading/ }).click();
    // A picker, with no box to type a family into.
    await expect(editor.getByRole("textbox", { name: "Light" })).toHaveCount(0);
    await editor.getByRole("button", { name: /^Font, / }).click();
    const list = page.getByRole("listbox");
    await expect(list.getByRole("group", { name: "System" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Manage fonts…" })
    ).toBeVisible();
    // Picked by name, and stored as that family exactly.
    await list
      .getByRole("group", { name: "System" })
      .getByRole("option", { name: /^Monospace/ })
      .click();
    await expect
      .poll(() => storedValue(page, "font.heading"))
      .toBe("monospace");
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();

    await panel.getByRole("button", { name: /^Strong/ }).click();
    await editor.getByLabel("Light", { exact: true }).click();
    await page.getByRole("option", { name: /^Regular 400/ }).click();
    await expect.poll(() => storedValue(page, "weight.strong")).toBe("400");
  } finally {
    await seed(page, before);
  }
});
