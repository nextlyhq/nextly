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

/**
 * The named characters a page's text may spell, by name: the Latin-1 set,
 * typographic punctuation and the common symbols, as HTML defines them
 * (`&eacute;`, `&ndash;`, `&euro;`). A name outside them is kept as written.
 */
const NAMED_CODES: Record<string, number> = {
  apos: 39,
  AElig: 198,
  Aacute: 193,
  Acirc: 194,
  Agrave: 192,
  Aring: 197,
  Atilde: 195,
  Auml: 196,
  Ccedil: 199,
  Dagger: 8225,
  ETH: 208,
  Eacute: 201,
  Ecirc: 202,
  Egrave: 200,
  Euml: 203,
  Iacute: 205,
  Icirc: 206,
  Igrave: 204,
  Iuml: 207,
  Ntilde: 209,
  OElig: 338,
  Oacute: 211,
  Ocirc: 212,
  Ograve: 210,
  Oslash: 216,
  Otilde: 213,
  Ouml: 214,
  Prime: 8243,
  Scaron: 352,
  THORN: 222,
  Uacute: 218,
  Ucirc: 219,
  Ugrave: 217,
  Uuml: 220,
  Yacute: 221,
  Yuml: 376,
  aacute: 225,
  acirc: 226,
  acute: 180,
  aelig: 230,
  agrave: 224,
  amp: 38,
  aring: 229,
  asymp: 8776,
  atilde: 227,
  auml: 228,
  bdquo: 8222,
  brvbar: 166,
  bull: 8226,
  ccedil: 231,
  cedil: 184,
  cent: 162,
  circ: 710,
  copy: 169,
  curren: 164,
  dagger: 8224,
  darr: 8595,
  deg: 176,
  divide: 247,
  eacute: 233,
  ecirc: 234,
  egrave: 232,
  emsp: 8195,
  ensp: 8194,
  eth: 240,
  euml: 235,
  euro: 8364,
  fnof: 402,
  frac12: 189,
  frac14: 188,
  frac34: 190,
  ge: 8805,
  gt: 62,
  harr: 8596,
  hellip: 8230,
  iacute: 237,
  icirc: 238,
  iexcl: 161,
  igrave: 236,
  iquest: 191,
  iuml: 239,
  laquo: 171,
  larr: 8592,
  ldquo: 8220,
  le: 8804,
  lrm: 8206,
  lsaquo: 8249,
  lsquo: 8216,
  lt: 60,
  macr: 175,
  mdash: 8212,
  micro: 181,
  middot: 183,
  minus: 8722,
  nbsp: 160,
  ndash: 8211,
  ne: 8800,
  not: 172,
  ntilde: 241,
  oacute: 243,
  ocirc: 244,
  oelig: 339,
  ograve: 242,
  ordf: 170,
  ordm: 186,
  oslash: 248,
  otilde: 245,
  ouml: 246,
  para: 182,
  permil: 8240,
  plusmn: 177,
  pound: 163,
  prime: 8242,
  quot: 34,
  raquo: 187,
  rarr: 8594,
  rdquo: 8221,
  reg: 174,
  rlm: 8207,
  rsaquo: 8250,
  rsquo: 8217,
  sbquo: 8218,
  scaron: 353,
  sect: 167,
  shy: 173,
  sup1: 185,
  sup2: 178,
  sup3: 179,
  szlig: 223,
  thinsp: 8201,
  thorn: 254,
  tilde: 732,
  times: 215,
  trade: 8482,
  uacute: 250,
  uarr: 8593,
  ucirc: 251,
  ugrave: 249,
  uml: 168,
  uuml: 252,
  yacute: 253,
  yen: 165,
  yuml: 255,
  zwj: 8205,
  zwnj: 8204,
};

/** `text` with its HTML entities read. */
function decoded(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi,
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
      // Names are case-sensitive: `&Eacute;` and `&eacute;` differ.
      // Its own names only: `&constructor;` is no character.
      const code = Object.hasOwn(NAMED_CODES, body)
        ? NAMED_CODES[body]
        : undefined;
      return code === undefined ? entity : String.fromCodePoint(code);
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
