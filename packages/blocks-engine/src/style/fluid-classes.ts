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
import { sameJsonValue } from "./same-token";

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

/**
 * A text style after an edit, without the fluid sizes of each device whose
 * size the edit changed: a size typed by hand, pointed at a variable or reset
 * is the author's, and sizes left beside it would be taken for the ones it was
 * made from (by a copy, a range change or "Fluid…"), and the size made again
 * from them.
 *
 * `before` is the class as it was. Only sizes it holds alike are judged:
 * sizes the edit sets anew beside the size are a "Fluid…" edit's own. With
 * `range`, a size that is the value its sizes make across it keeps them, as
 * "Fluid…" made again from the same sizes writes. The class itself where
 * nothing is dropped, and without `fluidSizes` once none is left.
 *
 * @experimental
 */
export function withoutStaleFluidSizes(
  entry: NamedClass,
  before: unknown,
  range?: FluidRangeWidths
): NamedClass {
  const sizes: unknown = isPlainRecord(entry) ? entry.fluidSizes : undefined;
  if (!isPlainRecord(sizes) || !isPlainRecord(before)) return entry;
  const was = isPlainRecord(before.fluidSizes) ? before.fluidSizes : {};
  const kept = Object.entries(sizes).filter(
    ([device, made]) =>
      !staleAt(
        {
          made,
          was: Object.hasOwn(was, device) ? was[device] : undefined,
          size: sizeAt(entry.styles, device),
          sizeWas: sizeAt(before.styles, device),
        },
        range
      )
  );
  if (kept.length === Object.keys(sizes).length) return entry;
  return withFluidSizes(entry, Object.fromEntries(kept));
}

/**
 * A text style after Undo, with the fluid sizes `before` held put back for
 * each device whose size it holds as `before` held it and has no sizes for:
 * the sizes {@link withoutStaleFluidSizes} dropped with the edit undone. The
 * class itself where none is.
 *
 * @experimental
 */
export function withFluidSizesBack(
  entry: NamedClass,
  before: NamedClass
): NamedClass {
  const sizes = before.fluidSizes;
  if (sizes === undefined) return entry;
  const own = entry.fluidSizes ?? {};
  const back = Object.entries(sizes).filter(
    ([device]) =>
      !Object.hasOwn(own, device) &&
      sameJsonValue(sizeAt(entry.styles, device), sizeAt(before.styles, device))
  );
  if (back.length === 0) return entry;
  return withFluidSizes(entry, { ...own, ...Object.fromEntries(back) });
}

/** One device's two sizes, beside its size, after an edit and before it. */
interface DeviceSizes {
  readonly made: unknown;
  readonly was: unknown;
  readonly size: unknown;
  readonly sizeWas: unknown;
}

/** Whether an edit left a device's unchanged sizes beside a size they no longer made. */
function staleAt(
  at: DeviceSizes,
  range: FluidRangeWidths | undefined
): boolean {
  if (!isFluidSizes(at.made) || !sameJsonValue(at.made, at.was)) return false;
  if (sameJsonValue(at.size, at.sizeWas)) return false;
  return range === undefined || at.size !== fluidValue(at.made, range);
}

/** One device's size at rest in styles read as stored data. */
function sizeAt(styles: unknown, device: string): unknown {
  const atRest = isPlainRecord(styles) ? styles.base : undefined;
  if (!isPlainRecord(atRest) || !Object.hasOwn(atRest, device)) {
    return undefined;
  }
  const values = atRest[device];
  return isPlainRecord(values) ? values.fontSize : undefined;
}

/** The class with these fluid sizes, or without the field for none. */
function withFluidSizes(
  entry: NamedClass,
  sizes: Record<string, unknown>
): NamedClass {
  const { fluidSizes: _replaced, ...rest } = entry;
  return Object.keys(sizes).length === 0
    ? rest
    : { ...rest, fluidSizes: sizes as NamedClass["fluidSizes"] };
}
