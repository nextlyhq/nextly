/**
 * The saved patterns the insert panel may offer, read once per editor.
 *
 * The panel has accepted a `patterns` prop since the tier landed and nothing
 * supplied one, so the whole tier was unreachable: an author could save a
 * pattern and never see it again. This is the read that connects the two.
 *
 * ## What it does NOT do
 *
 * It does not decide which patterns are offerable. `patternEntriesFrom` runs
 * the planner's own preflight over each one — the wrong kind, no nodes, an
 * envelope the apply cannot read, a nesting the rules no longer allow — and a
 * second opinion here would be a narrower one that disagrees the first time the
 * planner learns a new way to say no. So this hands over what the route
 * returned and lets the panel refuse.
 *
 * @module admin/pattern-library-client
 */
import type { SavedPattern } from "@nextlyhq/builder";
import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useMemo } from "react";

// The CONTRACT, not the route. The route reaches the collection through
// `nextly/config`, which is server-only and says so at load time; importing it
// here for one path constant takes the whole admin bundle down.
import {
  LIBRARY_ROUTE_PATH,
  PAGE_BUILDER_PLUGIN_NAME,
  type LibraryPattern,
  type LibraryResponse,
  isInsertableGranularity,
} from "../library-contract";

/**
 * What the panel needs to know about the library.
 *
 * The patterns, the categories they use, and whether the read was cut — and
 * NOTHING else, because each of those has a surface that draws it and nothing
 * more does. `usePluginRoute` also reports whether the read is still in
 * flight, which is worth drawing and is not drawn today, so it is not carried:
 * a field nothing reads is a promise about a surface that does not exist, and
 * the reader after this one cannot tell it from one that quietly stopped
 * working.
 */
export interface PatternLibraryRead {
  /**
   * The patterns to offer, empty until the read arrives.
   *
   * So the panel shows its blocks immediately and its patterns when they
   * arrive, which is what the design asks for — categories render before the
   * library resolves.
   */
  readonly patterns: readonly SavedPattern[];
  /**
   * The categories this library already uses, in the order they read best.
   *
   * Offered as SUGGESTIONS by the save form, which is what stops one library
   * growing "Hero", "hero" and "Heroes" as three groupings nobody chose. Not a
   * closed list: the useful groupings belong to the site being built, so the
   * field stays free text and a new site with no categories yet still works.
   *
   * Taken from every row the READ returned rather than from the insertable
   * ones, because a page-granularity pattern's category is a category this
   * library uses — it is simply not offered for insertion.
   *
   * Empty until the read arrives, which the form is written to expect: it takes
   * a name before the suggestions land and gains them when they do.
   */
  readonly categories: readonly string[];
  /**
   * Whether the ceiling cut the read short.
   *
   * Carried because the insert panel says so beside the tiles it offers, which
   * is where an author searches for the pattern that was left out. `false`
   * until the read arrives: a library that has not answered yet is not one
   * that was cut.
   */
  readonly truncated: boolean;
}

/**
 * Read this site's saved pattern library.
 *
 * Called from a component the shell mounts only while the insert panel is OPEN,
 * which is what keeps a library nobody is looking at from being fetched on
 * every editor mount. There is no `enabled` flag for the same reason: mounting
 * is the signal, and a second way to say it would be a second thing to get
 * wrong.
 */
export function usePatternLibrary(): PatternLibraryRead {
  const read = usePluginRoute<LibraryResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: LIBRARY_ROUTE_PATH,
    // Fresh on every mount. Patterns are created and published through the
    // ordinary collection screens, which invalidate their own keys and know
    // nothing about this route — so under the admin's five-minute default an
    // author who saved a pattern and then opened a page would be shown a
    // library their own save is missing from.
    staleTime: 0,
  });
  const patterns = useMemo(() => {
    // A stable EMPTY array while the read is in flight. A fresh `[]` on each
    // render is a new prop identity, and the panel builds its catalogue from
    // this — running the planner's preflight over every pattern in the library
    // — in a memo keyed on it. A new array each time would rebuild the whole
    // catalogue on every keystroke of the panel's own filter.
    const all = read.data?.items;
    if (all === undefined) return NO_PATTERNS;
    const insertable = all.filter(isInsertable);
    // The same stability when the filter removes nothing, which is the ordinary
    // library: `filter` allocates whether or not it dropped anything.
    return insertable.length === all.length ? all : insertable;
  }, [read.data]);
  const categories = useMemo(() => categoriesOf(read.data?.items), [read.data]);
  return {
    patterns,
    categories,
    truncated: read.data?.meta.truncated === true,
  };
}

/**
 * Every category named by a stored pattern, deduplicated and ordered.
 *
 * Case-INSENSITIVE deduplication, keeping the first spelling seen. A library
 * holding both "Heroes" and "heroes" already has the problem this list exists
 * to prevent, and offering both spellings would invite a third.
 *
 * Sorted by name rather than by frequency. A suggestion list an author scans is
 * one they can predict; ordering by how often each is used moves the entries
 * around as the library grows, so the one they reached for last time is
 * somewhere else.
 */
function categoriesOf(items: readonly LibraryPattern[] | undefined): string[] {
  if (items === undefined) return NO_CATEGORIES;
  const seen = new Map<string, string>();
  for (const item of items) {
    const name = typeof item.category === "string" ? item.category.trim() : "";
    if (name === "") continue;
    const key = name.toLocaleLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** One empty list for every read that has nothing yet; see `usePatternLibrary`. */
const NO_PATTERNS: readonly SavedPattern[] = [];
/** The same, for the categories, and for the same identity reason. */
const NO_CATEGORIES: string[] = [];

/**
 * Whether a saved pattern belongs in the INSERT list.
 *
 * A full-page pattern is a way to START a page, not something to place after
 * the block an author has selected. `SavedPattern` carries no granularity —
 * the panel judges placement from the pattern's own roots — so nothing
 * downstream can tell one apart, and a page-sized starting point would be
 * offered for insertion inside the page it is meant to be.
 *
 * Dropped here rather than at the route, because the route serves the LIBRARY
 * and this is one surface's view of it: the "start from a pattern" surface the
 * design calls for wants exactly the rows this leaves out.
 *
 * Asked as a CLOSED question, which `!== "page"` was not. That comparison
 * answers true for a granularity it has never heard of, and — the reachable
 * case — for one that is MISSING: the field is required, so absent means an
 * `afterRead` hook or a field-level read rule removed it, and a page pattern
 * whose granularity was stripped was offered for insertion. The rule lives in
 * the contract, where the vocabulary it closes over does.
 */
function isInsertable(pattern: LibraryPattern): boolean {
  return isInsertableGranularity(pattern.granularity);
}
