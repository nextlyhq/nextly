/**
 * How the site shapes its files for AI tools, as the SEO settings keep it
 * (`aiFiles`): the sections llms.txt lists its pages under (renamed,
 * ordered, merged, left out or listed under "Optional"), the sections of
 * links the site adds itself, what llms-full.txt holds and how large it may
 * grow, the folders that get llms files of their own, and the fields each
 * content type leaves out of its plain-text copies.
 *
 * Pure and import-free but for the plain-value checks, so the settings
 * screen and the server read and check it the same way.
 *
 * @module settings/ai-files
 */
import { isRecord, textOf } from "../plain-values";

/**
 * One group of pages llms.txt lists, as the site chose to show it. A
 * group is a content type's pages, keyed as the settings key a type (a
 * collection's slug, or `single:<slug>`), or the pages built in code in one
 * folder of the site (`code:docs`; `code:` for those at its root).
 */
export interface AiFilesGroup {
  key: string;
  /**
   * The heading its pages are listed under, in place of the default; two
   * groups given one heading are listed as one section.
   */
  heading?: string;
  /** Listed under the "Optional" section, which AI tools may skip. */
  optional?: boolean;
  /** Left out of llms.txt and llms-full.txt; the sitemap still lists it. */
  leftOut?: boolean;
}

/** A section of links the site adds to llms.txt itself. */
export interface AiFilesExtraSection {
  heading: string;
  /** Its links, one Markdown list item a line: `- [Name](address): notes`. */
  links: string;
}

/** What llms-full.txt holds of the pages llms.txt lists. */
export type AiFilesFullContents =
  | { include: "everything" }
  /** Only the pages of these groups, by key. */
  | { include: "groups"; groups: string[] }
  /** Only the pages whose address starts with one of these paths. */
  | { include: "addresses"; prefixes: string[] };

/** The site's choices for its files for AI tools. Every part is optional. */
export interface AiFiles {
  /** The groups the site chose for, in the order llms.txt lists them. */
  groups?: AiFilesGroup[];
  extraSections?: AiFilesExtraSection[];
  fullContents?: AiFilesFullContents;
  /** The most llms-full.txt may hold, in megabytes: {@link FULL_MB_DEFAULT} unless chosen. */
  fullMaxMegabytes?: number;
  /**
   * Folders of the site that get llms files of their own, as the llms.txt
   * proposal allows: `docs` serves `/docs/llms.txt` (and `/docs/llms-full.txt`
   * beside llms-full.txt), listing only the pages under `/docs`.
   */
  folderFiles?: string[];
  /**
   * The top-level fields left out of each content type's plain-text copies,
   * by the type's key: never written in a copy or in llms-full.txt.
   */
  copyLeftOut?: Record<string, string[]>;
}

/** The size llms-full.txt stops at unless the site chooses another, in megabytes. */
export const FULL_MB_DEFAULT = 5;

/**
 * The sizes the site may choose for llms-full.txt, in megabytes: 5 at most,
 * since AI tools read the file whole.
 */
export const FULL_MB_CHOICES = [1, 2, 3, 4, 5] as const;

/** At most this many groups, extra sections, folders and prefixes are kept. */
export const AI_FILES_LIMITS = {
  groups: 500,
  extraSections: 20,
  linksPerSection: 100,
  folderFiles: 20,
  prefixes: 20,
  fieldsPerType: 500,
} as const;

/** The heading of the section AI tools may skip, as the llms.txt proposal names it. */
export const OPTIONAL_HEADING = "Optional";

/** The default heading of every Single's page. */
export const SINGLES_HEADING = "Pages";

/** The default heading of pages built in code at the site's root. */
const OTHER_PAGES_HEADING = "Other pages";

/** The start of a group key naming a folder of pages built in code. */
export const CODE_GROUP_PREFIX = "code:";

/**
 * The folders the pages built in code at `paths` fill: the first part of
 * each address with more below it (`/docs/start` is in `docs`).
 */
export function codeFolders(paths: Iterable<string>): Set<string> {
  const folders = new Set<string>();
  for (const path of paths) {
    const folder = /^\/([^/]+)\/./.exec(path)?.[1];
    if (folder !== undefined) folders.add(folder);
  }
  return folders;
}

/**
 * The group key of a page built in code at `path`, among pages filling
 * `folders`: its folder's, the folder's own page (`/docs`) included, else
 * the group of the pages at the site's root (`/about`).
 */
export function codeGroupKey(
  path: string,
  folders: ReadonlySet<string>
): string {
  const first = /^\/([^/]+)/.exec(path)?.[1];
  return `${CODE_GROUP_PREFIX}${first !== undefined && folders.has(first) ? first : ""}`;
}

