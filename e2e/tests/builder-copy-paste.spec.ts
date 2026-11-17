/**
 * Copy, cut and paste of blocks in the real editor, on the keys and from the
 * block toolbar's menu, within a page and across pages.
 *
 * What each asserts, and the broken version it rules out:
 *
 * - A Heading copied with ⌘C and pasted with ⌘V into a selected Section is
 *   the Section's last child, selected, with a new id, and one undo takes it
 *   away. A paste that ignored the placement rule stores it after the
 *   Section; one applied as several edits needs several undos.
 * - Pasted with the Heading selected, the copy lands right after it; with
 *   nothing selected, at the end of the page.
 * - Copied on one page and pasted in another browser tab, on another page,
 *   the copy arrives with its words. A clipboard kept in the tab's memory
 *   pastes nothing there.
 * - Copy and Paste from the toolbar's "More actions" menu do the same as the
 *   keys.
 * - ⌘C and ⌘V in a heading's text being edited on the canvas, and in the
 *   panel's text field, copy and paste the TEXT: the words double and no
 *   block is added; ⌘X in the field cuts the words, not the block. With
 *   blocks on the clipboard, ⌘V at a caret in the heading still adds no
 *   block. Keys taken for blocks there would add or remove a block.
 *
 * "Control" stands for the editor's "mod" key: the suite's browser reports a
 * Windows user agent, so the editor reads "mod" as Control.
 *
 * Each test makes its own pages, named uniquely, so no lock is needed.
 *
 * @module tests/builder-copy-paste.spec
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  glyphPoint,
  layerRow,
  openLayers,
  pressSave,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";

const HERO = "00000000-0000-4000-8000-00000000f101";
const HEADING = "00000000-0000-4000-8000-00000000f102";
const PRICING = "00000000-0000-4000-8000-00000000f103";

function stamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A Hero section holding a "Welcome" Heading, and an empty Pricing section. */
function content(empty: boolean): unknown {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: empty
      ? []
      : [
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
          {
            id: PRICING,
            type: "core/section",
            version: 1,
            name: "Pricing",
            props: { as: "section", contained: true },
            slots: { children: [] },
          },
        ],
  };
}

