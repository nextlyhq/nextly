/**
 * The editor's acceptance suite: selecting, keyboard moves, dragging and
 * editing text in place, in the real page builder.
 *
 * The canvas harness (`acceptance.spec.ts`) proves the drag engine on its own.
 * It mounts no keyboard actions, no Layers panel and no inline-editing loader,
 * so none of what an author does beyond dragging can be seen there. This suite
 * opens the builder the way an author does, from the homepage single, and
 * drives it with real pointer and keyboard input.
 *
 * It is written to survive the canvas moving into a frame: every block is
 * reached through `editor-driver.ts`, which finds the canvas wherever it
 * renders. The same tests, unchanged, then say whether the move kept the
 * editor working.
 *
 * Properties and their status live in `editor-manifest.ts`. Each covered one
 * has a scenario in `SCENARIOS`, registered as a test titled by
 * `editorTitleFor`; the first test checks the two agree.
 *
 * @module tests/canvas/editor-acceptance
 */

import { expect, test, type Page } from "@playwright/test";

import { STORAGE_STATE } from "../../global-setup";

import {
  announcer,
  boxOf,
  clearSelection,
  clickBlock,
  field as fieldOf,
  glyphPoint,
  canvasScope,
  layerRow,
  openEditorWith,
  openLayers,
  selectedLayers,
  selection,
  structure,
} from "./editor-driver";
import {
  EDITOR_COVERED,
  EDITOR_DEFERRED,
  EDITOR_PROPERTIES,
  editorTitleFor,
} from "./editor-manifest";

function text(id: string, words: string) {
  return { id, type: "core/text", version: 1, props: { text: words } };
}

function passage(words: string) {
  return {
    root: {
      type: "root",
      format: "",
      indent: 0,
      version: 1,
      direction: null,
      children: [
        {
          type: "paragraph",
          format: "",
          indent: 0,
          version: 1,
          direction: null,
          children: [
            {
              type: "text",
              text: words,
              format: 0,
              style: "",
              mode: "normal",
              detail: 0,
              version: 1,
            },
          ],
        },
      ],
    },
  };
}

const HEADING = "Acceptance heading";
const PASSAGE = "Rich passage words";

/**
 * Six top-level blocks and one nested, chosen for what each test needs: a
 * single-line field (the heading), a multi-line one (each text block), a
 * container with a block above and below it (for moving in and out), and a
 * rich-text passage.
 */
const NODES = [
  {
    id: "ea-heading",
    type: "core/heading",
    version: 1,
    props: { text: HEADING, level: "h2" },
  },
  text("ea-first", "First paragraph"),
  text("ea-second", "Second paragraph"),
  {
    id: "ea-section",
    type: "core/section",
    version: 1,
    props: { as: "section", contained: true },
    slots: { children: [text("ea-inner", "Inside the section")] },
  },
  text("ea-third", "Third paragraph"),
  {
    id: "ea-passage",
    type: "core/rich-text",
    version: 1,
    props: { content: passage(PASSAGE) },
  },
];

const SEEDED = [
  "ea-heading",
  "ea-first",
  "ea-second",
  "ea-section",
  "ea-section>ea-inner",
  "ea-third",
  "ea-passage",
];

/** The word-wise caret modifier: Alt on macOS, Control elsewhere. */
const WORD = process.platform === "darwin" ? "Alt" : "Control";

/** Double-click a field's words and wait until it is being edited. */
async function editField(
  page: Page,
  id: string,
  prop: string,
  across = 0.5
): Promise<void> {
  const field = await fieldOf(page, id, prop);
  const point = await glyphPoint(page, field, across);
  await page.mouse.dblclick(point.x, point.y);
  // `contenteditable` appearing is the first moment anything can be typed:
  // rich text arrives on a lazily loaded chunk, and typing before it would go
  // to the page and assert nothing about this feature.
  await expect(field).toHaveAttribute(
    "contenteditable",
    /^(true|plaintext-only)$/,
    {
      timeout: 30_000,
    }
  );
}

// Not `serial`: every test reseeds the page it edits, so none depends on one
// before it, and a failure should not hide the verdicts after it. The shared
// homepage single is safe because the config runs one worker everywhere.

test.use({ storageState: STORAGE_STATE });

/**
 * What each covered property does, by its number.
 *
 * The tests are REGISTERED from the manifest through this map rather than
 * written one by one, so a covered property cannot lose its test to a rename,
 * a comment or a string that only looks like one: the manifest check compares
 * this map's keys with the covered set, and the loop below registers exactly
 * one test per covered property.
 */
