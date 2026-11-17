/**
 * The in-place block picker in the real editor, opened with "/", and in the
 * picker harness, opened at a fixed gap from a "+" at each corner.
 *
 * What each asserts, and the broken version it rules out:
 *
 * - "/" with a Section selected opens the picker with focus in its search,
 *   the default six, and a line naming the Section; with nothing selected
 *   the line names the end of the page. A binding that never reached the
 *   canvas, or a picker placing by its own rule, says something else.
 * - Enter on Heading adds it inside the Section and puts the caret in it;
 *   Box is added after the Section and focus goes to the canvas. A picker
 *   that left focus in a closed dialog leaves the author nowhere.
 * - Three Quotes added through the picker put Quote among the six. A count
 *   that was never kept leaves the default six.
 * - Escape, and a press outside, close the picker with nothing added and
 *   focus back on the canvas that opened it.
 * - "Browse all" from "/" keeps placing by the rule: a Heading inside the
 *   Section, then, with the Section selected again, a Box after it.
 * - From the Add panel alone, by keyboard: a tile's place is read with it
 *   and Enter adds it there.
 * - At 1280×800, the picker opened from a "+" at each corner of the window
 *   is wholly on screen; "Browse all" from the gap's "+" adds in that gap.
 *
 * Each editor test makes its own page, named uniquely, so no lock is needed.
 *
 * @module tests/builder-insert-picker.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  canvasRoot,
  clickBlock,
  selection,
  structure,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const HERO = "00000000-0000-4000-8000-00000000f001";
const HEADING = "00000000-0000-4000-8000-00000000f002";

function stamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A page with a Section named Hero holding one Heading. */
async function createPage(request: APIRequestContext): Promise<string> {
  const t = stamp();
  const created = await request.post(PAGES, {
    data: {
      title: `Insert picker ${t}`,
      slug: `insert-picker-${t}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: HERO,
            type: "core/section",
            version: 1,
            name: "Hero",
            props: { as: "section", contained: true },
            slots: {
              children: [
                {
                  id: HEADING,
                  type: "core/heading",
                  version: 1,
                  props: { text: "Welcome", level: "h2" },
                },
              ],
            },
          },
        ],
      },
    },
  });
  expect(created.ok(), `creating the page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** Select Hero on the canvas, so the keyboard works the canvas. */
async function selectHero(page: Page): Promise<void> {
  await clickBlock(page, HERO);
  await expect.poll(() => selection(page)).toEqual([HERO]);
}

function picker(page: Page) {
  return page.getByRole("dialog", { name: "Add a block" });
}

function search(page: Page) {
  return picker(page).getByRole("combobox", { name: "Search blocks" });
}

/** The six's names, as a screen reader reads each cell's name. */
function cellNames(page: Page): Promise<string[]> {
  return picker(page)
    .getByRole("gridcell")
    .evaluateAll(cells =>
      cells.map(cell => cell.getAttribute("aria-label") ?? "")
    );
}

/** Open the picker with "/", from the canvas. */
async function slash(page: Page): Promise<void> {
  await page.keyboard.press("/");
  await expect(search(page)).toBeFocused();
}

/** The blocks directly inside Hero, and the page's top level, by id. */
async function heroChildren(page: Page): Promise<number> {
  return (await structure(page)).filter(entry => entry.startsWith(`${HERO}>`))
    .length;
}

async function topLevel(page: Page): Promise<number> {
  return (await structure(page)).filter(entry => !entry.includes(">")).length;
}

/** Whether focus is on the canvas's frame, and what is focused inside it. */
async function canvasFocus(page: Page): Promise<{
  readonly onFrame: boolean;
  readonly editing: string | null;
}> {
  const onFrame = await page.evaluate(
    () => document.activeElement?.tagName === "IFRAME"
  );
  const editing = await (
    await canvasRoot(page)
  ).evaluate(root => {
    const active = root.ownerDocument.activeElement;
    if (active === null || !active.hasAttribute("contenteditable")) return null;
    return active.closest("[data-nx-node]")?.getAttribute("data-nx-node") ?? "";
  });
  return { onFrame, editing };
}

test.describe("the in-place picker, opened with /", () => {
  test.describe.configure({ timeout: 240_000 });

  test("opens beside the selected Section, with its search, the six and where it adds", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await selectHero(page);
    await slash(page);

    await expect
      .poll(() => cellNames(page))
      .toEqual(["Heading", "Text", "Image", "Button", "Box", "Columns"]);
    await expect(picker(page)).toHaveAccessibleDescription(
      "Adding inside Hero, at the end"
    );
    await expect(
      picker(page).getByRole("button", {
        name: "Browse all blocks and sections →",
      })
    ).toBeVisible();
    // Beside the Section: the picker's top edge is within its box's span.
    const hero = await (await canvasRoot(page))
      .locator(`[data-nx-node="${HERO}"]`)
      .boundingBox();
    const box = await picker(page).boundingBox();
    expect(hero).not.toBeNull();
    expect(box).not.toBeNull();
    if (hero !== null && box !== null) {
      expect(box.y).toBeGreaterThanOrEqual(hero.y - box.height - 16);
      expect(box.y).toBeLessThanOrEqual(hero.y + hero.height + 16);
    }

    await page.keyboard.press("Escape");
    await expect(picker(page)).toBeHidden();
    // With nothing selected, "/" adds at the end of the page.
    await page.keyboard.press("Escape");
    await expect.poll(() => selection(page)).toEqual([]);
    await slash(page);
    await expect(picker(page)).toHaveAccessibleDescription(
      "Adding at the end of the page"
    );
  });

  test("Enter on Heading adds it inside the Section with the caret in it; Box goes after it with focus on the canvas", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await selectHero(page);
    await slash(page);
    await page.keyboard.press("Enter");
    await expect(picker(page)).toBeHidden();
    await expect.poll(() => heroChildren(page)).toBe(2);
    const [added] = await selection(page);
    expect(added).not.toBe(HERO);
    await expect
      .poll(async () => (await canvasFocus(page)).editing)
      .toBe(added);

    // Out of the text, Hero again, and a Box: after Hero, focus on the canvas.
    await page.keyboard.press("Escape");
    await selectHero(page);
    await slash(page);
    await search(page).fill("box");
    await page.keyboard.press("Enter");
    await expect(picker(page)).toBeHidden();
    await expect.poll(() => topLevel(page)).toBe(2);
    await expect
      .poll(() => canvasFocus(page))
      .toEqual({ onFrame: true, editing: null });
  });

  test("three Quotes added through the picker put Quote among the six", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    for (let added = 0; added < 3; added++) {
      await selectHero(page);
      await slash(page);
      await search(page).fill("quote");
      await page.keyboard.press("Enter");
      await expect(picker(page)).toBeHidden();
      // The new Quote opens for typing; leave its text.
      await page.keyboard.press("Escape");
    }
    await selectHero(page);
    await slash(page);
    await expect.poll(() => cellNames(page)).toContain("Quote");
  });

  test("Escape and a press outside close it with nothing added, and focus back on the canvas", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await selectHero(page);
    const before = await structure(page);

    await slash(page);
    await page.keyboard.press("Escape");
    await expect(picker(page)).toBeHidden();
    await expect.poll(() => canvasFocus(page)).toMatchObject({ onFrame: true });
    // Escape closed the picker, and left the Section selected.
    expect(await selection(page)).toEqual([HERO]);

    // A press on the page, inside the canvas's own frame.
    await slash(page);
    await clickBlock(page, HERO);
    await expect(picker(page)).toBeHidden();
    await expect.poll(() => canvasFocus(page)).toMatchObject({ onFrame: true });
    expect(await structure(page)).toEqual(before);
  });

  test("Browse all keeps placing by the rule: a Heading inside the Section, then a Box after it", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await selectHero(page);
    await slash(page);
    await picker(page)
      .getByRole("button", { name: "Browse all blocks and sections →" })
      .click();
    await expect(picker(page)).toBeHidden();
    const panelSearch = page.getByRole("combobox", { name: "Insert a block" });
    await expect(panelSearch).toBeFocused();
    expect(await selection(page)).toEqual([HERO]);
    // Nothing was carried: each tile says its own place by the rule, so a Box
    // goes after the Section while a Heading goes inside it.
    await expect(
      page.getByRole("option", { name: "Box", exact: true })
    ).toHaveAccessibleDescription(/^Goes after Hero\./);
    await expect(
      page.getByRole("option", { name: "Heading", exact: true })
    ).toHaveAccessibleDescription(/^Goes inside Hero, at the end\./);

    await page.getByRole("option", { name: "Heading", exact: true }).click();
    await expect.poll(() => heroChildren(page)).toBe(2);
    await selectHero(page);
    await page.getByRole("option", { name: "Box", exact: true }).click();
    await expect.poll(() => topLevel(page)).toBe(2);
    expect(await heroChildren(page)).toBe(2);
  });

  test("from the Add panel by keyboard alone, a tile's place is read with it and Enter adds it there", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await selectHero(page);
    // To the panel without the mouse: "/" then Tab to Browse all.
    await slash(page);
    await page.keyboard.press("Tab");
    await expect(
      picker(page).getByRole("button", {
        name: "Browse all blocks and sections →",
      })
    ).toBeFocused();
    await page.keyboard.press("Enter");
    const panelSearch = page.getByRole("combobox", { name: "Insert a block" });
    await expect(panelSearch).toBeFocused();
    await panelSearch.fill("Quote");
    const active = page.locator(
      ".nx-insert-panel [cmdk-item][data-selected='true']"
    );
    await expect(active).toHaveAccessibleName("Quote");
    // The place is read with the tile, before what it is.
    await expect(active).toHaveAccessibleDescription(
      /^Goes inside Hero, at the end\./
    );
    await page.keyboard.press("Enter");
    await expect.poll(() => heroChildren(page)).toBe(2);
    await expect
      .poll(() => page.locator("[data-insert-announcement]").allTextContents())
      .toContain("Quote added inside Hero, at the end");
  });
});

