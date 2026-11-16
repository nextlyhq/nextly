/**
 * The Design panel holds still.
 *
 * - Switching its tabs leaves every column of the variable rows where it
 *   was, with classic scrollbars, which take room from the panel, and
 *   whether or not the usage counts have arrived. A count column sized to
 *   the counts, or a scrollbar that takes its room only when the list
 *   overflows, moved the rows sideways.
 * - With a long list of colours, a new colour's row is brought into view
 *   and its editor opens fully on screen, beside it, rather than off the
 *   bottom of the window.
 *
 * Both seed the site's variables and put them back after.
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
    id: "steady-text",
    type: "core/text",
    version: 1,
    props: { text: "A page beside the Design panel" },
  },
];

async function storedTokens(page: Page): Promise<unknown> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return item.tokens ?? null;
}

async function writeTokens(page: Page, tokens: unknown): Promise<void> {
  // Dropping a variable is refused until every page is counted.
  await countEveryPage(page.request);
  const written = await page.request.patch(SITE_STYLE, {
    data: { tokens, _overwrite: true },
  });
  expect(written.ok(), `writing the variables: ${written.status()}`).toBe(true);
}

/** `count` colours, named so they sort in order. */
function colours(count: number) {
  return {
    tokens: Array.from({ length: count }, (_, at) => ({
      name: `color.steady-${String(at).padStart(2, "0")}`,
      kind: "color",
      values: { light: `#${(0x203040 + at * 0x050505).toString(16)}` },
    })),
  };
}

/** Every scrollbar a classic one, as Windows and a Mac set to "Always" draw them. */
async function forceClassicScrollbars(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      "::-webkit-scrollbar { width: 15px; height: 15px; } ::-webkit-scrollbar-thumb { background: #888; }",
  });
}

async function openDesign(page: Page): Promise<void> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  if (!(await panel.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await expect(panel).toBeVisible();
}

/** The first variable row's name and value columns, in the window. */
async function firstRowColumns(page: Page) {
  const row = page.locator(".nx-vars__row").first();
  await expect(row).toBeVisible();
  // Each column found by what it is, so a count arriving after the first
  // measure is measured as the count rather than taken for the values.
  return row.evaluate(element => {
    const at = (box: Element | null) => {
      const rect = box?.getBoundingClientRect();
      return rect === undefined
        ? null
        : { left: Math.round(rect.left), right: Math.round(rect.right) };
    };
    return {
      row: at(element),
      name: at(element.querySelector(".nx-vars__name")),
      values: at(element.querySelector(".nx-vars__pair")),
    };
  });
}

async function switchTo(page: Page, tab: string): Promise<void> {
  await page.getByRole("tab", { name: tab, exact: true }).click();
  await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute(
    "aria-selected",
    "true"
  );
}

test("switching Design tabs leaves the rows' columns where they were", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const before = await storedTokens(page);
  try {
    // Enough rows that the list scrolls in one tab and not in another.
    await writeTokens(page, colours(30));
    await forceClassicScrollbars(page);
    await page.setViewportSize({ width: 1440, height: 800 });
    await openEditorWith(page, NODES, "steady-text");
    await forceClassicScrollbars(page);
    await openDesign(page);
    // Right after opening, before the usage counts may have arrived.
    const first = await firstRowColumns(page);
    // The room inside the panel's body, in a tab whose list scrolls and in
    // one whose list does not: a scrollbar taking room only in the first
    // narrows every row there.
    const room = () =>
      page.locator(".nx-vars__body").evaluate(body => body.clientWidth);
    const scrolling = await room();
    await switchTo(page, "Fonts");
    expect(await room()).toBe(scrolling);
    for (const tab of ["Shared styles", "Variables", "Fonts", "Variables"]) {
      await switchTo(page, tab);
    }
    // And once the counts are in.
    await expect(page.locator(".nx-vars__count").first()).toBeVisible({
      timeout: 30_000,
    });
    const settled = await firstRowColumns(page);
    expect(settled).toEqual(first);
  } finally {
    await writeTokens(page, before);
  }
});

test("a colour added to a long list opens its editor fully on screen", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const before = await storedTokens(page);
  try {
    await writeTokens(page, colours(30));
    await page.setViewportSize({ width: 1440, height: 800 });
    await openEditorWith(page, NODES, "steady-text");
    await openDesign(page);
    // The list at its top, the new row's place far below the window.
    await page.locator(".nx-vars__body").evaluate(body => {
      body.scrollTop = 0;
    });
    await page.getByRole("button", { name: "Add colour" }).click();
    const editor = page.getByRole("dialog", { name: "Edit New colour" });
    await expect(editor).toBeVisible();
    const box = await editor.boundingBox();
    const view = page.viewportSize();
    if (box === null || view === null) throw new Error("[e2e] no box");
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(view.height);
    expect(box.x + box.width).toBeLessThanOrEqual(view.width);
    // Beside its row, which is in view.
    const row = page.locator(".nx-vars__row[data-open]");
    await expect(row).toBeInViewport();
    await page.keyboard.press("Escape");
  } finally {
    await writeTokens(page, before);
  }
});
