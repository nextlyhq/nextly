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
import { presentedCell } from "../widgets/archetypes/presented-cell";
import type { ListField, ListModel } from "../widgets/frame/list-card";
import { collectionSlugOf } from "../widgets/frame/list-view-href";
import { LeadingChip, StatusPill } from "../widgets/frame/row-parts";

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
 * entry, then every other column the answer describes, in the order the card asked for them.
 * When it was updated reads as a relative time against `now`; a column of choices, such as the
 * status, sits at the row's end, labelled as the column labels its values; any other column joins
 * the meta line. By default that is when each row was updated and its status; a reader who
 * chose the card's Fields sees those instead, in the order they chose: the table's columns
 * follow it, and the stacked row places each by its role. On a collection with a lifecycle, the
 * status is drawn as a pill: a published entry's in the tone of done, any other's plain. On one
 * without, a field named `status` is the author's own and reads as any other. Each row leads
 * with the initial of its collection's label, as `labelOf` names it, the chip every list of
 * entries leads with.
 */
export function recentEntriesModel(
  query: RecentEntriesQuery | undefined,
  label: string,
  columns: readonly WidgetResultField[],
  now: number,
  labelOf: (slug: string) => string,
  /** Whether the collection has a draft and published lifecycle, as its source says. */
  lifecycle: boolean
): ListModel<Record<string, unknown>> {
  const title = columns.find(column => column.name === label);
  const slug = collectionSlugOf(query?.source);
  const initial =
    slug === undefined ? undefined : labelOf(slug).charAt(0).toUpperCase();
  return {
    titleLabel: fieldLabel({ name: label, label: title?.label }),
    titleOf: item => asPresentedText(item[label], title) ?? "—",
    hrefOf: item => entryHref(query, item),
    ...(initial === undefined
      ? {}
      : { leadingOf: () => <LeadingChip>{initial}</LeadingChip> }),
    fields: columns
      .filter(column => column.name !== label)
      .map(
        (column): ListField<Record<string, unknown>> => ({
          key: column.name,
          label: fieldLabel(column),
          role: column.choices === undefined ? "meta" : "trailing",
          // A time or a number lines up at its column's end in the table form.
          align:
            column.type === "date" || column.type === "number"
              ? "end"
              : "start",
          present: item => {
            if (column.name === "updatedAt") {
              return typeof item.updatedAt === "string"
                ? formatRelativeTime(item.updatedAt, now)
                : undefined;
            }
            if (!lifecycle || column.name !== "status") {
              return presentedCell(item[column.name], column, now);
            }
            const text = asPresentedText(item.status, column);
            if (text === undefined) return undefined;
            return (
              <StatusPill
                tone={item.status === "published" ? "good" : "neutral"}
              >
                {text}
              </StatusPill>
            );
          },
        })
      ),
  };
}
