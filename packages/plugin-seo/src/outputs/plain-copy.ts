/**
 * A page's plain-text copy: the words its content shows, written as Markdown,
 * for AI tools that read text rather than a rendered page. Made from the page
 * as stored, the same fields the site renders, and the same for every reader:
 * nothing here asks who is reading.
 *
 * The copy is the page's title as a heading, then the words of each content
 * field in the order its type declares them. Rich text keeps its structure
 * (headings, lists, links, quotes, code, tables, images); the inline styling
 * a reader sees as emphasis is left out, as plain text has none. What a
 * visitor never reads stays out: the page's SEO, its address, its
 * bookkeeping, fields holding a choice, a number or a date, and other
 * documents read with it, such as an author.
 *
 * A copy is served beside its page, at the page's address with `.md` added
 * (`index.html.md` where the address ends in a slash), as the llms.txt
 * proposal describes.
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

/** The words of `nodes` on one line: text, line breaks and links. */
function inline(nodes: readonly Node[]): string {
  return nodes
    .map(node => {
      if (node.type === "linebreak") return "\n";
      if (node.type === "link" || node.type === "autolink") {
        const words = inline(childrenOf(node));
        const url = textOf(node.url);
        return url === undefined ? words : `[${words}](${linkAddress(url)})`;
      }
      if (typeof node.text === "string") return escapeText(node.text);
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
        .map(child => prefixed(list(child), "  "));
      return [`${marker} ${inline(own)}`, ...nested].join("\n");
    })
    .join("\n");
}

/** A table, its first row as the header. */
function table(node: Node): string {
  const rows = childrenOf(node).map(
    row =>
      `| ${childrenOf(row)
        .map(cell => blocks(childrenOf(cell), 0).replace(/\n+/g, " "))
        .join(" | ")} |`
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
  const drawn = `![${alt}](${linkAddress(src)})`;
  return caption === undefined ? drawn : `${drawn}\n${escapeText(caption)}`;
}

/** A link a button draws, as text and address. */
function button(value: Record<string, unknown>): string {
  const words = textOf(value.text);
  const url = textOf(value.url);
  if (words === undefined) return "";
  return url === undefined
    ? escapeText(words)
    : `[${escapeText(words)}](${linkAddress(url)})`;
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
  gallery: node => itemsOf(node.images, image, "\n"),
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
 * A rich text value as Markdown, or nothing where `value` is not rich text
 * or shows no words.
 */
export function markdownOfRichText(value: unknown): string {
  if (!isRichText(value)) return "";
  return blocks(childrenOf(value.root), 0);
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

/** Text or long text: its words, as written. */
const wordsField: FieldReader = (_field, value, at) => {
  const words = textOf(value);
  if (words !== undefined) at.parts.push(escapeText(words.trim()));
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
 * The field types whose value a visitor reads, and how each is read. Every
 * other type (a choice, a number, a date, a relation, a file, JSON) shows no
 * words of its own and is left out.
 */
const FIELD_READERS: Readonly<Record<string, FieldReader>> = {
  text: wordsField,
  textarea: wordsField,
  richText: richTextField,
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

/** A page's plain-text copy, as Markdown, ending in a newline. */
export function plainCopyOf(source: CopySource): string {
  const parts: string[] = [];
  const title = textOf(source.title)?.trim();
  if (title !== undefined) parts.push(`# ${escapeText(title)}`);
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
  return `${parts.join("\n\n")}\n`;
}

/** The suffix a copy of a page whose address ends in a slash is served at. */
const INDEX_COPY = "index.html.md";

/**
 * Where the plain-text copy of the page at `address` is served: the page's
 * address with `.md` added, or `index.html.md` where it ends in a slash. A
 * query or fragment is not part of it.
 */
export function copyAddressOf(address: string): string {
  const url = new URL(address);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.endsWith("/")
    ? `${url.pathname}${INDEX_COPY}`
    : `${url.pathname}.md`;
  return url.href;
}

/**
 * The page addresses a request for `path` may ask for a copy of, in the
 * order they are tried: the address the copy's name says literally (`/a.md`
 * for `/a`, `/index.html.md` for `/index.html`), then, for `index.html.md`,
 * the folder's own page (`/` or `/docs/`), whose copy has that name too.
 * None where `path` is not a copy's address.
 */
export function pagesOfCopy(path: string): string[] {
  if (!path.endsWith(".md")) return [];
  const literal = path.slice(0, -".md".length);
  const pages = literal === "" || literal.endsWith("/") ? [] : [literal];
  if (path.endsWith(`/${INDEX_COPY}`)) {
    pages.push(path.slice(0, -INDEX_COPY.length));
  }
  return pages;
}
