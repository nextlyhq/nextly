/**
 * The state and arrangement behind grouped rows and rows that open a region
 * below them, kept out of the view so it only draws: which ids are toggled on,
 * whether the page or the list owns that, and which rows fall in which group.
 *
 * @module components/ui/table/data-table/row-groups
 */

import { useMemo, useState } from "react";

import type { DataTableGroup, DataTableGrouping } from "./types";

/** A row with what the view names it by: its id and its place in the list. */
export interface PlacedRow<Row> {
  row: Row;
  id: string;
  /** Its index in the list's rows, which the view builds element ids from. */
  index: number;
}

/** One run of rows the view draws together, under a group's header or none. */
export interface RowSection<Row> {
  group?: DataTableGroup;
  rows: PlacedRow<Row>[];
}

/**
 * The rows in the order the view draws them: each listed group in its listed
 * order, with its rows in the list's order, then any row whose group is not
 * listed, under no header. Without grouping, one section holds every row.
 */
export function sectionRows<Row extends object>(
  placed: PlacedRow<Row>[],
  grouping: DataTableGrouping<Row> | undefined
): RowSection<Row>[] {
  if (!grouping) return [{ rows: placed }];
  const byGroup = new Map<string, PlacedRow<Row>[]>(
    grouping.groups.map(group => [group.id, []])
  );
  const unlisted: PlacedRow<Row>[] = [];
  for (const entry of placed) {
    const members = byGroup.get(grouping.groupOf(entry.row));
    if (members) members.push(entry);
    else unlisted.push(entry);
  }
  const sections: RowSection<Row>[] = grouping.groups.map(group => ({
    group,
    rows: byGroup.get(group.id) ?? [],
  }));
  if (unlisted.length > 0) sections.push({ rows: unlisted });
  return sections;
}

/**
 * Whether a list has nothing to draw. A listed group is drawn even with no
 * rows, since its header carries a count and actions of its own, so a list of
 * groups is never empty. The table and the list surface above it both ask
 * this, so they agree on when the empty state stands in for the table.
 */
export function isListEmpty<Row extends object>(
  rows: readonly Row[],
  grouping: DataTableGrouping<Row> | undefined
): boolean {
  return rows.length === 0 && !grouping?.groups.length;
}

/** Which ids are on, and the one way to flip one. */
export interface ToggledIds {
  isOn: (id: string) => boolean;
  toggle: (id: string) => void;
}

/**
 * A set of ids toggled on — open rows, folded groups — owned by the page when
 * it passes `owned`, and by the list otherwise, starting from `initial`. Either
 * way `onChange` hears every flip with the whole set, so a page can start by
 * listening and take the state over later without the list changing.
 */
export function useToggledIds(
  owned: readonly string[] | undefined,
  initial: readonly string[] | undefined,
  onChange: ((ids: string[]) => void) | undefined
): ToggledIds {
  const [own, setOwn] = useState<readonly string[]>(() => initial ?? []);
  const current = owned ?? own;
  const on = useMemo(() => new Set(current), [current]);
  return {
    isOn: id => on.has(id),
    toggle: id => {
      const next = on.has(id)
        ? current.filter(other => other !== id)
        : [...current, id];
      if (owned === undefined) setOwn(next);
      onChange?.(next);
    },
  };
}

/**
 * What a group's header counts when the page states nothing: its rows in the
 * list, in words, so the number is never read out bare.
 */
export function rowCountLabel(count: number): string {
  return count === 1 ? "1 row" : `${count} rows`;
}
