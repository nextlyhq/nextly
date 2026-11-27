/**
 * A page's plain-text copy: the words its content shows, written as Markdown,
 * for AI tools that read text rather than a rendered page. Made from the page
 * as stored, the same fields the site renders, and the same for every reader:
 * nothing here asks who is reading.
 *
 * The copy is front matter naming the page (its title, description, address
 * and last change), the page's title as a heading, then the words of each
 * content field in the order its type declares them. Rich text keeps its
 * structure (headings, lists, links, quotes, code, tables, images) and the
 * emphasis and code a reader sees inside a line; a picture field shows its
 * image with its alt text. Every address is made whole against the page's,
 * so a link read away from the site still leads somewhere. Text holding
 * markup is written as the words the markup shows, and a picture drawn in
 * SVG, which holds no words, is left out. A fact that means nothing without
 * its name is written beside it: a choice as `Label: option`, a ticked box
 * as `Label: yes`, an address as `Label: <url>`, another page as
 * `Label: its title`, and a list of chips as a list under its label. What a
 * visitor never reads stays out: the page's SEO, its address, its
 * bookkeeping, code, JSON, numbers and dates.
 *
 * A copy is served beside its page, at the page's address with `.md` added
 * (`index.md` where the address ends in a slash, and `index.html.md` there
 * too), as the llms.txt proposal describes.
 *
 * @module outputs/plain-copy
 */
import { humanizeFieldName } from "@nextlyhq/plugin-sdk";
import { isFollowedLink } from "@nextlyhq/plugin-sdk/blocks";

import { isRecord, textOf } from "../plain-values";

/** A field as the type declares it, as far as a copy needs it. */
export interface CopyField {
  name?: string;
  type: string;
  fields?: readonly CopyField[];
  /** What the admin calls the field, written beside a fact it holds. */
  label?: unknown;
  /** A choice field's options, whose labels a copy writes for its values. */
  options?: unknown;
  /** The type a relationship field names pages of. */
  relationTo?: unknown;
}

/** Another page a relationship field names: its title, and its address where it has one. */
export interface RelatedPage {
  name: string;
  url?: string;
}

/**
 * The pages relationship fields name, by {@link relatedKey}, as the caller
 * read them: a copy is written synchronously, and a page's address is not.
 */
export type RelatedPages = ReadonlyMap<string, RelatedPage>;

/** The key a page a relationship field names is found under in {@link RelatedPages}. */
export const relatedKey = (collection: string, id: unknown): string =>
  `${collection}\u0000${String(id)}`;

/** What the copy's front matter says of the page. */
export interface CopyAbout {
  /** The title the page's head carries. */
  title?: string;
  description?: string;
  /** The page's own address, absolute. */
  url: string;
  /** When the published page last changed, as ISO 8601. */
  lastUpdated?: string;
}

/** What a copy is made from. */
export interface CopySource {
  /** The page's title, the copy's heading. */
  title?: string;
  /**
   * The field the title was read from, left out below the heading so it is
   * said once; none where the title is not one of the page's fields.
   */
  titleField?: string;
  /** The published page, as a visitor is served it. */
  document: Readonly<Record<string, unknown>>;
  /** The fields its type declares; where unknown, only its rich text is read. */
  fields?: readonly CopyField[];
  /** The page's address, absolute, which addresses in the copy are made whole against. */
  base?: string;
  /** What the front matter says of the page; none without it. */
  about?: CopyAbout;
  /**
   * Top-level fields left out besides the address, SEO and bookkeeping,
   * such as a Single's own name, which Nextly keeps and the page never shows.
   */
  skip?: readonly string[];
  /** The pages its relationship fields name, as the caller read them. */
  related?: RelatedPages;
}

/** Fields that are the page's address, SEO or bookkeeping, never its words. */
const NOT_CONTENT: ReadonlySet<string> = new Set([
  "id",
  "slug",
  "seo",
  "status",
  "createdAt",
  "updatedAt",
  "_status",
]);