/** A folder's name as a heading: `case-studies` is "Case studies". */
export function folderHeading(folder: string): string {
  const words = folder.replace(/[-_.~]+/g, " ").trim();
  if (words === "") return OTHER_PAGES_HEADING;
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** The default heading of a group of pages built in code, by its key. */
export function codeGroupHeading(key: string): string {
  const folder = key.slice(CODE_GROUP_PREFIX.length);
  return folder === "" ? OTHER_PAGES_HEADING : folderHeading(folder);
}

/** One link of an extra section, as read from its line. */
export interface ExtraLink {
  title: string;
  url: string;
  notes?: string;
}

/** A list item holding one link and, after a colon, its notes. */
const LINK_LINE = /^[-*] \[([^[\]]+)\]\(([^()\s]+)\)(?::\s*(.*))?$/;

/** An address an extra link may point to: a whole web address, or one from the site's root. */
const LINK_ADDRESS = /^(?:https?:\/\/[^\s/]+\.[^\s]*|\/[^\s]*)$/i;

/**
 * Whether `url` reads as an address as the files write it, made whole
 * against the site's origin: the same parse, so an address accepted here
 * never fails the file that writes it.
 */
function parsesAsAddress(url: string): boolean {
  try {
    return new URL(url, "https://example.com").href !== "";
  } catch {
    return false;
  }
}

/** Markup a link's words may not hold: an HTML tag or a heading's start. */
const MARKUP = /<[a-z/!]|`/i;

/** Why one line of an extra section is not a link in plain words; null when it is. */
export function extraLinkProblem(line: string): string | null {
  const read = LINK_LINE.exec(line.trim());
  if (read === null) {
    return `"${line.trim()}" is not a link. Write each as - [Name](https://…), with notes after a colon.`;
  }
  const [, title = "", url = "", notes] = read;
  if (!LINK_ADDRESS.test(url) || !parsesAsAddress(url)) {
    return `${url} is not a web address. Start it with https:// or with / for a page of this site.`;
  }
  if (MARKUP.test(title) || (notes !== undefined && MARKUP.test(notes))) {
    return `"${title.trim()}" holds markup. Write a link's name and notes in plain words.`;
  }
  return null;
}

/** The links an extra section's text holds, one a line, blank lines skipped. */
export function extraLinksOf(links: string): ExtraLink[] {
  return links.split(/\r\n?|\n/).flatMap(line => {
    const read = LINK_LINE.exec(line.trim());
    if (read === null || extraLinkProblem(line) !== null) return [];
    const [, title = "", url = "", notes] = read;
    const said = notes?.trim() ?? "";
    return [
      { title: title.trim(), url, ...(said === "" ? {} : { notes: said }) },
    ];
  });
}

/** Why a heading the site writes is not one line of plain words; null when it is. */
export function headingProblem(heading: string): string | null {
  const said = heading.trim();
  if (said === "") return "A section needs a heading.";
  if (/[\r\n]/.test(heading)) return "A heading is one line.";
  if (said.length > 100) return "A heading is 100 characters at most.";
  if (said.startsWith("#") || MARKUP.test(said)) {
    return `"${said}" holds markup. Write a heading in plain words.`;
  }
  return null;
}

/** Why an extra section is not a heading and links; null when it is. */
export function extraSectionProblem(
  section: AiFilesExtraSection
): string | null {
  const heading = headingProblem(section.heading);
  if (heading !== null) return heading;
  const lines = section.links
    .split(/\r\n?|\n/)
    .filter(line => line.trim() !== "");
  if (lines.length === 0) return `${section.heading.trim()} has no links.`;
  if (lines.length > AI_FILES_LIMITS.linksPerSection) {
    return `${section.heading.trim()} has more than ${AI_FILES_LIMITS.linksPerSection} links.`;
  }
  for (const line of lines) {
    const problem = extraLinkProblem(line);
    if (problem !== null) return problem;
  }
  return null;
}

/** A folder name a file of its own may be served in: one plain folder. */
const FOLDER = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;

/** Why `folder` cannot have llms files of its own; null when it can. */
export function folderProblem(folder: string): string | null {
  const said = folder.trim().replace(/^\/+|\/+$/g, "");
  if (said === "") return "Name the folder, such as docs.";
  return FOLDER.test(said) && said.length <= 100
    ? null
    : `${folder.trim()} is not one folder. Write its name alone, such as docs.`;
}

/** A folder as it is kept: without slashes around it. */
export const keptFolder = (folder: string): string =>
  folder.trim().replace(/^\/+|\/+$/g, "");

/** Why `prefix` is not the start of an address; null when it is. */
export function prefixProblem(prefix: string): string | null {
  const said = prefix.trim();
  return /^\/[^\s]*$/.test(said) && said.length <= 200
    ? null
    : `${said === "" ? "An address" : said} must start with /, such as /docs/.`;
}

