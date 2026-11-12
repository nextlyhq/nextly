/**
 * A page's structured data as the text of its JSON-LD script element.
 *
 * A leaf: the route helpers hand this text to a page's render, and a page
 * places it as the body of `<script type="application/ld+json">`, so the
 * structured data is in the HTML a crawler receives rather than added in the
 * browser. Nothing here knows React or Next.js.
 *
 * @module runtime/seo/structured-data
 */
import type { StructuredDataNode } from "./page-metadata-contract";

/** The vocabulary every node of a page's graph is written in. */
const SCHEMA_ORG = "https://schema.org";

/**
 * The characters an HTML parser reads inside a script element, or that end a
 * line in older JavaScript parsers, each written as its JSON escape. JSON
 * never needs one of them outside a string, and inside a string the escape
 * reads back as the same character, so the data is unchanged while no value
 * can end the element (`</script>`), open a comment (`<!--`) or add markup.
 */
const UNSAFE_IN_SCRIPT = /[<>&\u2028\u2029]/g;

function escapedForScript(json: string): string {
  return json.replace(
    UNSAFE_IN_SCRIPT,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

/** The props of a JSON-LD script element, for React to spread onto it. */
export interface JsonLdScriptProps {
  type: "application/ld+json";
  dangerouslySetInnerHTML: { __html: string };
}

/**
 * The props of the script element that places structured data in a page:
 * `<script {...jsonLdScriptProps(data)} />`, so the JSON-LD is in the HTML a
 * crawler receives, with no value able to end the element.
 *
 * `data` is JSON-LD text, as `context.structuredData` and the
 * `*StructuredData` functions give it, or nodes the site builds itself, which
 * are written as JSON here. Text is escaped again, which changes nothing in
 * text these functions wrote and makes any other JSON safe to place.
 *
 * ```tsx
 * {structuredData && <script {...jsonLdScriptProps(structuredData)} />}
 * <script {...jsonLdScriptProps({ "@context": "https://schema.org", "@type": "FAQPage" })} />
 * ```
 *
 * @experimental Settles with the page-metadata contract.
 */
export function jsonLdScriptProps(
  data: string | StructuredDataNode | readonly StructuredDataNode[]
): JsonLdScriptProps {
  const json = typeof data === "string" ? data : JSON.stringify(data);
  return {
    type: "application/ld+json",
    dangerouslySetInnerHTML: { __html: escapedForScript(json) },
  };
}

/**
 * The page's nodes as one schema.org graph, written to be placed as the body
 * of a JSON-LD script element; nothing for a page with none, so no empty
 * element is drawn.
 *
 * @experimental Settles with the page-metadata contract.
 */
export function structuredDataText(
  nodes: readonly StructuredDataNode[] | undefined
): string | undefined {
  if (nodes === undefined || nodes.length === 0) return undefined;
  return escapedForScript(
    JSON.stringify({ "@context": SCHEMA_ORG, "@graph": nodes })
  );
}
