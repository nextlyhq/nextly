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
import { LIBRARY_ROUTE_PATH, type LibraryResponse } from "../library-contract";

/**
 * The name this plugin registers under, which is also how its routes are
 * addressed.
 *
 * A plugin names ITSELF when reading its own route — there is no ambient plugin
 * identity in the admin — so the literal has to be somewhere. Here rather than
 * at the call site, because the same string is the plugin's `name` and a second
 * spelling of it addresses a namespace the dispatcher does not serve.
 */
export const PAGE_BUILDER_PLUGIN_NAME = "@nextlyhq/plugin-page-builder";

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
  });
  const patterns = useMemo(
    // A stable EMPTY array while the read is in flight. A fresh `[]` on each
    // render is a new prop identity, and the panel builds its catalogue from
    // this — running the planner's preflight over every pattern in the library
    // — in a memo keyed on it. A new array each time would rebuild the whole
    // catalogue on every keystroke of the panel's own filter.
    () => read.data?.items ?? NO_PATTERNS,
    [read.data]
  );
  return { patterns };
}

/** One empty list for every read that has nothing yet; see `usePatternLibrary`. */
const NO_PATTERNS: readonly SavedPattern[] = [];
