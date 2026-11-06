/**
 * What site code may hold: the elements, attributes and URLs every published
 * page may carry in its head or at the end of its body, written once.
 *
 * Site code runs on every page, so whoever may write it may run script there;
 * that is the point of it. These rules do not stop that. They keep each entry
 * inside its slot (no breaking out of a script or style, no element that
 * swallows the page), refuse the ways code hides in markup that does not look
 * like a script (event handlers, `javascript:` URLs, `<base>`, a meta
 * refresh), and keep what is stored exactly what renders, so a hash taken at
 * save is the hash the browser takes.
 *
 * Stored as structured entries, never as HTML: the render builds elements
 * from them, so nothing stored is parsed again by a browser. The sanitiser
 * (`sanitise`) turns what a person pastes into entries and judges each with
 * {@link siteCodeEntryProblem}; the render judges a stored entry again with
 * the same function, so a row edited in the database cannot break out either.
 *
 * @module site-code/rules
 * @experimental
 */

/** Where site code goes on every published page. */
export type SiteCodeSlot = "head" | "body";

/** An entry's attributes, by name, as stored. */
export type SiteCodeAttrs = Readonly<Record<string, string>>;

/** One element of site code, as stored and rendered. */
export type SiteCodeEntry =
  | {
      readonly tag: "script";
      readonly attrs: SiteCodeAttrs;
      /** Inline code; absent for a script loaded by `src`. */
      readonly text?: string;
    }
  | {
      readonly tag: "style";
      readonly attrs: SiteCodeAttrs;
      readonly text: string;
    }
  | { readonly tag: "meta"; readonly attrs: SiteCodeAttrs }
  | { readonly tag: "link"; readonly attrs: SiteCodeAttrs }
  | {
      readonly tag: "noscript";
      /** The one element a no-script fallback holds: a pixel, or a frame. */
      readonly child: {
        readonly tag: "img" | "iframe";
        readonly attrs: SiteCodeAttrs;
      };
    };

/**
 * How much site code a site may have. It ships on every page view, so the
 * bounds are generous for vendor snippets and small for a page's weight.
 */
export const SITE_CODE_LIMITS = {
  /** Characters a person may paste into one slot. */
  slotChars: 50_000,
  /** Elements one slot may hold. */
  entriesPerSlot: 40,
  /** Characters in one URL. */
  urlLength: 2048,
  /** Characters in one attribute value. */
  attributeLength: 4096,
} as const;

/** The script types a browser runs as code, or reads as data, and no other. */
const SCRIPT_TYPES: ReadonlySet<string> = new Set([
  "module",
  "text/javascript",
  "application/ld+json",
]);

/** The link relations site code may use: hints, styles, icons, alternates. */
const LINK_RELS: ReadonlySet<string> = new Set([
  "preconnect",
  "dns-prefetch",
  "preload",
  "modulepreload",
  "stylesheet",
  "icon",
  "apple-touch-icon",
  "manifest",
  "alternate",
]);

/** The attributes each element may carry, besides `data-*` on a script. */
const ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  script: new Set([
    "src",
    "async",
    "defer",
    "type",
    "crossorigin",
    "integrity",
    "referrerpolicy",
    "nomodule",
    "id",
  ]),
  style: new Set(["media"]),
  meta: new Set(["name", "property", "content", "itemprop"]),
  link: new Set([
    "rel",
    "href",
    "as",
    "type",
    "crossorigin",
    "integrity",
    "media",
    "sizes",
    "hreflang",
    "referrerpolicy",
    "fetchpriority",
  ]),
  // `style` on the pixel, as vendor snippets hide it (`display:none`).
  img: new Set(["src", "width", "height", "alt", "style"]),
  iframe: new Set(["src", "width", "height", "style"]),
};

/** The slots each element may go in. */
const SLOTS: Readonly<Record<SiteCodeEntry["tag"], readonly SiteCodeSlot[]>> = {
  script: ["head", "body"],
  style: ["head", "body"],
  meta: ["head"],
  link: ["head"],
  noscript: ["body"],
};

/** The attributes that hold a URL, judged by {@link siteCodeUrlProblem}. */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set(["src", "href"]);

/** A `data-*` attribute's name, as a script may carry one. */
const DATA_ATTRIBUTE = /^data-[a-z0-9][a-z0-9._:-]*$/;

/**
 * What browsers ignore in a URL before reading it: ASCII whitespace and
 * control characters, which is how `java\tscript:` still runs.
 */
const IGNORED_IN_URL = /[\u0000- \u007f-\u009f]/g;

/**
 * Why a URL may not be used, or `undefined` when it may: it must be `https:`
 * or a path on this site (`/…`), read as a browser reads it once what it
 * ignores is taken out, so no obfuscation of another scheme gets through.
 */
export function siteCodeUrlProblem(value: string): string | undefined {
  if (value.length > SITE_CODE_LIMITS.urlLength) {
    return `is longer than ${SITE_CODE_LIMITS.urlLength} characters`;
  }
  const read = value.replace(IGNORED_IN_URL, "");
  // A path on this site, but not `//host` or `/\host`, which browsers read
  // as another host.
  if (read.startsWith("/")) {
    return read.startsWith("//") || read.includes("\\")
      ? "points at another site without saying https:"
      : undefined;
  }
  let url: URL;
  try {
    url = new URL(read);
  } catch {
    return "is not an https: address or a path on this site";
  }
  return url.protocol === "https:"
    ? undefined
    : `uses ${url.protocol}, and only https: addresses are allowed`;
}

