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
 * so a link read away from the site still leads somewhere. What a visitor
 * never reads stays out: the page's SEO, its address, its bookkeeping,
 * fields holding a choice, a number or a date, and other documents read with
 * it, such as an author.
 *
 * A copy is served beside its page, at the page's address with `.md` added
 * (`index.md` where the address ends in a slash, and `index.html.md` there
 * too), as the llms.txt proposal describes.
 *
 * @module outputs/plain-copy
 */
import { isRecord, textOf } from "../plain-values";

/** A field as the type declares it, as far as a copy needs it. */
export interface CopyField {
  name?: string;
  type: string;
  fields?: readonly CopyField[];
}

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
function inlineCode(code: string): string {
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
  if ((format & ITALIC) !== 0) styled = `_${styled}_`;
  if ((format & BOLD) !== 0) styled = `**${styled}**`;
  if ((format & STRIKETHROUGH) !== 0) styled = `~~${styled}~~`;
  return `${lead}${styled}${trail}`;
}

/** The words of `nodes` on one line: text, line breaks and links. */
function inline(nodes: readonly Node[]): string {
  return nodes
    .map(node => {
      if (node.type === "linebreak") return "\n";
      if (node.type === "link" || node.type === "autolink") {
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
    .map(line =>
      line
        .replace(/^(\s*)(#|[-+])/, "$1\\$2")
        .replace(/^(\s*\d+)([.)])/, "$1\\$2")
    )
    .join("\n");
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
  const code = rawInline(childrenOf(node));
  const longest = Math.max(
    0,
    ...(code.match(/`+/g) ?? []).map(run => run.length)
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${textOf(node.language) ?? ""}\n${code}\n${fence}`;
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
}

/** Collects the words of a value held by one kind of field. */
type FieldReader = (field: CopyField, value: unknown, at: Collecting) => void;

/** The next level down from `at`. */
const deeper = (at: Collecting): Collecting => ({
  parts: at.parts,
  depth: at.depth + 1,
});

/** Text or long text: its words, as written; each of them, where it holds several. */
const wordsField: FieldReader = (_field, value, at) => {
  for (const each of Array.isArray(value) ? value : [value]) {
    const words = textOf(each);
    if (words !== undefined) at.parts.push(escapeText(words.trim()));
  }
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
 * A picture field: each image it holds, with its alt text, as the page
 * shows it. A file that is not an image, or a media item not read with the
 * page (an id alone), shows nothing.
 */
const uploadField: FieldReader = (_field, value, at) => {
  for (const each of Array.isArray(value) ? value : [value]) {
    if (!isRecord(each)) continue;
    const src = textOf(each.url);
    const type = textOf(each.mimeType);
    if (
      src === undefined ||
      (type !== undefined && !type.startsWith("image/"))
    ) {
      continue;
    }
    const alt = textOf(each.alt) ?? textOf(each.altText) ?? "";
    at.parts.push(`![${escapeText(alt)}](${linkAddress(wholeAddress(src))})`);
  }
};

/**
 * The field types whose value a visitor reads, and how each is read. Every
 * other type (a choice, a number, a date, a relation, a file that is not a
 * picture, JSON) shows no words of its own and is left out.
 */
const FIELD_READERS: Readonly<Record<string, FieldReader>> = {
  text: wordsField,
  textarea: wordsField,
  richText: richTextField,
  upload: uploadField,
  group: groupField,
  repeater: repeaterField,
  fieldGroup: fieldGroupField,
  component: fieldGroupField,
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

/** `text` on one line, its line breaks and runs of space made one space. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

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
  const title = textOf(source.title)?.trim();
  if (title !== undefined) parts.push(`# ${escapeText(title)}`);
  writtenFor(source.base ?? source.about?.url, () => {
    if (source.fields === undefined) {
      for (const [name, value] of Object.entries(source.document)) {
        if (!NOT_CONTENT.has(name)) richTextWords(value, parts, 0);
      }
    } else {
      fieldsWords(source.fields, source.document, {
        parts,
        depth: 0,
        ...(source.titleField === undefined
          ? {}
          : { titleField: source.titleField }),
      });
    }
  });
  const body = `${parts.join("\n\n")}\n`;
  return source.about === undefined
    ? body
    : `${frontMatterOf(source.about)}\n\n${body}`;
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
