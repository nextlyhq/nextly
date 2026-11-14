/**
 * A page's plain-text copy made from the page as it is rendered: the words
 * of its `<main>`, written as Markdown. For a page with no stored document
 * of its own to read words from, such as a page built in the site's code or
 * a Page Builder layout, this is the only way to say what the page shows.
 *
 * It keeps what carries meaning: headings, paragraphs, lists, links, quotes,
 * code, tables, described images, and the emphasis a reader sees. Scripts,
 * styles, icons, forms, navigation, dialogs and anything hidden from every
 * reader (`hidden`, `aria-hidden="true"`) are left out. Where a page has no
 * `<main>`, its body is read without the header and footer every page shares.
 *
 * Small and dependency-free: it reads the HTML a site's own pages render,
 * which is well formed, and makes no attempt to be a general HTML parser.
 * Where it meets markup it cannot read, it keeps the words and drops the
 * markup, so a copy never says less than the words on the page.
 *
 * @module outputs/rendered-copy
 */
import { escapedLineStart, fencedCode, inlineCode } from "./plain-copy";

/** Elements that hold no content of their own and are never closed. */
const VOID: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Elements whose content is never words a reader reads. */
const SKIPPED: ReadonlySet<string> = new Set([
  "script",
  "style",
  "svg",
  "noscript",
  "template",
  "video",
  "audio",
  "iframe",
  "canvas",
  "form",
  "button",
  "select",
  "textarea",
  "nav",
  "dialog",
  "head",
]);

/**
 * Elements whose content is raw text, not markup: read to their own closing
 * tag, so a `"</div>"` in a script's source closes nothing. Each is also
 * left out of the copy.
 */
const RAW_TEXT: ReadonlySet<string> = new Set([
  "script",
  "style",
  "textarea",
  "iframe",
]);

/**
 * Where a fenced code block stands in the copy while it is written, so the
 * tidying of prose at the end never touches code; the character is never
 * in a page's words, which are kept without it.
 */
const CODE_MARK = "\u0000";

/** Elements that begin a block of their own. */
const BLOCKS: ReadonlySet<string> = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "aside",
  "figure",
  "figcaption",
  "dl",
  "dt",
  "dd",
  "details",
  "summary",
  "address",
  "main",
  "ul",
  "ol",
  "table",
  "blockquote",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

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

/** `text` with its character references read as the characters they name. */
function decoded(text: string): string {
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

/** An attribute's value in a tag's attribute text, decoded, or none. */
function attributeOf(attributes: string, name: string): string | undefined {
  const found = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i"
  ).exec(attributes);
  if (found === null) return undefined;
  return decoded(found[1] ?? found[2] ?? found[3] ?? "");
}

/** Whether a tag's attributes hide it from every reader. */
function hiddenBy(attributes: string): boolean {
  // The attribute itself, not a word inside a quoted value.
  const names = attributes.replace(/"[^"]*"|'[^']*'/g, '""');
  return (
    /(?:^|\s)hidden(?:\s|=|\/|$)/i.test(names) ||
    attributeOf(attributes, "aria-hidden")?.toLowerCase() === "true"
  );
}

/** `href` made whole against `base`, or as written where it cannot be. */
function whole(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

/**
 * An image's own address: the original of one Next.js serves resized
 * through `/_next/image`, else its `src`, made whole.
 */
function imageAddress(src: string, base: string): string {
  const url = whole(src, base);
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/_next/image")) {
      const original = parsed.searchParams.get("url");
      if (original !== null) return whole(original, base);
    }
  } catch {
    // Not an address a URL can read: kept as written.
  }
  return url;
}

/** An address as a Markdown link holds it whole: brackets and spaces encoded. */
const linkTarget = (url: string): string =>
  url.replace(
    /[()\s<>]/g,
    char => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
  );