/** Whether a page's address, from the site's root, starts with `prefix`. */
export function addressStartsWith(path: string, prefix: string): boolean {
  if (path.startsWith(prefix)) return true;
  // `/docs/` takes in the folder's own page, `/docs`, too.
  return prefix.endsWith("/") && path === prefix.slice(0, -1);
}

/** Whether a page's address is in `folder`: its own page, or one under it. */
export const inFolder = (path: string, folder: string): boolean =>
  path === `/${folder}` || path.startsWith(`/${folder}/`);

/**
 * Whether `folder` has llms files of its own: only one the settings name,
 * and only while llms.txt is served.
 */
export const servesFolderFiles = (
  rules: { llmsTxt?: boolean; aiFiles?: AiFiles },
  folder: string
): boolean =>
  rules.llmsTxt === true && (rules.aiFiles?.folderFiles ?? []).includes(folder);

/**
 * Whether the site's code leaves a field out of plain-text copies:
 * `custom: { seo: { copy: false } }` on the field.
 */
export function leftOutInCode(field: { custom?: unknown }): boolean {
  const { custom } = field;
  return isRecord(custom) && isRecord(custom.seo) && custom.seo.copy === false;
}

/** Each kept text of `value`, where it is a list; none otherwise. */
const textsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(each => (textOf(each) === undefined ? [] : [String(each)]))
    : [];

/**
 * The choices `value` holds, as far as they are well formed: what the
 * settings screen edits. A part that is not one is dropped, so a value
 * written past the screen opens as the parts it can show. The server reads
 * the stored value by its own rule (`settings/ai-files-stored`), refusing a
 * value that breaks it as a whole.
 */
export function aiFilesOf(value: unknown): AiFiles {
  if (!isRecord(value)) return {};
  const groups = Array.isArray(value.groups)
    ? value.groups.filter(isRecord).flatMap(group => {
        const key = typeof group.key === "string" ? group.key : undefined;
        if (key === undefined) return [];
        const heading = textOf(group.heading);
        return [
          {
            key,
            ...(heading === undefined ? {} : { heading }),
            ...(group.optional === true ? { optional: true } : {}),
            ...(group.leftOut === true ? { leftOut: true } : {}),
          },
        ];
      })
    : [];
  const extraSections = Array.isArray(value.extraSections)
    ? value.extraSections.filter(isRecord).map(section => ({
        heading: typeof section.heading === "string" ? section.heading : "",
        links: typeof section.links === "string" ? section.links : "",
      }))
    : [];
  const fullContents = fullContentsOf(value.fullContents);
  const size = value.fullMaxMegabytes;
  const copyLeftOut = isRecord(value.copyLeftOut)
    ? Object.fromEntries(
        Object.entries(value.copyLeftOut)
          .map(([key, names]) => [key, textsOf(names)] as const)
          .filter(([, names]) => names.length > 0)
      )
    : {};
  const folderFiles = textsOf(value.folderFiles);
  return {
    ...(groups.length === 0 ? {} : { groups }),
    ...(extraSections.length === 0 ? {} : { extraSections }),
    ...(fullContents === undefined ? {} : { fullContents }),
    ...(typeof size === "number" &&
    (FULL_MB_CHOICES as readonly number[]).includes(size)
      ? { fullMaxMegabytes: size }
      : {}),
    ...(folderFiles.length === 0 ? {} : { folderFiles }),
    ...(Object.keys(copyLeftOut).length === 0 ? {} : { copyLeftOut }),
  };
}

/** What llms-full.txt holds, where `value` says it well formed. */
function fullContentsOf(value: unknown): AiFilesFullContents | undefined {
  if (!isRecord(value)) return undefined;
  if (value.include === "everything") return { include: "everything" };
  if (value.include === "groups") {
    return { include: "groups", groups: textsOf(value.groups) };
  }
  if (value.include === "addresses") {
    return { include: "addresses", prefixes: textsOf(value.prefixes) };
  }
  return undefined;
}

/**
 * `files` as it is stored: groups the site changed nothing for, blank
 * extra sections, and choices that are the defaults dropped, and null
 * where nothing is left, so undoing every choice clears the value.
 */
