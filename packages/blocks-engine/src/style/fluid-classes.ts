/**
 * Text styles across a new fluid range: each size a text style made with
 * "Fluid…" made again from its two sizes, as a range change remakes a fluid
 * variable's value and a fluid Site text row's size.
 *
 * Here, beside the rule that writes the value, because both the save that
 * changes the range and anything checking it must remake exactly the value
 * the editor wrote.
 *
 * @module style/fluid-classes
 */
import type { NodeStyles } from "../document";
import { isPlainRecord } from "../plain-record";

import {
  fluidValue,
  isFluidSizes,
  type FluidRangeWidths,
  type FluidSizes,
} from "./fluid-value";
import type { NamedClass } from "./named-class";

/**
 * The class list with each fluid size remade across `to`.
 *
 * A device's size is remade only while it still holds the value its sizes
 * make across `from`: one typed since, or pointed at a variable, is the
 * author's and is left as it is. A class without `fluidSizes` comes back as
 * the same object, and the list itself when nothing was remade, so a caller
 * can tell by identity that nothing changed.
 *
 * @experimental
 */
export function classesAcrossFluidRange(
  classes: readonly NamedClass[],
  from: FluidRangeWidths,
  to: FluidRangeWidths
): readonly NamedClass[] {
  let changed = false;
  const across = classes.map(entry => {
    const next = classAcross(entry, from, to);
    if (next !== entry) changed = true;
    return next;
  });
  return changed ? across : classes;
}

/** One class across the new range, or the same class where nothing changes. */
function classAcross(
  entry: NamedClass,
  from: FluidRangeWidths,
  to: FluidRangeWidths
): NamedClass {
  // Read as stored data: a list may hold anything under these keys.
  const record: { readonly fluidSizes?: unknown; readonly styles?: unknown } =
    isPlainRecord(entry) ? entry : {};
  const sizes = record.fluidSizes;
  const atRest = isPlainRecord(record.styles) ? record.styles.base : undefined;
  if (!isPlainRecord(sizes) || !isPlainRecord(atRest)) return entry;
  const base = restAcross(atRest, sizes, from, to);
  if (base === atRest) return entry;
  return {
    ...entry,
    styles: { ...entry.styles, base } as NodeStyles,
  };
}

/**
 * The styles at rest, device by device, with each size its sizes made remade
 * across `to`; the same record where none is.
 */
function restAcross(
  atRest: Record<string, unknown>,
  sizes: Record<string, unknown>,
  from: FluidRangeWidths,
  to: FluidRangeWidths
): Record<string, unknown> {
  let base = atRest;
  for (const device in sizes) {
    if (!Object.hasOwn(sizes, device)) continue;
    const made = sizes[device];
    const values = atRest[device];
    if (!isFluidSizes(made) || !isPlainRecord(values)) continue;
    const remade = remadeSize(values.fontSize, made, from, to);
    if (remade === undefined) continue;
    if (base === atRest) base = { ...atRest };
    base[device] = { ...values, fontSize: remade };
  }
  return base;
}

/**
 * The size made again across `to`, or `undefined` where it is not the value
 * its sizes make across `from`, or the new value is the same.
 */
function remadeSize(
  size: unknown,
  made: FluidSizes,
  from: FluidRangeWidths,
  to: FluidRangeWidths
): string | undefined {
  if (size !== fluidValue(made, from)) return undefined;
  const remade = fluidValue(made, to);
  return remade === size ? undefined : remade;
}
