/**
 * What a Recent entries card draws from its rows: the field naming each row, where each row
 * links, and the line of detail under it (its status and when it was updated).
 *
 * Kept apart from the component so the reading is tested without rendering.
 */

import { buildRoute, ROUTES } from "@admin/constants/routes";
import { formatRelativeTime } from "@admin/lib/dashboard";
import type { WidgetResultField } from "@admin/types/dashboard/widgets";

import { asPresentedText } from "../widgets/archetypes/cell-text";
import { collectionSlugOf } from "../widgets/archetypes/more-exist";

/** The query a Recent entries card asked, as far as its rows are read by it. */
export interface RecentEntriesQuery {
  source?: string;
  select?: string[];
}

/**
 * The field that names each row: the first one the card asked for, which is the collection's
 * title field (the titled Collection setting asks it first). `undefined` for a card that asked
 * for none.
 */
export function rowLabelField(
  query: RecentEntriesQuery | undefined
): string | undefined {
  return query?.select?.[0];
}

/**
 * Where a row links: its entry's edit page in the collection the card reads. `undefined` for a
 * row with no id, or a card not reading one collection.
 */
export function entryHref(
  query: RecentEntriesQuery | undefined,
  item: Record<string, unknown>
): string | undefined {
  const slug = collectionSlugOf(query?.source);
  const id = item.id;
  if (slug === undefined) return undefined;
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  return buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, { slug, id: String(id) });
}

/**
 * A row's line of detail: its status, as the column labels it, and when it was updated, read
 * against `now`. Either is left out where the row has none; nothing at all for neither.
 */
export function entryDetail(
  item: Record<string, unknown>,
  columns: readonly WidgetResultField[],
  now: number
): string | undefined {
  const status = asPresentedText(
    item.status,
    columns.find(column => column.name === "status")
  );
  const updated =
    typeof item.updatedAt === "string"
      ? formatRelativeTime(item.updatedAt, now)
      : undefined;
  const parts = [status, updated].filter(
    (part): part is string => part !== undefined && part !== ""
  );
  return parts.length === 0 ? undefined : parts.join(" · ");
}
