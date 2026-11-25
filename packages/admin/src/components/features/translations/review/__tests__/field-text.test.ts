/**
 * A stored value as the text a review compares. A broken reading would mark
 * unchanged text as changed, or show the editor's own data in place of words.
 */
import { describe, expect, it } from "vitest";

import { fieldText } from "../field-text";

const paragraph = (text: string) => ({
  type: "paragraph",
  version: 1,
  children: [{ type: "text", version: 1, text }],
});
const DOCUMENT = {
  root: {
    type: "root",
    version: 1,
    children: [paragraph("First line"), paragraph("Second line")],
  },
};

describe("fieldText", () => {
  it.each([null, undefined, ""])("reads nothing from %o", value => {
    expect(fieldText(value)).toBe("");
  });

  it("keeps a text as it is", () => {
    expect(fieldText("  Two\nlines ")).toBe("  Two\nlines ");
  });

  it("reads a rich text one line per block, however it is stored", () => {
    expect(fieldText(DOCUMENT)).toBe("First line\nSecond line");
    expect(fieldText(JSON.stringify(DOCUMENT))).toBe("First line\nSecond line");
  });

  it.each(["{ not json", '{"a":1}', "{}"])(
    "keeps a text that only looks like a document: %s",
    value => {
      expect(fieldText(value)).toBe(value);
    }
  );

  it.each([
    [7, "7"],
    [false, "false"],
  ])("reads %o as %s", (value, words) => {
    expect(fieldText(value)).toBe(words);
  });

  it("shows any other structure as it is stored, the same each time", () => {
    expect(fieldText({ a: [1] })).toBe(fieldText({ a: [1] }));
    expect(fieldText({ a: [1] })).not.toBe(fieldText({ a: [2] }));
  });
});
