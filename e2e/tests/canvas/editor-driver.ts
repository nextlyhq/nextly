/**
 * Driving the real page builder, wherever its canvas renders.
 *
 * The canvas renders in the admin's own document today. It is meant to move
 * into a same-origin iframe the editor owns, titled "Page canvas: …", and this
 * suite exists to be the before-and-after check for that move. So nothing here
 * assumes which document the blocks are in:
 *
 * - blocks are found through {@link canvasScope}, which is the canvas frame
 *   when there is one and the page otherwise;
 * - anything evaluated against a block reads the block's OWN document and
 *   window (`ownerDocument`, `defaultView`), never the globals of whichever
 *   realm the evaluation started in;
 * - pointer positions come from Playwright's `boundingBox()`, which reports a
 *   framed element in the main page's coordinates, so `page.mouse` lands on it
 *   either way.
 *
 * The editor's chrome — Layers, the live region, the inspector — stays in the
 * admin's document in both arrangements, so it is found on the page.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/canvas/editor-driver
 */

import {
  expect,
  type FrameLocator,
  type Locator,
  type Page,
} from "@playwright/test";

import { gotoAdmin } from "../support/admin";

/** The frame the canvas will render in, by the title the editor gives it. */
export const CANVAS_FRAME = 'iframe[title^="Page canvas"]';

const HOMEPAGE = "/admin/api/singles/homepage";

/** Either label the builder's card uses, for an empty page and a built one. */
const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;

/** Something `.locator()` can be asked of: the page, or the canvas frame. */
type Scope = Page | FrameLocator;

/**
 * The document the blocks are in.
 *
 * Asked fresh on every call rather than decided once, because the frame is
 * created when the canvas mounts and a scope taken before that would point at
 * the page for the rest of the test.
 */
export async function canvasScope(page: Page): Promise<Scope> {
  return (await page.locator(CANVAS_FRAME).count()) > 0
    ? page.frameLocator(CANVAS_FRAME)
    : page;
}

/** The canvas's root element, inside whichever document holds it. */
export async function canvasRoot(page: Page): Promise<Locator> {
  return (await canvasScope(page)).locator(".nx-canvas").first();
}

/** One block on the canvas, by its document id. */
export async function block(page: Page, id: string): Promise<Locator> {
  return (await canvasRoot(page)).locator(`[data-nx-node="${id}"]`);
}

/** One block's row in the Layers panel, which stays in the admin's document. */
export function layerRow(page: Page, id: string): Locator {
  return page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem")
    .filter({ has: page.locator(`[data-nx-layer="${id}"]`) });
}

/**
 * Open the Layers panel from the left rail, unless it is already open.
 *
 * The rail button is a toggle (`aria-pressed`), so pressing it blind would
 * close a panel an earlier step left open.
 */
export async function openLayers(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Layers", exact: true });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") {
    await toggle.click();
  }
  await expect(page.getByRole("tree", { name: "Layers" })).toBeVisible();
}

/**
 * The blocks Layers marks as selected, by the `data-nx-layer` of each selected
 * row's own label.
 *
 * Rows nest, so a selected row CONTAINS the rows of its children: the first
 * label inside a row is its own, and the ones after it are its children's.
 */
export async function selectedLayers(page: Page): Promise<string[]> {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator('[role="treeitem"][aria-selected="true"]')
    .evaluateAll(rows =>
      rows.map(
        row =>
          row.querySelector("[data-nx-layer]")?.getAttribute("data-nx-layer") ??
          ""
      )
    );
}

/** The keyboard actions' live region, where a move is announced. */
export function announcer(page: Page): Locator {
  return page.locator('p.nx-sr-only[role="status"][aria-live="polite"]');
}

/**
 * The canvas's tree as a flat list: `id` at the top level, `parent>id` inside
 * a container.
 *
 * Read from the DOM the canvas rendered, in document order, so it is what the
 * author sees rather than what the store claims. Order and nesting are both in
 * it, which is what a keyboard move or a drag changes.
 */
export async function structure(page: Page): Promise<string[]> {
  return (await canvasRoot(page)).evaluate(root =>
    Array.from(root.querySelectorAll("[data-nx-node]"), node => {
      const id = node.getAttribute("data-nx-node") ?? "";
      const parent = node.parentElement
        ?.closest("[data-nx-node]")
        ?.getAttribute("data-nx-node");
      return parent ? `${parent}>${id}` : id;
    })
  );
}

/**
 * Which blocks are selected, primary first.
 *
 * `data-nx-selected` is `"primary"` on the block the inspector shows and empty
 * on every other selected block, so presence is selection and the value says
 * which one leads.
 */
export async function selection(page: Page): Promise<string[]> {
  return (await canvasRoot(page)).evaluate(root => {
    const marked = Array.from(root.querySelectorAll("[data-nx-selected]"));
    const id = (n: Element) => n.getAttribute("data-nx-node") ?? "";
    const primary = marked.filter(
      n => n.getAttribute("data-nx-selected") === "primary"
    );
    const rest = marked.filter(
      n => n.getAttribute("data-nx-selected") !== "primary"
    );
    return [...primary.map(id), ...rest.map(id)];
  });
}

/** A block's box, in main-page coordinates, or a failure naming the block. */
export async function boxOf(
  page: Page,
  id: string
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await (await block(page, id)).boundingBox();
  if (box === null) throw new Error(`[e2e] block ${id} rendered no box`);
  return box;
}

/**
 * Click a block at its right edge, halfway down, with modifiers held if asked.
 *
 * Held through the keyboard rather than a locator click's `modifiers`, so the
 * press is one real pointer gesture at one point, the same in either document.
 * The point is chosen to miss the editor's chrome: the primary block's
 * toolbar floats above it at the LEFT, over the block before, so a press at a
 * block's left or top edge can land on that toolbar and select nothing. The
 * right edge of a full-width block is its own padding, which nothing covers.
 */
