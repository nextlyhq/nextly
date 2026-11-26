/**
 * An address the editor linked as it was typed (`autolink`) is written as a
 * link, as any link is, and one the author then unlinked (`isUnlinked`) as
 * its words alone, as the editor shows it.
 *
 * @module shared/lib/__tests__/rich-text-html.autolink.test
 */
import { describe, expect, it } from "vitest";

import type {
  RichTextNode,
  RichTextValue,
} from "../../../collections/fields/types/rich-text";
import { convertRichTextToHtml } from "../rich-text-html";

/** One paragraph holding `children`, as the editor stores it. */
function paragraphOf(children: RichTextNode[]): RichTextValue {
  return {
    root: { type: "root", children: [{ type: "paragraph", children }] },
  };
}

const words = (text: string): RichTextNode => ({
  type: "text",
  text,
  format: 0,
});

describe("an address the editor linked", () => {
  it("is written as a link, with the address it was linked to", () => {
    const html = convertRichTextToHtml(
      paragraphOf([
        words("Meet at "),
        {
          type: "autolink",
          url: "https://www.example.org/groups/open-source/",
          rel: null,
          target: null,
          title: null,
          isUnlinked: false,
          children: [words("https://www.example.org/groups/open-source/")],
        },
      ]),
      { styles: "none" }
    );
    expect(html).toContain(
      'href="https://www.example.org/groups/open-source/">https://www.example.org/groups/open-source/</a>'
    );
  });

  it("is written as its words once the author unlinked it", () => {
    const html = convertRichTextToHtml(
      paragraphOf([
        words("Mail "),
        {
          type: "autolink",
          url: "mailto:me@example.com",
          isUnlinked: true,
          children: [words("me@example.com")],
        },
      ]),
      { styles: "none" }
    );
    expect(html).not.toContain("<a");
    expect(html).toContain("Mail me@example.com");
  });
});
