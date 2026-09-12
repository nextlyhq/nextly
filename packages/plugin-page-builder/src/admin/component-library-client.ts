/**
 * The site's component definitions, as the editor needs them in two shapes.
 *
 * The canvas needs a MAP by id, because that is what the renderer resolves an
 * instance against — and without one every instance on the page draws the
 * could-not-be-loaded marker, which is what the editor showed before this read
 * existed. The insert panel needs a LIST with titles and categories, because
 * that is what it draws tiles from. Both come from one read, derived once here,
 * so the tile an author places and the definition the canvas then draws are
 * the same document rather than two reads that could disagree.
 *
 * ## Why this reads on every mount of a surface that draws the page
 *
 * `usePatternLibrary` is mounted only while the insert panel is open, which
 * keeps a library nobody is looking at from being fetched. Definitions cannot
 * wait for a panel: a page that already holds instances needs them the moment
 * it is drawn — on the editor's canvas, and in the miniature the entry form
 * shows at rest, which is the same page drawn by the same renderer. So every
 * surface that draws the page reads this on mount, from its own route rather
 * than the pattern library's: the pattern tier can run to the whole byte
 * ceiling, and dragging it along to draw a header would spend that on every
 * form open.
 *
 * ## The language it reads in
 *
 * The one the surrounding document is being edited in, from the form's own
 * locale context. A component's document field can be localized, and the
 * public renderer reads definitions in the page's locale; a read that named
 * none would draw an author editing German a canvas of English components,
 * and the miniature at rest too. The language travels in the route's path,
 * which is the read hook's cache key, so switching language is a different
 * read rather than the last language's definitions served from cache. A
 * field that cannot know its language — outside any form — reads the app
 * default, which is what an absent `?locale=` means everywhere in the admin.
 *
 * ## Staleness
 *
 * Fresh on every mount, as the pattern read is and for the same reason: a
 * definition is edited through its own collection screen, which knows nothing
 * about this route, so nothing invalidates this on a write. Within one editor
 * session the definition is held still by the soft-lock lease the collection
 * screen takes to edit it, so a version stamp here would guard against a
 * change the lease already prevents.
 *
 * @module admin/component-library-client
 */
import type { BlockDocument, DefinitionsById } from "@nextlyhq/blocks-engine";
import type { SavedComponent } from "@nextlyhq/builder";
import { useDocumentLocale, usePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useEffect, useMemo, useRef } from "react";

// The CONTRACT, not the route, for the reason the pattern client gives: the
// route reaches the collection through server-only modules.
import {
  componentLibraryPath,
  PAGE_BUILDER_PLUGIN_NAME,
  type ComponentLibraryResponse,
} from "../library-contract";

import {
  libraryReadState,
  type LibraryReadState,
} from "./pattern-library-client";

/**
 * Where the read stands: in flight, answered, failed to refresh, or failed.
 *
 * The pattern read's states, by the same name, so the two tiers cannot come
 * to mean different things by "stale".
 */
export type ComponentLibraryState = LibraryReadState;

/** What one component read hands the editor. */
export interface ComponentLibraryRead {
  /**
   * The definitions the canvas resolves instances against, keyed by id.
   *
   * Empty until the read arrives, and empty for a site with no components —
   * the same value, on purpose: the renderer draws a placeholder for an
   * instance it has no definition for, and both states want exactly that.
   */
  readonly definitions: DefinitionsById;
  /** The definitions as the insert panel offers them, empty until the read arrives. */
  readonly components: readonly SavedComponent[];
  /**
   * Whether the ceiling cut the read short.
   *
   * Carried because the insert panel SAYS so beside the tiles it offers. A
   * definition left out by the ceiling still renders as a placeholder on the
   * canvas, which is the honest answer for a definition the editor did not
   * receive — and the sentence in the panel is what tells the author that the
   * placeholder is a library too large to load whole rather than a component
   * somebody deleted.
   */
  readonly truncated: boolean;
  /**
   * Where the read stands.
   *
   * The map and the list are empty until the read first answers. A read that
   * answered once and then failed to answer again keeps what it had and is
   * `stale`: the page still draws, from definitions an edit elsewhere may
   * since have changed, and the surfaces say so and offer the retry rather
   * than presenting the last answer as the current one.
   */
  readonly state: ComponentLibraryState;
  /** Ask again, ignoring anything cached. What a surface offers on `unavailable`. */
  readonly retry: () => void;
}