const SCENARIOS: Readonly<Record<number, (page: Page) => Promise<void>>> = {
  1: async page => {
    await openLayers(page);
    expect(await selection(page)).not.toContain("ea-second");
    await clickBlock(page, "ea-second");
    expect(await selection(page)).toEqual(["ea-second"]);
    // The same SET on both surfaces: a stale row left marked in Layers would
    // pass a check of only the rows it names.
    await expect.poll(() => selectedLayers(page)).toEqual(["ea-second"]);
    await expect(layerRow(page, "ea-second")).toHaveAttribute(
      "aria-selected",
      "true"
    );
  },
  2: async page => {
    await clickBlock(page, "ea-first");
    await clickBlock(page, "ea-third", ["Shift"]);
    // The whole run from the anchor, anchor first: a plain click would leave
    // the third block alone, and a toggle would add it to the first and skip
    // what lies between. Nested blocks are not listed, since their container
    // is selected.
    expect(await selection(page)).toEqual([
      "ea-first",
      "ea-second",
      "ea-section",
      "ea-third",
    ]);

    // Mod-click takes ONE block out and leaves the rest of the run as it was:
    // the whole set is compared, so a toggle that also loses part of the run
    // fails. The first block left becomes primary, the leader having gone.
    await clickBlock(page, "ea-first", ["ControlOrMeta"]);
    expect(await selection(page)).toEqual([
      "ea-second",
      "ea-section",
      "ea-third",
    ]);

    // And puts it back as the leader, the block the author just pointed at.
    await clickBlock(page, "ea-first", ["ControlOrMeta"]);
    expect(await selection(page)).toEqual([
      "ea-first",
      "ea-second",
      "ea-section",
      "ea-third",
    ]);
  },
  3: async page => {
    await clickBlock(page, "ea-first");
    expect(await selection(page)).toEqual(["ea-first"]);
    await page.keyboard.press("Escape");
    expect(await selection(page)).toEqual([]);
    // Cleared, not removed: a handler that deleted the block would empty the
    // selection the same way.
    expect(await structure(page)).toEqual(SEEDED);
  },
  4: async page => {
    await openLayers(page);
    await layerRow(page, "ea-third").click();
    expect(await selection(page)).toEqual(["ea-third"]);
    await layerRow(page, "ea-heading").click();
    expect(await selection(page)).toEqual(["ea-heading"]);
  },
  5: async page => {
    await clickBlock(page, "ea-second");
    await page.keyboard.press("Alt+ArrowUp");
    await expect
      .poll(() => structure(page))
      .toEqual(["ea-heading", "ea-second", "ea-first", ...SEEDED.slice(3)]);
    await expect(announcer(page)).toHaveText("Block moved");
    // Still selected, so a run of presses keeps moving the same block.
    expect(await selection(page)).toEqual(["ea-second"]);

    // The down move announces too, and FRESHLY: its words are the same as the
    // up move's, so the region alternates a zero-width space to make the text
    // change. Unchanged text would be the up move's announcement still sitting
    // there.
    const afterUp = await announcer(page).evaluate(n => n.textContent ?? "");
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(() => structure(page)).toEqual(SEEDED);
    await expect
      .poll(() => announcer(page).evaluate(n => n.textContent ?? ""))
      .not.toBe(afterUp);
    await expect(announcer(page)).toHaveText("Block moved");
  },
  6: async page => {
    await clickBlock(page, "ea-third");
    await page.keyboard.press("Alt+ArrowRight");
    await expect
      .poll(() => structure(page))
      .toEqual([
        "ea-heading",
        "ea-first",
        "ea-second",
        "ea-section",
        "ea-section>ea-inner",
        "ea-section>ea-third",
        "ea-passage",
      ]);
    await expect(announcer(page)).toHaveText(
      "Block moved into the container above it"
    );

    await page.keyboard.press("Alt+ArrowLeft");
    await expect.poll(() => structure(page)).toEqual(SEEDED);
    await expect(announcer(page)).toHaveText(
      "Block moved out of its container"
    );
  },
  7: async page => {
    await clickBlock(page, "ea-second");
    await page.keyboard.press("Alt+ArrowUp");
    await expect.poll(() => structure(page)).not.toEqual(SEEDED);
    // ONE undo restores the tree: a move recorded as several entries would
    // leave it half-done here.
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => structure(page)).toEqual(SEEDED);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(() => structure(page))
      .toEqual(["ea-heading", "ea-second", "ea-first", ...SEEDED.slice(3)]);
  },
  8: async page => {
    const from = await boxOf(page, "ea-third");
    const onto = await boxOf(page, "ea-heading");
    await page.mouse.move(from.x + 6, from.y + from.height / 2);
    await page.mouse.down();
    // Past the drag threshold first, so the press is read as a drag.
    await page.mouse.move(from.x + 6, from.y + from.height / 2 + 14, {
      steps: 4,
    });
    // Over the lower part of the heading, "after it", which is the gap before
    // the first paragraph. Aimed well inside the heading rather than at the
    // paragraph's top edge, where the target-switch hysteresis would keep the
    // last gap the pointer passed.
    await page.mouse.move(onto.x + 40, onto.y + onto.height * 0.8, {
      steps: 20,
    });
    await page.mouse.up();
    await expect
      .poll(() => structure(page))
      .toEqual([
        "ea-heading",
        "ea-third",
        "ea-first",
        "ea-second",
        "ea-section",
        "ea-section>ea-inner",
        "ea-passage",
      ]);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => structure(page)).toEqual(SEEDED);
  },
  9: async page => {
    const field = await fieldOf(page, "ea-heading", "text");
    await editField(page, "ea-heading", "text");
    await expect(field).toHaveAttribute("data-nx-editing", "text");
    // Entering selects the whole field, so typing replaces it.
    await page.keyboard.type("Renamed heading");
    await page.keyboard.press("Enter");
    await expect(field).not.toHaveAttribute("contenteditable", /.+/);
    // Exactly the words, read raw and from the stored value: the text matchers
    // fold whitespace, so a commit that kept the Enter as a line break would
    // pass them.
    await expect(page.getByLabel("Text", { exact: true })).toHaveValue(
      "Renamed heading"
    );
    expect(await field.evaluate(element => element.textContent)).toBe(
      "Renamed heading"
    );
    // Through the store, not left in the DOM: undo brings the old words back.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(field).toHaveText(HEADING);
  },
  10: async page => {
    const field = await fieldOf(page, "ea-heading", "text");
    await editField(page, "ea-heading", "text");
    await page.keyboard.type("Discard me");
    await expect(field).toHaveText("Discard me");
    await page.keyboard.press("Escape");
    await expect(field).not.toHaveAttribute("contenteditable", /.+/);
    await expect(field).toHaveText(HEADING);
    // Cancelling wrote nothing: an undo now has nothing of this edit to bring
    // back, where a cancel that wrote the words and then wrote the old ones
    // over them would surface "Discard me" here.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(field).toHaveText(HEADING);
  },
  11: async page => {
    const field = await fieldOf(page, "ea-first", "text");
    await editField(page, "ea-first", "text");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Line two");
    // Enter belonged to the value: the field is still being edited.
    await expect(field).toHaveAttribute("data-nx-editing", "text");
    // Pressing the inspector's field moves focus out of the canvas, which
    // commits, and keeps this block selected so the inspector shows its value.
    const stored = page.getByLabel("Text", { exact: true });
    await stored.click();
    await expect(field).not.toHaveAttribute("contenteditable", /.+/);
    // The STORED value, line break included: text that only looks right on the
    // canvas — a swallowed Enter, or words left in an element nobody wrote back
    // — does not get here.
    await expect(stored).toHaveValue("First paragraph\nLine two");
    // And it was one write: a single undo, pressed on the canvas rather than
    // in the inspector's own field, restores the words as they were.
    await clickBlock(page, "ea-third");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(field).toHaveText("First paragraph");
  },
  12: async page => {
    const field = await fieldOf(page, "ea-passage", "content");
    await editField(page, "ea-passage", "content");
    await page.keyboard.press("End");
    await page.keyboard.type(" bold");
    await page.keyboard.press(`Shift+${WORD}+ArrowLeft`);
    // The editor applies a selection asynchronously, so each step waits for
    // the previous one to land: a format pressed before the word is selected
    // formats nothing, and the passage commits plain. Read from the passage's
    // own window, which is the canvas frame's once there is one.
    await expect
      .poll(() =>
        field.evaluate(
          element =>
            element.ownerDocument.defaultView?.getSelection()?.toString() ?? ""
        )
      )
      .toBe("bold");
    await page.keyboard.press("ControlOrMeta+b");
    await expect(field.locator("strong")).toHaveText("bold");
    await clickBlock(page, "ea-heading");
    await expect(field).not.toHaveAttribute("contenteditable", /.+/);
    // Rendered back from the stored value, so the bold run is in the document.
    await expect(field.locator("strong")).toHaveText("bold");
    await expect(field).toContainText(PASSAGE);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(field.locator("strong")).toHaveCount(0);
    await expect(field).toHaveText(PASSAGE);
  },
  13: async page => {
    const field = await fieldOf(page, "ea-passage", "content");
    const before = await field.innerHTML();
    await editField(page, "ea-passage", "content");
    await page.keyboard.type("zzz");
    await expect(field).toContainText("zzz");
    await page.keyboard.press("Escape");
    await expect(field).not.toHaveAttribute("contenteditable", /.+/);
    await expect(field).not.toContainText("zzz");
    expect(await field.innerHTML()).toBe(before);
    // And left no history behind, as for plain text.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(field).not.toContainText("zzz");
    expect(await field.innerHTML()).toBe(before);
  },
};