/** `text` on one line, its line breaks and runs of space made one space. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** How deep into nested content a copy goes before it stops. */
const MAX_DEPTH = 32;

/** A rich text node, as stored. */
type Node = Record<string, unknown>;

const childrenOf = (node: Node): Node[] =>
  Array.isArray(node.children) ? node.children.filter(isRecord) : [];

/**
 * The page's address, which a link or an image written from the site's root
 * is made whole against while a copy is written. Set only for the length of
 * one synchronous write, so no copy reads another's.
 */
let writingFor: string | undefined;

/** `url` made whole against the page being written, where it can be. */
function wholeAddress(url: string): string {
  if (writingFor === undefined) return url;
  try {
    return new URL(url, writingFor).href;
  } catch {
    return url;
  }
}

/** Rich text's format bits a reader sees, as Lexical stores them. */
const BOLD = 1;
const ITALIC = 2;
const STRIKETHROUGH = 4;
const CODE = 16;

/** Inline code, fenced with more backticks than it holds, as Markdown spells it. */
export function inlineCode(code: string): string {
  const longest = Math.max(
    0,
    ...(code.match(/`+/g) ?? []).map(run => run.length)
  );
  const fence = "`".repeat(longest + 1);
  // A space keeps a backtick at either end from joining the fence.
  const padded = /^`|`$/.test(code) ? ` ${code} ` : code;
  return `${fence}${padded}${fence}`;
}

/** A text node's words, with the emphasis and code a reader sees in it. */
function styledText(node: Node, text: string): string {
  const format = typeof node.format === "number" ? node.format : 0;
  if ((format & CODE) !== 0) return inlineCode(text);
  if (text.trim() === "") return escapeText(text);
  // Markers hug the words: Markdown reads none around a space.
  const [, lead = "", words = "", trail = ""] =
    /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];
  let styled = escapeText(words);
  // Asterisks, not underscores: Markdown reads them inside a word too.
  if ((format & ITALIC) !== 0) styled = `*${styled}*`;
  if ((format & BOLD) !== 0) styled = `**${styled}**`;
  if ((format & STRIKETHROUGH) !== 0) styled = `~~${styled}~~`;
  return `${lead}${styled}${trail}`;
}

/** The words of `nodes` on one line: text, line breaks and links. */
function inline(nodes: readonly Node[]): string {
  return nodes
    .map(node => {
      if (node.type === "linebreak") return "\n";
      // An address the author unlinked is read below as its words.
      if (isFollowedLink(node)) {
        const words = inline(childrenOf(node));
        const url = textOf(node.url);
        return url === undefined
          ? words
          : `[${words}](${linkAddress(wholeAddress(url))})`;
      }
      if (typeof node.text === "string") return styledText(node, node.text);
      return inline(childrenOf(node));
    })
    .join("");
}

/** The words of `nodes` as written, for code, where nothing is Markdown. */
function rawInline(nodes: readonly Node[]): string {
  return nodes
    .map(node => {
      if (node.type === "linebreak") return "\n";
      if (typeof node.text === "string") return node.text;
      return rawInline(childrenOf(node));
    })
    .join("");
}

/**
 * `text` as Markdown reads it back: every character Markdown or HTML would
 * take as markup escaped, and the start of each line that would begin a
 * heading, a quote or a list, so the copy says the words the page shows.
 */
function escapeText(text: string): string {
  return text
    .replace(/[\\`*_[\]()<>|&]/g, "\\$&")
    .split("\n")
    .map(escapedLineStart)
    .join("\n");
}

/**
 * `line`, the start of a line of Markdown, with what would begin a
 * heading or a list there escaped, so it reads as the words it is.
 */
export function escapedLineStart(line: string): string {
  return line
    .replace(/^(\s*)(#|[-+])/, "$1\\$2")
    .replace(/^(\s*\d+)([.)])/, "$1\\$2");
}

/**
 * A link's address, its parentheses and white space percent-encoded, so an
 * address holding one is linked whole rather than cut short.
 */
export function linkAddress(url: string): string {
  return url.replace(
    /[()\s]/g,
    char => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
  );
}

/** `text` with each line begun by `prefix`. */
const prefixed = (text: string, prefix: string): string =>
  text
    .split("\n")
    .map(line => `${prefix}${line}`)
    .join("\n");

/** A list, its nested lists indented beneath the item holding them. */
function list(node: Node): string {
  const numbered = node.listType === "number";
  const start = typeof node.start === "number" ? node.start : 1;
  return childrenOf(node)
    .map((item, at) => {
      const marker = numbered ? `${start + at}.` : "-";
      const own = childrenOf(item).filter(child => child.type !== "list");
      const nested = childrenOf(item)
        .filter(child => child.type === "list")
        // Indented past the marker and its space, so it stays in this item.
        .map(child => prefixed(list(child), " ".repeat(marker.length + 1)));
      return [`${marker} ${inline(own)}`, ...nested].join("\n");
    })
    .join("\n");
}

/**
 * A table cell's words on one line, every pipe escaped: a table reads a
 * pipe as the end of its cell even inside code, so code's `A | B` is
 * written `A \| B`, which a table reads back as the pipe.
 */
const cellOf = (cell: Node): string =>
  blocks(childrenOf(cell), 0)
    .replace(/\n+/g, " ")
    .replace(/(?<!\\)\|/g, "\\|");

/** A table, its first row as the header. */
function table(node: Node): string {
  const rows = childrenOf(node).map(
    row => `| ${childrenOf(row).map(cellOf).join(" | ")} |`
  );
  const [header, ...rest] = rows;
  if (header === undefined) return "";
  const columns = childrenOf(childrenOf(node)[0] ?? {}).length;
  const rule = `|${" --- |".repeat(columns)}`;
  return [header, rule, ...rest].join("\n");
}

/** An image: its alt text and address, and its caption beneath. */
function image(node: Node): string {
  const src = textOf(node.src);
  if (src === undefined) return "";
  const alt = escapeText(textOf(node.altText) ?? textOf(node.alt) ?? "");
  const caption = textOf(node.caption);
  const drawn = `![${alt}](${linkAddress(wholeAddress(src))})`;
  return caption === undefined ? drawn : `${drawn}\n${escapeText(caption)}`;
}

/** A link a button draws, as text and address. */
function button(value: Record<string, unknown>): string {
  const words = textOf(value.text);
  const url = textOf(value.url);
  if (words === undefined) return "";
  return url === undefined
    ? escapeText(words)
    : `[${escapeText(words)}](${linkAddress(wholeAddress(url))})`;
}

/** Each item of a node's list (`images`, `buttons`), drawn by `draw`. */
function itemsOf(
  value: unknown,
  draw: (item: Record<string, unknown>) => string,
  between: string
): string {
  return (Array.isArray(value) ? value : [])
    .filter(isRecord)
    .map(draw)
    .filter(line => line !== "")
    .join(between);
}

/**
 * A code block, as written, fenced with more backticks than any run inside
 * it, so a fence the code holds stays part of the code.
 */
function codeBlock(node: Node): string {
  return fencedCode(rawInline(childrenOf(node)), textOf(node.language) ?? "");
}

/**
 * `code` as a fenced block, its fence longer than any run of backticks
 * inside it, so a fence the code holds stays part of the code; `info`, the
 * language, follows the opening fence.
 */
export function fencedCode(code: string, info = ""): string {
  const longest = Math.max(
    0,
    ...(code.match(/`+/g) ?? []).map(run => run.length)
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${info}\n${code}\n${fence}`;
}

/** Text that shows no words is nothing; anything else is `drawn` from it. */
const unlessBlank = (words: string, drawn: string): string =>
  words.trim() === "" ? "" : drawn;

/** How each kind of rich text block is written, by its node type. */
const BLOCK_WRITERS: Readonly<Record<string, (node: Node) => string>> = {
  heading: node => {
    const level = /^h([1-6])$/.exec(String(node.tag))?.[1] ?? "2";
    const words = inline(childrenOf(node));
    return unlessBlank(words, `${"#".repeat(Number(level))} ${words}`);
  },
  quote: node => {
    const words = inline(childrenOf(node));
    return unlessBlank(words, prefixed(words, "> "));
  },
  list,
  code: codeBlock,
  horizontalrule: () => "---",
  image,
  gallery: node => {
    const images = itemsOf(node.images, image, "\n");
    const caption = textOf(node.caption);
    return caption === undefined
      ? images
      : [images, escapeText(caption)].filter(part => part !== "").join("\n");
  },
  // A video shows its caption beneath it; the video itself has no words.
  video: node => {
    const caption = textOf(node.caption);
    return caption === undefined ? "" : escapeText(caption);
  },
  "button-link": button,
  "button-group": node => itemsOf(node.buttons, button, " "),
  table,
  paragraph: node => inline(childrenOf(node)),
};

/** One block of rich text as Markdown; empty where it shows no words. */
function block(node: Node, depth: number): string {
  if (depth > MAX_DEPTH) return "";
  const write =
    typeof node.type === "string" ? BLOCK_WRITERS[node.type] : undefined;
  if (write !== undefined) return write(node);
  // A container (a collapsible section, say) shows its children's words; a
  // node of a kind not known here shows its own text, if any.
  const children = childrenOf(node);
  if (children.some(child => typeof child.text !== "string")) {
    return blocks(children, depth + 1);
  }
  return inline(children.length > 0 ? children : [node]);
}

/** Blocks of rich text, each its own paragraph of Markdown. */
function blocks(nodes: readonly Node[], depth: number): string {
  return nodes
    .map(node => block(node, depth))
    .filter(part => part.trim() !== "")
    .join("\n\n");
}

/** Whether `value` is a stored rich text value. */
function isRichText(value: unknown): value is { root: Node } {
  return isRecord(value) && isRecord(value.root);
}

/**
 * `write`'s answer with addresses made whole against `base`, where given,
 * and as written otherwise.
 */
function writtenFor<T>(base: string | undefined, write: () => T): T {
  const outer = writingFor;
  writingFor = base ?? outer;
  try {
    return write();
  } finally {
    writingFor = outer;
  }
}

/**
 * A rich text value as Markdown, or nothing where `value` is not rich text
 * or shows no words. Where `base`, the page's address, is given, a link or
 * an image written from the site's root is made whole against it.
 */
export function markdownOfRichText(value: unknown, base?: string): string {
  if (!isRichText(value)) return "";
  return writtenFor(base, () => blocks(childrenOf(value.root), 0));
}

/**
 * Another document read with the page, told by the stamps every stored
 * document carries: what it holds is that document's, not this page's.
 */
function isOtherDocument(value: Record<string, unknown>): boolean {
  return (
    value.id !== undefined &&
    (value.createdAt !== undefined || value.updatedAt !== undefined)
  );
}

/** Where a field's words are collected, how deep it is, and what to skip. */
interface Collecting {
  parts: string[];
  depth: number;
  /** The top-level field the heading was taken from, said once already. */
  titleField?: string;
  /** Top-level fields left out besides those never content. */
  skip?: ReadonlySet<string>;
  /** The pages relationship fields name. */
  related?: RelatedPages;
}

/** Collects the words of a value held by one kind of field. */
type FieldReader = (field: CopyField, value: unknown, at: Collecting) => void;

/** The next level down from `at`. */
const deeper = (at: Collecting): Collecting => ({
  parts: at.parts,
  depth: at.depth + 1,
  ...(at.related === undefined ? {} : { related: at.related }),
});

/** Elements whose content is never words a reader sees: a drawing, code, styles. */
const WORDLESS_ELEMENTS =
  /<(svg|script|style|template)\b[^>]*\/>|<(svg|script|style|template)\b[\s\S]*?<\/\2\s*>/gi;

/** A tag, or a comment: what markup is made of. */
const MARKUP_TAG =
  /<!--[\s\S]*?-->|<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/g;

/** Where markup breaks a line: a line break, or the end of a block. */
const MARKUP_BREAK =
  /<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr|blockquote|section|article)\s*>/gi;

/** The character references a page's text commonly carries, by name. */
const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
  middot: "·",
};

/**
 * `text` with its character references read as the characters they name:
 * the one reading of them for a stored value holding markup and for a
 * rendered page alike, so both give the same words for the same HTML.
 */
export function decodedEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,
    (whole, ref: string) => {
      if (!ref.startsWith("#")) return NAMED[ref.toLowerCase()] ?? whole;
      const point =
        ref[1]?.toLowerCase() === "x"
          ? Number.parseInt(ref.slice(2), 16)
          : Number.parseInt(ref.slice(1), 10);
      return Number.isInteger(point) && point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : whole;
    }
  );
}

/**
 * The words `text` shows: where it holds markup (a site that renders a
 * field as HTML, to colour a word say), its tags taken out and the words
 * inside them kept, a drawing or a script inside it dropped whole, and its
 * entities read as the characters they spell. Text with no markup is
 * returned as it is, so `a < b` and `&` typed as words stay words.
 */
function wordsOfMarkup(text: string): string {
  if (!/<[a-zA-Z!/]/.test(text)) return text;
  const stripped = text
    .replace(WORDLESS_ELEMENTS, "")
    .replace(MARKUP_BREAK, "\n")
    .replace(MARKUP_TAG, "");
  return decodedEntities(stripped);
}

/** Whether a value is a drawing in SVG, which holds no words. */
const isSvgMarkup = (text: string): boolean => /^\s*<svg[\s>]/i.test(text);

/**
 * The title `text` names a page by: the words its markup shows, on one
 * line; none where nothing is left. The one reading of a title for the
 * outputs that name pages, so each names a page alike.
 */
export function plainTitle(text: string | undefined): string | undefined {
  if (text === undefined || isSvgMarkup(text)) return undefined;
  const words = wordsOfMarkup(text).replace(/\s+/g, " ").trim();
  return words === "" ? undefined : words;
}

/** What a field is called beside a fact it holds: its label, else its name in words. */
function labelOf(field: CopyField): string {
  const label = textOf(field.label);
  if (label !== undefined) return escapeText(oneLine(label));
  return escapeText(humanizeFieldName(field.name ?? ""));
}

/**
 * An address written as text, a web or mail address, which a copy writes
 * as a link a reader can follow.
 */
const ADDRESS =
  /^(?:https?:\/\/\S+|mailto:\S+|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/i;

/**
 * Text or long text: its words, as written; each of them, where it holds
 * several. Markup in it is written as the words it shows, a value that is
 * a drawing in SVG is left out, and one that is only an address is written
 * beside the field's label, as `Label: <url>`.
 */
const wordsField: FieldReader = (field, value, at) => {
  for (const each of Array.isArray(value) ? value : [value]) {
    const raw = textOf(each);
    if (raw === undefined || isSvgMarkup(raw)) continue;
    const words = wordsOfMarkup(raw).trim();
    if (words === "") continue;
    at.parts.push(
      ADDRESS.test(words) ? `${labelOf(field)}: <${words}>` : escapeText(words)
    );
  }
};

/** The values a field holds: each of a list, or the one value. */
const valuesOf = (value: unknown): unknown[] =>
  Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];

/** The label a choice field shows for the stored `value`, else the value itself. */
function optionLabel(field: CopyField, value: unknown): string | undefined {
  const stored = typeof value === "number" ? String(value) : textOf(value);
  if (stored === undefined) return undefined;
  const options = Array.isArray(field.options) ? field.options : [];
  for (const option of options) {
    if (option === stored) return stored;
    if (!isRecord(option)) continue;
    const optionValue =
      typeof option.value === "number" ? String(option.value) : option.value;
    if (optionValue === stored) return textOf(option.label) ?? stored;
  }
  return stored;
}

/** A select or radio: `Label: option label`, the label the page shows, never the stored value. */
const choiceField: FieldReader = (field, value, at) => {
  const labels = valuesOf(value)
    .map(each => optionLabel(field, each))
    .filter((label): label is string => label !== undefined);
  if (labels.length === 0) return;
  at.parts.push(
    `${labelOf(field)}: ${labels.map(label => escapeText(oneLine(label))).join(", ")}`
  );
};

/** A checkbox: `Label: yes` where it is ticked; nothing where it is not. */
const checkboxField: FieldReader = (field, value, at) => {
  if (value === true) at.parts.push(`${labelOf(field)}: yes`);
};

/** Chips: a list of their words under the field's label. */
const chipsField: FieldReader = (field, value, at) => {
  const chips = valuesOf(value)
    .map(each => textOf(each))
    .filter((chip): chip is string => chip !== undefined)
    .map(chip => `- ${escapeText(oneLine(wordsOfMarkup(chip)))}`);
  if (chips.length > 0)
    at.parts.push(`${labelOf(field)}:\n\n${chips.join("\n")}`);
};

/**
 * The page a relationship value names, as read with this page: its type and
 * stored document, or none where only its id was read.
 */
function relatedDocument(
  field: CopyField,
  value: unknown
): { collection: string; document: Record<string, unknown> } | undefined {
  // A field naming several types stores which one beside the page.
  if (isRecord(value) && typeof value.relationTo === "string") {
    return isRecord(value.value)
      ? { collection: value.relationTo, document: value.value }
      : undefined;
  }
  const collection = textOf(field.relationTo);
  return collection !== undefined && isRecord(value)
    ? { collection, document: value }
    : undefined;
}

/**
 * Every page a relationship field of `document` names that was read with
 * it, at any depth of its groups and repeaters, in the order the copy
 * writes them: what a caller reads the names and addresses of before the
 * copy is written ({@link RelatedPages}).
 */
export function relatedDocumentsIn(
  fields: readonly CopyField[],
  document: Readonly<Record<string, unknown>>,
  depth = 0
): { collection: string; document: Record<string, unknown> }[] {
  if (depth > MAX_DEPTH) return [];
  return fields.flatMap(field => {
    if (field.name === undefined || NOT_CONTENT.has(field.name)) return [];
    const value = document[field.name];
    if (field.type === "relationship") {
      return valuesOf(value).flatMap(
        each => relatedDocument(field, each) ?? []
      );
    }
    const rows =
      field.type === "group"
        ? [value]
        : field.type === "repeater"
          ? valuesOf(value)
          : [];
    return rows.flatMap(row =>
      isRecord(row)
        ? relatedDocumentsIn(field.fields ?? [], row, depth + 1)
        : []
    );
  });
}

/**
 * A relationship: `Label: title` for each page it names that was read with
 * this one, linked where that page has an address. A page named by its id
 * alone, one the public may not read, shows nothing.
 */
const relationshipField: FieldReader = (field, value, at) => {
  const named = valuesOf(value).flatMap(each => {
    const found = relatedDocument(field, each);
    if (found === undefined) return [];
    const page = at.related?.get(
      relatedKey(found.collection, found.document.id)
    );
    if (page === undefined) return [];
    const name = escapeText(oneLine(page.name));
    return [
      page.url === undefined
        ? name
        : `[${name}](${linkAddress(wholeAddress(page.url))})`,
    ];
  });
  if (named.length > 0) at.parts.push(`${labelOf(field)}: ${named.join(", ")}`);
};

/** Rich text: its blocks, as Markdown. */
const richTextField: FieldReader = (_field, value, at) => {
  const markdown = markdownOfRichText(value);
  if (markdown !== "") at.parts.push(markdown);
};

/** A group: its own fields, from the values nested under its name. */
const groupField: FieldReader = (field, value, at) => {
  if (isRecord(value)) fieldsWords(field.fields ?? [], value, deeper(at));
};

/** A repeater: each row's fields, in order. */
const repeaterField: FieldReader = (field, value, at) => {
  for (const item of Array.isArray(value) ? value : []) {
    if (isRecord(item)) fieldsWords(field.fields ?? [], item, deeper(at));
  }
};

/**
 * A field group (formerly a component), whose fields are declared with the
 * group rather than on the type: its rich text, wherever it holds some.
 */
const fieldGroupField: FieldReader = (_field, value, at) => {
  richTextWords(value, at.parts, at.depth + 1);
};

/**
 * Whether an image is drawn in SVG, told by its type or else its file's
 * name: a drawing, such as a logo or an icon, holds no words a copy can say.
 */
function isSvgImage(src: string, type: string | undefined): boolean {
  if (type !== undefined) return type.toLowerCase().startsWith("image/svg");
  return /\.svgz?(?:[?#]|$)/i.test(src);
}

/**
 * A picture field: each image it holds, with its alt text, as the page
 * shows it. A file that is not an image, a drawing in SVG, or a media item
 * not read with the page (an id alone), shows nothing.
 */
const uploadField: FieldReader = (_field, value, at) => {
  for (const each of Array.isArray(value) ? value : [value]) {
    if (!isRecord(each)) continue;
    const src = textOf(each.url);
    const type = textOf(each.mimeType);
    if (
      src === undefined ||
      (type !== undefined && !type.startsWith("image/")) ||
      isSvgImage(src, type)
    ) {
      continue;
    }
    const alt = textOf(each.alt) ?? textOf(each.altText) ?? "";
    at.parts.push(`![${escapeText(alt)}](${linkAddress(wholeAddress(src))})`);
  }
};

/**
 * The field types whose value a visitor reads, and how each is read. Every
 * other type (a number, a date, code, JSON, a file that is not a picture)
 * shows no words of its own and is left out.
 */
const FIELD_READERS: Readonly<Record<string, FieldReader>> = {
  text: wordsField,
  textarea: wordsField,
  email: wordsField,
  richText: richTextField,
  upload: uploadField,
  group: groupField,
  repeater: repeaterField,
  fieldGroup: fieldGroupField,
  component: fieldGroupField,
  select: choiceField,
  radio: choiceField,
  checkbox: checkboxField,
  chips: chipsField,
  relationship: relationshipField,
};

/** The words of each of `fields` in `document`, in their order. */
function fieldsWords(
  fields: readonly CopyField[],
  document: Readonly<Record<string, unknown>>,
  at: Collecting
): void {
  if (at.depth > MAX_DEPTH) return;
  for (const field of fields) {
    const read = FIELD_READERS[field.type];
    if (read === undefined || field.name === undefined) continue;
    if (NOT_CONTENT.has(field.name)) continue;
    if (at.depth === 0 && field.name === at.titleField) continue;
    if (at.depth === 0 && at.skip?.has(field.name) === true) continue;
    read(field, document[field.name], at);
  }
}

/** Every rich text value in `value`, at any depth, into `parts`. */
function richTextWords(value: unknown, parts: string[], depth: number): void {
  if (depth > MAX_DEPTH) return;
  if (isRichText(value)) {
    const markdown = markdownOfRichText(value);
    if (markdown !== "") parts.push(markdown);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) richTextWords(item, parts, depth + 1);
    return;
  }
  if (isRecord(value) && !isOtherDocument(value)) {
    for (const child of Object.values(value)) {
      richTextWords(child, parts, depth + 1);
    }
  }
}

/** One line of front matter, its text quoted as YAML reads JSON's strings. */
const quoted = (value: string): string => JSON.stringify(oneLine(value));

/**
 * The front matter naming the page: its title and description as quoted
 * text, its address and when it last changed, each where known.
 */
function frontMatterOf(about: CopyAbout): string {
  const title = textOf(about.title);
  const description = textOf(about.description);
  return [
    "---",
    ...(title === undefined ? [] : [`title: ${quoted(title)}`]),
    ...(description === undefined
      ? []
      : [`description: ${quoted(description)}`]),
    `url: ${about.url}`,
    ...(about.lastUpdated === undefined
      ? []
      : [`last_updated: ${about.lastUpdated}`]),
    "---",
  ].join("\n");
}

/** A page's plain-text copy, as Markdown, ending in a newline. */
export function plainCopyOf(source: CopySource): string {
  const parts: string[] = [];
  const title = plainTitle(source.title);
  if (title !== undefined) parts.push(`# ${escapeText(title)}`);
  writtenFor(source.base ?? source.about?.url, () => {
    if (source.fields === undefined) {
      for (const [name, value] of Object.entries(source.document)) {
        if (NOT_CONTENT.has(name) || source.skip?.includes(name) === true) {
          continue;
        }
        richTextWords(value, parts, 0);
      }
    } else {
      fieldsWords(source.fields, source.document, {
        parts,
        depth: 0,
        ...(source.titleField === undefined
          ? {}
          : { titleField: source.titleField }),
        ...(source.skip === undefined ? {} : { skip: new Set(source.skip) }),
        ...(source.related === undefined ? {} : { related: source.related }),
      });
    }
  });
  const body = `${parts.join("\n\n")}\n`;
  return source.about === undefined
    ? body
    : withFrontMatter(source.about, body);
}

/**
 * The copy of a page whose words could not be read: its name as the
 * heading, and its description, what its head tells a reader it holds, so
 * no copy and no page of llms-full.txt is a bare heading. Ends in a newline.
 */
export function descriptionCopyOf(
  title: string | undefined,
  description: string | undefined
): string {
  const heading = plainTitle(title);
  const words =
    description === undefined ? undefined : textOf(oneLine(description));
  return `${[
    ...(heading === undefined ? [] : [`# ${escapeText(heading)}`]),
    ...(words === undefined ? [] : [escapeText(words)]),
  ].join("\n\n")}\n`;
}

/** `body`, a copy's Markdown, begun by front matter naming its page. */
export function withFrontMatter(about: CopyAbout, body: string): string {
  return `${frontMatterOf(about)}\n\n${body.trim()}\n`;
}

/**
 * The names a copy of a page whose address ends in a slash is served at:
 * `index.md`, the one linked, and `index.html.md`, which the llms.txt
 * proposal named first and readers may still ask for.
 */
const INDEX_COPIES = ["index.md", "index.html.md"] as const;

/**
 * Every path the plain-text copy of the page at `address` is served at, the
 * one linked first: the page's path with `.md` added, or, where it ends in a
 * slash, `index.md` and `index.html.md` added. A query or fragment is not
 * part of it.
 */
export function copyPathsOf(address: string): string[] {
  const { pathname } = new URL(address);
  return pathname.endsWith("/")
    ? INDEX_COPIES.map(name => `${pathname}${name}`)
    : [`${pathname}.md`];
}

/**
 * Where the plain-text copy of the page at `address` is linked: the page's
 * address with `.md` added, or `index.md` where it ends in a slash. A query
 * or fragment is not part of it.
 */
export function copyAddressOf(address: string): string {
  const url = new URL(address);
  url.search = "";
  url.hash = "";
  url.pathname = copyPathsOf(address)[0] ?? `${url.pathname}.md`;
  return url.href;
}

/**
 * The page addresses a request for `path` may ask for a copy of, in the
 * order they are tried: the address the copy's name says literally (`/a.md`
 * for `/a`, `/index.md` for `/index`), then, for `index.md` and
 * `index.html.md`, the folder's own page (`/` or `/docs/`), whose copy has
 * that name too. None where `path` is not a copy's address.
 */
export function pagesOfCopy(path: string): string[] {
  if (!path.endsWith(".md")) return [];
  const literal = path.slice(0, -".md".length);
  const pages = literal === "" || literal.endsWith("/") ? [] : [literal];
  const index = INDEX_COPIES.find(name => path.endsWith(`/${name}`));
  if (index !== undefined) pages.push(path.slice(0, -index.length));
  return pages;
}