/**
 * Read this site's component definitions, at the editor's posture.
 *
 * `enabled` is for the surface that may not need them at all. The read is not
 * small — the route lists the whole tier, completes each row with a read of
 * its own, and is bounded at sixteen mebibytes — and every entry form holding
 * a blocks field draws the page at rest, whether or not the page places a
 * single component. A page that places none resolves nothing against these
 * definitions, so asking for them buys a miniature exactly nothing and costs
 * the library on every form open.
 *
 * A disabled read is `ready` rather than `pending`: the query never starts, so
 * its `pending` never clears, and a surface keyed on it would wait forever for
 * an answer nobody asked for. Nothing is loading and nothing failed, which is
 * what `ready` says — with the empty map, which is already the value for a
 * site with no components.
 */
export function useComponentLibrary({
  enabled = true,
}: { enabled?: boolean } = {}): ComponentLibraryRead {
  const locale = useDocumentLocale();
  const read = usePluginRoute<ComponentLibraryResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: componentLibraryPath(locale?.code),
    enabled,
    staleTime: 0,
  });
  const { data, pending, error, refetch } = read;
  // One memo for both shapes, keyed on the read's DATA and nothing else, so
  // the map and the list are always derived from the same response — and so
  // a re-render between reads hands the canvas the same map identity, which
  // is what keeps it from re-resolving every instance on every keystroke.
  // The route hook mints its `refetch` wrapper per render, so a memo keyed on
  // that too runs on every render, and rebuilt the map on each one.
  const shapes = useMemo(() => {
    if (data === undefined) return NOTHING_YET;
    // Built mutable, published read-only: the map's type is what the renderer
    // takes, and a consumer must not be able to add a definition the read did
    // not return.
    const definitions = new Map<string, BlockDocument>();
    for (const item of data.items) {
      // A row saved without content is offered nowhere and resolves nothing:
      // the panel skips a null document, and the renderer draws its
      // placeholder for an id the map does not hold.
      if (item.document !== null) definitions.set(item.id, item.document);
    }
    // The rows travel to the panel AS RECEIVED. The wire shape extends the
    // panel's own, so there is nothing to translate — and a translation here
    // was where a field the wire carried went missing on its way to a tile.
    return {
      definitions,
      components: data.items,
      truncated: data.meta.truncated,
    };
  }, [data]);
  // Read off the error and the data TOGETHER, not the data alone: the query
  // keeps its last answer when a refetch fails, and a state that called that
  // ready left the page drawn from definitions an edit elsewhere may have
  // changed, with nothing saying so and no retry.
  const state = enabled ? libraryReadState({ data, pending, error }) : "ready";
  // One retry for the life of the hook, asking whatever the read's refetch is
  // NOW. Handing the wrapper out as it arrives would change the retry's
  // identity every render, and with it everything keyed on this read.
  const latest = useRef(refetch);
  useEffect(() => {
    latest.current = refetch;
  }, [refetch]);
  const retry = useCallback(() => {
    latest.current();
  }, []);
  return useMemo(() => ({ ...shapes, state, retry }), [shapes, state, retry]);
}

/**
 * A stable EMPTY answer while the read is in flight or has failed.
 *
 * One shared map and one shared list rather than fresh ones per render, for
 * the reason the pattern client keeps `NO_PATTERNS`: the canvas re-resolves
 * when the map's identity changes, and the panel rebuilds its catalogue when
 * the list's does. The state and the retry are added per read, since only the
 * read knows them.
 */
const NOTHING_YET: Pick<
  ComponentLibraryRead,
  "definitions" | "components" | "truncated"
> = {
  definitions: new Map(),
  components: [],
  truncated: false,
};
