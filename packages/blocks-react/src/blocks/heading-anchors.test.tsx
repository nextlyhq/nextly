/**
 * The headings a passage draws and the anchors they are drawn with: the ids
 * `core/rich-text` puts on its headings and `core/table-of-contents` links to.
 *
 * Read through `passageHeadings`, the walk `RichText` draws a passage with, so
 * these cases hold the outline to the render rather than to a second reading of
 * the stored tree. The expected ids are the ones the blog template's
 * hand-written post page gives the same headings: lower-cased words,
 * punctuation dropped, spaces as hyphens, repeats numbered from 2.
 */
import type { RichTextNode, RichTextValue } from "@nextlyhq/blocks-engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  passageHeadings,
  RichText,
  VIEWS_DRAWING_CHILDREN,
} from "../rich-text";

import { anchorAllocator, anchorIds, headingRank } from "./heading-anchors";

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

const image = (...children: RichTextNode[]): RichTextNode => ({
  type: "image",
  src: "/media/a.png",
  altText: "A picture",
  ...(children.length > 0 ? { children } : {}),
});

const passage = (...children: RichTextNode[]): RichTextValue => ({
  root: { type: "root", children },
});

const ids = (value: unknown) => passageHeadings(value).map(anchor => anchor.id);

/** The passage as a page draws it, with its headings anchored. */
const drawn = (value: RichTextValue) =>
  renderToStaticMarkup(<RichText value={value} anchorHeadings={true} />);

/** Every id the drawn passage carries. */
const drawnIds = (html: string) =>
  [...html.matchAll(/\sid="([^"]*)"/g)].map(match => match[1]);

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
    const anchors = passageHeadings(
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

describe("the ids of one passage", () => {
  it("cost one probe per heading for a passage of 20,000 identical headings", () => {
    // A quadratic allocator probes every id taken before each repeat:
    // about 200 million lookups here. Counted rather than timed, so a busy
    // machine cannot make it pass or fail.
    let probes = 0;
    class CountingSet extends Set<string> {
      override has(value: string): boolean {
        probes += 1;
        return super.has(value);
      }
    }
    const allocator = anchorAllocator(new CountingSet());
    const taken = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) taken.add(allocator.take("Notes"));
    expect(taken.size).toBe(20_000);
    expect(probes).toBeLessThanOrEqual(2 * 20_000);
  });

  it("still steps past an id another heading's own words took", () => {
    const allocator = anchorAllocator();
    expect(
      ["Notes", "Notes 2", "Notes", "Notes 3", "Notes", "Notes"].map(text =>
        allocator.take(text)
      )
    ).toEqual([
      "notes",
      "notes-2",
      "notes-3",
      "notes-3-2",
      "notes-4",
      "notes-5",
    ]);
  });
});

describe("the headings a passage draws", () => {
  it("are found in document order inside the containers the renderer draws", () => {
    const anchors = passageHeadings(
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

  it("are labelled by the words a heading keeps, when its block content moves out after it", () => {
    // `Before`, an image, then `After`: the heading draws `Before`, and the
    // image and `After` follow it in the flow.
    const value = passage(
      heading("h2", words("Before"), image(), words("After"))
    );
    expect(
      passageHeadings(value).map(({ id, text }) => ({ id, text }))
    ).toEqual([{ id: "before", text: "Before" }]);
    expect(drawn(value)).toMatch(/^<h2 id="before">Before<\/h2><figure/);
  });

  it("include a heading a heading moved out after itself, as the renderer draws it", () => {
    const value = passage(
      heading("h2", words("Outer"), heading("h3", words("Moved out")))
    );
    expect(ids(value)).toEqual(["outer", "moved-out"]);
    expect(drawnIds(drawn(value))).toEqual(["outer", "moved-out"]);
  });

  it("leave out a stale heading stored under a node the renderer draws no children of", () => {
    const stale = () => heading("h2", words("Stale"));
    for (const holder of [
      image(stale()),
      { type: "horizontalrule", children: [stale()] },
      { type: "text", text: "Words", children: [stale()] },
      { type: "button-link", text: "Go", url: "/go", children: [stale()] },
    ]) {
      const value = passage(holder, heading("h2", words("Drawn")));
      expect(ids(value), holder.type).toEqual(["drawn"]);
      expect(drawn(value), holder.type).not.toContain("Stale");
    }
  });

  it("keep their anchors on a heading the renderer rebuilds inside a disclosure label", () => {
    // A summary may hold a heading, so it keeps it, copied with only the
    // children it may hold; the image leaves it, and the id must still land
    // on the copy that is drawn.
    const value = passage({
      type: "collapsible-container",
      open: true,
      children: [
        {
          type: "collapsible-title",
          children: [heading("h3", words("Label"), image())],
        },
        {
          type: "collapsible-content",
          children: [paragraph("Body")],
        },
      ],
    });
    expect(ids(value)).toEqual(["label"]);
    expect(drawn(value)).toContain(
      '<summary><h3 id="label">Label</h3></summary>'
    );
  });

  it("are none for a value that is not rich text", () => {
    for (const value of [undefined, null, "<h2>Old</h2>", {}, { root: {} }]) {
      expect(passageHeadings(value), String(value)).toEqual([]);
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

  it("are keyed by the node drawn, so a renderer finds the id of each heading", () => {
    const first = heading("h2", words("Alpha"));
    const second = heading("h2", words("Alpha"));
    const map = anchorIds(passageHeadings(passage(first, second)));
    expect(map.get(first)).toBe("alpha");
    expect(map.get(second)).toBe("alpha-2");
  });
});

describe("the views that draw children", () => {
  it.each(Object.keys(VIEWS_DRAWING_CHILDREN))(
    "%s draws a heading stored as its child, and the walk lists it",
    type => {
      const value = passage({
        type,
        url: "/go",
        children: [heading("h2", words("Child"))],
      });
      expect(ids(value)).toEqual(["child"]);
      expect(drawnIds(drawn(value))).toContain("child");
    }
  );
});

describe("a heading's rank", () => {
  it("is its tag's level, and 2 for a tag the renderer does not know", () => {
    expect(headingRank(heading("h1"))).toBe(1);
    expect(headingRank(heading("h6"))).toBe(6);
    expect(headingRank(heading("h7"))).toBe(2);
    expect(headingRank({ type: "heading" })).toBe(2);
  });
});
