/**
 * Where a text node's inline style sits relative to its format wrappers.
 *
 * This serializer and the React renderer in `blocks-react` draw the same stored
 * node, and both put that style on a `<span>`. Whichever of the two elements is
 * NESTED DEEPER wins for an inherited property, so the nesting is not a
 * presentation detail — it decides whether an author's colour or a `<mark>`'s
 * own paint reaches the reader, and it has to be the same answer on both.
 *
 * It was not covered here before, which is how it could have been changed in
 * either direction without anything noticing.
 *
 * @module shared/lib/__tests__/rich-text-html.inline-style.test
 */
import { describe, expect, it } from "vitest";

import type { RichTextValue } from "../../../collections/fields/types/rich-text";
import { convertRichTextToHtml } from "../rich-text-html";

const TEXT_FORMAT = { BOLD: 1, UNDERLINE: 8, HIGHLIGHT: 128 } as const;

const html = (node: Record<string, unknown>): string =>
  // `?? ""` rather than a non-null assertion: the serializer answers `null` for
  // a value it cannot read, and a test that threw on that would report a shape
  // problem as a failure of whatever it was asserting.
  convertRichTextToHtml({
    root: {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", text: "Hi", ...node }],
        },
      ],
    },
  } as unknown as RichTextValue) ?? "";

describe("an inline style beside a format wrapper", () => {
  it("puts the style inside the wrapper, where the author's choice applies", () => {
    // `<mark>` is painted by the UA, and this serializer additionally gives it a
    // class that sets a colour. A style OUTSIDE it would only be inherited, so
    // the mark's own paint would win and an author who highlighted a phrase and
    // then chose a text colour would publish the mark's colours instead.
    const marked = html({
      format: TEXT_FORMAT.HIGHLIGHT,
      style: "color: #ff0000",
    });
    expect(marked).toContain(
      '<mark class="nextly-rich-text-highlight"><span style="color:#ff0000">Hi</span></mark>'
    );
  });

  it("keeps a bold run bold when the style would cancel it", () => {
    /*
     * The other direction, and why the nesting alone cannot be the rule. Once
     * the span is inside, a stored `font-weight: normal` — which is what a paste
     * from a word processor carries — would cancel the bold by being nested
     * deeper.
     *
     * The shared reader drops it instead, so the contradiction is resolved by
     * the PROPERTY rather than by the markup, and this file and the React
     * renderer reach the same answer from the same code.
     */
    const bold = html({
      format: TEXT_FORMAT.BOLD,
      style: "font-weight: normal; color: #ff0000",
    });
    expect(bold).toContain("<strong");
    expect(bold).toContain("color:#ff0000");
    expect(bold).not.toContain("font-weight:normal");
  });

  it("drops a wrapper whose line the style already draws", () => {
    // The same question the React renderer asks, from the same module. A text
    // decoration propagates to descendants rather than being replaced by
    // theirs, so `<u>` around a span declaring `underline wavy red` would draw
    // two underlines here exactly as it does there.
    const decorated = html({
      format: TEXT_FORMAT.UNDERLINE,
      style: "text-decoration: underline wavy red",
    });
    // Longhands: the engine resolves the shorthand into the three it assigns,
    // so neither surface emits it under its own name any more.
    expect(decorated).toContain("text-decoration-line:underline");
    expect(decorated).not.toContain("<u");
  });

  it("keeps that wrapper when nothing draws its line", () => {
    // The control, and it is what makes the assertion above about the STYLE
    // rather than about underlines having stopped working.
    expect(html({ format: TEXT_FORMAT.UNDERLINE })).toContain("<u");
  });

  it("emits no span when the style survives nothing", () => {
    // The control. A serializer that always wrapped would satisfy both
    // assertions above while putting an empty element around every formatted
    // word in every document.
    expect(
      html({ format: TEXT_FORMAT.BOLD, style: "position: fixed" })
    ).not.toContain("<span");
  });

  it("still escapes the text it wraps", () => {
    // The span is built around already-escaped content now rather than being
    // wrapped around the formatter's output, so this is the assertion that the
    // move did not step past the escaping on the way.
    expect(html({ text: "<img src=x>", style: "color: #fff" })).not.toContain(
      "<img"
    );
  });
});
