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
} from "../library-contract";

/**
 * What the panel needs to know about the library.
 *
 * The patterns and NOTHING else, because the panel offers a list and has no
 * surface for anything more yet. The route reports whether it truncated, and
 * `usePluginRoute` reports whether the read is still in flight — both are worth
 * drawing and neither is drawn today, so neither is carried here. A field
 * nothing reads is a promise about a surface that does not exist, and the
 * reader after this one cannot tell it from one that quietly stopped working.
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
}

/**
 * Read this site's saved pattern library.
 *
 * `enabled` exists because the panel is one tab of a shell that is often opened
 * on a different one: reading a library nobody is looking at costs a request
 * per editor mount, on every page load, for a tier the author may never open.
 */
export function usePatternLibrary(enabled = true): PatternLibraryRead {
  const read = usePluginRoute<LibraryResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: LIBRARY_ROUTE_PATH,
    enabled,
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
  return { patterns };
}

/** One empty list for every read that has nothing yet; see `usePatternLibrary`. */
const NO_PATTERNS: readonly SavedPattern[] = [];

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
 */
function isInsertable(pattern: LibraryPattern): boolean {
  return pattern.granularity !== "page";
}