async function createPage(
  request: APIRequestContext,
  empty = false
): Promise<string> {
  const t = stamp();
  const created = await request.post(PAGES, {
    data: {
      title: `Copy paste ${t}`,
      slug: `copy-paste-${t}`,
      status: "draft",
      content: content(empty),
    },
  });
  expect(created.ok(), `creating the page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * One page block in the canvas frame, by its id. Read from the whole frame:
 * the site's header and footer are drawn in the same frame, around the page.
 */
function pageBlock(page: Page, id: string): Locator {
  return canvasFrame(page).locator(`[data-nx-node="${id}"]`).first();
}

/** Which blocks the canvas marks selected, primary first. */
async function selection(page: Page): Promise<string[]> {
  return canvasFrame(page)
    .locator("body")
    .evaluate(body => {
      const marked = Array.from(body.querySelectorAll("[data-nx-selected]"));
      const id = (each: Element) => each.getAttribute("data-nx-node") ?? "";
      return [
        ...marked.filter(each => each.getAttribute("data-nx-selected") === "primary"),
        ...marked.filter(each => each.getAttribute("data-nx-selected") !== "primary"),
      ].map(id);
    });
}

/** Click a page block at its right edge, halfway down, clear of its toolbar. */
async function clickBlock(page: Page, id: string): Promise<void> {
  const box = await pageBlock(page, id).boundingBox();
  if (box === null) throw new Error(`[e2e] block ${id} rendered no box`);
  await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
}

/** A page block's inline field for `prop`. */
function fieldOf(page: Page, id: string, prop: string): Locator {
  return pageBlock(page, id)
    .locator(`xpath=descendant-or-self::*[@data-nx-prop="${prop}"]`)
    .first();
}

/** The selected block's toolbar "More actions" button. */
function blockMenu(page: Page): Locator {
  return page
    .getByTestId("canvas")
    .getByRole("button", { name: "More actions" });
}

/** Select a block from its Layers row. */
async function selectInLayers(page: Page, id: string): Promise<void> {
  await openLayers(page);
  await layerRow(page, id).locator(`[data-nx-layer="${id}"]`).first().click();
  await expect.poll(() => selection(page)).toEqual([id]);
}

/** The blocks drawn inside `parent`, in order. */
async function childrenOf(page: Page, parent: string): Promise<string[]> {
  return pageBlock(page, parent).evaluate(element =>
    Array.from(element.querySelectorAll("[data-nx-node]"), each =>
      each.getAttribute("data-nx-node")
    ).filter((id): id is string => id !== null)
  );
}

/** Every page block's id, in page order, the site's header and footer aside. */
async function pageIds(page: Page, within: string): Promise<string[]> {
  return pageBlock(page, within).evaluate(element => {
    const root = element.parentElement;
    return root === null
      ? []
      : Array.from(root.querySelectorAll("[data-nx-node]"), each =>
          each.getAttribute("data-nx-node") ?? ""
        );
  });
}

/** Save the draft and read the page's stored top-level blocks. */
async function savedTopLevel(
  page: Page,
  id: string
): Promise<{ id: string; type: string; props?: { text?: string } }[]> {
  const saved = page.waitForResponse(
    response =>
      response.url().includes("/collections/pages/entries") &&
      ["PATCH", "PUT", "POST"].includes(response.request().method()) &&
      response.ok()
  );
  await pressSave(page);
  await saved;
  return (await storedPageNodes(page.request, PAGES, id)) as unknown as {
    id: string;
    type: string;
    props?: { text?: string };
  }[];
}

test.describe("copying, cutting and pasting blocks", () => {
  test.describe.configure({ timeout: 240_000 });

  test("⌘C then ⌘V pastes inside a selected Section, selected, as one undo step", async ({
    page,
  }) => {
    await openBuilder(page, await createPage(page.request));

    await clickBlock(page, HEADING);
    await expect.poll(() => selection(page)).toEqual([HEADING]);
    await page.keyboard.press("Control+c");

    await selectInLayers(page, PRICING);
    await page.keyboard.press("Control+v");

    await expect.poll(() => childrenOf(page, PRICING)).toHaveLength(1);
    const [copy] = await childrenOf(page, PRICING);
    expect(copy).not.toBe(HEADING);
    await expect(pageBlock(page, copy ?? "")).toHaveText("Welcome");
    await expect.poll(() => selection(page)).toEqual([copy]);
    // The original stays where it was.
    expect(await childrenOf(page, HERO)).toEqual([HEADING]);

    await page.keyboard.press("Control+z");
    await expect.poll(() => childrenOf(page, PRICING)).toEqual([]);
  });

  test("pastes right after a selected Heading, and at the end of the page with nothing selected", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);

    await clickBlock(page, HEADING);
    await expect.poll(() => selection(page)).toEqual([HEADING]);
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await expect.poll(() => childrenOf(page, HERO)).toHaveLength(2);
    expect((await childrenOf(page, HERO))[0]).toBe(HEADING);

    // Escape goes up to the Hero, then clears the selection at the top.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect.poll(() => selection(page)).toEqual([]);
    await page.keyboard.press("Control+v");

    // The paste selects the copy it made.
    await expect.poll(async () => (await selection(page)).length).toBe(1);
    const stored = await savedTopLevel(page, id);
    expect(stored.map(node => node.type)).toEqual([
      "core/section",
      "core/section",
      "core/heading",
    ]);
    expect(stored[2]?.props?.text).toBe("Welcome");
    expect(stored[2]?.id).not.toBe(HEADING);
  });

  test("pastes in another browser tab, on another page of the same site", async ({
    page,
    context,
  }) => {
    await openBuilder(page, await createPage(page.request));
    await clickBlock(page, HEADING);
    await expect.poll(() => selection(page)).toEqual([HEADING]);
    await page.keyboard.press("Control+c");

    const other = await context.newPage();
    const otherId = await createPage(other.request, true);
    await openBuilder(other, otherId);
    await other.keyboard.press("Control+v");

    await expect(
      canvasFrame(other).locator("[data-nx-node]", { hasText: "Welcome" })
    ).not.toHaveCount(0);
    const stored = await savedTopLevel(other, otherId);
    expect(stored.map(node => node.type)).toEqual(["core/heading"]);
    expect(stored[0]?.props?.text).toBe("Welcome");
    expect(stored[0]?.id).not.toBe(HEADING);
    await other.close();
  });

  test("Copy and Paste from the toolbar's More actions menu", async ({
    page,
    context,
  }) => {
    // A menu's Paste reads the clipboard itself, which the browser asks
    // permission for; an author grants it once.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openBuilder(page, await createPage(page.request));

    await clickBlock(page, HEADING);
    await blockMenu(page).click();
    await page.getByRole("menuitem", { name: "Copy", exact: true }).click();

    await selectInLayers(page, PRICING);
    await blockMenu(page).click();
    await page.getByRole("menuitem", { name: "Paste", exact: true }).click();

    await expect.poll(() => childrenOf(page, PRICING)).toHaveLength(1);
    const [copy] = await childrenOf(page, PRICING);
    expect(copy).not.toBe(HEADING);
    await expect(pageBlock(page, copy ?? "")).toHaveText("Welcome");
  });

  test("⌘V in a heading's text on the canvas goes to the text even with blocks copied", async ({
    page,
  }) => {
    await openBuilder(page, await createPage(page.request));
    // Blocks on the clipboard: a paste the editor took for blocks would add one.
    await clickBlock(page, HEADING);
    await expect.poll(() => selection(page)).toEqual([HEADING]);
    await page.keyboard.press("Control+c");
    // Cleared, so the block's toolbar is not drawn over the words to press.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect.poll(() => selection(page)).toEqual([]);
    const before = await pageIds(page, HERO);

    const text = fieldOf(page, HEADING, "text");
    const point = await glyphPoint(page, text, 0.5);
    await page.mouse.dblclick(point.x, point.y);
    await expect(text).toHaveAttribute(
      "contenteditable",
      /^(true|plaintext-only)$/,
      { timeout: 30_000 }
    );
    // A caret, with nothing highlighted, so only the text rule keeps the key.
    await page.keyboard.press("End");
    await page.keyboard.press("Control+v");
    await page.keyboard.press("Escape");

    await expect(text).not.toHaveAttribute("contenteditable", /.+/);
    expect(await pageIds(page, HERO)).toEqual(before);
  });

  test("⌘C and ⌘V in a heading's text on the canvas copy and paste the text, not the block", async ({
    page,
  }) => {
    await openBuilder(page, await createPage(page.request));
    const before = await pageIds(page, HERO);

    const text = fieldOf(page, HEADING, "text");
    const point = await glyphPoint(page, text, 0.5);
    await page.mouse.dblclick(point.x, point.y);
    await expect(text).toHaveAttribute(
      "contenteditable",
      /^(true|plaintext-only)$/,
      { timeout: 30_000 }
    );
    // Entering selects the whole field.
    await page.keyboard.press("Control+c");
    await page.keyboard.press("End");
    await page.keyboard.press("Control+v");
    await page.keyboard.press("Enter");

    await expect(text).not.toHaveAttribute("contenteditable", /.+/);
    await expect(pageBlock(page, HEADING)).toHaveText("WelcomeWelcome");
    expect(await pageIds(page, HERO)).toEqual(before);
  });

  test("⌘C and ⌘V in the panel's text field copy and paste the text, not the block", async ({
    page,
  }) => {
    await openBuilder(page, await createPage(page.request));
    await clickBlock(page, HEADING);
    await expect.poll(() => selection(page)).toEqual([HEADING]);
    const before = await pageIds(page, HERO);

    const words = page.getByLabel("Text", { exact: true });
    await words.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+c");
    await page.keyboard.press("End");
    await page.keyboard.press("Control+v");

    await expect(words).toHaveValue("WelcomeWelcome");
    expect(await pageIds(page, HERO)).toEqual(before);

    // ⌘X cuts the words, not the block.
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+x");
    await expect(words).toHaveValue("");
    expect(await pageIds(page, HERO)).toEqual(before);
  });
});
