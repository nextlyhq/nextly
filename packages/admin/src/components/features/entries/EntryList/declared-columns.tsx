"use client";

/**
 * Plugins' declared columns on the entry list, as table columns.
 *
 * The columns arrive ordered, filtered for this reader and scoped to this
 * collection by the place's own rule (`usePlaceContributions`), so this only
 * says how each is drawn. A `field` column draws its value through the cell
 * renderer every field column uses, so the field reads the same as it does in
 * its own column; a field this collection does not have is not drawn. A
 * `component` column draws each cell through `PluginSlot`, which puts every
 * cell behind its own boundary: one cell that throws shows its fallback in
 * that cell alone.
 *
 * @module components/features/entries/EntryList/declared-columns
 */
import type { DeliveredAdminEntry } from "nextly/config";

import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { PlaceContributionFallback } from "@admin/components/shared/target-slot/PlaceContributionFallback";
import type { NextlyColumn } from "@admin/components/ui/table/data-table";

import { EntryTableCell } from "./EntryTableCell";
import {
  findFieldByName,
  type CollectionForColumns,
} from "./EntryTableColumns";

/** What a declared column's own cell component receives. */
export interface DeclaredColumnCellProps {
  /** The place's context: who is looking, and which collection. */
  context: { userId: string; collection: string };
  /** The row, as this reader listed it. */
  row: Record<string, unknown>;
}

/**
 * The table columns `delivered` declares, in the order delivered. Built-in
 * markers, and anything not a column, are skipped: the list has no built-in
 * columns of its own to place among them.
 */
export function declaredColumns(
  delivered: readonly DeliveredAdminEntry[],
  collection: CollectionForColumns,
  context: DeclaredColumnCellProps["context"]
): NextlyColumn<Record<string, unknown>>[] {
  return delivered.flatMap((item): NextlyColumn<Record<string, unknown>>[] => {
    if ("builtIn" in item || item.kind !== "column") return [];
    const name = `declared:${item.id}`;
    if (item.field !== undefined) {
      const field = findFieldByName(collection.fields, item.field);
      if (!field?.name) return [];
      const fieldName = field.name;
      return [
        {
          name,
          header: item.label,
          sortable: false,
          accessor: row => row[fieldName],
          cell: ({ row }) => (
            <EntryTableCell
              field={field}
              value={row[fieldName]}
              entry={row}
              collectionSlug={collection.slug}
            />
          ),
        },
      ];
    }
    const component = item.component;
    return [
      {
        name,
        header: item.label,
        sortable: false,
        cell: ({ row }) => (
          <PluginSlot<DeclaredColumnCellProps>
            path={component}
            props={{ context, row }}
            fallback={<PlaceContributionFallback />}
          />
        ),
      },
    ];
  });
}