export async function clickBlock(
  page: Page,
  id: string,
  modifiers: readonly ("Shift" | "ControlOrMeta")[] = []
): Promise<void> {
  const box = await boxOf(page, id);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
  for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
}

/**
 * A point a given fraction of the way across the first run of text inside an
 * element, in main-page coordinates.
 *
 * Aimed at the glyphs rather than the element: a short text occupies the left
 * of a full-width block, so the element's centre is past its last word and a
 * double-click there lands at the end of the text. Measured inside the
 * element's own document, then, when the canvas is framed, mapped out through
 * the frame's border, padding and scale to a point on the page.
 */
export async function glyphPoint(
  page: Page,
  target: Locator,
  across: number
): Promise<{ x: number; y: number }> {
  const local = await target.evaluate((element, fraction) => {
    const doc = element.ownerDocument;
    const text = doc.evaluate(
      ".//text()[normalize-space()]",
      element,
      null,
      9 /* FIRST_ORDERED_NODE_TYPE */,
      null
    ).singleNodeValue;
    if (text === null) return null;
    const range = doc.createRange();
    range.selectNodeContents(text);
    const box = range.getBoundingClientRect();
    return { x: box.x + box.width * fraction, y: box.y + box.height / 2 };
  }, across);
  if (local === null) throw new Error("[e2e] the element rendered no text");
  const frame = page.locator(CANVAS_FRAME);
  if ((await frame.count()) === 0) return local;
  const content = await frame.evaluate(element => {
    // Where the frame's CONTENT starts, and how much it is scaled: the border
    // box's corner plus the border and padding, each multiplied by the scale.
    // The same arithmetic as the builder's geometry mapping
    // (`frameContentOrigin`, `pointToHost`), restated because this suite
    // imports no product code.
    const iframe = element as HTMLIFrameElement;
    const box = iframe.getBoundingClientRect();
    const style = iframe.ownerDocument.defaultView?.getComputedStyle(iframe);
    const scale = iframe.offsetWidth > 0 ? box.width / iframe.offsetWidth : 1;
    const padLeft = parseFloat(style?.paddingLeft ?? "0") || 0;
    const padTop = parseFloat(style?.paddingTop ?? "0") || 0;
    return {
      x: box.left + (iframe.clientLeft + padLeft) * scale,
      y: box.top + (iframe.clientTop + padTop) * scale,
      scale,
    };
  });
  return {
    x: content.x + local.x * content.scale,
    y: content.y + local.y * content.scale,
  };
}

/**
 * A block's inline field: the element carrying `data-nx-prop`, which is the
 * block's own element for a block that is one field, or one inside it.
 */
export async function field(
  page: Page,
  id: string,
  prop: string
): Promise<Locator> {
  return (await block(page, id))
    .locator(`xpath=descendant-or-self::*[@data-nx-prop="${prop}"]`)
    .first();
}

/**
 * The text the inline editor ITSELF holds selected in a field being edited,
 * or "" when it holds none.
 *
 * Not the browser's selection. The editor copies the DOM selection into its
 * own state on `selectionchange`, which the browser dispatches after the keys
 * that moved it, and a keyboard shortcut acts on the editor's copy, which is
 * not refreshed from the DOM for a key press. A format pressed after the DOM
 * shows the word selected, but before the editor has caught up, formats the
 * caret it last saw, and nothing in the document changes. Waiting on this is
 * waiting on the selection the shortcut will actually use.
 *
 * Read through the editor Lexical attaches to its root element. That is an
 * internal of the library, and the only place this state is visible: nothing
 * on the canvas reflects the editor's selection.
 */
export async function editorSelectionText(field: Locator): Promise<string> {
  return field.evaluate(element => {
    type Lexical = {
      getEditorState(): {
        _selection: { getTextContent(): string } | null;
        read<T>(read: () => T): T;
      };
    };
    const editor = (element as Element & { __lexicalEditor?: Lexical })
      .__lexicalEditor;
    if (editor === undefined) return "";
    const state = editor.getEditorState();
    return state.read(() => state._selection?.getTextContent() ?? "");
  });
}

/**
 * Clear the selection by pressing empty canvas below the last block.
 *
 * The editor restores the author's last selection when the page opens again,
 * so a test cannot assume it starts with nothing selected. Cleared with a
 * press on the background rather than Escape, so a broken Escape fails the
 * test about Escape and not every test's setup.
 */
export async function clearSelection(page: Page): Promise<void> {
  const root = await (await canvasRoot(page)).boundingBox();
  if (root === null) throw new Error("[e2e] the canvas has no box");
  await page.mouse.click(root.x + 12, root.y + root.height - 12);
  await expect.poll(() => selection(page)).toEqual([]);
}

/**
 * Seed the single the builder edits, open the builder, and wait for the first
 * block to render.
 *
 * Seeded through the admin API rather than built through the UI: what is
 * under test is editing an existing page, and a fixture assembled by the
 * features under test would fail for the wrong reason.
 */
export async function openEditorWith(
  page: Page,
  nodes: readonly unknown[],
  firstId: string
): Promise<void> {
  const stored = await page.request.patch(HOMEPAGE, {
    data: { layout: { formatVersion: 1, kind: "page", nodes } },
  });
  expect(stored.ok(), `seeding the homepage layout: ${stored.status()}`).toBe(
    true
  );
  await gotoAdmin(page, "/singles/homepage");
  await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
  // The block must be ON SCREEN before anything is aimed at it: a gesture sent
  // at an element that has not rendered lands on the page behind it.
  await expect(await block(page, firstId)).toBeVisible({ timeout: 30_000 });
}
