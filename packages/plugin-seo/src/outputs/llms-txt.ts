/**
 * The site's `llms.txt`: a plain list of its pages for AI tools to read, in
 * the format the llms.txt proposal sets out. The site's name is the heading,
 * its description the summary beneath it, and each page a link under its
 * content type, with the title and description the page's head carries.
 *
 * Pure: the route reads which pages are listed from the same listing the
 * sitemap serves, so the two never list different pages.
 *
 * @module outputs/llms-txt
 */
import { linkAddress } from "./plain-copy";

/** One page, as llms.txt lists it. */
export interface LlmsEntry {
  /** The heading it is listed under: its content type. */
  section: string;
  title: string;
  /** Where a reader goes for it: the page, or its plain-text copy. */
  url: string;
  description?: string;
}

/** What llms.txt is written from. */
export interface LlmsFile {
  name: string;
  description?: string;
  /**
   * What the site tells AI tools in its own words, after the summary:
   * paragraphs and lists, never a heading, as the llms.txt proposal allows.
   */
  intro?: string;
  /** Where llms-full.txt is served, linked after the intro; none while it is off. */
  fullTxt?: string;
  entries: readonly LlmsEntry[];
}

/** `text` on one line, its line breaks and runs of space made one space. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** A link's words, with the brackets that would end it escaped. */
const linkText = (text: string): string =>
  oneLine(text).replace(/[[\]\\]/g, match => `\\${match}`);

/**
 * The site's own words as llms.txt holds them: a line that would begin a
 * heading escaped, since only the file's sections are headings, and runs of
 * blank lines made one.
 */
function introOf(intro: string | undefined): string {
  if (intro === undefined) return "";
  return intro
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(line => line.replace(/\s+$/, "").replace(/^(\s*)#/, "$1\\#"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The head both files begin with: the name, the summary and the site's own words. */
function headLines(
  file: Pick<LlmsFile, "name" | "description" | "intro">
): string[] {
  const lines = [`# ${oneLine(file.name)}`];
  const summary =
    file.description === undefined ? "" : oneLine(file.description);
  if (summary !== "") lines.push("", `> ${summary}`);
  const intro = introOf(file.intro);
  if (intro !== "") lines.push("", intro);
  return lines;
}

/** llms.txt for the site, ending in a newline. */
export function llmsTxt(file: LlmsFile): string {
  const lines = headLines(file);
  if (file.fullTxt !== undefined) {
    lines.push(
      "",
      `The whole site in one file: [llms-full.txt](${linkAddress(file.fullTxt)}).`
    );
  }
  // Each section once, where its first page is, its pages in the order given.
  const sections = new Map<string, string[]>();
  for (const entry of file.entries) {
    const description =
      entry.description === undefined ? "" : oneLine(entry.description);
    const link = `- [${linkText(entry.title)}](${linkAddress(entry.url)})`;
    const list = sections.get(entry.section) ?? [];
    list.push(description === "" ? link : `${link}: ${description}`);
    sections.set(entry.section, list);
  }
  for (const [section, links] of sections) {
    lines.push("", `## ${oneLine(section)}`, "", ...links);
  }
  return `${lines.join("\n")}\n`;
}

/** One page as llms-full.txt holds it. */
export interface LlmsFullPage {
  title: string;
  /** The page's own address. */
  url: string;
  /**
   * The page's plain-text copy, without front matter; none for a page the
   * public may not read, which is named by its address alone.
   */
  body?: string;
}

/** What llms-full.txt is written from. */
export interface LlmsFullFile {
  name: string;
  description?: string;
  intro?: string;
  /**
   * The pages, in order. Any iterable, read one page at a time and no
   * further than the file can hold, so a lazy one builds no page past
   * where the file stops short.
   */
  pages: Iterable<LlmsFullPage>;
  /** Where llms.txt is, named where the file stops short of every page. */
  listUrl?: string;
  /** The most the file may hold, in bytes: 5 MB unless given. */
  maxBytes?: number;
}

/** The size llms-full.txt stops short of, since AI tools read it whole. */
const FULL_MAX_BYTES = 5 * 1024 * 1024;

/** Between the pages of llms-full.txt. */
const PAGE_BREAK = "\n\n---\n\n";

const bytes = (text: string): number => new TextEncoder().encode(text).length;

/**
 * One page's part of llms-full.txt: its title as a heading, its address,
 * then its copy without the heading the copy begins with.
 */
function fullPage(page: LlmsFullPage): string {
  const body = (page.body ?? "").replace(/^# [^\n]*\n+/, "").trim();
  const head = `# ${oneLine(page.title)}\n\nSource: ${page.url}`;
  return body === "" ? head : `${head}\n\n${body}`;
}

/**
 * llms-full.txt for the site, ending in a newline: llms.txt's head, then
 * each page's words under its title and address, in the order given. A page
 * that would take the file past its size is left out, with every page after
 * it, and the file ends saying where the rest are listed.
 */
export function llmsFullTxt(file: LlmsFullFile): string {
  const max = file.maxBytes ?? FULL_MAX_BYTES;
  const ending =
    file.listUrl === undefined
      ? "The rest of the site's pages are left out."
      : `The rest of the site's pages are listed in [llms.txt](${linkAddress(file.listUrl)}).`;
  const blocks = [headLines(file).join("\n")];
  // Room is kept for the ending, so a file cut short can still say so.
  const room = max - bytes(`${PAGE_BREAK}${ending}\n`);
  let size = bytes(blocks[0] ?? "");
  for (const page of file.pages) {
    const block = fullPage(page);
    const grown = size + bytes(`${PAGE_BREAK}${block}`);
    if (grown > room) {
      blocks.push(ending);
      break;
    }
    blocks.push(block);
    size = grown;
  }
  return `${blocks.join(PAGE_BREAK)}\n`;
}
