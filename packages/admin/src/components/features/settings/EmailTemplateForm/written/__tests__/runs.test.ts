/**
 * A text block's runs through the editor and back: what is stored is what the
 * editor shows, and what it shows is stored again unchanged, marks, links,
 * chips and line breaks included.
 */
import {
  $createRangeSelection,
  $getRoot,
  $setSelection,
  createEditor,
  type LexicalEditor,
} from "lexical";
import { describe, expect, it } from "vitest";

import {
  $readRuns,
  $selectedLink,
  $setRuns,
  $setSelectionLink,
  RUN_NODES,
  type Inline,
  type WrittenLink,
} from "../runs";

function editor(): LexicalEditor {
  return createEditor({
    nodes: [...RUN_NODES],
    onError: error => {
      throw error;
    },
  });
}

function roundTrip(runs: readonly Inline[]): Inline[] {
  const e = editor();
  e.update(() => $setRuns(runs), { discrete: true });
  let out: Inline[] = [];
  e.getEditorState().read(() => {
    out = $readRuns();
  });
  return out;
}

describe("a text block's runs in the editor", () => {
  it("come back as they were stored: marks, chips and links", () => {
    const runs: Inline[] = [
      { type: "text", text: "Hi " },
      { type: "chip", variable: "name", fallback: "there" },
      { type: "text", text: ", " },
      { type: "text", text: "paid", bold: true },
      { type: "text", text: " and " },
      { type: "text", text: "thanked", italic: true },
      { type: "text", text: " " },
      {
        type: "text",
        text: "track it",
        link: { url: "https://shop.example/o/1" },
      },
      { type: "text", text: " or " },
      {
        type: "text",
        text: "see it",
        link: { chip: { variable: "orderUrl" } },
      },
    ];
    expect(roundTrip(runs)).toEqual(runs);
  });

  it("keep a line break inside the text", () => {
    const runs: Inline[] = [{ type: "text", text: "Line one\nLine two" }];
    expect(roundTrip(runs)).toEqual(runs);
  });

  it("join neighbouring runs with the same marks into one", () => {
    expect(
      roundTrip([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ])
    ).toEqual([{ type: "text", text: "ab" }]);
  });

  it("are empty for an empty block", () => {
    expect(roundTrip([])).toEqual([]);
  });
});

/**
 * Stores `runs`, selects from `from` in the first text node to `to` in the
 * last, sets the link of that selection and reads the runs back, with the
 * link the selection reported before the change.
 */
function linked(
  runs: readonly Inline[],
  from: number,
  to: number,
  link: WrittenLink | undefined
): { runs: Inline[]; before: WrittenLink | undefined } {
  const e = editor();
  let before: WrittenLink | undefined;
  e.update(
    () => {
      $setRuns(runs);
      const texts = $getRoot().getAllTextNodes();
      const selection = $createRangeSelection();
      selection.anchor.set(texts[0].getKey(), from, "text");
      selection.focus.set(texts[texts.length - 1].getKey(), to, "text");
      $setSelection(selection);
      before = $selectedLink();
      $setSelectionLink(link);
    },
    { discrete: true }
  );
  let out: Inline[] = [];
  e.getEditorState().read(() => {
    out = $readRuns();
  });
  return { runs: out, before };
}

describe("a link on the selected text", () => {
  const shop = { url: "https://shop.example" };

  it("links only what is selected", () => {
    expect(
      linked([{ type: "text", text: "Hello world" }], 6, 11, shop).runs
    ).toEqual([
      { type: "text", text: "Hello " },
      { type: "text", text: "world", link: shop },
    ]);
  });

  it("links a chip inside the selection, to a variable's address too", () => {
    const orderUrl = { chip: { variable: "orderUrl" } };
    expect(
      linked(
        [
          { type: "text", text: "See " },
          { type: "chip", variable: "order" },
          { type: "text", text: " now" },
        ],
        0,
        4,
        orderUrl
      ).runs
    ).toEqual([
      { type: "text", text: "See ", link: orderUrl },
      { type: "chip", variable: "order", link: orderUrl },
      { type: "text", text: " now", link: orderUrl },
    ]);
  });

  it("unlinks the selection and leaves the rest of the link as it was", () => {
    const result = linked(
      [{ type: "text", text: "Hello world", link: shop }],
      0,
      5,
      undefined
    );
    expect(result.before).toEqual(shop);
    expect(result.runs).toEqual([
      { type: "text", text: "Hello" },
      { type: "text", text: " world", link: shop },
    ]);
  });

  it("changes the selected part of a link to another address", () => {
    const other = { url: "https://other.example" };
    expect(
      linked([{ type: "text", text: "Hello world", link: shop }], 6, 11, other)
        .runs
    ).toEqual([
      { type: "text", text: "Hello ", link: shop },
      { type: "text", text: "world", link: other },
    ]);
  });
});
