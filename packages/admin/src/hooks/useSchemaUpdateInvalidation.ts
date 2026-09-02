"use client";

/**
 * Re-read the workspace declarations when the schema changes.
 *
 * ## Why this is the branding provider's job
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
 * The owner invalidates its own cache. `RootLayout` and `RestartContext` each
 * re-read the CONTENT caches on the same events, and neither owns this one;
 * putting `admin-meta` in their lists would make three components responsible
 * for one query's freshness.
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

export function useSchemaUpdateInvalidation(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const handler = () => {
      void queryClient.invalidateQueries({ queryKey: ADMIN_META_KEY });
    };
    window.addEventListener(SCHEMA_UPDATED_EVENT, handler);
    return () => window.removeEventListener(SCHEMA_UPDATED_EVENT, handler);
  }, [queryClient]);
}
