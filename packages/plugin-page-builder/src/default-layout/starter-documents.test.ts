/**
 * The starter header and footer's content, as stored.
 *
 * What a site draws from them is checked through the real published route in
 * `__tests__/starter-header-footer.integration.test.ts`; this pins what makes
 * them follow the site: only core blocks, every colour and spacing step a
 * design variable, the name and year bound to the site, the links a list of
 * the site's own pages collection.
 */
import { describe, expect, it } from "vitest";

import { SITE_NAME_FALLBACK, starterDocument } from "./starter-documents";

type Json = Record<string, unknown>;

/** Every node of a document, depth first. */
function nodesOf(document: unknown): Json[] {
  const found: Json[] = [];
  const walk = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes as Json[]) {
      found.push(node);
      for (const slot of Object.values((node.slots ?? {}) as Json)) walk(slot);
    }
  };
  walk((document as { nodes?: unknown }).nodes);
  return found;
}

/** Every style value under a node's styles, with the property it sets. */
function styleValues(node: Json): [string, unknown][] {
  const out: [string, unknown][] = [];
  const walk = (property: string, value: unknown): void => {
    if (typeof value === "object" && value !== null && !("$token" in value)) {
      for (const [key, inner] of Object.entries(value)) {
        walk(property === "" || property === "base" ? key : property, inner);
      }
      return;
    }
    out.push([property, value]);
  };
  walk("", node.styles ?? {});
  return out;
}

const COLOUR_PROPERTIES = new Set(["color", "backgroundColor", "border"]);
const SPACING_PROPERTIES = new Set(["padding", "margin", "gap", "rowGap"]);

describe.each(["header", "footer"] as const)("the starter %s", area => {
  const document = starterDocument(area, "pages");
  const nodes = nodesOf(document);

  it("is a component built only from core blocks", () => {
    expect(document.kind).toBe("component");
    expect(nodes.length).toBeGreaterThan(3);
    for (const node of nodes) expect(String(node.type)).toMatch(/^core\//);
  });

  it("holds no fixed colour, and takes every spacing step from a design variable", () => {
    for (const node of nodes) {
      for (const [property, value] of styleValues(node)) {
        if (COLOUR_PROPERTIES.has(property) && typeof value === "string") {
          // A border's width and style are words or a hairline; only its
          // colour is a colour, and that is a variable.
          expect(value).not.toMatch(/#|rgb|hsl|oklch|color\(/i);
        }
        if (SPACING_PROPERTIES.has(property)) {
          // A spacing step is a design variable; "0" is no space at all.
          expect(value === "0" || typeof value === "object").toBe(true);
        }
        if (property === "fontSize") expect(value).toBe("inherit");
      }
    }
    const raw = JSON.stringify(document);
    expect(raw).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    // The only two literal lengths: the header's one-pixel rule and the
    // copyright line's word space, which grows with the text.
    const lengths = raw.match(/"\d+(\.\d+)?(px|r?em|vw|vh|%)"/g) ?? [];
    expect(lengths).toEqual(area === "header" ? ['"1px"'] : ['"0.25em"']);
  });

  it("binds the site's name, with its words while none is set", () => {
    const named = nodes.filter(node =>
      JSON.stringify(node.bindings ?? {}).includes('"applicationName"')
    );
    expect(named.length).toBeGreaterThan(0);
    for (const node of named) {
      expect(JSON.stringify(node.bindings)).toContain(
        `"fallback":"${SITE_NAME_FALLBACK}"`
      );
    }
  });

  it("lists the site's own pages collection as links, oldest first", () => {
    const lists = nodes.filter(node => node.type === "core/collection-loop");
    expect(lists).toHaveLength(1);
    expect(lists[0]?.props).toMatchObject({
      collection: "pages",
      sort: "createdAt",
      limit: area === "header" ? 5 : 4,
    });
    expect(JSON.stringify(starterDocument(area, "site-pages"))).toContain(
      '"collection":"site-pages"'
    );
  });
});

describe("what the starter says", () => {
  it("offers Contact us to /contact in the header, and a Pages column and the year in the footer", () => {
    const header = JSON.stringify(starterDocument("header", "pages"));
    expect(header).toContain('"label":"Contact us","href":"/contact"');
    expect(header).toContain('"href":"/"');
    const footer = JSON.stringify(starterDocument("footer", "pages"));
    expect(footer).toContain('"text":"Pages"');
    expect(footer).toContain('"text":"©"');
    expect(footer).toContain('"$bind":"currentYear","source":"site"');
  });
});
