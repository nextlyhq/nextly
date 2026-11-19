/**
 * A text block's runs through the editor and back: what is stored is what the
 * editor shows, and what it shows is stored again unchanged, marks, links,
 * chips and line breaks included.
 */
import { createEditor, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";

import { $readRuns, $setRuns, RUN_NODES, type Inline } from "../runs";

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