test.describe("the editor acceptance suite", () => {
  test("the suite covers what its manifest claims", () => {
    // Every covered property has a scenario and every scenario a covered
    // property, compared as sets of numbers: a scenario commented out, or one
    // left behind after its property was deferred, turns this red.
    const byNumber = (a: number, b: number) => a - b;
    expect(Object.keys(SCENARIOS).map(Number).sort(byNumber)).toEqual(
      EDITOR_COVERED.map(p => p.n).sort(byNumber)
    );
    expect(EDITOR_COVERED.length + EDITOR_DEFERRED.length).toBe(
      EDITOR_PROPERTIES.length
    );
    expect(new Set(EDITOR_PROPERTIES.map(p => p.n)).size).toBe(
      EDITOR_PROPERTIES.length
    );
  });

  test("the driver aims through a bordered, padded and scaled canvas frame", async ({
    page,
  }) => {
    // The canvas is meant to render in a frame, and every inline edit is aimed
    // through `glyphPoint`. This builds such a frame directly, with a border,
    // padding, an offset and a scale, and checks a press at the point it
    // returns lands on the words inside, at the place it was aimed.
    await page.setContent(`
      <iframe title="Page canvas: driver check"
        style="position:absolute;left:30px;top:40px;width:800px;height:600px;
               border:7px solid;padding:5px;transform:scale(0.5);transform-origin:0 0"
        srcdoc="<div class='nx-canvas'><p data-nx-prop='text'
          style='margin:120px 0 0 200px;font:20px sans-serif'>Glyphs to aim at</p></div>">
      </iframe>`);
    const target = (await canvasScope(page)).locator('[data-nx-prop="text"]');
    await expect(target).toHaveText("Glyphs to aim at");
    const aimedAt = await target.evaluate(element => {
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(element.firstChild as Node);
      const box = range.getBoundingClientRect();
      element.ownerDocument.addEventListener("click", event => {
        Object.assign(element.ownerDocument.defaultView ?? {}, {
          hit: {
            onTarget: event.target === element,
            x: event.clientX,
            y: event.clientY,
          },
        });
      });
      return { x: box.x + box.width * 0.5, y: box.y + box.height / 2 };
    });
    const point = await glyphPoint(page, target, 0.5);
    await page.mouse.click(point.x, point.y);
    const hit = await target.evaluate(
      element =>
        (
          element.ownerDocument.defaultView as unknown as {
            hit?: { onTarget: boolean; x: number; y: number };
          }
        ).hit
    );
    expect(hit?.onTarget).toBe(true);
    // Within a page pixel, which is two frame pixels at this scale.
    expect(Math.abs((hit?.x ?? 0) - aimedAt.x)).toBeLessThanOrEqual(2);
    expect(Math.abs((hit?.y ?? 0) - aimedAt.y)).toBeLessThanOrEqual(2);
  });

  test("the deferred properties are reported, not hidden", async () => {
    for (const p of EDITOR_DEFERRED) {
      expect(p.reason, `E${p.n} defers without a reason`).toBeTruthy();
      // eslint-disable-next-line no-console -- the deferred set is reported on purpose
      console.log(`DEFERRED E${p.n}: ${p.property} — ${p.reason}`);
    }
  });
});

test.describe("the editor, driven as an author drives it", () => {
  test.beforeEach(async ({ page }) => {
    await openEditorWith(page, NODES, "ea-heading");
    // The fixture as seeded, so every test starts from a known tree and a
    // failure to seed reads as that rather than as the property under test.
    expect(await structure(page)).toEqual(SEEDED);
    await clearSelection(page);
  });

  for (const property of EDITOR_COVERED) {
    test(editorTitleFor(property), async ({ page }) => {
      const scenario = SCENARIOS[property.n];
      if (scenario === undefined) {
        throw new Error(`E${property.n} is covered and has no scenario`);
      }
      await scenario(page);
    });
  }
});
