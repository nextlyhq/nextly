/**
 * Rows and component instances an earlier release stored without an id, given the same id at the
 * same place in every language, so the upgrade to one structure across languages
 * (`localisation-structures`) can keep each language's text by it.
 *
 * @module cli/commands/upgrade-steps/position-ids
 */
import { randomUUID } from "node:crypto";

import type { SharedStructureShape } from "../../../domains/i18n/shared-structure";
import { parsedValue } from "../../../shared/lib/json-column-value";
import { isPlainObject } from "../../../shared/lib/plain-copy";

/**
 * Give the rows and instances an earlier release stored without an id (a component's instances
 * held inline in a row were never given one) the same id at the same place in every language, so
 * each language's text can be kept by it. Only where every language's list there is as long as the
 * default language's: a list that differs keeps no id, and its languages then compare unequal and
 * are refused (`judge`). A row that has an id keeps it. Returns each language's value, read from
 * its stored text, with those ids given.
 */
export function withPositionIds(
  stored: ReadonlyMap<string, unknown>,
  shape: SharedStructureShape,
  defaultLocale: string
): Map<string, unknown> {
  const levels = [...stored.entries()].map(([locale, value]) => ({
    locale,
    value: parsedValue(value),
  }));
  alignLevel(
    levels.map(level => level.value),
    shape,
    levels.findIndex(level => level.locale === defaultLocale)
  );
  return new Map(levels.map(level => [level.locale, level.value]));
}

/** {@link withPositionIds} at one level: the same container's value in each language. */
function alignLevel(
  inLanguages: unknown[],
  shape: SharedStructureShape,
  primary: number
): void {
  if (shape.kind === "group") {
    if (inLanguages.every(isPlainObject)) {
      alignInside(inLanguages, shape, primary);
    }
    return;
  }
  for (const rows of rowsAtEachPlace(inLanguages, primary)) {
    giveSharedId(rows);
    alignInside(rows, shape, primary);
  }
}

/** {@link alignLevel} through each container inside `rows`, the same row in each language. */
function alignInside(
  rows: Record<string, unknown>[],
  shape: SharedStructureShape,
  primary: number
): void {
  for (const [name, nested] of Object.entries(shape.inner)) {
    alignLevel(
      rows.map(row => row[name]),
      nested,
      primary
    );
  }
}

/**
 * The rows at each place of a list held in every language, the same place in each: only where
 * every language holds a list as long as the default language's (`primary`), and each place
 * holds a row in every language. None where the lists differ, which `judge` then refuses.
 */
function rowsAtEachPlace(
  inLanguages: unknown[],
  primary: number
): Record<string, unknown>[][] {
  if (!inLanguages.every(Array.isArray)) return [];
  const lists = inLanguages as unknown[][];
  const length = lists[primary >= 0 ? primary : 0]?.length ?? 0;
  if (lists.some(list => list.length !== length)) return [];
  const places: Record<string, unknown>[][] = [];
  for (let index = 0; index < length; index += 1) {
    const rows = lists.map(list => list[index]);
    if (rows.every(isPlainObject)) places.push(rows);
  }
  return places;
}

/** Gives the same row in every language, where none of them has an id, one id minted for all. */
function giveSharedId(rows: Record<string, unknown>[]): void {
  const ids = new Set(rows.map(row => row.id));
  if (ids.size !== 1 || !(ids.has(undefined) || ids.has(""))) return;
  const id = randomUUID();
  for (const row of rows) row.id = id;
}
