/**
 * The anchors a passage's headings are drawn with: the ids `core/rich-text`
 * puts on its headings and `core/table-of-contents` links to.
 *
 * The expected ids are the ones the blog template's hand-written post page
 * gives the same headings, so a post rebuilt with the builder keeps the
 * addresses its readers have shared: lower-cased words, punctuation dropped,
 * spaces as hyphens, repeats numbered from 2.
 */
import type { RichTextNode, RichTextValue } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { anchorIds, headingAnchors, headingRank } from "./heading-anchors";

const words = (text: string, format = 0): RichTextNode => ({
  type: "text",
  text,
  format,
});

const heading = (tag: string, ...children: RichTextNode[]): RichTextNode => ({
  type: "heading",
  tag,
  children,
});

const paragraph = (text: string): RichTextNode => ({
  type: "paragraph",
  children: [words(text)],
});

const passage = (...children: RichTextNode[]): RichTextValue => ({
  root: { type: "root", children },
});

const ids = (value: unknown) => headingAnchors(value).map(anchor => anchor.id);

describe("a heading's anchor", () => {
  it("is its words, lower-cased, with punctuation dropped and spaces as hyphens", () => {
    expect(
      ids(
        passage(
          heading("h2", words("Getting Started")),
          heading("h2", words("What's new in v2?")),
          heading("h2", words("C++ & Rust: a  comparison")),
          heading("h2", words("  Spaces -- and hyphens  "))
        )
      )
    ).toEqual([
      "getting-started",
      "whats-new-in-v2",
      "c-rust-a-comparison",
      "spaces-and-hyphens",
    ]);
  });

  it("reads the words as a reader sees them, with the formatting dropped", () => {
    const anchors = headingAnchors(
      passage(heading("h2", words("Bold "), words("and italic", 3)))
    );
    expect(anchors.map(({ id, text }) => ({ id, text }))).toEqual([
      { id: "bold-and-italic", text: "Bold and italic" },
    ]);
  });

  it("keeps letters outside ASCII, and falls back to `section` when nothing is left", () => {
    expect(
      ids(
        passage(
          heading("h2", words("Café au lait")),
          heading("h2", words("日本語の見出し")),
          heading("h2", words("???"))
        )
      )
    ).toEqual(["café-au-lait", "日本語の見出し", "section"]);
  });

  it("numbers a repeat from 2, and never reuses an id a heading already holds", () => {
    expect(
      ids(
        passage(
          heading("h2", words("Notes")),
          heading("h3", words("Notes")),
          heading("h2", words("Notes 2")),
          heading("h2", words("Notes"))
        )
      )
    ).toEqual(["notes", "notes-2", "notes-2-2", "notes-3"]);
  });

  it("gives a heading with no words no anchor, and lists it nowhere", () => {
    expect(
      ids(
        passage(
          heading("h2"),
          heading("h2", words("   ")),
          heading("h2", words("Kept"))
        )
      )
    ).toEqual(["kept"]);
  });
});

describe("a passage's headings", () => {
  it("are found in document order at any depth, and paragraphs are not headings", () => {
    const anchors = headingAnchors(
      passage(
        heading("h2", words("One")),
        paragraph("Not a heading"),
        {
          type: "collapsible-container",
          children: [
            {
              type: "collapsible-content",
              children: [heading("h3", words("Inside"))],
            },
          ],
        },
        heading("h4", words("Two"))
      )
    );
    expect(anchors.map(({ id, rank }) => [id, rank])).toEqual([
      ["one", 2],
      ["inside", 3],
      ["two", 4],
    ]);
  });

  it("are none for a value that is not rich text", () => {
    for (const value of [undefined, null, "<h2>Old</h2>", {}, { root: {} }]) {
      expect(headingAnchors(value), String(value)).toEqual([]);
    }
  });

  it("are read past a node that is not a node, as the renderer skips it", () => {
    const value = {
      root: {
        type: "root",
        children: [null, 4, heading("h2", words("Still here"))],
      },
    };
    expect(ids(value)).toEqual(["still-here"]);
  });

  it("are keyed by the stored node, so a renderer finds the id of the heading it draws", () => {
    const first = heading("h2", words("Alpha"));
    const second = heading("h2", words("Alpha"));
    const map = anchorIds(headingAnchors(passage(first, second)));
    expect(map.get(first)).toBe("alpha");
    expect(map.get(second)).toBe("alpha-2");
  });
});

describe("a heading's rank", () => {
  it("is its tag's level, and 2 for a tag the renderer does not know", () => {
    expect(headingRank(heading("h1"))).toBe(1);
    expect(headingRank(heading("h6"))).toBe(6);
    expect(headingRank(heading("h7"))).toBe(2);
    expect(headingRank({ type: "heading" })).toBe(2);
  });
});
