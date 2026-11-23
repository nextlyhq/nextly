/**
 * The Schema Builder's type picker asks the server what each other type would do to a saved
 * field's values (`type-change-targets`, on each kind's schema routes).
 *
 * @module services/typeChangeTargetsApi
 */
import { protectedApi } from "@admin/lib/api/protectedApi";

import type { ListResponse } from "../lib/api/response-types";

/** One type a saved field may be changed to, as the server judges it (`type-change-targets`). */
export interface TypeChangeTarget {
  type: string;
  /** Why the save refuses the change whatever the values hold; null where it does not. */
  blocked: string | null;
  /** For a change a translation rule of the save refuses, the save's own words. */
  refusal: { code: string; reason: string; steps: string[] } | null;
  /** What the change can do to the field's values; null where it is blocked. */
  outcome: "keeps" | "converts" | "may-lose" | null;
}

/**
 * What each other type would do to the saved field at `path` (its holders' names, then its own) of
 * the entity at `address` (`/collections/schema/posts`), as the type picker shows it.
 */
export async function typeChangeTargetsAt(
  address: string,
  path: readonly string[]
): Promise<TypeChangeTarget[]> {
  const result = await protectedApi.post<ListResponse<TypeChangeTarget>>(
    `${address}/type-change-targets`,
    { field: [...path] }
  );
  return result.items;
}
