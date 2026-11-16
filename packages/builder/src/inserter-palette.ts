/**
 * The palette's search and grouping: which entries a query finds, the groups
 * by category in the order the palette shows them, and each category's
 * heading.
 *
 * @module inserter-palette
 */

import { EDITOR_WORDS } from "./editor-words";
import {
  COMPONENT_CATEGORY,
  type InsertEntry,
  UNCATEGORISED,
} from "./inserter-types";

/**
 * Narrow the catalog by what the author typed.
 *
 * Matches the label, the namespaced block name, the declared keywords and the
 * description — the block name included because it is what appears in
 * documentation and in an agent's output, so someone who knows `core/heading`
 * should not have to guess that it is labelled "Heading".
 *
 * An empty or whitespace-only query returns the list unchanged rather than
 * nothing: the panel opens with no query, and a filter that treated that as
 * "match nothing" would show an empty palette on open.
 */
export function filterEntries<TEntry extends InsertEntry>(
  entries: readonly TEntry[],
  query: string
): TEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...entries];
  return entries.filter(entry =>
    searchableWords(entry).some(field => field.toLowerCase().includes(needle))
  );
}

/**
 * The words one entry is matched on.
 *
 * A block additionally carries its namespaced name because that is what appears
 * in documentation and in an agent's output. A pattern has no such identity to
 * offer — its stored id is a row key nobody types — so the tier decides the
 * list rather than every field being read off whichever entry arrives.
 */
function searchableWords(entry: InsertEntry): readonly string[] {
  const shared = [entry.label, entry.description, ...entry.keywords];
  return entry.kind === "block" ? [entry.blockName, ...shared] : shared;
}

/** A category heading and the entries under it, in the order the panel draws them. */
export interface InsertGroup<TEntry extends InsertEntry = InsertEntry> {
  readonly category: string;
  readonly entries: readonly TEntry[];
}

/**
 * Group entries under their categories.
 *
 * `preferred` names the headings a library wants offered first — a page starts
 * as structure, so "layout" belongs above "interactive", and neither
 * first-appearance nor an alphabetical sort produces that. It is a caller's
 * declaration rather than a constant here, because categories are free strings
 * contributed by any plugin and this module has no standing to rank them.
 *
 * Categories outside `preferred` follow, in first-appearance order. A plugin
 * that ships an unranked category still gets a heading rather than being hidden
 * behind a list it was never named in — dropping it would make a block
 * unreachable through the very panel that exists to reach it.
 */
export function groupByCategory<TEntry extends InsertEntry>(
  entries: readonly TEntry[],
  preferred: readonly string[] = []
): InsertGroup<TEntry>[] {
  const groups = new Map<string, TEntry[]>();
  for (const entry of entries) {
    const bucket = groups.get(entry.category);
    if (bucket === undefined) groups.set(entry.category, [entry]);
    else bucket.push(entry);
  }

  // Ranked first, in the order declared; then everything else as it arrived.
  // `preferred` may name categories nothing claims, so it is filtered against
  // what is actually present rather than trusted to describe this catalogue.
  const ranked = preferred.filter(category => groups.has(category));
  const rest = [...groups.keys()].filter(
    category => !ranked.includes(category)
  );

  return [...ranked, ...rest].map(category => ({
    category,
    entries: groups.get(category) ?? [],
  }));
}

/**
 * The groups the Add panel draws, in its order: the categories the host ranks
 * (the library's own), then the site's components, then any other category a
 * plugin declared, then the blocks that declared none.
 *
 * Derived from {@link groupByCategory} rather than grouped again, so the two
 * cannot disagree about which entries share a heading; this only decides where
 * the two headings the panel itself names sit. The components follow the
 * ranked categories because they are what an author reaches for next once the
 * basic blocks are passed. The uncategorised go last, because "More blocks" is
 * a remainder and reads as one only at the end.
 */
export function paletteGroups<TEntry extends InsertEntry>(
  entries: readonly TEntry[],
  preferred: readonly string[] = [],
  blockOrder: readonly string[] = []
): InsertGroup<TEntry>[] {
  const groups = groupByCategory(entries, [
    ...preferred,
    COMPONENT_CATEGORY,
  ]).map(group => ({
    ...group,
    entries: inBlockOrder(group.entries, blockOrder),
  }));
  return [
    ...groups.filter(group => group.category !== UNCATEGORISED),
    ...groups.filter(group => group.category === UNCATEGORISED),
  ];
}

/**
 * A group's entries with the blocks the host ranks first, in its order, and
 * everything else after them as it arrived (by label). A sort that keeps
 * ties in place, so a block's variations stay right behind it.
 */
function inBlockOrder<TEntry extends InsertEntry>(
  entries: readonly TEntry[],
  blockOrder: readonly string[]
): TEntry[] {
  if (blockOrder.length === 0) return [...entries];
  const rank = new Map(blockOrder.map((name, index) => [name, index]));
  const rankOf = (entry: TEntry): number =>
    (entry.kind === "block" ? rank.get(entry.blockName) : undefined) ??
    blockOrder.length;
  return [...entries].sort((a, b) => rankOf(a) - rankOf(b));
}

/**
 * The words a category's heading is drawn with.
 *
 * The library's category ids are words for code ("content"), so the ones it
 * declares are named as an author reads them; "content" is "Text" because that
 * is what the blocks under it are. The two groups the panel itself makes are
 * named here too. A plugin's category is a free string it chose to be read,
 * so it is drawn as written.
 */
export function categoryHeading(category: string): string {
  return Object.hasOwn(CATEGORY_HEADINGS, category)
    ? (CATEGORY_HEADINGS[category] ?? category)
    : category;
}

/**
 * The headings {@link categoryHeading} names, keyed by category id. Read with
 * `Object.hasOwn` because a category is a plugin's free string, and a plain
 * object would answer "constructor" with an inherited function.
 */
const CATEGORY_HEADINGS: Readonly<Record<string, string>> = {
  layout: "Layout",
  content: "Text",
  // What a template draws of the entry itself.
  entry: "Entry",
  media: "Media",
  interactive: "Interactive",
  // The two groups the panel makes are named with the editor's words.
  [COMPONENT_CATEGORY]: `Your ${EDITOR_WORDS.components.toLowerCase()}`,
  [UNCATEGORISED]: `More ${EDITOR_WORDS.blocks.toLowerCase()}`,
};
