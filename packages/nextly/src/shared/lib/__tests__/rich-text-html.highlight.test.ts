/**
 * The highlight mark in the rich-text serializer.
 *
 * Same question as the code path beside it: who owns the colour. The mark used
 * to arrive with a light yellow baked into a style attribute, which no site
 * stylesheet could override and no dark page could read. It states that the
 * text is marked; the site decides what marked looks like.
 */

import { describe, expect, it } from "vitest";

import type { RichTextValue } from "../../../collections/fields/types/rich-text";
import { convertRichTextToHtml } from "../rich-text-html";

/** Wrap nodes in the root envelope the converter expects. */
function doc(children: unknown[]): RichTextValue {
  return {
    root: {
      type: "root",
      children,
      direction: null,
      format: "",
      indent: 0,
      version: 1,
    },
  } as unknown as RichTextValue;
}

/** Lexical stores text formats as a bitmask; highlight is 128. */
const HIGHLIGHT = 128;
const BOLD = 1;

function paragraph(children: unknown[]) {
  return { type: "paragraph", children, format: "", indent: 0, version: 1 };
}

function text(value: string, format = 0) {
  return { type: "text", text: value, format, style: "", version: 1 };
}

describe("highlight marks", () => {
  it("marks highlighted text with <mark>", () => {
    const html = convertRichTextToHtml(
      doc([paragraph([text("marked", HIGHLIGHT)])])
    );
    expect(html).toContain("<mark");
    expect(html).toContain("marked");
  });

  it("leaves unhighlighted text unmarked", () => {
    const html = convertRichTextToHtml(doc([paragraph([text("plain")])]));
    expect(html).not.toContain("<mark");
  });

  // The point of the whole change: a colour baked in here outranks the site's
  // stylesheet, so the site could never restyle it and a dark page was stuck
  // with dark text on light yellow.
  it("carries no colour of its own", () => {
    const html = convertRichTextToHtml(
      doc([paragraph([text("marked", HIGHLIGHT)])])
    );
    expect(html).not.toContain("#fef08a");
    expect(html).not.toMatch(/background-color/i);
    expect(html).not.toMatch(/<mark[^>]*style=/i);
  });

  it("names the mark so a stylesheet can reach it", () => {
    const html = convertRichTextToHtml(
      doc([paragraph([text("marked", HIGHLIGHT)])])
    );
    expect(html).toContain('class="nextly-rich-text-highlight"');
  });

  it("escapes the text it marks", () => {
    const html = convertRichTextToHtml(
      doc([paragraph([text("<script>x</script>", HIGHLIGHT)])])
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("combines with other formats on the same text", () => {
    const html = convertRichTextToHtml(
      doc([paragraph([text("both", HIGHLIGHT | BOLD)])])
    );
    expect(html).toContain("<mark");
    expect(html).toContain("<strong");
  });
});
