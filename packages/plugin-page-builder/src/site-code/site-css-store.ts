/**
 * Where the site's own CSS is kept: rows of the plugin's `site_options`
 * table, written only by the site code routes (`site-code/css-route`).
 *
 * The table holds a value of at most 255 characters on MySQL, and site CSS
 * may be 50,000, so it is kept as a header row and its parts:
 *
 * - `site-css`: what is stored, by its SHA-256, its length and its number of
 *   parts, who saved it (`user:<id>`), and a mark new on every save;
 * - `site-css:000`, `site-css:001`, …: the CSS itself, in parts of at most
 *   255 characters, never splitting a character in two.
 *
 * A save is one transaction: the header row is compared and set (it changes
 * only if it is still the one the save read), then the parts are replaced.
 * So of two saves made from one read, only one lands, and a read, taking
 * every row in one statement, never sees half of a save.
 *
 * There is no version history: a save replaces what was there.
 *
 * @module site-code/site-css-store
 * @experimental
 */
import { and, eq, like, or } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
} from "@nextlyhq/plugin-sdk/schema";

import { siteOptions } from "../schema/tables";
import { sha256Hex } from "../sha256-hex";

/** The header row's name. */
export const SITE_CSS_OPTION = "site-css";

/** The start of each part row's name. */
const PART_PREFIX = `${SITE_CSS_OPTION}:`;

/** The most characters one part holds: the table's value on MySQL. */
export const SITE_CSS_PART_CHARS = 255;

/**
 * The plugin cache part every read of the site CSS a page caches is tagged
 * with, and a save expires.
 */
export const SITE_CSS_CACHE_PART = "site-css";

/** What a save made since this one's read is refused with. */
export const SITE_CSS_STALE = "Someone changed the site CSS; reload to see it";

/** The dialect, for telling a unique-name refusal apart. */
export type SiteCssDialect = Parameters<typeof isUniqueViolation>[0];

/** The database surface the CSS is kept through. */
export type SiteCssDatabase = Pick<
  PluginDatabase,
  "select" | "table" | "transaction"
>;

/** The site CSS as stored. */
export interface StoredSiteCss {
  /** The CSS, or empty when none is saved. */
  readonly css: string;
  /** Its SHA-256, which a save made from this read hands back. */
  readonly sha256: string;
  /** Who saved it last, as `user:<id>`; `null` before any save. */
  readonly changedBy: string | null;
  /** When it was saved last, as an ISO date; `null` before any save. */
  readonly changedAt: string | null;
}

/** What one save changed, for its audit row. */
export interface SiteCssWrite {
  readonly before: { readonly sha256: string; readonly chars: number };
  readonly after: { readonly sha256: string; readonly chars: number };
}

/** A save refused because the CSS changed since it was read. */
export class SiteCssStaleError extends Error {
  constructor() {
    super(SITE_CSS_STALE);
    this.name = "SiteCssStaleError";
  }
}

/** The header row's value. */
interface Header {
  readonly sha256: string;
  readonly chars: number;
  readonly parts: number;
  readonly by: string | null;
}

/** The CSS in parts of at most {@link SITE_CSS_PART_CHARS}, characters kept whole. */
export function siteCssParts(css: string): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < css.length) {
    let end = Math.min(start + SITE_CSS_PART_CHARS, css.length);
    // A part never ends between the two halves of a surrogate pair.
    const last = css.charCodeAt(end - 1);
    if (end < css.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    parts.push(css.slice(start, end));
    start = end;
  }
  return parts;
}

/** A part row's name: its place, padded so names sort as parts do. */
function partName(index: number): string {
  return `${PART_PREFIX}${String(index).padStart(3, "0")}`;
}

/** The header's value as stored, with a mark new to this save. */
function headerValue(header: Header): string {
  return JSON.stringify({
    ...header,
    // New on every save, so the compare-and-set always changes the row:
    // MySQL counts changed rows, and an unchanged one would read as stale.
    mark: globalThis.crypto.randomUUID().slice(0, 12),
  });
}

/** A stored header's value, or `undefined` when it can't be read. */
function headerOf(value: string): Header | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  const header = parsed as Partial<Header> | null;
  if (
    typeof header?.sha256 !== "string" ||
    typeof header.chars !== "number" ||
    typeof header.parts !== "number"
  ) {
    return undefined;
  }
  return {
    sha256: header.sha256,
    chars: header.chars,
    parts: header.parts,
    by: typeof header.by === "string" ? header.by : null,
  };
}

