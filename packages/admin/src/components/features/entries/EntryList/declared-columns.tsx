"use client";

/**
 * Plugins' declared columns on the entry list, as table columns.
 *
 * The columns arrive ordered, filtered for this reader and scoped to this
 * collection by the place's own rule (`usePlaceContributions`), so this only
 * says how each is drawn. A `field` column draws its value through the cell
 * renderer every field column uses, so the field reads the same as it does in
 * its own column; a field this collection does not have at its top level is
 * not drawn. A
 * `component` column draws each cell through `PluginSlot`, which puts every
 * cell behind its own boundary: one cell that throws shows its fallback in
 * that cell alone. Each cell is isolated as every contribution is, so a form
 * a plugin draws in its cell submits without reaching the page's, and a
 * control it draws there runs without also opening the row's entry.
 *
 * @module components/features/entries/EntryList/declared-columns
 */
import type { DeliveredAdminEntry } from "nextly/config";
import type { KeyboardEvent, MouseEvent } from "react";

import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { IsolatedContribution } from "@admin/components/shared/target-slot/IsolatedContribution";
import { PlaceContributionFallback } from "@admin/components/shared/target-slot/PlaceContributionFallback";
import type { NextlyColumn } from "@admin/components/ui/table/data-table";

import { EntryTableCell } from "./EntryTableCell";
import {
  findTopLevelField,
  type CollectionForColumns,
} from "./EntryTableColumns";

/** What a declared column's own cell component receives. */
export interface DeclaredColumnCellProps {
  /** The place's context: who is looking, and which collection. */
  context: { userId: string; collection: string };
  /** The row, as this reader listed it. */
  row: Record<string, unknown>;
}

/** The elements whose click belongs to the cell's own control, not the row. */
const CONTROL =
  "a, button, input, select, textarea, label, summary, [role='button'], [role='link'], [role='checkbox'], [role='menuitem'], [role='switch'], [role='tab'], [contenteditable='true']";

/**
 * A click on a control the plugin drew in its cell stays in the cell: the row
 * around it opens its entry on a click, which would follow the control's own
 * action. So does any click from something the cell drew elsewhere in the
 * page through a portal, a menu or a popover, which React still passes up
 * through the cell. A click on the cell's plain content still opens the row.
 */
function keepControlClickInCell(event: MouseEvent<HTMLElement>): void {
  const target = event.target;
  const drawnElsewhere =
    !(target instanceof Node) || !event.currentTarget.contains(target);
  const control = target instanceof Element ? target.closest(CONTROL) : null;
  if (drawnElsewhere || (control && event.currentTarget.contains(control))) {
    event.stopPropagation();
  }
}

/**
 * A key pressed in the cell stays in the cell. Only a focused control inside
 * it can receive one, and the row opens its entry on Enter or Space.
 */
function keepKeyInCell(event: KeyboardEvent<HTMLElement>): void {
  event.stopPropagation();
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
      // A field the row holds under its own name: one inside a group or
      // repeater sits inside its parent's value, so it is not drawn.
      const field = findTopLevelField(collection.fields, item.field);
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
          <span
            className="contents"
            onClick={keepControlClickInCell}
            onKeyDown={keepKeyInCell}
          >
            <IsolatedContribution>
              <PluginSlot<DeclaredColumnCellProps>
                path={component}
                props={{ context, row }}
                fallback={<PlaceContributionFallback />}
              />
            </IsolatedContribution>
          </span>
        ),
      },
    ];
  });
}
