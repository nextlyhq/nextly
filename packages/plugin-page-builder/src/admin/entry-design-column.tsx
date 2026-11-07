"use client";

/**
 * The entry list's Design column: which entries have their own design,
 * marked with the one own-design pill, on the lists of collections that have
 * a template and no others.
 *
 * A column is registered for a list by its key, synchronously, before the
 * plugin can know whether that collection has a template. So a provider on
 * every list (`"*"`) adds nothing itself: when a list asks for its columns,
 * it reads that collection's own designs, and only when the collection has a
 * template registers the column for that list, which the open list then
 * draws. Only that answer is kept for good. A list key that is not a collection (users, media)
 * is answered with no template and gets no column.
 *
 * Each cell reads the same cached answer (`useEntryDesigns`), so a page of
 * rows asks the server once, not once per row. On a narrow list the column
 * rides on each card, as every list column does. A provider's column is
 * appended after every field's, off screen on a wide collection, so the
 * column is moved to sit right after Status, beside the lifecycle it reads
 * with.
 *
 * @module admin/entry-design-column
 */
import {
  registerColumns,
  transformColumns,
  type NextlyColumn,
} from "@nextlyhq/plugin-sdk/admin";
import type { JSX } from "react";

import {
  designOf,
  readCollectionDesigns,
  useEntryDesigns,
} from "./entry-designs-client";
import { OwnDesignPill } from "./OwnDesignPill";

/** The column's name, out of the way of any field's. */
const DESIGN_COLUMN_NAME = "__pageBuilderOwnDesign";

/** The lists given the column, which keep it for the session. */
const columned = new Set<string>();
/** The lists whose read is out, so a redraw meanwhile asks nothing more. */
const pending = new Set<string>();
/**
 * When each list last answered that its collection has no template. Kept
 * only a short while: a collection given a template later in the session
 * gets its column the next time its list is opened, while the redraws of
 * one list view ask nothing more.
 */
const noTemplateAt = new Map<string, number>();
/** How long an answer of "no template" stands. */
const NO_TEMPLATE_FOR_MS = 30_000;
/** Whether the provider on every list is registered. */
let registered = false;

/**
 * Offer the Design column on every list whose collection has a template.
 * Safe to call more than once.
 */
export function registerEntryDesignColumn(): void {
  if (registered) return;
  registered = true;
  registerColumns("*", ({ target }) => {
    askAbout(target);
    return [];
  });
}

/**
 * Read whether `target` has a template, and register its column when it has.
 * Only that answer is kept for good; "no template", or a read that failed,
 * is asked again when the list is next drawn after a while.
 */
function askAbout(target: string): void {
  if (target === "*" || columned.has(target) || pending.has(target)) return;
  const answeredAt = noTemplateAt.get(target);
  if (
    answeredAt !== undefined &&
    Date.now() - answeredAt < NO_TEMPLATE_FOR_MS
  ) {
    return;
  }
  pending.add(target);
  readCollectionDesigns(target).then(
    answer => {
      pending.delete(target);
      if (answer === undefined || answer.meta.template === null) {
        noTemplateAt.set(target, Date.now());
        return;
      }
      noTemplateAt.delete(target);
      columned.add(target);
      registerColumns(target, () => [designColumn(target)]);
      transformColumns(target, designAfterStatus);
    },
    () => {
      pending.delete(target);
    }
  );
}

/** The Design column of `collection`'s list. */
function designColumn(collection: string): NextlyColumn {
  return {
    name: DESIGN_COLUMN_NAME,
    header: "Design",
    sortable: false,
    searchable: false,
    cell: ({ row }) => <DesignCell collection={collection} row={row} />,
  };
}

/** The entry list's lifecycle column, a collection with drafts' `status`. */
const STATUS_COLUMN_NAME = "status";

/**
 * `columns` with the Design column moved to right after Status, so it is on
 * screen beside the lifecycle rather than after every field. A list with no
 * Status column (one whose lifecycle is drawn elsewhere, or a collection
 * without drafts) takes it right after its first column, the one naming each
 * entry, for the same reason: appended, it sits past every field, off screen
 * on a wide collection. A list without the Design column is returned as it
 * came.
 */
export function designAfterStatus<Column extends { name: string }>(
  columns: Column[]
): Column[] {
  const design = columns.find(column => column.name === DESIGN_COLUMN_NAME);
  if (design === undefined) return columns;
  const rest = columns.filter(column => column !== design);
  const status = rest.findIndex(column => column.name === STATUS_COLUMN_NAME);
  const after = status === -1 ? Math.min(1, rest.length) : status + 1;
  return [...rest.slice(0, after), design, ...rest.slice(after)];
}

/** A listed row's id, as text. */
function rowIdOf(row: Record<string, unknown>): string | undefined {
  const id = row.id;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : undefined;
}

/** One row's mark: the pill for an own design, "Template" for the rest. */
export function DesignCell({
  collection,
  row,
}: {
  collection: string;
  row: Record<string, unknown>;
}): JSX.Element | null {
  const read = useEntryDesigns(collection);
  const id = rowIdOf(row);
  if (read.data === undefined) {
    // The pill's own size while the read is out, so the row does not move
    // when it lands; nothing at all once it failed.
    return read.error !== null ? null : (
      <span
        aria-hidden="true"
        className="inline-block h-[22px] w-20 animate-pulse rounded-full bg-muted"
      />
    );
  }
  const { meta } = read.data;
  const design = id === undefined ? undefined : designOf(read.data, id);
  if (design !== undefined) {
    return (
      <OwnDesignPill
        published={design.status === "published"}
        template={
          meta.template?.status === "published" ? meta.template.title : null
        }
      />
    );
  }
  // A list cut at its bound cannot say an entry past it has none.
  if (meta.hasNext) return null;
  return <span className="text-xs text-muted-foreground">Template</span>;
}
