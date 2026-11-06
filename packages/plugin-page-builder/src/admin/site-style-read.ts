/**
 * The editor's one read of the stored site style.
 *
 * Through the plugin's own route rather than the `site-style` Single's REST
 * read: drawing a block needs the style, and the Single's read needs Design's
 * `read-site-style`, which an author who may edit a page need not hold. The
 * route answers to anyone who may edit something the builder opens, with the
 * four stored sections exactly as the Single holds them.
 *
 * ONE query, under one key, for every surface that draws or edits the style:
 * the canvas, the inspector, Design's studios, the undo history's read-back
 * and the writers that read the document again after a save. Two reads would
 * be two answers to "what is stored", and the history waits for the read the
 * canvas draws from to catch up with a replayed write, which only holds while
 * they are the same read.
 *
 * Writes stay with the Single (`useSaveSiteStyle`), and nothing invalidates
 * this key for them, so a writer asks it again through `refetch` once its
 * write has landed.
 *
 * @module admin/site-style-read
 */
import { readPluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_STYLE_ROUTE_PATH,
  type StoredSiteStyle,
} from "../library-contract";

/** The cache entry every surface shares; the plugin's own, so no other read collides with it. */
const STORED_SITE_STYLE_KEY = [
  "plugin-page-builder",
  "stored-site-style",
] as const;

/** The stored site style as one read reports it. */
export interface StoredSiteStyleRead {
  /** The stored sections, or `undefined` until the route has answered. */
  readonly data: StoredSiteStyle | undefined;
  /**
   * Whether the first answer is still coming. A real third state beside the
   * data: nothing stored and nothing read yet look alike otherwise.
   */
  readonly isPending: boolean;
  /** Why the read failed, when it did. */
  readonly error: Error | null;
  /**
   * Whether `data` is the site as it is now: an answer read since this
   * surface mounted, or one still inside the freshness the shared cache
   * gives it. An older cached answer is shown while a new read runs, and an
   * answer kept after a later read failed is shown beside that failure;
   * neither is known to be current.
   */
  readonly current: boolean;
  /**
   * Ask the route again, resolving once it has answered, with whether that
   * read failed: a caller waiting for a write to show must not take a failed
   * read for one that caught up.
   */
  readonly refetch: () => Promise<{ readonly isError: boolean }>;
}

/** Read the stored site style through the plugin's route. */
export function useStoredSiteStyle(): StoredSiteStyleRead {
  const query = useQuery<StoredSiteStyle>({
    queryKey: STORED_SITE_STYLE_KEY,
    queryFn: async ({ signal }) => {
      const body = await readPluginRoute<StoredSiteStyle>({
        plugin: PAGE_BUILDER_PLUGIN_NAME,
        path: SITE_STYLE_ROUTE_PATH,
        signal,
      });
      // The route always answers its four sections. An empty answer is a
      // transport fault, and drawing the defaults over it would hide that.
      if (body === undefined) {
        throw new Error("The site style could not be read.");
      }
      return body;
    },
  });
  const { refetch: ask } = query;
  const refetch = useCallback(async () => {
    const answer = await ask();
    return { isError: answer.isError };
  }, [ask]);
  return {
    data: query.data,
    isPending: query.isPending,
    error: query.error,
    // `isSuccess` is false once a later read fails, even with data kept.
    current: query.isSuccess && (query.isFetchedAfterMount || !query.isStale),
    refetch,
  };
}
