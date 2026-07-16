/**
 * Code rendering in the rich-text serializer.
 *
 * This is the one path every site's content passes through on its way to the
 * page, and it had no tests. The assertions here are about who owns the
 * colour: the serializer states what each token *is* and nothing about how it
 * looks, because an inline style outranks the site's stylesheet and would fix
 * every code block to one palette in both light and dark.
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

function codeBlock(children: unknown[], language = "javascript") {
  return { type: "code", language, children };
}

function token(text: string, highlightType?: string | null) {
  return { type: "code-highlight", text, highlightType };
}

describe("code blocks", () => {
  it("states the language it was given", () => {
    const html = convertRichTextToHtml(doc([codeBlock([token("x")])]));
    expect(html).toContain('data-language="javascript"');
  });

  it("carries no colour of its own", () => {
    const html = convertRichTextToHtml(
      doc([codeBlock([token("const", "keyword")])])
    );
    expect(html).not.toMatch(/background-color:/);
    expect(html).not.toMatch(/style="[^"]*color:/);
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("keeps a class the site can style", () => {
    const html = convertRichTextToHtml(doc([codeBlock([token("x")])]));
    expect(html).toContain('class="nextly-rich-text-code-block"');
  });
});

describe("syntax tokens", () => {
  it("emits the token type as a class", () => {
    const html = convertRichTextToHtml(
      doc([codeBlock([token("const", "keyword")])])
    );
    expect(html).toContain(
      '<span class="nextly-code-token nextly-code-token--keyword">const</span>'
    );
  });

  it("keeps every token of a line, in order", () => {
    const html = convertRichTextToHtml(
      doc([
        codeBlock([
          token("const", "keyword"),
          token(" x = ", null),
          token('"hi"', "string"),
        ]),
      ])
    );
    expect(html).toContain("nextly-code-token--keyword");
    expect(html).toContain("nextly-code-token--string");
    expect(html).toMatch(/const<\/span> x = <span[^>]*>&quot;hi&quot;/);
  });

  it("leaves untyped text bare rather than in an empty wrapper", () => {
    const html = convertRichTextToHtml(doc([codeBlock([token("  ", null)])]));
    expect(html).not.toContain("nextly-code-token");
    expect(html).toContain("<code>  </code>");
  });

  it("escapes the token's text", () => {
    const html = convertRichTextToHtml(
      doc([codeBlock([token("<script>alert(1)</script>", "string")])])
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  // The type reaches a class attribute, and it arrives from stored content.
  it.each([
    ['" onmouseover="alert(1)', "an attribute break-out"],
    ["keyword><script>alert(1)</script", "a tag break-out"],
    ["Keyword", "an unexpected case"],
    ["../../etc", "punctuation"],
    ["", "an empty type"],
  ])("refuses %s as a class (%s)", rawType => {
    const html = convertRichTextToHtml(doc([codeBlock([token("x", rawType)])]));
    expect(html).not.toContain("onmouseover");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<code>x</code>");
  });
});

describe("inline code", () => {
  const CODE_FORMAT = 16;

  it("is a class, not an inline background", () => {
    const html = convertRichTextToHtml(
      doc([
        {
          type: "paragraph",
          children: [{ type: "text", text: "npm i", format: CODE_FORMAT }],
        },
      ])
    );
    expect(html).toContain('<code class="nextly-rich-text-code">npm i</code>');
    expect(html).not.toMatch(/background-color:/);
  });
});
