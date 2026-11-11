/**
 * A page's structured data as the text of its JSON-LD script element.
 *
 * What each case pins:
 * - the text is the page's nodes as one schema.org graph, read back unchanged;
 * - no value an editor enters can end the script element or add markup to
 *   the page, whatever it holds;
 * - a page with no structured data gets no text, so no empty element is drawn.
 */
import { describe, expect, it } from "vitest";

import type { StructuredDataNode } from "../page-metadata-contract";
import { structuredDataText } from "../structured-data";

describe("structuredDataText", () => {
  it("is the page's nodes as one schema.org graph", () => {
    const nodes: StructuredDataNode[] = [
      { "@type": "WebPage", "@id": "https://example.com/about", name: "About" },
      { "@type": "Organization", name: "Example", sameAs: ["https://x.com/e"] },
    ];

    const text = structuredDataText(nodes);

    expect(JSON.parse(text ?? "")).toEqual({
      "@context": "https://schema.org",
      "@graph": nodes,
    });
  });

  it("ends no script element and adds no markup, whatever a value holds", () => {
    const hostile = [
      "</script><script>alert(1)</script>",
      "</SCRIPT >",
      "<!-- a comment that never closes",
      "<![CDATA[ x ]]>",
      "Tom & Jerry > Itchy",
      "line\u2028separator\u2029paragraph",
    ];
    const nodes = hostile.map(name => ({ "@type": "Thing", name }));

    const text = structuredDataText(nodes) ?? "";

    // Nothing in the text an HTML parser reads inside a script element.
    expect(text).not.toMatch(/[<>&\u2028\u2029]/);
    // And every value still reads back exactly as it was entered.
    expect(
      (JSON.parse(text) as { "@graph": { name: string }[] })["@graph"].map(
        node => node.name
      )
    ).toEqual(hostile);
  });

  it.each([
    ["none", undefined],
    ["an empty list", []],
  ])("is nothing for %s", (_, nodes) => {
    expect(structuredDataText(nodes)).toBeUndefined();
  });
});
