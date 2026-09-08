"use client";

/**
 * Re-read a query the schema change invalidated.
 *
 * ## Which queries need this
 *
 * `/api/admin-meta/workspace` carries the widget DECLARATIONS — including the
 * cards core derives per collection — and this provider owns those queries and
 * caches them for five minutes. The dashboard's layout endpoint, meanwhile,
 * answers fresh: a collection created a moment ago is offered in the picker
 * immediately. Without this the picker shows that card under its raw id,
 * because no declaration has arrived to give it a title, and adding it saves a
 * placement the grid then skips for want of anything to draw — addable, stored,
 * and invisible until something else happens to refetch.
 *
 * The dashboard LAYOUT goes stale for the same reason and separately: it
 * answers which cards are placed and which are offered, so a collection created
 * a moment ago is missing from the picker until something else refetches, and
 * one just deleted is still offered and then refused on save. It has no polling
 * and `refetchOnWindowFocus` only, so "something else" may be a long way off.
 *
 * The owner invalidates its own cache. `RootLayout` and `RestartContext` each
 * re-read the CONTENT caches on the same events, and neither owns either of
 * these; putting these keys in their lists would make one component responsible
 * for another's freshness.
 *
 * ## The two events
 *
 * A schema change reaches this tab two ways, and both have to be heard: the
 * Schema Builder's own apply dispatches nothing (it invalidates directly, so
 * `RestartContext` names this key too), while a code-first edit or an apply in
 * ANOTHER tab arrives as `nextly:schema-updated` from the fetcher's version
 * header check.
 *
 * @module hooks/useSchemaUpdateInvalidation
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/** The event the fetcher dispatches on a schema version bump. */
export const SCHEMA_UPDATED_EVENT = "nextly:schema-updated";

/** The queries this provider owns, both halves of the admin-meta payload. */
export const ADMIN_META_KEY = ["admin-meta"] as const;

export function useSchemaUpdateInvalidation(
  /**
   * A STABLE reference — a module-level constant, not an inline literal.
   *
   * The effect depends on it, so a fresh array each render would detach and
   * re-attach the listener on every one. Both callers pass an exported `as
   * const` key, which is also what makes the key they invalidate the same object
   * their `useQuery` registered under rather than a copy that happens to match.
   */
  queryKey: readonly unknown[]
): void {
  const queryClient = useQueryClient();
  // The key is a parameter so each OWNER re-reads its own cache. Two queries go
  // stale on a schema change and they belong to different modules: the branding
  // provider holds the widget declarations, and the dashboard layout holds which
  // cards are placed and which are offered. A single hook naming both would make
  // one module responsible for another's freshness, and a key added for one
  // consumer would silently start invalidating for the other.
  useEffect(() => {
    const handler = () => {
      void queryClient.invalidateQueries({ queryKey });
    };
    window.addEventListener(SCHEMA_UPDATED_EVENT, handler);
    return () => window.removeEventListener(SCHEMA_UPDATED_EVENT, handler);
  }, [queryClient, queryKey]);
}