test.describe("the in-place picker, opened at a fixed gap", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("is wholly on screen from a + at each corner of the window", async ({
    page,
  }) => {
    await page.goto("/builder-picker");
    for (const corner of [
      "top left",
      "top right",
      "bottom left",
      "bottom right",
    ]) {
      await page
        .getByRole("button", {
          name: `Add a block between Hero and Pricing (${corner})`,
        })
        .click();
      await expect(picker(page)).toHaveAccessibleDescription(
        "Adding between Hero and Pricing"
      );
      const box = await picker(page).boundingBox();
      expect(box, corner).not.toBeNull();
      if (box !== null) {
        expect(box.x, corner).toBeGreaterThanOrEqual(0);
        expect(box.y, corner).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, corner).toBeLessThanOrEqual(1280);
        expect(box.y + box.height, corner).toBeLessThanOrEqual(800);
      }
      await page.keyboard.press("Escape");
      await expect(picker(page)).toBeHidden();
    }
  });

  test("Browse all from the gap's + adds a block clicked in the panel in that gap", async ({
    page,
  }) => {
    await page.goto("/builder-picker");
    await page
      .getByRole("button", {
        name: "Add a block between Hero and Pricing (top right)",
      })
      .click();
    await picker(page)
      .getByRole("button", { name: "Browse all blocks and sections →" })
      .click();
    const panel = page.getByRole("complementary", { name: "Add panel" });
    await expect(panel.locator(".nx-insert-panel__placement")).toHaveText(
      "Adding between Hero and Pricing"
    );
    await panel.getByRole("option", { name: "Heading", exact: true }).click();
    await expect
      .poll(async () =>
        JSON.parse(
          (await page
            .getByTestId("picker-harness")
            .getAttribute("data-nx-document")) ?? "[]"
        )
      )
      .toEqual([
        { type: "core/section", children: ["core/heading"] },
        { type: "core/heading", children: [] },
        { type: "core/section", children: ["core/heading"] },
      ]);
  });
});
