"use client";

/**
 * The entry list's Design column: which entries have their own design,
 * marked with the one own-design pill, on the lists of collections that have
 * a template and no others.
 *
 * A column is registered for a list by its key, synchronously, before the
 * plugin can know whether that collection has a template. So a provider on
 * every list (`"*"`) adds nothing itself: the first time a list asks for its
 * columns, it reads that collection's own designs once, and only when the
 * collection has a template registers the column for that list, which the
 * open list then draws. A list key that is not a collection (users, media)
 * is answered with no template and gets no column.
 *
 * Each cell reads the same cached answer (`useEntryDesigns`), so a page of
 * rows asks the server once, not once per row. On a narrow list the column
 * rides on each card, as every list column does.
 *
 * @module admin/entry-design-column
 */
import { registerColumns, type NextlyColumn } from "@nextlyhq/plugin-sdk/admin";
import type { JSX } from "react";

import {
  designOf,
  readCollectionDesigns,
  useEntryDesigns,
} from "./entry-designs-client";
import { OwnDesignPill } from "./OwnDesignPill";

/** The column's name, out of the way of any field's. */
export const DESIGN_COLUMN_NAME = "__pageBuilderOwnDesign";

/** The list keys asked about, so each collection is read once a session. */
const asked = new Set<string>();
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
 * Read whether `target` has a template, once, and register its column when
 * it has. A read that fails is asked again the next time the list opens.
 */
function askAbout(target: string): void {
  if (target === "*" || asked.has(target)) return;
  asked.add(target);
  readCollectionDesigns(target).then(
    answer => {
      if (answer === undefined || answer.meta.template === null) return;
      registerColumns(target, () => [designColumn(target)]);
    },
    () => {
      asked.delete(target);
    }
  );
}

/** The Design column of `collection`'s list. */
export function designColumn(collection: string): NextlyColumn {
  return {
    name: DESIGN_COLUMN_NAME,
    header: "Design",
    sortable: false,
    searchable: false,
    cell: ({ row }) => <DesignCell collection={collection} row={row} />,
  };
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
