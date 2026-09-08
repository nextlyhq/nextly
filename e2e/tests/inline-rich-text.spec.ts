/**
 * Editing a passage on the canvas, in a real browser.
 *
 * Two behaviours of inline rich text cannot be observed anywhere else. jsdom
 * does not reflect the editor's selection back into the DOM — `rangeCount`
 * stays 0 after a focus — so a unit test can assert that a caret offset was
 * HANDED to the editor and never where the caret went. And a list's Enter
 * gesture runs through command handlers that need a real key event to reach.
 *
 * Both were repaired on evidence read out of Lexical's source rather than
 * measured, which is exactly the kind of claim that deserves a browser.
 *
 * The route is the real admin builder rather than a playground harness: the
 * harnesses mount `<Canvas>` directly and never supply the editor loader, so
 * nothing there would load Lexical at all and both tests would pass against a
 * feature that does nothing.
 *
 * @module tests/inline-rich-text
 */
import { expect, test, type Page } from "@playwright/test";

import { STORAGE_STATE } from "../global-setup";
import { gotoAdmin } from "./support/admin";

/*
 * The control that opens the page builder, in EITHER state.
 *
 * The card names itself for the document it is showing — an empty page invites
 * you to build it, a populated one to open the builder — so a helper naming one
 * wording breaks whenever the fixture gains or loses blocks, and breaks with a
 * timeout that names the editor rather than the button. Kept as a literal
 * because this suite is deliberately black box and imports no product code;
 * the source of both strings is `PageBuilderCard`.
 */
const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;

const HOMEPAGE = "/admin/api/singles/homepage";

/** The element the renderer marks as carrying the passage. */
const PASSAGE = '[data-nx-prop="content"]';

const SENTENCE = "Hello world";

function textNode(text: string) {
  return {
    type: "text",
    text,
    format: 0,
    style: "",
    mode: "normal",
    detail: 0,
    version: 1,
  };
}

/**
 * A heading node, for the caret case a paragraph cannot cover.
 *
 * A paragraph's box barely moves when the library's typographic baseline is
 * applied — line height and margins only. A heading's moves the most of
 * anything on the page: `h1` carries a `2.25em` size, a `1.15` line height and
 * a `1.5em` top margin, so its glyph boxes sit somewhere a paragraph's never
 * do. The caret is derived from the POINTER against those boxes, so a fixture
 * whose layout cannot change is a fixture that cannot see this fail.
 */
function heading(text: string) {
  return {
    type: "heading",
    tag: "h1",
    format: "",
    indent: 0,
    version: 1,
    direction: null,
    children: [textNode(text)],
  };
}

function paragraph(text: string) {
  return {
    type: "paragraph",
    format: "",
    indent: 0,
    version: 1,
    direction: null,
    children: [textNode(text)],
  };
}

/** A document holding one `core/rich-text` block. */
function documentWith(children: unknown[]) {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "passage",
        type: "core/rich-text",
        version: 1,
        props: {
          content: {
            root: {
              type: "root",
              format: "",
              indent: 0,
              version: 1,
              direction: null,
              children,
            },
          },
        },
      },
    ],
  };
}

/** Seed the single the builder opens, then open it. */
async function openBuilderWith(page: Page, children: unknown[]): Promise<void> {
  const api = await page.request;
  const stored = await api.patch(HOMEPAGE, {
    data: { layout: documentWith(children) },
  });
  expect(stored.ok(), `seeding the homepage layout: ${stored.status()}`).toBe(
    true
  );

  await gotoAdmin(page, "/singles/homepage");
  await page.getByRole("button", { name: OPEN_BUILDER_ACTION }).click();
  // The passage must be ON SCREEN before anything is aimed at it: a gesture
  // sent at an element that has not rendered lands on the page behind it.
  await expect(page.locator(PASSAGE).first()).toBeVisible({ timeout: 30_000 });
}

/**
 * A point a given fraction of the way across the rendered GLYPHS.
 *
 * Aimed at the text node's own box rather than the block's. The passage's
 * element is full canvas width and a short sentence occupies the left of it, so
 * the element's centre is PAST the end of the words — a double-click there
 * resolves to the end of the text and every assertion about caret position
 * passes or fails for the wrong reason. Measured: aiming at the wrapper gave a
 * caret offset of 11 on an eleven-character sentence.
 *
 * The same trap `text-selection.spec.ts` records from the other direction: a
 * gesture aimed at a block corner is only sometimes over text.
 */
async function glyphPoint(
  page: Page,
  across: number
): Promise<{ x: number; y: number }> {
  const point = await page
    .locator(PASSAGE)
    .first()
    .evaluate((element, fraction) => {
      const text = element.ownerDocument.evaluate(
        ".//text()[normalize-space()]",
        element,
        null,
        9 /* FIRST_ORDERED_NODE_TYPE */,
        null
      ).singleNodeValue;
      if (text === null) return null;
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(text);
      const box = range.getBoundingClientRect();
      return { x: box.x + box.width * fraction, y: box.y + box.height / 2 };
    }, across);
  if (point === null) throw new Error("[e2e] the passage rendered no text");
  return point;
}

/**
 * Enter the passage by double-clicking its text, and wait until it is editable.
 *
 * The wait is the whole point of doing this in a browser: the editor arrives on
 * a lazily loaded chunk, and `contenteditable` appearing is the first moment
 * anything can be typed. Typing before it would go to the document and assert
 * nothing about this feature.
 */
