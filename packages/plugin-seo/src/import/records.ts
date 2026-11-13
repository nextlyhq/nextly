/**
 * What every import source is read into: one record per page it names, with
 * the values it holds for each place a value can go, how the record is
 * matched to a page here, and what the source called each place. Pure.
 *
 * WordPress plugins store titles as templates, such as Yoast's
 * `%%title%% %%sep%% %%sitename%%`; a template is filled in with the page's
 * own title and the site's name and separator from the SEO settings, and a
 * value naming anything else is left out rather than imported with a hole.
 *
 * @module import/records
 */
import type { ImportTarget } from "./contract";

/**
 * Why a file can't be read as the export it was chosen as, in one sentence a
 * person can act on. Thrown by the file readers, which run in the browser as
 * well as on the server and so import nothing from the server; the import's
 * routes answer it as invalid input.
 */
export class ImportFileRefused extends Error {
  /** What kind of refusal it is, for the server's log. */
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = "ImportFileRefused";
    this.reason = reason;
  }
}

/** A share image as a source names it: an id here, or an address. */
export type ImageRef = { id: string } | { url: string };

/** The values one record holds, by where each goes. */
export interface ImportedValues {
  title?: string;
  description?: string;
  socialTitle?: string;
  socialDescription?: string;
  canonical?: string;
  image?: ImageRef;
  /** Hidden from search (true), or said to be shown (false). */
  hidden?: boolean;
}

/** The template language a record's text is written in. */
export type Variables = "yoast" | "rankMath";

/** How a record is matched to a page here. */
export interface RecordMatch {
  /** The page itself, where the record was read from it. */
  page?: { type: string; id: string };
  /** The address the record was served at, from the root. */
  path?: string;
  /** Its slug, where the source gives one. */
  slug?: string;
}

/** A redirect a record asks for. */
export interface ImportedRedirect {
  /** The address it is from, as a URL spells it, where the source gives one. */
  source?: string;
  /** That address in full, as the source wrote it. */
  address?: string;
  target: string;
  permanent: boolean;
}

/** One page's values as a source holds them. */
export interface ImportedRecord {
  /** How the person would recognise it: its title, else its address. */
  label: string;
  match: RecordMatch;
  values: ImportedValues;
  variables?: Variables;
  /** The page's own title in the source, for its templates. */
  sourceTitle?: string;
  redirect?: ImportedRedirect;
}

/** A source, read. */
export interface ParsedSource {
  records: ImportedRecord[];
  /** What the source calls the field each place's values come from. */
  from: Partial<Record<ImportTarget, string[]>>;
  /** The source's fields the import leaves out. */
  left: string[];
  warnings: string[];
}

/** A value's text with something in it, trimmed, or none. */
export function textValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The path an address names, from the root and without a trailing slash,
 * or none where it is not an address. A path alone is read as one.
 */
export function pathOfAddress(address: string | undefined): string | undefined {
  const path = spelledPathOf(address);
  if (path === undefined) return undefined;
  let decoded = path;
  try {
    decoded = decodeURI(path);
  } catch {
    // An address with a stray percent sign is matched as it is spelled.
  }
  const trimmed = decoded.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * The path an address names as a URL spells it, percent-encoded, without a
 * trailing slash: what a redirect from it is stored as, since the redirect
 * rules read a source as a URL spells it.
 */
export function spelledPathOf(address: string | undefined): string | undefined {
  const text = textValue(address);
  if (text === undefined) return undefined;
  try {
    const path = new URL(text, "https://example.invalid").pathname;
    const trimmed = path.replace(/\/+$/, "");
    return trimmed === "" ? "/" : trimmed;
  } catch {
    return undefined;
  }
}

/** What a template is filled in with. */
export interface TemplateValues {
  title?: string;
  siteName?: string;
  separator: string;
  siteDescription?: string;
}

/** The variables each template language spells, by what fills them. */
const VARIABLES: Readonly<Record<Variables, { open: string; close: string }>> =
  {
    yoast: { open: "%%", close: "%%" },
    rankMath: { open: "%", close: "%" },
  };

/**
 * `text` with its template variables filled in, or none where it names a
 * variable that cannot be, or one with no value here. A page number is empty
 * on a page's own address, as it is on the first page of a list.
 */
export function fillTemplate(
  text: string,
  variables: Variables | undefined,
  values: TemplateValues
): string | undefined {
  if (variables === undefined) return text;
  const { open, close } = VARIABLES[variables];
  const escape = (part: string) => part.replace(/[%]/g, "\\%");
  // A variable may take arguments, as Rank Math's `%customfield(price)%`
  // does; none is one Nextly can fill, so it leaves its value out.
  const pattern = new RegExp(
    `${escape(open)}([a-z0-9_]+)(\\([^)]*\\))?${escape(close)}`,
    "gi"
  );
  const known: Readonly<Record<string, string | undefined>> = {
    title: values.title,
    sitename: values.siteName,
    sep: values.separator,
    sitedesc: values.siteDescription,
    page: "",
    pagenumber: "",
  };
  let missing = false;
  const filled = text.replace(pattern, (_, name: string, args?: string) => {
    const key = name.toLowerCase();
    const value =
      args === undefined && Object.hasOwn(known, key) ? known[key] : undefined;
    if (value === undefined) missing = true;
    return value ?? "";
  });
  if (missing) return undefined;
  // A variable filled in empty leaves its spaces behind.
  const tidy = filled.replace(/\s{2,}/g, " ").trim();
  return tidy === "" ? undefined : tidy;
}

/** An id as text: a string or a number, or none. */
export function idText(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  return typeof value === "number" ? String(value) : undefined;
}

/** `n pages`, `1 page`, or the same of another noun. */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
