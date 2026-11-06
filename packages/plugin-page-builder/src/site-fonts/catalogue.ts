/**
 * Reading the Fontsource catalogue: its list of families and one family's
 * metadata, parsed at the boundary.
 *
 * Both answers come from another server, so neither is trusted past here.
 * An entry this cannot read is skipped and counted rather than failing the
 * list, and nothing an entry says is used to build an address without first
 * matching the narrow grammar below.
 *
 * @module site-fonts/catalogue
 */
import { z } from "nextly/zod";

import {
  FONT_CATEGORIES,
  type CatalogueFamily,
  type FontStyleName,
} from "./contract";

/** A catalogue id: lower-case words joined by single hyphens. */
export const FONT_ID: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The longest catalogue id accepted. Real ids are far shorter. */
export const MAX_FONT_ID_LENGTH = 64;

/** A script's name, such as `latin-ext`, as it appears in a file name. */
export const SUBSET_NAME: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A plain release number, the only version a file address is pinned to. */
const RELEASE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** A `unicode-range`, in characters that cannot leave a CSS descriptor. */
const UNICODE_RANGE =
  /^[Uu]\+[0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?(?:\s*,\s*[Uu]\+[0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?)*$/;

const STYLE_ORDER: readonly FontStyleName[] = ["normal", "italic"];

/**
 * Scripts the catalogue serves as many numbered files (`[0]` to `[119]`)
 * rather than one file with one range: Japanese, Korean and Chinese. One add
 * downloads a few files, so these are not offered; a family keeps its other
 * scripts.
 */
const SPLIT_SUBSETS: ReadonlySet<string> = new Set([
  "japanese",
  "korean",
  "chinese-simplified",
  "chinese-traditional",
  "chinese-hongkong",
]);

/** The script a family starts from: its own, else Latin when it was split. */
function startingSubset(
  subsets: readonly string[],
  preferred: string
): string | undefined {
  if (subsets.includes(preferred)) return preferred;
  return subsets.includes("latin") ? "latin" : undefined;
}

const Entry = z.object({
  id: z.string().max(MAX_FONT_ID_LENGTH).regex(FONT_ID),
  family: z.string().min(1).max(200),
  subsets: z.array(z.string()),
  weights: z.array(z.number()),
  styles: z.array(z.string()),
  defSubset: z.string(),
  variable: z.boolean(),
  category: z.string(),
  license: z.string().max(100),
  type: z.string(),
});

type Entry = z.infer<typeof Entry>;

const Metadata = Entry.extend({
  npmVersion: z.string().regex(RELEASE),
  unicodeRange: z.record(z.string(), z.string().max(4000).regex(UNICODE_RANGE)),
});

/** One family's metadata, as an add reads it. */
export interface FontMetadata extends CatalogueFamily {
  /** Where the family comes from; only `google` may be added. */
  readonly type: string;
  /** The catalogue package's release, which file addresses are pinned to. */
  readonly version: string;
  /** Each script's `unicode-range`. */
  readonly unicodeRange: Readonly<Record<string, string>>;
}

/** Whether a category is one the editor offers. Icon fonts are not text. */
function isCategory(value: string): value is CatalogueFamily["category"] {
  return (FONT_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The family as the editor lists it, or nothing when it is not a Google text
 * family. Weights a face could not be stored with, and names that could not
 * be part of a file address, are dropped.
 */
function familyOf(entry: Entry): CatalogueFamily | undefined {
  if (entry.type !== "google" || !isCategory(entry.category)) return undefined;
  const subsets = entry.subsets.filter(
    subset => SUBSET_NAME.test(subset) && !SPLIT_SUBSETS.has(subset)
  );
  const defSubset = startingSubset(subsets, entry.defSubset);
  if (defSubset === undefined) return undefined;
  const styles = STYLE_ORDER.filter(style => entry.styles.includes(style));
  const weights = entry.weights.filter(
    weight =>
      Number.isInteger(weight) &&
      weight % 100 === 0 &&
      weight >= 100 &&
      weight <= 900
  );
  if (styles.length === 0 || weights.length === 0) return undefined;
  return {
    id: entry.id,
    family: entry.family,
    category: entry.category,
    weights: [...new Set(weights)].sort((a, b) => a - b),
    styles,
    subsets,
    defSubset,
    variable: entry.variable,
    licence: entry.license,
  };
}

/**
 * The catalogue's list, as families the editor can offer.
 *
 * `skipped` counts entries that could not be read at all, which is worth a
 * line in the log; families filtered out on purpose (another source, an icon
 * font) are not counted. `unreadable` says the answer was not a list.
 */
export function parseCatalogue(raw: unknown): {
  families: CatalogueFamily[];
  skipped: number;
  unreadable?: true;
} {
  if (!Array.isArray(raw))
    return { families: [], skipped: 0, unreadable: true };
  const families: CatalogueFamily[] = [];
  let skipped = 0;
  for (const item of raw) {
    const parsed = Entry.safeParse(item);
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    const family = familyOf(parsed.data);
    if (family !== undefined) families.push(family);
  }
  return { families, skipped };
}

/** One family's metadata, or nothing when any part of it cannot be trusted. */
export function parseFontMetadata(raw: unknown): FontMetadata | undefined {
  const parsed = Metadata.safeParse(raw);
  if (!parsed.success) return undefined;
  const family = familyOf(parsed.data);
  if (family === undefined) return undefined;
  return {
    ...family,
    type: parsed.data.type,
    version: parsed.data.npmVersion,
    unicodeRange: parsed.data.unicodeRange,
  };
}

const Versions = z.object({ latestVariable: z.string().regex(RELEASE) });

/**
 * The variable package's own latest release, from the catalogue's version
 * answer. Static and variable packages are released separately, so a variable
 * file is pinned to this rather than to the family's `npmVersion`. Nothing
 * when there is no variable package or its version cannot be trusted.
 */
export function parseVariableVersion(raw: unknown): string | undefined {
  const parsed = Versions.safeParse(raw);
  return parsed.success ? parsed.data.latestVariable : undefined;
}

/** One family's figures in the stats answer: only the total month is read. */
const StatsEntry = z.object({
  total: z.object({ npmDownloadMonthly: z.number().int().nonnegative() }),
});

/**
 * How popular each family is, from the catalogue's stats answer: its total
 * monthly downloads, by catalogue id.
 *
 * An entry whose figure is missing or unreadable counts as 0 rather than
 * failing the answer, so one odd family cannot cost the rest their order.
 * Nothing when the answer is not an object of families at all, which the
 * editor reads as "order by name".
 */
export function parseCatalogueStats(
  raw: unknown
): ReadonlyMap<string, number> | undefined {
  const parsed = z.record(z.string(), z.unknown()).safeParse(raw);
  if (!parsed.success) return undefined;
  const popularity = new Map<string, number>();
  for (const [id, entry] of Object.entries(parsed.data)) {
    const figures = StatsEntry.safeParse(entry);
    popularity.set(
      id,
      figures.success ? figures.data.total.npmDownloadMonthly : 0
    );
  }
  return popularity;
}

/**
 * The families with their popularity, 0 for one the stats do not name; the
 * families as they are when there are no stats, so the field's absence says
 * that nothing is known rather than that nobody uses them.
 */
export function withPopularity(
  families: readonly CatalogueFamily[],
  stats: ReadonlyMap<string, number> | undefined
): CatalogueFamily[] {
  if (stats === undefined) return [...families];
  return families.map(family => ({
    ...family,
    popularity: stats.get(family.id) ?? 0,
  }));
}