/** Text with the characters Markdown would read as markup escaped. */
function escaped(text: string): string {
  return (
    text
      .replace(/[\\`*_[\]<>|]/g, "\\$&")
      // An ampersand only where it would begin a character reference.
      .replace(/&(?=#?[a-z0-9]+;)/gi, "\\&")
  );
}

/**
 * The longest outermost `<main>` of `html`, or nothing: a page that streams
 * its content can render an empty one first and the real one later.
 */
function longestMain(html: string, base: string): string {
  let best = "";
  let depth = 0;
  let start = -1;
  // Just past the candidate's opening tag, so its own `hidden` is judged.
  let opened = -1;
  for (const match of html.matchAll(/<(\/?)main(?=[\s>])[^>]*>/gi)) {
    if (match[1] === "") {
      if (depth === 0) {
        start = match.index;
        opened = match.index + match[0].length;
      }
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      const end = match.index + match[0].length;
      if (
        depth === 0 &&
        end - start > best.length &&
        !leftOutAt(html, opened, base)
      ) {
        best = html.slice(start, end);
      }
    }
  }
  return best;
}

/** The page's `<body>`, or all of `html` where it has none. */
const bodyOf = (html: string): string =>
  /<body[\s>][\s\S]*<\/body>/i.exec(html)?.[0] ?? html;

/**
 * The page's main content: its longest `<main>`, else its body, whose
 * shared header and footer are then left out.
 */
function mainOf(
  html: string,
  base: string
): { source: string; wholeBody: boolean } {
  const main = longestMain(html, base);
  return main === ""
    ? { source: bodyOf(html), wholeBody: true }
    : { source: main, wholeBody: false };
}

/** One element still open while the page is read. */
interface Open {
  tag: string;
  /** Whether its content is left out. */
  skip: boolean;
  /** Where its content begins in the copy so far. */
  start: number;
  href?: string;
  ordered?: boolean;
  /** Items in a list, or rows in a table, so far. */
  count?: number;
  /** A list item's marker width: how far its later blocks are indented. */
  indent?: number;
  /** A table row's cells so far. */
  cells?: number;
}

/** The emphasis each inline element draws, as Markdown marks it. */
const EMPHASIS: Readonly<Record<string, string>> = {
  strong: "**",
  b: "**",
  // Asterisks, not underscores: Markdown reads them inside a word too.
  em: "*",
  i: "*",
  s: "~~",
  del: "~~",
};

/**
 * `text` without emphasis marks that wrap all of it. Marks that open and
 * close two separate parts (`**a** and **b**`) wrap neither whole, so they
 * stay.
 */
function unwrapped(text: string): string {
  let words = text;
  for (;;) {
    const inner = /^(\*\*|\*|~~)([\s\S]*)\1$/.exec(words);
    const [, mark = "", rest = ""] = inner ?? [];
    if (inner === null || rest.trim() === "" || rest.includes(mark)) {
      return words;
    }
    words = rest.trim();
  }
}

/**
 * The copy as it is written, kept in pieces: adding to its end, and reading
 * or trimming its last characters, never reads the whole of it again. As
 * one string, every block's checks of how the copy ends would read it all,
 * so a page of many blocks took time growing with their square.
 */
class CopyText {
  private readonly pieces: string[] = [];
  length = 0;

  add(text: string): void {
    if (text === "") return;
    this.pieces.push(text);
    this.length += text.length;
  }

  /** Its last `count` characters, or all of it where it is shorter. */
  last(count: number): string {
    let tail = "";
    for (let at = this.pieces.length - 1; at >= 0; at -= 1) {
      if (tail.length >= count) break;
      const piece = this.pieces[at] ?? "";
      tail =
        piece.slice(Math.max(piece.length - (count - tail.length), 0)) + tail;
    }
    return tail;
  }

  endsWith(suffix: string): boolean {
    return this.last(suffix.length) === suffix;
  }

  /** Takes the spaces and tabs off its end. */
  trimEnd(): void {
    for (
      let piece = this.pieces.at(-1);
      piece !== undefined;
      piece = this.pieces.at(-1)
    ) {
      let end = piece.length;
      while (end > 0 && (piece[end - 1] === " " || piece[end - 1] === "\t")) {
        end -= 1;
      }
      if (end === piece.length) return;
      this.length -= piece.length - end;
      if (end > 0) {
        this.pieces[this.pieces.length - 1] = piece.slice(0, end);
        return;
      }
      this.pieces.pop();
    }
  }

  /** What it holds from `start` on: only those pieces are read. */
  from(start: number): string {
    const parts: string[] = [];
    let end = this.length;
    for (let at = this.pieces.length - 1; at >= 0 && end > start; at -= 1) {
      const piece = this.pieces[at] ?? "";
      const pieceStart = end - piece.length;
      parts.push(pieceStart >= start ? piece : piece.slice(start - pieceStart));
      end = pieceStart;
    }
    return parts.reverse().join("");
  }

  /** Cuts it back to its first `start` characters. */
  cut(start: number): void {
    for (
      let piece = this.pieces.pop();
      piece !== undefined;
      piece = this.pieces.pop()
    ) {
      const pieceStart = this.length - piece.length;
      this.length = pieceStart;
      if (pieceStart < start) {
        this.pieces.push(piece.slice(0, start - pieceStart));
        this.length = start;
      }
      if (this.length <= start) return;
    }
  }

  toString(): string {
    return this.pieces.join("");
  }
}

/** The writer of one page's copy, as its HTML is read. */
class CopyWriter {
  readonly copy = new CopyText();
  readonly stack: Open[] = [];
  /** The fenced code blocks, in order, each marked in the copy by its index. */
  readonly codes: string[] = [];

  private readonly base: string;
  private readonly wholeBody: boolean;

  constructor(base: string, wholeBody: boolean) {
    this.base = base;
    this.wholeBody = wholeBody;
  }

  skipping(): boolean {
    return this.stack.some(open => open.skip);
  }

  inside(tag: string): boolean {
    return this.stack.some(open => open.tag === tag);
  }

  /** Whether the row being read is its table's first, its header. */
  headerRow(): boolean {
    return (
      [...this.stack].reverse().find(open => open.tag === "tr")?.count === 0
    );
  }

  /** Whether `tag` is a list inside another list's item: no blank line around it. */
  nestedList(tag: string): boolean {
    return (tag === "ul" || tag === "ol") && this.lists().length > 0;
  }

  lists(): Open[] {
    return this.stack.filter(open => open.tag === "ul" || open.tag === "ol");
  }

  /** Ends the line, with no space left at its end. */
  newLine(): void {
    if (this.inCell()) {
      this.cellBreak();
      return;
    }
    this.copy.trimEnd();
    if (this.copy.length > 0 && !this.copy.endsWith("\n")) this.copy.add("\n");
  }

  /** Whether what is written now is in a table cell, on its row's line. */
  private inCell(): boolean {
    return this.inside("td") || this.inside("th");
  }

  /**
   * A break in a table cell: a space. A table row is one line, so a line
   * break, a block or a list item in a cell keeps the row whole.
   */
  private cellBreak(): void {
    if (!/[\s|]$/.test(this.copy.last(1))) this.copy.add(" ");
  }

  /** Starts a block: a blank line between it and what came before. */
  newBlock(): void {
    if (this.inside("table")) {
      // Between a table's rows and cells, the bars do the breaking.
      if (this.inCell()) this.cellBreak();
      return;
    }
    this.copy.trimEnd();
    if (this.copy.length === 0 || this.copy.endsWith("\n\n")) return;
    this.copy.add(this.copy.endsWith("\n") ? "\n" : "\n\n");
  }

  /** The words of a text run, as the copy holds them. */
  text(raw: string): void {
    if (this.skipping()) return;
    // Never a code block's mark, which only the writer places.
    const text = decoded(raw).replaceAll(CODE_MARK, "");
    if (this.inside("pre")) {
      this.copy.add(text);
      return;
    }
    const words = text.replace(/\s+/g, " ");
    if (words.trim() === "") {
      this.space();
      return;
    }
    this.copy.add(
      this.inside("code") ? this.leading(words) : this.prose(words)
    );
  }

  /** A space, where the copy does not already end in one or begin here. */
  private space(): void {
    if (this.copy.length > 0 && !/\s$/.test(this.copy.last(1))) {
      this.copy.add(" ");
    }
  }

  /** `words` without the space that would lead a line. */
  private leading(words: string): string {
    return this.atLineStart() ? words.trimStart() : words;
  }

  /**
   * `words` of prose, escaped: what Markdown would read as markup, and,
   * where they begin a line or a list item, a heading's or a list's mark.
   */
  private prose(words: string): string {
    const kept = this.leading(escaped(words));
    return this.atLineStart() || this.atItemStart()
      ? escapedLineStart(kept)
      : kept;
  }

  /** Whether the copy so far ends a line, so what follows begins one. */
  private atLineStart(): boolean {
    return this.copy.length === 0 || this.copy.endsWith("\n");
  }

  /** Whether an element is left out of the copy, with everything in it. */
  private leftOut(tag: string, attributes: string): boolean {
    return (
      SKIPPED.has(tag) ||
      hiddenBy(attributes) ||
      (this.wholeBody && (tag === "header" || tag === "footer"))
    );
  }

  open(tag: string, attributes: string): void {
    const skip = this.leftOut(tag, attributes);
    const shown = !skip && !this.skipping();
    // Written where shown, but code holds only text.
    const writes = shown && !this.inside("pre");
    if (VOID.has(tag)) {
      if (writes) this.empty(tag, attributes);
      // A line break drawn in code is one of the code's own lines.
      else if (shown && tag === "br") this.copy.add("\n");
      return;
    }
    const open: Open = { tag, skip, start: this.copy.length };
    if (writes) this.begin(open, attributes);
    this.stack.push(open);
  }

  /** What an element that holds nothing writes: a break, a rule or an image. */
  private empty(tag: string, attributes: string): void {
    if (tag === "br") {
      this.newLine();
    } else if (tag === "hr") {
      this.newBlock();
      this.copy.add("---");
      this.newBlock();
    } else if (tag === "img") {
      const alt = attributeOf(attributes, "alt")?.trim();
      const src = attributeOf(attributes, "src");
      // An image with no words for it is decoration, said nothing of.
      if (alt !== undefined && alt !== "" && src !== undefined) {
        this.copy.add(
          `![${escaped(alt)}](${linkTarget(imageAddress(src, this.base))})`
        );
      }
    }
  }

  /** What opening an element writes, and what it notes to close it by. */
  private begin(open: Open, attributes: string): void {
    const { tag } = open;
    if (this.nestedList(tag)) this.newLine();
    // A block that begins a list item stays on its marker's line.
    else if (BLOCKS.has(tag) && !this.atItemStart()) this.newBlock();
    this.beginnerFor(tag)?.(open, attributes);
    open.start = this.copy.length;
  }

  /** Whether nothing is written yet in the list item being read, past its marker. */
  private atItemStart(): boolean {
    const item = [...this.stack].reverse().find(open => open.tag === "li");
    return item !== undefined && this.copy.length === item.start;
  }

  /** What opening `tag` writes beyond its block's break, where it writes any. */
  private beginnerFor(
    tag: string
  ): ((open: Open, attributes: string) => void) | undefined {
    const beginners: Record<string, (open: Open, attributes: string) => void> =
      {
        li: open => this.beginItem(open),
        ol: (open, attributes) => this.beginOrdered(open, attributes),
        td: () => this.beginCell(),
        th: () => this.beginCell(),
        tr: open => this.beginRow(open),
        a: (open, attributes) => this.beginLink(open, attributes),
      };
    return beginners[tag];
  }

  /**
   * A list item's marker, numbered in order and indented to the content of
   * the item its list is in, however wide that item's marker is, so a list
   * in a numbered item stays nested; the item's own content column is
   * noted, to indent its later blocks and lists by.
   */
  private beginItem(open: Open): void {
    this.newLine();
    const list = this.lists().at(-1);
    if (list !== undefined) list.count = (list.count ?? 0) + 1;
    const marker = list?.ordered === true ? `${list.count ?? 1}.` : "-";
    // The item this list is in: this item is not on the stack yet.
    const parent = [...this.stack].reverse().find(each => each.tag === "li");
    const lead = `${" ".repeat(parent?.indent ?? 0)}${marker} `;
    open.indent = lead.length;
    this.copy.add(lead);
  }

  /** An ordered list, numbered from its `start`, else from one. */
  private beginOrdered(open: Open, attributes: string): void {
    open.ordered = true;
    const start = Number.parseInt(attributeOf(attributes, "start") ?? "", 10);
    // Its first item takes the number after the count it starts from.
    if (Number.isInteger(start)) open.count = start - 1;
  }

  /** A table cell's leading bar, counted in its row. */
  private beginCell(): void {
    const row = [...this.stack].reverse().find(each => each.tag === "tr");
    if (row !== undefined) row.cells = (row.cells ?? 0) + 1;
    this.copy.trimEnd();
    this.copy.add(
      this.copy.endsWith("\n") || this.copy.length === 0 ? "| " : " | "
    );
  }

  /** A table row, numbered in its table so the first is read as the header. */
  private beginRow(open: Open): void {
    const table = [...this.stack].reverse().find(each => each.tag === "table");
    open.count = table?.count ?? 0;
    if (table !== undefined) table.count = (table.count ?? 0) + 1;
    this.newLine();
  }

  /** A link's target, made whole; a link within the page or to a script has none. */
  private beginLink(open: Open, attributes: string): void {
    // Two links in a row would otherwise run together.
    if (this.copy.endsWith(")")) this.copy.add(" ");
    const href = attributeOf(attributes, "href");
    if (
      href !== undefined &&
      !href.startsWith("#") &&
      !/^javascript:/i.test(href)
    ) {
      open.href = whole(href, this.base);
    }
  }

  close(tag: string): void {
    const at = this.stack.map(open => open.tag).lastIndexOf(tag);
    // A stray closing tag closes nothing.
    if (at === -1) return;
    const open = this.stack[at];
    this.stack.length = at;
    if (open === undefined || open.skip || this.skipping()) return;
    // Code holds its text as written: no element inside it adds Markdown.
    if (this.inside("pre") || this.inside("code")) return;
    this.closerFor(tag)(open);
  }

  /**
   * What `open` holds, taken off the copy so a closer can write it again
   * rewritten: only its own words are read, never the copy before it.
   */
  private taken(open: Open): string {
    const inner = this.copy.from(open.start);
    this.copy.cut(open.start);
    return inner;
  }

  /** How closing `tag` rewrites what it holds, read after it is closed. */
  private closerFor(tag: string): (open: Open) => void {
    const heading = /^h([1-6])$/.exec(tag);
    if (heading !== null) {
      return open => this.closeHeading(Number(heading[1]), this.taken(open));
    }
    const mark = EMPHASIS[tag];
    if (mark !== undefined) return open => this.closeEmphasis(mark, open);
    if (tag === "th" || (tag === "td" && this.headerRow())) {
      return open => this.closeHeaderCell(this.taken(open));
    }
    const closers: Record<string, (open: Open) => void> = {
      a: open => this.closeLink(open, this.taken(open)),
      code: open => this.closeCode(this.taken(open)),
      pre: open => this.closePre(this.taken(open)),
      blockquote: open => this.closeQuote(this.taken(open)),
      li: open => this.closeItem(open, this.taken(open)),
      tr: open => this.closeRow(open),
      table: () => this.newBlock(),
    };
    return closers[tag] ?? (open => this.closeOther(tag, open));
  }

  /** A heading, marked by its level. */
  private closeHeading(level: number, inner: string): void {
    // A heading is emphasis enough: emphasis around all of it is dropped.
    const heading = unwrapped(inner.replace(/\s+/g, " ").trim());
    if (heading !== "") this.copy.add(`${"#".repeat(level)} ${heading}`);
    this.newBlock();
  }

  /** A link, its words as its label. */
  private closeLink(open: Open, inner: string): void {
    // A card that wraps a heading and a paragraph in one link is one line.
    const label = inner
      .split(/\n+/)
      .map(part => part.replace(/^#+\s*/, "").trim())
      .filter(part => part !== "")
      .join(" — ");
    this.copy.add(
      label !== "" && open.href !== undefined
        ? `[${label}](${linkTarget(open.href)})`
        : label
    );
  }

  /**
   * A list item: each line after its first that is indented less than its
   * marker is indented under it, so a later paragraph stays in the item.
   */
  private closeItem(open: Open, inner: string): void {
    const indent = " ".repeat(open.indent ?? 0);
    this.copy.add(
      inner
        .split("\n")
        .map((line, at) =>
          at === 0 || line.trim() === "" || line.startsWith(indent)
            ? line
            : `${indent}${line.trimStart()}`
        )
        .join("\n")
    );
    this.newLine();
  }

  /**
   * A preformatted block, fenced as code: kept aside and marked where it
   * stands, so it is copied verbatim ({@link withCode}).
   */
  private closePre(inner: string): void {
    // The line break a browser drops after `<pre>`, and the one that only
    // ends the last line; every other blank line and space is the code's.
    const code = inner.replace(/^\n/, "").replace(/\n$/, "");
    this.codes.push(fencedCode(code));
    this.copy.add(`${CODE_MARK}${this.codes.length - 1}${CODE_MARK}`);
    this.newBlock();
  }

  /** Inline code, fenced in backticks. */
  private closeCode(inner: string): void {
    const code = inner.trim();
    if (code === "") return;
    // In a table a bar ends the cell, inside code too, unless escaped.
    const span = inlineCode(code);
    this.copy.add(this.inCell() ? span.replaceAll("|", "\\|") : span);
  }

  /** Emphasis, marked where it holds words on one line. */
  private closeEmphasis(mark: string, open: Open): void {
    // Read first, and taken off only where it is marked.
    const inner = this.copy.from(open.start);
    const words = inner.trim();
    if (words === "" || words.includes("\n")) return;
    const lead = inner.match(/^\s*/)?.[0] ?? "";
    const trail = inner.match(/\s*$/)?.[0] ?? "";
    this.copy.cut(open.start);
    this.copy.add(`${lead}${mark}${words}${mark}${trail}`);
  }

  /** A quote, each line marked. */
  private closeQuote(inner: string): void {
    const quote = inner.trim();
    if (quote !== "") {
      this.copy.add(
        quote
          .split("\n")
          .map(line => (line === "" ? ">" : `> ${line}`))
          .join("\n")
      );
    }
    this.newBlock();
  }

  /** A header cell, without emphasis around all of it. */
  private closeHeaderCell(inner: string): void {
    // A header cell is emphasis enough, as a heading is.
    this.copy.add(unwrapped(inner.trim()));
  }

  /** A table row, closed by its bar; the first row is followed by the header line. */
  private closeRow(open: Open): void {
    this.copy.trimEnd();
    this.copy.add(" |\n");
    if (open.count !== 0) return;
    // The first row is the table's header: one line cell per cell opened,
    // whatever bars the cells' own words hold.
    this.copy.add(`|${" --- |".repeat(Math.max(open.cells ?? 0, 1))}\n`);
  }

  /** Any other element: a list, a block, or an inline element. */
  private closeOther(tag: string, open: Open): void {
    if (this.nestedList(tag)) {
      this.newLine();
    } else if (BLOCKS.has(tag)) {
      this.newBlock();
    } else if (this.copy.length === open.start) {
      // An empty inline element is a separator drawn by CSS: it keeps the
      // words either side apart.
      this.space();
    }
  }
}

/** The text of the document head's first `<title>`, or none. */
function titleOf(html: string): string | undefined {
  const head = html.slice(0, Math.max(html.search(/<\/head>/i), 0));
  const found = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const title = found === null ? "" : decoded(found[1] ?? "").trim();
  return title === "" ? undefined : title;
}

/** The content of the head's `<meta name="description">`, or none. */
function descriptionOf(html: string): string | undefined {
  const head = html.slice(0, Math.max(html.search(/<\/head>/i), 0));
  for (const [tag] of head.matchAll(/<meta\s[^>]*>/gi)) {
    if (attributeOf(tag, "name")?.toLowerCase() === "description") {
      const content = attributeOf(tag, "content")?.trim();
      return content === "" ? undefined : content;
    }
  }
  return undefined;
}

/** The tags of the HTML a page's copy reads: a comment, a tag, or text. */
const TOKEN =
  /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g;

/**
 * Where the raw text of a `tag` opened before `from` ends: just past its
 * closing tag, else the end of `source`, which an unclosed one runs to.
 */
function rawTextEnd(source: string, tag: string, from: number): number {
  const closing = new RegExp(`</${tag}(?=[\\s/>])[^>]*>`, "gi");
  closing.lastIndex = from;
  const found = closing.exec(source);
  return found === null ? source.length : found.index + found[0].length;
}

/**
 * `markdown` with each code block put back where its mark stands, every
 * line after the first led by what leads the mark's line (a quote's `>`, a
 * list item's indent), so code in a quote or an item stays inside it.
 */
function withCode(markdown: string, codes: readonly string[]): string {
  const mark = new RegExp(
    `^([^\\n${CODE_MARK}]*)${CODE_MARK}(\\d+)${CODE_MARK}`,
    "gm"
  );
  return markdown.replace(mark, (whole, lead: string, at: string) => {
    const code = codes[Number(at)];
    if (code === undefined) return whole;
    // A list marker leads only the first line; the rest align under it.
    const rest = lead.replace(/(?:-|\d+\.) /g, marker =>
      " ".repeat(marker.length)
    );
    return code
      .split("\n")
      .map((line, index) => {
        if (index === 0) return `${lead}${line}`;
        return line === "" ? rest.trimEnd() : `${rest}${line}`;
      })
      .join("\n");
  });
}

/**
 * Each tag and text run of the HTML `source` handed to `writer` in order.
 * Raw text is already taken out ({@link withoutRawText}), and comments
 * are passed over.
 */
function read(source: string, writer: CopyWriter): void {
  for (const token of source.matchAll(TOKEN)) {
    const [all, closing, name, attributes = ""] = token;
    if (all.startsWith("<!--")) continue;
    if (name === undefined) {
      writer.text(all);
      continue;
    }
    const tag = name.toLowerCase();
    if (closing === "/") writer.close(tag);
    else if (/\/\s*$/.test(attributes) && !VOID.has(tag)) {
      // A self-closed element that is not void holds nothing.
      writer.open(tag, attributes);
      writer.close(tag);
    } else writer.open(tag, attributes);
  }
}

/**
 * Whether what begins at `at` in `html` is inside an element the copy
 * leaves out, judged as the copy itself judges it: the page up to there is
 * read by a writer, and asked whether it is skipping.
 */
function leftOutAt(html: string, at: number, base: string): boolean {
  const writer = new CopyWriter(base, false);
  read(html.slice(0, at), writer);
  return writer.skipping();
}

/** Markdown written from HTML: its prose, and the code blocks marked in it. */
interface Written {
  prose: string;
  codes: readonly string[];
}

/**
 * Markdown from the HTML `source`, its addresses made whole against
 * `base`: the prose tidied, its code blocks still kept aside, to be put
 * back by {@link withCode} once nothing more reads the prose.
 */
function writtenOf(source: string, base: string, wholeBody: boolean): Written {
  const writer = new CopyWriter(base, wholeBody);
  read(source, writer);
  const prose = writer.copy
    .toString()
    .split("\n")
    .map(line => line.replace(/[ \t]+$/, ""))
    // A list item left with no words.
    .filter(line => !/^\s*(?:-|\d+\.)\s*$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { prose, codes: writer.codes };
}

/**
 * The hidden containers React streams boundaries' content in
 * (`<div hidden id="S:0">`), each one's inner HTML by its id, and `html`
 * without them: read in one pass.
 */
function streamedSegments(html: string): {
  segments: Map<string, string>;
  rest: string;
} {
  const segments = new Map<string, string>();
  let rest = "";
  let from = 0;
  const openings = /<div hidden id="(S:[^"]+)">/g;
  for (
    let found = openings.exec(html);
    found !== null;
    found = openings.exec(html)
  ) {
    const end = divEnd(html, found.index);
    if (end === undefined) break;
    segments.set(
      found[1] ?? "",
      html.slice(found.index + found[0].length, end.inner)
    );
    rest += html.slice(from, found.index);
    from = end.outer;
    openings.lastIndex = end.outer;
  }
  return { segments, rest: rest + html.slice(from) };
}

/**
 * Where the `<div>` opened at `start` closes: where its inner HTML ends,
 * and just past its closing tag, divs inside it counted.
 */
function divEnd(
  html: string,
  start: number
): { inner: number; outer: number } | undefined {
  let depth = 0;
  const divs = /<(\/?)div(?=[\s>])[^>]*>/gi;
  divs.lastIndex = start;
  for (let div = divs.exec(html); div !== null; div = divs.exec(html)) {
    depth += div[1] === "/" ? -1 : 1;
    if (depth === 0) {
      return { inner: div.index, outer: div.index + div[0].length };
    }
  }
  return undefined;
}

/**
 * Where the boundary whose fallback begins at `from` ends: the comment
 * that closes it (`<!--/$-->`), boundaries inside it counted; the end of
 * `html` where it is never closed.
 */
function boundaryEnd(html: string, from: number): number {
  let depth = 0;
  const comments = /<!--([\s\S]*?)-->/g;
  comments.lastIndex = from;
  for (
    let comment = comments.exec(html);
    comment !== null;
    comment = comments.exec(html)
  ) {
    const data = comment[1] ?? "";
    if (data === "/$" || data === "/&") {
      if (depth === 0) return comment.index;
      depth -= 1;
    } else if (["$", "$?", "$~", "$!", "&"].includes(data)) {
      depth += 1;
    }
  }
  return html.length;
}

/**
 * `html` with each boundary the page's script fills (`<template
 * id="B:0">`, then its fallback) holding its streamed content instead, and
 * any boundary inside that content filled the same way. Each segment is
 * used once, and every part of the page is read once.
 */
function boundariesFilled(
  html: string,
  moves: ReadonlyMap<string, string>,
  segments: Map<string, string>
): string {
  let filled = "";
  let from = 0;
  const templates = /<template id="(B:[^"]+)"><\/template>/g;
  for (
    let found = templates.exec(html);
    found !== null;
    found = templates.exec(html)
  ) {
    const segment = moves.get(found[1] ?? "");
    const content = segment === undefined ? undefined : segments.get(segment);
    if (segment === undefined || content === undefined) continue;
    segments.delete(segment);
    const after = found.index + found[0].length;
    const end = boundaryEnd(html, after);
    filled +=
      html.slice(from, found.index) +
      boundariesFilled(content, moves, segments);
    from = end;
    templates.lastIndex = end;
  }
  return filled + html.slice(from);
}

/** The comments React marks a streamed boundary's start and end with. */
const BOUNDARY_MARK = /^<!--(?:\/?[$&]|\$[?~!])-->$/;

/**
 * `html` with the content of every raw-text element taken out, and every
 * comment but the marks of streamed boundaries: what is left is markup and
 * the words a reader reads, so nothing written inside a script's source,
 * such as `"</main>"`, can be read as the page's own markup by any step
 * after it.
 */
function withoutRawText(html: string): string {
  let kept = "";
  const tokens = new RegExp(TOKEN);
  for (
    let token = tokens.exec(html);
    token !== null;
    token = tokens.exec(html)
  ) {
    const [all, closing, name, attributes = ""] = token;
    const tag = name?.toLowerCase();
    if (all.startsWith("<!--")) {
      if (BOUNDARY_MARK.test(all)) kept += all;
      continue;
    }
    kept += all;
    if (
      tag !== undefined &&
      closing !== "/" &&
      RAW_TEXT.has(tag) &&
      !/\/\s*$/.test(attributes)
    ) {
      // Its raw text is passed over whole, and the element closed.
      tokens.lastIndex = rawTextEnd(html, tag, tokens.lastIndex);
      kept += `</${tag}>`;
    }
  }
  return kept;
}

/**
 * The page as the browser shows it once every streamed boundary has loaded,
 * its raw text taken out. A page that streams renders each Suspense
 * boundary's fallback first, then its content in a hidden container, and a
 * script (`$RC("B:0","S:0")`) moves the content into the fallback's place.
 * The moves are read from the page's scripts, then made, a boundary
 * streamed inside another filled with its parent.
 */
function readableHtml(rendered: string): string {
  const moves = new Map<string, string>();
  for (const [, boundary = "", segment = ""] of rendered.matchAll(
    /\$R[CR]\("(B:[^"]+)","(S:[^"]+)"/g
  )) {
    moves.set(boundary, segment);
  }
  const html = withoutRawText(rendered);
  if (moves.size === 0) return html;
  const { segments, rest } = streamedSegments(html);
  return boundariesFilled(rest, moves, segments);
}

/**
 * A top-level heading line of Markdown prose: never a line of code, which
 * is still kept aside, nor one holding a code block's mark.
 */
const TOP_HEADING = new RegExp(`^# \\S[^\\n${CODE_MARK}]*$`, "m");

/**
 * The page's first top-level heading where a reader sees it, read as the
 * whole body is read, so a heading hidden, or in navigation or a dialog,
 * is passed over; none where there is no such heading.
 */
function shownHeading(html: string, base: string): string | undefined {
  return TOP_HEADING.exec(writtenOf(bodyOf(html), base, false).prose)?.[0];
}

/** What a rendered page's copy is made of. */
export interface RenderedCopy {
  /** The title in the page's head. */
  title?: string;
  /** The description in the page's head. */
  description?: string;
  /** The page's main content as Markdown, beginning with its main heading. */
  body: string;
}

/**
 * The copy of a page from its rendered HTML: its head's title and
 * description, and its main content as Markdown, every address made whole
 * against `base`, the page's own address, read as the page shows once
 * every part it streams has loaded. Where the main content holds no
 * top-level heading, the page's first shown `<h1>` (which a page may place
 * above its `<main>`) begins it.
 */
export function renderedCopyOf(rendered: string, base: string): RenderedCopy {
  const html = readableHtml(rendered);
  const { source, wholeBody } = mainOf(html, base);
  const main = writtenOf(source, base, wholeBody);
  let { prose } = main;
  if (!TOP_HEADING.test(prose)) {
    const heading = shownHeading(html, base);
    if (heading !== undefined)
      prose = prose === "" ? heading : `${heading}\n\n${prose}`;
  }
  const body = withCode(prose, main.codes);
  const title = titleOf(html);
  const description = descriptionOf(html);
  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    body,
  };
}
