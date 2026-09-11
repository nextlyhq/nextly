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
 * ## Why this reads on every editor mount
 *
 * `usePatternLibrary` is mounted only while the insert panel is open, which
 * keeps a library nobody is looking at from being fetched. Definitions cannot
 * wait for a panel: a page that already holds instances needs them the moment
 * the canvas draws. So this reads on mount, and asks for the COMPONENT tier
 * alone — the pattern tier can run to the whole byte ceiling, and dragging it
 * along to draw a header would spend that on every editor open.
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
import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useMemo } from "react";

// The CONTRACT, not the route, for the reason the pattern client gives: the
// route reaches the collection through server-only modules.
import {
  COMPONENT_LIBRARY_ROUTE_PATH,
  PAGE_BUILDER_PLUGIN_NAME,
  type LibraryResponse,
} from "../library-contract";

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
   * Carried so a surface can say the library is incomplete. A definition left
   * out by the ceiling still renders as a placeholder, which is the honest
   * answer for a definition the editor did not receive.
   */
  readonly truncated: boolean;
}

/** Read this site's component definitions, at the editor's posture. */
export function useComponentLibrary(): ComponentLibraryRead {
  const read = usePluginRoute<LibraryResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: COMPONENT_LIBRARY_ROUTE_PATH,
    staleTime: 0,
  });
  // One memo for both shapes, keyed on the read's data, so the map and the
  // list are always derived from the same response — and so a re-render
  // between reads hands the canvas the same map identity, which is what keeps
  // it from re-resolving every instance on every keystroke.
  return useMemo(() => {
    const items = read.data?.components;
    if (items === undefined) return NOTHING_YET;
    // Built mutable, published read-only: the map's type is what the renderer
    // takes, and a consumer must not be able to add a definition the read did
    // not return.
    const definitions = new Map<string, BlockDocument>();
    const components: SavedComponent[] = [];
    for (const item of items) {
      components.push({
        id: item.id,
        title: item.title,
        ...(item.description === undefined
          ? {}
          : { description: item.description }),
        ...(item.category === undefined ? {} : { category: item.category }),
        document: item.document,
      });
      // A row saved without content is offered nowhere and resolves nothing:
      // the panel skips a null document, and the renderer draws its
      // placeholder for an id the map does not hold.
      if (item.document !== null) definitions.set(item.id, item.document);
    }
    return {
      definitions,
      components,
      truncated: read.data?.meta.components.truncated === true,
    };
  }, [read.data]);
}

/**
 * A stable EMPTY answer while the read is in flight.
 *
 * One shared value rather than a fresh object per render, for the reason the
 * pattern client keeps `NO_PATTERNS`: the canvas re-resolves when the map's
 * identity changes, and the panel rebuilds its catalogue when the list's does.
 */
const NOTHING_YET: ComponentLibraryRead = {
  definitions: new Map(),
  components: [],
  truncated: false,
};