/** Why one attribute of an element may not be used; `undefined` if it may. */
function attributeProblem(
  tag: string,
  name: string,
  value: string
): string | undefined {
  if (name.startsWith("on")) return `the ${name} attribute runs code`;
  if (name === "nonce") return "the nonce is the site's to set";
  const allowed =
    ATTRIBUTES[tag]?.has(name) === true ||
    (tag === "script" && DATA_ATTRIBUTE.test(name));
  if (!allowed) return `the ${name} attribute isn't allowed on <${tag}>`;
  if (value.length > SITE_CODE_LIMITS.attributeLength) {
    return `the ${name} attribute is longer than ${SITE_CODE_LIMITS.attributeLength} characters`;
  }
  if (URL_ATTRIBUTES.has(name)) {
    const problem = siteCodeUrlProblem(value);
    if (problem !== undefined) return `its ${name} ${problem}`;
  }
  return undefined;
}

/** Why an element's own attribute values may not be used, by element. */
function valueProblem(tag: string, attrs: SiteCodeAttrs): string | undefined {
  if (tag === "script") {
    if (attrs.type !== undefined && !SCRIPT_TYPES.has(attrs.type)) {
      return `a script of type "${attrs.type}" isn't allowed`;
    }
    // Next.js's own ids, in any case (`__NEXT_DATA__`).
    if (attrs.id?.toLowerCase().startsWith("__next") === true) {
      return "a script id starting __next belongs to Next.js";
    }
  }
  if (tag === "link") {
    if (attrs.rel === undefined || !LINK_RELS.has(attrs.rel)) {
      return `a link with rel "${attrs.rel ?? ""}" isn't allowed`;
    }
    if (attrs.href === undefined) return "a link needs an href";
  }
  return undefined;
}

/** Why an element's attributes may not be used; `undefined` if they may. */
function attrsProblem(tag: string, attrs: unknown): string | undefined {
  if (!isAttrs(attrs)) return "its attributes can't be read";
  for (const [name, value] of Object.entries(attrs)) {
    const problem = attributeProblem(tag, name, value);
    if (problem !== undefined) return problem;
  }
  return valueProblem(tag, attrs);
}

/** Why an element's inline text may not be used; `undefined` if it may. */
function textProblem(
  tag: "script" | "style",
  text: string
): string | undefined {
  // Each would end the element early, or (`<!--` in a script) put the parser
  // in a state where the closing tag no longer closes it.
  if (tag === "script" && /<\/script/i.test(text)) {
    return "its code contains </script, which would end it early";
  }
  if (tag === "script" && text.includes("<!--")) {
    return "its code contains <!--, which can keep the script from ending";
  }
  if (tag === "style" && /<\/style/i.test(text)) {
    return "its styles contain </style, which would end them early";
  }
  return undefined;
}

/** Whether a value is a record of string attributes. */
function isAttrs(value: unknown): value is SiteCodeAttrs {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(item => typeof item === "string")
  );
}

/** Why a no-script fallback may not be used; `undefined` if it may. */
function fallbackProblem(child: unknown): string | undefined {
  if (typeof child !== "object" || child === null) {
    return "a <noscript> may hold only an <img> or an <iframe>";
  }
  const { tag, attrs } = child as { tag?: unknown; attrs?: unknown };
  if (tag !== "img" && tag !== "iframe") {
    return "a <noscript> may hold only an <img> or an <iframe>";
  }
  const problem = attrsProblem(tag, attrs);
  if (problem !== undefined) return `in its <noscript>, ${problem}`;
  return isAttrs(attrs) && attrs.src === undefined
    ? `its <noscript> ${tag} needs a src`
    : undefined;
}

/**
 * Why one entry may not be stored in, or rendered from, `slot`; `undefined`
 * when it may. Read from an unknown value, since the render reads stored rows.
 */
export function siteCodeEntryProblem(
  entry: unknown,
  slot: SiteCodeSlot
): string | undefined {
  if (typeof entry !== "object" || entry === null) {
    return "it isn't an element";
  }
  const { tag } = entry as { tag?: unknown };
  if (typeof tag !== "string" || !Object.hasOwn(SLOTS, tag)) {
    return `<${String(tag)}> isn't allowed`;
  }
  const known = tag as SiteCodeEntry["tag"];
  if (!SLOTS[known].includes(slot)) {
    return `<${known}> belongs ${slot === "head" ? "at the end of the body" : "in the head"}`;
  }
  if (known === "noscript") {
    return fallbackProblem((entry as { child?: unknown }).child);
  }
  const { attrs, text } = entry as { attrs?: unknown; text?: unknown };
  const problem = attrsProblem(known, attrs);
  if (problem !== undefined) return problem;
  return contentProblem(known, attrs as SiteCodeAttrs, text);
}

/** Why an entry's content may not be used, by element; `undefined` if it may. */
function contentProblem(
  tag: "script" | "style" | "meta" | "link",
  attrs: SiteCodeAttrs,
  text: unknown
): string | undefined {
  if (tag === "meta" || tag === "link") {
    return text === undefined ? undefined : `<${tag}> holds no text`;
  }
  if (text !== undefined && typeof text !== "string") {
    return "its text can't be read";
  }
  if (tag === "script" && attrs.src !== undefined && text !== undefined) {
    return "a script loaded by src holds no code of its own";
  }
  if (tag === "script" && attrs.src === undefined && text === undefined) {
    return "a script needs code or a src";
  }
  if (tag === "style" && text === undefined) return "a style needs styles";
  return text === undefined ? undefined : textProblem(tag, text);
}
