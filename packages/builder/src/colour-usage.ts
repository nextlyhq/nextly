/**
 * Which colours the Colours tab's usage filter lists, by what the site's
 * usage count says of each (`variable-usage`) and what the open page uses.
 *
 * @module colour-usage
 */
import type { UsageState } from "./variable-usage";

/** Which colours the Colours tab lists: all, the unused, or this page's. */
export type ColourFilter = "all" | "unused" | "page";

/**
 * Whether a colour is listed under a filter: under Unused only where the
 * site's count has shown it unused, never while it is still counting.
 */
export function keepsColour(
  filter: ColourFilter,
  state: UsageState,
  onPage: boolean
): boolean {
  if (filter === "all") return true;
  return filter === "unused" ? state === "unused" : onPage;
}