/** A stored time as an ISO date. */
function isoOf(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value !== "") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }
  return null;
}

/** One row of the table, as read. */
interface Row {
  readonly name: string;
  readonly value: string;
  readonly updatedAt?: unknown;
}

/**
 * The CSS the rows hold, or empty when they don't hold all of it (a row
 * edited or removed in the database, say): what is drawn is never a part of
 * what was saved.
 */
async function cssOf(header: Header, rows: readonly Row[]): Promise<string> {
  const parts = new Map(
    rows
      .filter(row => row.name.startsWith(PART_PREFIX))
      .map(row => [row.name, row.value])
  );
  const css = Array.from({ length: header.parts }, (_, index) =>
    parts.get(partName(index))
  );
  if (css.every(part => part !== undefined)) {
    const joined = css.join("");
    if ((await sha256Hex(joined)) === header.sha256) return joined;
  }
  console.warn(
    "[page-builder] The stored site CSS is incomplete, so none of it is drawn. Save it again in Settings."
  );
  return "";
}

/** The site CSS as stored, read in one statement. */
export async function readStoredSiteCss(
  db: Pick<PluginDatabase, "select" | "table">
): Promise<StoredSiteCss> {
  const t = db.table(siteOptions);
  const where = or(eq(t.name, SITE_CSS_OPTION), like(t.name, `${PART_PREFIX}%`));
  const rows = (
    where === undefined ? [] : await db.select(siteOptions).where(where).all()
  ) as Row[];
  const headerRow = rows.find(row => row.name === SITE_CSS_OPTION);
  const header =
    headerRow === undefined ? undefined : headerOf(headerRow.value);
  if (header === undefined) {
    return {
      css: "",
      sha256: await sha256Hex(""),
      changedBy: null,
      changedAt: null,
    };
  }
  return {
    css: await cssOf(header, rows),
    sha256: header.sha256,
    changedBy: header.by,
    changedAt: isoOf(headerRow?.updatedAt),
  };
}

/** What a save is asked to store. */
export interface SiteCssSave {
  readonly css: string;
  /** The SHA-256 of the CSS the person read: the save is refused if it changed. */
  readonly readSha256: string;
  /** Who is saving, as `user:<id>`. */
  readonly changedBy: string;
}

/**
 * Save the site CSS, if what is stored is still what the person read.
 * Throws {@link SiteCssStaleError} when it isn't.
 */
export async function saveSiteCss(
  db: SiteCssDatabase,
  dialect: SiteCssDialect,
  save: SiteCssSave
): Promise<SiteCssWrite> {
  const parts = siteCssParts(save.css);
  const after = { sha256: await sha256Hex(save.css), chars: save.css.length };
  const value = headerValue({
    ...after,
    parts: parts.length,
    by: save.changedBy,
  });
  const none = await sha256Hex("");
  try {
    return await db.transaction(async tx => {
      const t = tx.table(siteOptions);
      const row = (await tx
        .select(siteOptions)
        .where(eq(t.name, SITE_CSS_OPTION))
        .first()) as Row | null;
      const header = row === null ? undefined : headerOf(row.value);
      const before = header ?? { sha256: none, chars: 0 };
      if (before.sha256 !== save.readSha256) throw new SiteCssStaleError();
      if (row === null) {
        // Two first saves at once: the unique name refuses the second.
        await tx.insert(siteOptions, { name: SITE_CSS_OPTION, value });
      } else {
        const same = and(eq(t.name, SITE_CSS_OPTION), eq(t.value, row.value));
        const changed =
          same === undefined
            ? 0
            : await tx
                .update(siteOptions, { value, updatedAt: new Date() })
                .where(same);
        if (changed !== 1) throw new SiteCssStaleError();
      }
      await tx.delete(siteOptions).where(like(t.name, `${PART_PREFIX}%`));
      if (parts.length > 0) {
        await tx.insert(
          siteOptions,
          parts.map((part, index) => ({ name: partName(index), value: part }))
        );
      }
      return {
        before: { sha256: before.sha256, chars: before.chars },
        after,
      };
    });
  } catch (error) {
    if (isUniqueViolation(dialect, error)) throw new SiteCssStaleError();
    throw error;
  }
}
