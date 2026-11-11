/**
 * What a crawler reads from a page's HTML: its title and description, its
 * social card, its official address and its robots rules, each as the first
 * tag that says it, the way crawlers take them.
 *
 * Read with a small scanner, not a full HTML parser: only `<title>`, `<meta>`
 * and `<link>` matter, and the places those words appear without being tags
 * (scripts, styles, comments, an icon's own `<title>`) are removed first.
 *
 * @module received/head
 */

/** A page's head, as one crawler received it. */
export interface ReceivedHead {
  title?: string;
  description?: string;
  /** The official address the page names, as written. */
  canonical?: string;
  /** Every rule of its `robots` and `googlebot` tags, in lower case. */
  robots: string[];
  og: {
    title?: string;
    description?: string;
    image?: string;
    imageWidth?: number;
    imageHeight?: number;
  };
  twitter: { title?: string; description?: string; image?: string };
}

/** Elements whose content is never the page's head, removed before reading. */
const NOT_THE_HEAD =
  /<!--[\s\S]*?-->|<(script|style|svg|template|noscript|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/**
 * Every `<name …>` tag, read to its own closing `>`: a `>` inside a quoted
 * value (`content="A > B"`) is part of the value, not the end of the tag.
 */
function tagsNamed(html: string, name: string): string[] {
  const pattern = new RegExp(`<${name}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, "gi");
  return [...html.matchAll(pattern)].map(([tag]) => tag);
}

/** The characters an HTML entity may stand for here. */
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** `text` with its HTML entities read. */
function decoded(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity: string, body: string) => {
      if (body.startsWith("#")) {
        const code =
          body[1] === "x" || body[1] === "X"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        return code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : entity;
      }
      return NAMED[body.toLowerCase()] ?? entity;
    }
  );
}

/** `text` with its runs of white space made one space, and trimmed. */
function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The attributes of one tag, by lower-case name, each read once. */
function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern =
    /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  // The tag's own name is skipped: attributes start after it.
  const body = tag.replace(/^<\s*[a-z]+/i, "");
  for (const match of body.matchAll(pattern)) {
    const name = (match[1] ?? "").toLowerCase();
    if (name === "" || attributes.has(name)) continue;
    attributes.set(name, decoded(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return attributes;
}

/** A whole number from a tag's text, or undefined. */
function wholeNumber(text: string | undefined): number | undefined {
  if (text === undefined || !/^\s*\d+\s*$/.test(text)) return undefined;
  return Number(text);
}

/** The values of each `<meta>` tag by its name or property, first kept. */
function metaValues(html: string): {
  values: Map<string, string>;
  robots: string[];
} {
  const values = new Map<string, string>();
  const robots: string[] = [];
  for (const tag of tagsNamed(html, "meta")) {
    const attributes = attributesOf(tag);
    const key = (
      attributes.get("name") ??
      attributes.get("property") ??
      ""
    ).toLowerCase();
    const content = attributes.get("content");
    if (key === "" || content === undefined) continue;
    if (key === "robots" || key === "googlebot") {
      robots.push(
        ...content
          .split(",")
          .map(rule => rule.trim().toLowerCase())
          .filter(rule => rule !== "")
      );
      continue;
    }
    if (!values.has(key)) values.set(key, tidy(content));
  }
  return { values, robots };
}

/** The address of the first `<link rel="canonical">`. */
function canonicalOf(html: string): string | undefined {
  for (const tag of tagsNamed(html, "link")) {
    const attributes = attributesOf(tag);
    const rel = (attributes.get("rel") ?? "").toLowerCase().split(/\s+/);
    const href = attributes.get("href");
    if (rel.includes("canonical") && href !== undefined) return href.trim();
  }
  return undefined;
}

/** `value` under `key`, or nothing where it is undefined or blank. */
function some<K extends string, V>(
  key: K,
  value: V | undefined
): Partial<Record<K, V>> {
  return value === undefined || value === ""
    ? {}
    : ({ [key]: value } as Record<K, V>);
}

/** What a crawler reads from `html`. */
export function readHead(html: string): ReceivedHead {
  const page = html.replace(NOT_THE_HEAD, "");
  const titled = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(page);
  const { values, robots } = metaValues(page);
  return {
    ...some("title", titled ? tidy(decoded(titled[1] ?? "")) : undefined),
    ...some("description", values.get("description")),
    ...some("canonical", canonicalOf(page)),
    robots,
    og: {
      ...some("title", values.get("og:title")),
      ...some("description", values.get("og:description")),
      ...some("image", values.get("og:image") ?? values.get("og:image:url")),
      ...some("imageWidth", wholeNumber(values.get("og:image:width"))),
      ...some("imageHeight", wholeNumber(values.get("og:image:height"))),
    },
    twitter: {
      ...some("title", values.get("twitter:title")),
      ...some("description", values.get("twitter:description")),
      ...some("image", values.get("twitter:image")),
    },
  };
}
