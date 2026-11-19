/**
 * A set's `areas` rows, and the one rule for giving an area a component:
 * that area's own row names it, keeping its place and its row id, and every
 * other row stays exactly as it was stored.
 *
 * @module layout-area-rows
 */
import type { LayoutArea } from "./collections/areas";

/** One row of a set's areas, as stored. */
export interface AreaRow {
  readonly area?: unknown;
  readonly component?: unknown;
  readonly [key: string]: unknown;
}

/**
 * A stored `areas` value as rows: the array as read, or the JSON text an
 * adapter storing the repeater as text hands back. Anything else is none.
 */
export function areaRowsOf(value: unknown): AreaRow[] {
  const rows = typeof value === "string" ? parsed(value) : value;
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is AreaRow => typeof row === "object" && row !== null
  );
}

/** `areas` with `area` naming `component`, every other row kept as stored. */
export function withArea(
  areas: readonly AreaRow[],
  area: LayoutArea,
  component: string
): AreaRow[] {
  let placed = false;
  const next: AreaRow[] = [];
  for (const entry of areas) {
    if (entry.area !== area) {
      next.push(entry);
    } else if (!placed) {
      // The area's own row keeps its place and its row id. A second row for
      // the same area, which the set's own check refuses, is not kept.
      next.push({ ...entry, area, component });
      placed = true;
    }
  }
  return placed ? next : [...next, { area, component }];
}

/** Stored JSON text, or `null` when it does not parse. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** `areas` with nothing in `area`, every other row kept as stored. */
export function withoutArea(
  areas: readonly AreaRow[],
  area: LayoutArea
): AreaRow[] {
  return areas.filter(entry => entry.area !== area);
}

/**
 * The component a row names, by id: as stored, an id, and as a form holds a
 * relationship it read, the related row. Anything else names none.
 */
function rowComponentId(row: AreaRow | undefined): string | undefined {
  const value = row?.component;
  if (typeof value === "string") return value === "" ? undefined : value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && value !== null && "id" in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id !== "") return id;
    if (typeof id === "number") return String(id);
  }
  return undefined;
}

/** The component `areas` names for `area`, by id, if any. */
export function areaComponentOf(
  areas: readonly AreaRow[],
  area: LayoutArea
): string | undefined {
  return rowComponentId(areas.find(entry => entry.area === area));
}
