/**
 * What a Recent entries card draws from its rows: the field naming each row, where each row
 * links, and the fields beside it (when it was updated, and its status).
 *
 * Kept apart from the component so the reading is tested without rendering.
 */

import { buildRoute, ROUTES } from "@admin/constants/routes";
import { formatRelativeTime } from "@admin/lib/dashboard";
import { fieldLabel } from "@admin/lib/field-label";
import type { WidgetResultField } from "@admin/types/dashboard/widgets";

import { asPresentedText } from "../widgets/archetypes/cell-text";
import type { ListModel } from "../widgets/frame/list-card";
import { collectionSlugOf } from "../widgets/frame/list-view-href";

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
function entryHref(
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
 * A Recent entries card's rows as a list: each titled by its title field and leading to its
 * entry, with when it was updated (read against `now`) on the meta line and its status, as the
 * column labels it, at the row's end. A row without one of them leaves that place empty.
 */
export function recentEntriesModel(
  query: RecentEntriesQuery | undefined,
  label: string,
  columns: readonly WidgetResultField[],
  now: number
): ListModel<Record<string, unknown>> {
  const column = (name: string) => columns.find(each => each.name === name);
  return {
    titleLabel: fieldLabel({ name: label, label: column(label)?.label }),
    titleOf: item => asPresentedText(item[label], column(label)) ?? "—",
    hrefOf: item => entryHref(query, item),
    fields: [
      {
        key: "updatedAt",
        label: column("updatedAt")?.label ?? "Updated",
        role: "meta",
        align: "end",
        present: item =>
          typeof item.updatedAt === "string"
            ? formatRelativeTime(item.updatedAt, now)
            : undefined,
      },
      ...(column("status") === undefined
        ? []
        : [
            {
              key: "status",
              label: column("status")?.label ?? "Status",
              role: "trailing" as const,
              present: (item: Record<string, unknown>) =>
                asPresentedText(item.status, column("status")),
            },
          ]),
    ],
  };
}
