/**
 * The Lucide icon set, resolved by id on the server.
 *
 * Its own entry (`@nextlyhq/blocks-react/icons/lucide`) rather than part of the
 * blocks library, because the data is large and only a SERVER render needs
 * it whole: the editor's canvas renders the same blocks in the browser, and
 * importing the set from a block would put every icon in the editor's bundle.
 * A block asks `PageContext.resolveIcon`, and the host decides where the
 * answer comes from — the published page's route supplies this resolver.
 * An icon picker loads this entry through a dynamic `import()` and searches
 * it with `searchLucideIcons`, so the set reaches a browser only when a
 * picker opens.
 *
 * The data is vendored from a pinned Lucide release by
 * `scripts/update-lucide.mjs`, rather than read through `lucide-react`, so a
 * site's own `lucide-react` version can never rename an icon on a published
 * page. Lucide is ISC-licensed; the licence ships in `third-party/lucide`.
 *
 * @module icons/lucide
 */
import type { ResolvedIcon } from "../context";

import type * as LucideSet from "./lucide-data";

/*
 * The set itself, loaded on first use and kept for the life of the process.
 * Imported statically, every server render and every cold start would parse
 * the whole set, on a site that never draws an icon as much as on one that
 * does. A load that fails is not kept: in a browser the set is a chunk
 * fetched over the network, and a fetch that failed once may succeed when
 * the next search or resolve tries again.
 */
let loaded: Promise<typeof LucideSet> | undefined;
function lucideSet(): Promise<typeof LucideSet> {
  if (loaded !== undefined) return loaded;
  const loading = import("./lucide-data");
  loaded = loading;
  loading.catch(() => {
    if (loaded === loading) loaded = undefined;
  });
  return loading;
}

/** The set prefix every Lucide id carries: `lucide:star`. */
export const LUCIDE_PREFIX = "lucide";

/** The box every Lucide icon is drawn in. */
const VIEW_BOX = "0 0 24 24";

/**
 * An icon id's set and name, or `null` when it is not one: a set, a colon and
 * a name, each lower-case letters, digits and hyphens.
 */
export function parseIconId(
  id: string
): { readonly set: string; readonly name: string } | null {
  const match = /^([a-z0-9-]+):([a-z0-9-]+)$/.exec(id);
  return match === null ? null : { set: match[1] ?? "", name: match[2] ?? "" };
}

/**
 * A Lucide icon by id, or `null` for an id this set does not draw. A name
 * Lucide has renamed resolves to the icon it now is, so an id stored before a
 * rename keeps drawing; the answer names the current icon.
 */
export async function resolveLucideIcon(
  id: string
): Promise<ResolvedIcon | null> {
  const parsed = parseIconId(id);
  if (parsed === null || parsed.set !== LUCIDE_PREFIX) return null;
  const { LUCIDE_ALIASES, LUCIDE_ICONS } = await lucideSet();
  const name = Object.hasOwn(LUCIDE_ICONS, parsed.name)
    ? parsed.name
    : Object.hasOwn(LUCIDE_ALIASES, parsed.name)
      ? LUCIDE_ALIASES[parsed.name]
      : undefined;
  const body = name === undefined ? undefined : LUCIDE_ICONS[name];
  if (name === undefined || body === undefined) return null;
  return {
    id: `${LUCIDE_PREFIX}:${name}`,
    name,
    body,
    viewBox: VIEW_BOX,
    stroked: true,
  };
}

/** The words an icon is found by, for a picker's search. */
export async function lucideTagsOf(name: string): Promise<readonly string[]> {
  const { LUCIDE_TAGS } = await lucideSet();
  return Object.hasOwn(LUCIDE_TAGS, name) ? (LUCIDE_TAGS[name] ?? []) : [];
}

/** The Lucide release the set was taken from. */
export async function lucideVersion(): Promise<string> {
  return (await lucideSet()).LUCIDE_VERSION;
}

/** One icon a search found: the icon itself and the words it is found by. */
export interface LucideSearchResult extends ResolvedIcon {
  readonly tags: readonly string[];
}

/**
 * Text as a search compares it: lower case, with spaces, underscores and
 * repeated hyphens read as one hyphen, so `Arrow up` finds `arrow-up`.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Whether `query` starts one of the hyphen-separated words of `text`. */
const startsAWord = (text: string, query: string): boolean =>
  text.startsWith(query) || text.includes(`-${query}`);

/** What a search compares a query with: an icon's name, former names and tags. */
interface SearchedIcon {
  readonly name: string;
  readonly formerNames: readonly string[];
  readonly tags: readonly string[];
}

