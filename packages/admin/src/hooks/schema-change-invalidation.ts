/**
 * The content caches a schema change makes stale, asked again together.
 *
 * A schema change reaches this tab two ways: the Schema Builder's own apply
 * (`RestartContext`) and a code-first edit or an apply in another tab
 * (`RootLayout`, on `nextly:schema-updated`). Both owe the same list, so it
 * lives here once: a key added for one path and forgotten on the other would
 * leave that path showing the old schema.
 *
 * @module hooks/schema-change-invalidation
 */
import type { QueryClient } from "@tanstack/react-query";

import {
  CURRENT_USER_CAPABILITIES_KEY,
  askAccessAgain,
} from "./current-user-access";
import { fieldGroupKeys } from "./queries";

/** Ask again every content cache a schema change makes stale. */
export function invalidateContentCaches(queryClient: QueryClient): void {
  // void: the invalidations are fire-and-forget; the queries refetch on their
  // own when they observe the new key state.
  void queryClient.invalidateQueries({ queryKey: ["collections"] });
  void queryClient.invalidateQueries({ queryKey: ["entries"] });
  void queryClient.invalidateQueries({ queryKey: ["singles"] });
  void queryClient.invalidateQueries({ queryKey: ["single-documents"] });
  void queryClient.invalidateQueries({ queryKey: fieldGroupKeys.all() });
  // What the user may do with each collection and Single is answered per
  // entity, so one just added or removed is missing from that answer, or
  // still in it, until it is asked again.
  askAccessAgain(queryClient, CURRENT_USER_CAPABILITIES_KEY);
}
