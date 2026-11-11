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
  entries: readonly LlmsEntry[];
}

/** `text` on one line, its line breaks and runs of space made one space. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** A link's words, with the brackets that would end it escaped. */
const linkText = (text: string): string =>
  oneLine(text).replace(/[[\]\\]/g, match => `\\${match}`);

/** llms.txt for the site, ending in a newline. */
export function llmsTxt(file: LlmsFile): string {
  const lines = [`# ${oneLine(file.name)}`];
  const summary =
    file.description === undefined ? "" : oneLine(file.description);
  if (summary !== "") lines.push("", `> ${summary}`);
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