export function storedAiFiles(files: AiFiles): AiFiles | null {
  const groups = (files.groups ?? []).map(group => {
    const heading = group.heading?.trim();
    return {
      key: group.key,
      ...(heading === undefined || heading === "" ? {} : { heading }),
      ...(group.optional === true ? { optional: true } : {}),
      ...(group.leftOut === true ? { leftOut: true } : {}),
    };
  });
  const extraSections = (files.extraSections ?? [])
    .map(section => ({
      heading: section.heading.trim(),
      links: section.links
        .split(/\r\n?|\n/)
        .map(line => line.trim())
        .filter(line => line !== "")
        .join("\n"),
    }))
    .filter(section => section.heading !== "" || section.links !== "");
  const folderFiles = [
    ...new Set((files.folderFiles ?? []).map(keptFolder)),
  ].filter(folder => folder !== "");
  const copyLeftOut = Object.fromEntries(
    Object.entries(files.copyLeftOut ?? {}).filter(
      ([, names]) => names.length > 0
    )
  );
  const full = files.fullContents;
  const stored: AiFiles = {
    // Kept whenever the screen placed them: their order is the list's order.
    ...(groups.length === 0 ? {} : { groups }),
    ...(extraSections.length === 0 ? {} : { extraSections }),
    ...(full === undefined || full.include === "everything"
      ? {}
      : {
          fullContents:
            full.include === "groups"
              ? full
              : {
                  include: "addresses",
                  prefixes: full.prefixes
                    .map(prefix => prefix.trim())
                    .filter(prefix => prefix !== ""),
                },
        }),
    ...(files.fullMaxMegabytes === undefined ||
    files.fullMaxMegabytes === FULL_MB_DEFAULT
      ? {}
      : { fullMaxMegabytes: files.fullMaxMegabytes }),
    ...(folderFiles.length === 0 ? {} : { folderFiles }),
    ...(Object.keys(copyLeftOut).length === 0 ? {} : { copyLeftOut }),
  };
  return Object.keys(stored).length === 0 ? null : stored;
}

/** The first problem `check` finds in the parts of `items` that are not blank. */
function firstProblem<T>(
  items: readonly T[],
  blank: (item: T) => boolean,
  check: (item: T) => string | null
): string | null {
  for (const item of items) {
    if (blank(item)) continue;
    const problem = check(item);
    if (problem !== null) return problem;
  }
  return null;
}

/** Why the choices hold more than the stored rule keeps; null when they don't. */
function countProblem(files: AiFiles): string | null {
  const folders = (files.folderFiles ?? []).filter(each => each.trim() !== "");
  if (folders.length > AI_FILES_LIMITS.folderFiles) {
    return `Name ${AI_FILES_LIMITS.folderFiles} folders at most.`;
  }
  const full = files.fullContents;
  const prefixes =
    full?.include === "addresses"
      ? full.prefixes.filter(each => each.trim() !== "")
      : [];
  if (prefixes.length > AI_FILES_LIMITS.prefixes) {
    return `Name ${AI_FILES_LIMITS.prefixes} addresses at most.`;
  }
  return (files.extraSections ?? []).length > AI_FILES_LIMITS.extraSections
    ? `Add ${AI_FILES_LIMITS.extraSections} sections at most.`
    : null;
}

/** Why what llms-full.txt holds is unfinished; null when it is chosen whole. */
function fullContentsProblem(
  full: AiFilesFullContents | undefined
): string | null {
  if (full?.include === "groups") {
    return full.groups.length === 0
      ? "Choose the sections llms-full.txt holds."
      : null;
  }
  if (full?.include !== "addresses") return null;
  const prefixes = full.prefixes.filter(prefix => prefix.trim() !== "");
  if (prefixes.length === 0) {
    return "Name the start of the addresses llms-full.txt holds, such as /docs/.";
  }
  return firstProblem(prefixes, () => false, prefixProblem);
}

/**
 * Why the choices in `files` cannot be saved, said for the screen; null
 * when they can. A blank part is dropped on save, so it holds nothing up.
 * The stored value's rule asks the same of each part.
 */
export function aiFilesProblem(files: AiFiles): string | null {
  return (
    countProblem(files) ??
    firstProblem(
      files.extraSections ?? [],
      section => section.heading.trim() === "" && section.links.trim() === "",
      extraSectionProblem
    ) ??
    firstProblem(
      (files.groups ?? []).map(group => group.heading?.trim() ?? ""),
      heading => heading === "",
      headingProblem
    ) ??
    firstProblem(
      files.folderFiles ?? [],
      folder => folder.trim() === "",
      folderProblem
    ) ??
    fullContentsProblem(files.fullContents)
  );
}

/** Where the settings screen previews llms.txt, under the plugin's routes. */
export const AI_FILES_PREVIEW_ROUTE_PATH = "/settings/ai-files/preview";

/** How many lines of llms.txt the preview shows. */
export const PREVIEW_LINES = 200;

/** One group of pages, as the settings screen lists it. */
export interface AiFilesGroupListed {
  key: string;
  /** The heading it is listed under unless renamed. */
  defaultHeading: string;
  /** How many listed pages it holds. */
  pages: number;
}

/** What the preview route answers. */
export interface AiFilesPreviewBody {
  /** Every group of pages llms.txt lists, left out or not. */
  groups: AiFilesGroupListed[];
  /** The first {@link PREVIEW_LINES} lines of llms.txt, with the choices sent. */
  preview: string;
  /** How many lines the whole file has. */
  lines: number;
}
