/**
 * A page's structured data as the text of its JSON-LD script element.
 *
 * What each case pins:
 * - the text is the page's nodes as one schema.org graph, read back unchanged;
 * - no value an editor enters can end the script element or add markup to
 *   the page, whatever it holds;
 * - a page with no structured data gets no text, so no empty element is drawn;
 * - the props of a JSON-LD script element place the plugin's text unchanged,
 *   and a site's own nodes or JSON text as safely.
 */
import { describe, expect, it } from "vitest";

import type { StructuredDataNode } from "../page-metadata-contract";
import { jsonLdScriptProps, structuredDataText } from "../structured-data";

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

describe("jsonLdScriptProps", () => {
  const HOSTILE = "</script><script>alert(1)</script> & <!--";

  /** The body of the element the props draw, read back. */
  const bodyOf = (props: ReturnType<typeof jsonLdScriptProps>) =>
    props.dangerouslySetInnerHTML.__html;

  it("draws a JSON-LD script element holding the page's text as it was given", () => {
    const text = structuredDataText([{ "@type": "Thing", name: HOSTILE }]);
    const props = jsonLdScriptProps(text ?? "");
    expect(props.type).toBe("application/ld+json");
    expect(bodyOf(props)).toBe(text);
  });

  it("writes a site's own nodes so no value ends the element", () => {
    const node = {
      "@context": "https://schema.org",
      "@type": "Thing",
      name: HOSTILE,
    };
    const body = bodyOf(jsonLdScriptProps(node));
    expect(body).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(body)).toEqual(node);
    const list = bodyOf(jsonLdScriptProps([node, node]));
    expect(JSON.parse(list)).toEqual([node, node]);
  });

  it("makes JSON text a site wrote itself safe to place", () => {
    const body = bodyOf(jsonLdScriptProps(JSON.stringify({ name: HOSTILE })));
    expect(body).not.toMatch(/[<>&]/);
    expect(JSON.parse(body)).toEqual({ name: HOSTILE });
  });
});
