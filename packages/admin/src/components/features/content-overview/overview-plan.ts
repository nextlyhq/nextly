/**
 * What the Content overview shows for an address and a reader: which tables,
 * a redirect to the one kind the reader has, or the empty state.
 *
 * `/admin/content` shows a table for each kind the reader may open.
 * `/admin/collections` and `/admin/singles` show that kind's table alone, and
 * send a reader who has none of that kind but some of the other to the other's
 * address. A reader with neither is redirected nowhere: each address shows the
 * empty state.
 *
 * Pure, so the page only draws what this decides.
 *
 * @module components/features/content-overview/overview-plan
 */
import { ROUTES } from "@admin/constants/routes";
import { CHANGE_SETTINGS } from "@admin/lib/permissions/system-policy";

/** Which address the overview is drawn for. */
export type OverviewScope = "all" | "collections" | "singles";

/** Whether the reader has anything of each kind to open. */
interface Readable {
  collections: boolean;
  singles: boolean;
}

type OverviewPlan =
  /** The lists, or the answer about what the reader may do, are still out. */
  | { kind: "pending" }
  | { kind: "tables"; collections: boolean; singles: boolean }
  | { kind: "redirect"; to: string }
  | { kind: "empty" };

export function overviewPlan({
  scope,
  settled,
  readable,
}: {
  scope: OverviewScope;
  /** Whether the lists and the server's answer about access are in. */
  settled: boolean;
  readable: Readable;
}): OverviewPlan {
  // Nothing is claimed of a list filtered through no answer yet: it reads
  // exactly like a reader with nothing, which would redirect or say "empty".
  if (!settled) return { kind: "pending" };
  if (!readable.collections && !readable.singles) return { kind: "empty" };
  if (scope === "collections" && !readable.collections) {
    return { kind: "redirect", to: ROUTES.SINGLES };
  }
  if (scope === "singles" && !readable.singles) {
    return { kind: "redirect", to: ROUTES.COLLECTIONS };
  }
  return {
    kind: "tables",
    collections: scope !== "singles" && readable.collections,
    singles: scope !== "collections" && readable.singles,
  };
}

/** The page's title for each address. */
export const OVERVIEW_TITLE: Readonly<Record<OverviewScope, string>> = {
  all: "Content",
  collections: "Collections",
  singles: "Singles",
};

/** "1 collection", "8 collections". */
function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The line under the title: how many of each kind the reader may open, and on
 * the Content overview what the page is for. A kind the reader has none of is
 * not counted.
 */
export function overviewSummary({
  scope,
  collections,
  singles,
}: {
  scope: OverviewScope;
  collections: number;
  singles: number;
}): string {
  const parts = [
    collections > 0 ? counted(collections, "collection", "collections") : "",
    singles > 0 ? counted(singles, "Single", "Singles") : "",
  ].filter(part => part !== "");
  const counts = parts.join(" · ");
  return scope === "all"
    ? `${counts}. Everything editors write lives here.`
    : counts;
}

/**
 * Whether the reader may build a collection, so the empty state offers it: the
 * Schema Builder shows on this site, and the reader holds what a schema change
 * asks, create, update and delete on settings, all of them.
 */
export function mayBuildCollections(
  hasPermission: (permission: string) => boolean,
  showBuilder: boolean
): boolean {
  return showBuilder && CHANGE_SETTINGS.every(hasPermission);
}
