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
import { fencedCode, inlineCode } from "./plain-copy";

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
  return text.replace(/[\\`*_[\]<>|]/g, "\\$&");
}

/**
 * The page's main content: the longest outermost `<main>` (a page that
 * streams its content can render an empty one first and the real one
 * later), else its body, whose shared header and footer are then left out.
 */
function mainOf(html: string): { source: string; wholeBody: boolean } {
  let best = "";
  let depth = 0;
  let start = -1;
  for (const match of html.matchAll(/<(\/?)main(?=[\s>])[^>]*>/gi)) {
    if (match[1] === "") {
      if (depth === 0) start = match.index;
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      const end = match.index + match[0].length;
      if (depth === 0 && end - start > best.length) {
        best = html.slice(start, end);
      }
    }
  }
  if (best !== "") return { source: best, wholeBody: false };
  const body = /<body[\s>][\s\S]*<\/body>/i.exec(html);
  return { source: body?.[0] ?? html, wholeBody: true };
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

/** The writer of one page's copy, as its HTML is read. */
class CopyWriter {
  out = "";
  readonly stack: Open[] = [];

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
    this.out = this.out.replace(/[ \t]+$/, "");
    if (this.out !== "" && !this.out.endsWith("\n")) this.out += "\n";
  }

  /** Starts a block: a blank line between it and what came before. */
  newBlock(): void {
    if (this.inside("table")) return;
    this.out = this.out.replace(/[ \t]+$/, "");
    if (this.out === "" || this.out.endsWith("\n\n")) return;
    this.out += this.out.endsWith("\n") ? "\n" : "\n\n";
  }

  /** The words of a text run, as the copy holds them. */
  text(raw: string): void {
    if (this.skipping()) return;
    if (this.inside("pre")) {
      this.out += decoded(raw);
      return;
    }
    const words = decoded(raw).replace(/\s+/g, " ");
    if (words.trim() === "") {
      if (this.out !== "" && !/\s$/.test(this.out)) this.out += " ";
      return;
    }
    const kept = this.inside("code") ? words : escaped(words);
    this.out +=
      this.out === "" || this.out.endsWith("\n") ? kept.trimStart() : kept;
  }

  open(tag: string, attributes: string): void {
    const skip =
      SKIPPED.has(tag) ||
      hiddenBy(attributes) ||
      (this.wholeBody && (tag === "header" || tag === "footer"));
    const inherited = this.skipping();
    if (VOID.has(tag)) {
      if (!inherited && !skip && !this.inside("pre"))
        this.empty(tag, attributes);
      return;
    }
    const open: Open = { tag, skip, start: this.out.length };
    if (!inherited && !skip && !this.inside("pre"))
      this.begin(open, attributes);
    this.stack.push(open);
  }

  /** What an element that holds nothing writes: a break, a rule or an image. */
  private empty(tag: string, attributes: string): void {
    if (tag === "br") {
      this.newLine();
    } else if (tag === "hr") {
      this.newBlock();
      this.out += "---";
      this.newBlock();
    } else if (tag === "img") {
      const alt = attributeOf(attributes, "alt")?.trim();
      const src = attributeOf(attributes, "src");
      // An image with no words for it is decoration, said nothing of.
      if (alt !== undefined && alt !== "" && src !== undefined) {
        this.out += `![${escaped(alt)}](${linkTarget(imageAddress(src, this.base))})`;
      }
    }
  }

  /** What opening an element writes, and what it notes to close it by. */
  private begin(open: Open, attributes: string): void {
    const { tag } = open;
    if (this.nestedList(tag)) this.newLine();
    else if (BLOCKS.has(tag)) this.newBlock();
    if (tag === "li") {
      this.newLine();
      const lists = this.lists();
      const list = lists.at(-1);
      if (list !== undefined) list.count = (list.count ?? 0) + 1;
      const marker = list?.ordered === true ? `${list.count ?? 1}.` : "-";
      this.out += `${"  ".repeat(Math.max(lists.length - 1, 0))}${marker} `;
    }
    if (tag === "ol") open.ordered = true;
    if (tag === "td" || tag === "th") {
      this.out = this.out.replace(/[ \t]+$/, "");
      this.out += this.out.endsWith("\n") || this.out === "" ? "| " : " | ";
    }
    if (tag === "tr") {
      const table = [...this.stack]
        .reverse()
        .find(each => each.tag === "table");
      open.count = table?.count ?? 0;
      if (table !== undefined) table.count = (table.count ?? 0) + 1;
      this.newLine();
    }
    if (tag === "a") {
      // Two links in a row would otherwise run together.
      if (this.out.endsWith(")")) this.out += " ";
      const href = attributeOf(attributes, "href");
      if (
        href !== undefined &&
        !href.startsWith("#") &&
        !/^javascript:/i.test(href)
      ) {
        open.href = whole(href, this.base);
      }
    }
    open.start = this.out.length;
  }

  close(tag: string): void {
    const at = this.stack.map(open => open.tag).lastIndexOf(tag);
    // A stray closing tag closes nothing.
    if (at === -1) return;
    const open = this.stack[at];
    this.stack.length = at;
    if (open === undefined || open.skip || this.skipping()) return;
    const inner = this.out.slice(open.start);
    const before = this.out.slice(0, open.start);
    if (/^h[1-6]$/.test(tag)) {
      // A heading is emphasis enough: emphasis around all of it is dropped.
      const heading = unwrapped(inner.replace(/\s+/g, " ").trim());
      this.out =
        heading === ""
          ? before
          : `${before}${"#".repeat(Number(tag[1]))} ${heading}`;
      this.newBlock();
    } else if (tag === "a") {
      // A card that wraps a heading and a paragraph in one link is one line.
      const label = inner
        .split(/\n+/)
        .map(part => part.replace(/^#+\s*/, "").trim())
        .filter(part => part !== "")
        .join(" — ");
      this.out =
        before +
        (label !== "" && open.href !== undefined
          ? `[${label}](${linkTarget(open.href)})`
          : label);
    } else if (tag === "pre") {
      const code = inner.replace(/^\n+|\s+$/g, "");
      this.out = `${before}${fencedCode(code)}`;
      this.newBlock();
    } else if (tag === "code" && !this.inside("pre")) {
      const code = inner.trim();
      this.out = code === "" ? before : `${before}${inlineCode(code)}`;
    } else if (EMPHASIS[tag] !== undefined) {
      const mark = EMPHASIS[tag];
      const words = inner.trim();
      if (words !== "" && !words.includes("\n")) {
        const lead = inner.match(/^\s*/)?.[0] ?? "";
        const trail = inner.match(/\s*$/)?.[0] ?? "";
        this.out = `${before}${lead}${mark}${words}${mark}${trail}`;
      }
    } else if (tag === "blockquote") {
      const quote = inner.trim();
      this.out =
        quote === ""
          ? before
          : `${before}${quote
              .split("\n")
              .map(line => (line === "" ? ">" : `> ${line}`))
              .join("\n")}`;
      this.newBlock();
    } else if (tag === "li") {
      this.newLine();
    } else if (tag === "th" || (tag === "td" && this.headerRow())) {
      // A header cell is emphasis enough, as a heading is.
      this.out = `${before}${unwrapped(inner.trim())}`;
    } else if (tag === "tr") {
      this.out = `${this.out.replace(/[ \t]+$/, "")} |\n`;
      if (open.count === 0) {
        // The first row is the table's header.
        const cells = this.out.slice(open.start).split("|").length - 2;
        this.out += `|${" --- |".repeat(Math.max(cells, 1))}\n`;
      }
    } else if (tag === "table") {
      this.newBlock();
    } else if (this.nestedList(tag)) {
      this.newLine();
    } else if (BLOCKS.has(tag)) {
      this.newBlock();
    } else if (inner === "" && this.out !== "" && !/\s$/.test(this.out)) {
      // An empty inline element is a separator drawn by CSS: it keeps the
      // words either side apart.
      this.out += " ";
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

/** Markdown from the HTML `source`, its addresses made whole against `base`. */
function markdownOf(source: string, base: string, wholeBody: boolean): string {
  const writer = new CopyWriter(base, wholeBody);
  for (const token of source.matchAll(
    /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g
  )) {
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
  return (
    writer.out
      .split("\n")
      .map(line => line.replace(/[ \t]+$/, ""))
      // A list item left with no words.
      .filter(line => !/^\s*(?:-|\d+\.)\s*$/.test(line))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
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
 * against `base`, the page's own address. Where the main content holds no
 * top-level heading, the page's first `<h1>` (which a page may place above
 * its `<main>`) begins it.
 */
export function renderedCopyOf(html: string, base: string): RenderedCopy {
  const { source, wholeBody } = mainOf(html);
  let body = markdownOf(source, base, wholeBody);
  if (!/^# \S/m.test(body)) {
    const heading = /<h1[\s>][\s\S]*?<\/h1>/i.exec(html)?.[0];
    const words =
      heading === undefined
        ? ""
        : markdownOf(heading, base, false).replace(/^#\s*/, "").trim();
    if (words !== "")
      body = body === "" ? `# ${words}` : `# ${words}\n\n${body}`;
  }
  const title = titleOf(html);
  const description = descriptionOf(html);
  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    body,
  };
}