async function enterPassage(page: Page, across: number): Promise<void> {
  const point = await glyphPoint(page, across);
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.locator(`${PASSAGE}[contenteditable="true"]`)).toBeVisible({
    timeout: 30_000,
  });
}

test.describe.configure({ mode: "serial" });

test.use({ storageState: STORAGE_STATE });

test.describe("a passage edited on the canvas", () => {
  test("types where the author clicked, not at the end", async ({ page }) => {
    /*
     * `focus()` puts the caret at the END of a passage when the loaded state
     * carries no selection, and a freshly parsed state never carries one. So
     * before the fix every edit began at the end regardless of the pointer, and
     * a double-click in the middle followed by typing appended.
     *
     * The caret comes from the POINTER's position, not from the document's
     * selection: a press on a block is a grab rather than a highlight, so the
     * canvas suppresses the browser's own selection and there is none to read.
     * Measured here before this was understood — `rangeCount` was 0 at the
     * moment of the double-click, so the offset was always absent and every
     * edit began at the end.
     */
    await openBuilderWith(page, [paragraph(SENTENCE)]);
    // Just past the middle of "Hello world", which is inside "world".
    await enterPassage(page, 0.55);

    await page.keyboard.type("X");

    const passage = page.locator(PASSAGE).first();
    // The whole string, at the OFFSET the click implies, rather than "contains
    // X" and "does not end with X" — that pair rules out an append and an
    // editor that typed nothing, and is satisfied by every other insertion
    // point, which is the thing this case is actually about. `0.55` across
    // "Hello world" is the boundary before `world`, so the caret belongs at
    // index 6.
    await expect(passage).toHaveText("Hello Xworld");
  });

  test("types where the author clicked inside a HEADING", async ({ page }) => {
    /*
     * The same property as the paragraph case above, on the block whose layout
     * this library actually moves. A heading is styled by the typographic
     * baseline — size, line height, weight and a top margin — so its text sits
     * at coordinates a paragraph's never occupies, and the inline editor
     * applies its own theme at edit-start. If those two typographies diverge,
     * the caret is measured against a layout the author never saw and lands on
     * an unrelated character.
     *
     * A paragraph cannot stand in for this: its box barely moves, so it agrees
     * with the defect it would be meant to catch.
     */
    await openBuilderWith(page, [heading(SENTENCE)]);

    // The fixture REACHED the mechanism, asserted before the property. A
    // `heading` node the block does not render as a heading would leave this
    // case a second paragraph test wearing a heading's name — passing, and
    // covering nothing the case above does not already cover.
    const rendered = page.locator(`${PASSAGE} h1`).first();
    await expect(rendered).toBeVisible();
    const size = await rendered.evaluate(
      element => getComputedStyle(element).fontSize
    );
    // The baseline's own `2.25em` against an unstyled 16px ancestor, so 36px.
    // Not merely "larger than a paragraph": that is satisfied by any styling at
    // all, including a host's, and this has to be THIS library's value or the
    // test is not exercising the change. The unit matters to the number — `em`
    // multiplies whatever this heading inherits, which is what lets an author's
    // page or block typography reach it, so a size set anywhere above the
    // canvas would move this figure rather than break the mechanism.
    expect(size).toBe("36px");

    await enterPassage(page, 0.55);

    await page.keyboard.type("X");

    const passage = page.locator(PASSAGE).first();
    // The whole string, at the OFFSET the click implies. `contains "X"` plus
    // `does not contain "worldX"` is satisfied by every insertion except the
    // final one — `XHello world` and `Hello Xworld` both pass it — so it rules
    // out an append and says nothing about the failure this case is named for,
    // where a caret measured against the wrong layout lands on an unrelated
    // character.
    //
    // `0.55` across "Hello world" is the boundary before `world`, so the caret
    // belongs at index 6 and the passage reads `Hello Xworld`. Measured, not
    // assumed: a double-click SELECTS the word, and the editor collapses that
    // selection to the pointer rather than replacing it.
    await expect(passage).toHaveText("Hello Xworld");
  });

  test("leaves a list when Enter is pressed on an empty item", async ({
    page,
  }) => {
    /*
     * The generic rich-text handler makes Enter on an empty list item insert
     * ANOTHER empty item, so an author cannot leave a list by the gesture every
     * editor uses. Exiting lives in the list behaviour, which the field editor
     * mounts as a plugin and this editor registers imperatively.
     *
     * Two Enters from the end of the only item: the first opens a new empty
     * item, the second should end the list. Counting items is what separates
     * the two outcomes — with the behaviour registered the empty item is
     * consumed, without it there are three.
     */
    await openBuilderWith(page, [
      {
        type: "list",
        listType: "bullet",
        tag: "ul",
        start: 1,
        format: "",
        indent: 0,
        version: 1,
        direction: null,
        children: [
          {
            type: "listitem",
            value: 1,
            format: "",
            indent: 0,
            version: 1,
            direction: null,
            children: [textNode("Item")],
          },
        ],
      },
    ]);
    await enterPassage(page, 0.5);

    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    const items = page.locator(`${PASSAGE} li`);
    // The control on the fixture itself: if the list never rendered as a list,
    // this count would be 0 and the assertion below would pass for the wrong
    // reason.
    await expect(items).not.toHaveCount(0);
    await expect(items).toHaveCount(1);
  });
});