/** One way a query can match an icon. */
type MatchKind = (query: string, icon: SearchedIcon) => boolean;

/**
 * A query of several words, each starting a word of the name, a former name
 * or a tag: `circle out` finds `circle-arrow-out-up-right`.
 */
const everyWordStartsAWord: MatchKind = (query, icon) => {
  const words = query.split("-");
  const texts = [icon.name, ...icon.formerNames, ...icon.tags];
  return (
    words.length > 1 &&
    words.every(word => texts.some(text => startsAWord(text, word)))
  );
};

/**
 * The ways a query can match an icon, best first; a match ranks by the first
 * kind it meets. In order: the name itself; a name Lucide renamed from, typed
 * in full; the start of the name; the start of a word in the name; the start
 * of a word in a former name; a tag in full; the start of a word in a tag;
 * anywhere in the name; every word of the query starting a word of the icon.
 */
const MATCH_KINDS: readonly MatchKind[] = [
  (query, { name }) => name === query,
  (query, { formerNames }) => formerNames.includes(query),
  (query, { name }) => name.startsWith(query),
  (query, { name }) => startsAWord(name, query),
  (query, { formerNames }) =>
    formerNames.some(former => startsAWord(former, query)),
  (query, { tags }) => tags.includes(query),
  (query, { tags }) => tags.some(tag => startsAWord(tag, query)),
  (query, { name }) => name.includes(query),
  everyWordStartsAWord,
];

/**
 * How well an icon matches, lower being better, or `undefined` for no match:
 * the place in {@link MATCH_KINDS} of the first kind of match it meets.
 */
function rankOf(query: string, icon: SearchedIcon): number | undefined {
  const rank = MATCH_KINDS.findIndex(matches => matches(query, icon));
  return rank === -1 ? undefined : rank;
}

/**
 * Lucide icons matching a query, best match first, at most `limit` of them.
 *
 * Matched by name, by a name Lucide has since renamed (answered with the icon
 * it is now), and by the words Lucide tags it with: `delivery` finds `truck`.
 * Ties go to the shorter name, then the alphabetically first. An empty query
 * lists the whole set in name order.
 */
export async function searchLucideIcons(
  query: string,
  limit: number = Number.POSITIVE_INFINITY
): Promise<readonly LucideSearchResult[]> {
  const { LUCIDE_ALIASES, LUCIDE_ICONS, LUCIDE_TAGS } = await lucideSet();
  const wanted = normalize(query);
  const formerNamesOf = new Map<string, string[]>();
  for (const [former, current] of Object.entries(LUCIDE_ALIASES)) {
    formerNamesOf.set(current, [...(formerNamesOf.get(current) ?? []), former]);
  }

  const ranked: { name: string; rank: number }[] = [];
  for (const name of Object.keys(LUCIDE_ICONS)) {
    const rank =
      wanted === ""
        ? 0
        : rankOf(wanted, {
            name,
            formerNames: formerNamesOf.get(name) ?? [],
            tags: (LUCIDE_TAGS[name] ?? []).map(normalize),
          });
    if (rank !== undefined) ranked.push({ name, rank });
  }
  const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  // The whole set reads in name order; a search reads best match first.
  ranked.sort((a, b) =>
    wanted === ""
      ? byName(a.name, b.name)
      : a.rank - b.rank ||
        a.name.length - b.name.length ||
        byName(a.name, b.name)
  );

  return ranked.slice(0, Math.max(0, limit)).map(({ name }) => ({
    id: `${LUCIDE_PREFIX}:${name}`,
    name,
    body: LUCIDE_ICONS[name] ?? "",
    viewBox: VIEW_BOX,
    stroked: true,
    tags: LUCIDE_TAGS[name] ?? [],
  }));
}

/**
 * The set as an icon picker's source: its prefix, its name as a person reads
 * it, and its search and resolve. Shaped as `@nextlyhq/ui`'s `IconSource`,
 * which this package cannot import, so every picker (the admin's icon field,
 * the page builder's Icon control) reads the set through this one object
 * rather than each assembling its own.
 */
export const lucideIconSource: LucideIconSource = {
  prefix: LUCIDE_PREFIX,
  label: "Lucide",
  search: query => searchLucideIcons(query),
  resolve: id => resolveLucideIcon(id),
};

/** The shape of {@link lucideIconSource}. */
export interface LucideIconSource {
  readonly prefix: string;
  readonly label: string;
  search(query: string): Promise<readonly LucideSearchResult[]>;
  resolve(id: string): Promise<ResolvedIcon | null>;
}
