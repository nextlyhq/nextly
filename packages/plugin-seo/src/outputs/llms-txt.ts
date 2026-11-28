/**
 * The site's `llms.txt`: a plain list of its pages for AI tools to read, in
 * the format the llms.txt proposal sets out. The site's name is the heading,
 * its description the summary beneath it, and each page a link under its
 * section, with the title and description the page's head carries; the
 * site's own sections of links follow, and the "Optional" section, which
 * the proposal lets AI tools skip, comes last.
 *
 * Pure: the route reads which pages are listed from the same listing the
 * sitemap serves, so the two never list different pages.
 *
 * @module outputs/llms-txt
 */
import { OPTIONAL_HEADING } from "../settings/ai-files";

import { linkAddress } from "./plain-copy";

/** One page, as llms.txt lists it. */
export interface LlmsEntry {
  /**
   * The heading it is listed under: its section, by default its content
   * type; {@link OPTIONAL_HEADING} for a page AI tools may skip.
   */
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
  /** Whether the file is one folder's rather than the whole site's. */
  folder?: boolean;
  /** The site's RSS feeds, each by its name and address, named after that. */
  feeds?: readonly { title: string; url: string }[];
  /**
   * The folders with llms.txt files of their own, each by its name and its
   * file's address, named after the feeds.
   */
  folderFiles?: readonly { title: string; url: string }[];
  entries: readonly LlmsEntry[];
  /**
   * The site's own sections of links, after the pages' sections: one with a
   * page section's heading joins it, after its pages.
   */
  extraSections?: readonly LlmsExtraSection[];
}

/** A section of links the site adds itself. */
export interface LlmsExtraSection {
  heading: string;
  links: readonly { title: string; url: string; notes?: string }[];
}

/** A link of a section, as a Markdown list item, with its notes after a colon. */
function linkLine(
  title: string,
  url: string,
  notes: string | undefined
): string {
  const said = notes === undefined ? "" : oneLine(notes);
  // The title as given: a page's name is already the words it shows, and
  // reading it as markup again would take `<Button>` in it for a tag.
  const link = `- [${linkText(title)}](${linkAddress(url)})`;
  return said === "" ? link : `${link}: ${said}`;
}

/**
 * Each section's links, in the order its first link comes, the "Optional"
 * section last whatever its place, as the proposal names the section AI
 * tools may skip.
 */
function sectionsOf(
  entries: readonly LlmsEntry[],
  extra: readonly LlmsExtraSection[]
): [string, string[]][] {
  const sections = new Map<string, string[]>();
  const add = (heading: string, line: string) => {
    const named = oneLine(heading);
    // "optional" in any case is the one section AI tools may skip.
    const key =
      named.toLowerCase() === OPTIONAL_HEADING.toLowerCase()
        ? OPTIONAL_HEADING
        : named;
    const list = sections.get(key) ?? [];
    list.push(line);
    sections.set(key, list);
  };
  for (const entry of entries) {
    add(entry.section, linkLine(entry.title, entry.url, entry.description));
  }
  for (const section of extra) {
    for (const link of section.links) {
      add(section.heading, linkLine(link.title, link.url, link.notes));
    }
  }
  const optional = sections.get(OPTIONAL_HEADING);
  sections.delete(OPTIONAL_HEADING);
  return [
    ...sections,
    ...(optional === undefined
      ? []
      : [[OPTIONAL_HEADING, optional] as [string, string[]]]),
  ];
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
      `${file.folder === true ? "All of it" : "The whole site"} in one file: [llms-full.txt](${linkAddress(file.fullTxt)}).`
    );
  }
  const feeds = file.feeds ?? [];
  if (feeds.length > 0) {
    const links = feeds.map(
      feed => `[${linkText(feed.title)}](${linkAddress(feed.url)})`
    );
    lines.push("", `What is new, as RSS: ${links.join(", ")}.`);
  }
  const folders = file.folderFiles ?? [];
  if (folders.length > 0) {
    const links = folders.map(
      folder => `[${linkText(folder.title)}](${linkAddress(folder.url)})`
    );
    lines.push(
      "",
      `Parts of the site with an llms.txt of their own: ${links.join(", ")}.`
    );
  }
  for (const [section, links] of sectionsOf(
    file.entries,
    file.extraSections ?? []
  )) {
    lines.push("", `## ${section}`, "", ...links);
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
   * where the file stops short; an async one, where a page's words are
   * read as it is built.
   */
  pages: Iterable<LlmsFullPage> | AsyncIterable<LlmsFullPage>;
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
 * One page's part of llms-full.txt: its title as a heading, as given, its
 * address, then its copy without the heading the copy begins with.
 */
function fullPage(page: LlmsFullPage): string {
  const body = (page.body ?? "").replace(/^# [^\n]*\n+/, "").trim();
  const head = `# ${oneLine(page.title)}\n\nSource: ${page.url}`;
  return body === "" ? head : `${head}\n\n${body}`;
}

/** llms-full.txt as written, and how much of what it was given it holds. */
export interface WrittenFullFile {
  text: string;
  /** How many pages it holds. */
  written: number;
  /** Whether it stopped short of a page that would take it past its size. */
  cut: boolean;
}

/**
 * llms-full.txt for the site, ending in a newline: llms.txt's head, then
 * each page's words under its title and address, in the order given. A page
 * that would take the file past its size is left out, with every page after
 * it, and the file ends saying where the rest are listed.
 */
export async function llmsFullFile(
  file: LlmsFullFile
): Promise<WrittenFullFile> {
  const max = file.maxBytes ?? FULL_MAX_BYTES;
  const ending =
    file.listUrl === undefined
      ? "The rest of the site's pages are left out."
      : `The rest of the site's pages are listed in [llms.txt](${linkAddress(file.listUrl)}).`;
  const blocks = [headLines(file).join("\n")];
  // Room is kept for the ending, so a file cut short can still say so.
  const room = max - bytes(`${PAGE_BREAK}${ending}\n`);
  let size = bytes(blocks[0] ?? "");
  let written = 0;
  let cut = false;
  for await (const page of file.pages) {
    const block = fullPage(page);
    const grown = size + bytes(`${PAGE_BREAK}${block}`);
    if (grown > room) {
      blocks.push(ending);
      cut = true;
      break;
    }
    blocks.push(block);
    size = grown;
    written += 1;
  }
  return { text: `${blocks.join(PAGE_BREAK)}\n`, written, cut };
}

/** llms-full.txt's text alone, as {@link llmsFullFile} writes it. */
export async function llmsFullTxt(file: LlmsFullFile): Promise<string> {
  return (await llmsFullFile(file)).text;
}
